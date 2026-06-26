import JSZip from 'jszip';
import type { WebContainer } from '@webcontainer/api';
import { markPreviewStale, getShellOutputBuffer } from '../store/webContainer';
import {
    INSTALL_FIRST_ATTEMPT_TIMEOUT_MS,
    buildSpawnEnv,
    buildSpawnOptions,
    ensureNpmCacheDir,
    hasNodeModulesInstalled,
    hasViteInstalled,
    inferProjectDirectory,
    resolveProjectDirectoryForNpm,
    resolveProjectFsPath,
    runProcessAndCollectExit,
} from './webContainerShell';
import { applyDeterministicTerminalFixes } from './terminalAutoFix';
import {
    listDependencySnapshots,
    loadDependencySnapshot,
    saveDependencySnapshot,
    type DependencySnapshotRecord,
} from './sandboxSnapshotCache';

export const MINIMAL_ROOT_PACKAGE_JSON = JSON.stringify(
    {
        name: 'generated-app',
        private: true,
        version: '0.0.0',
        type: 'module',
        scripts: {
            dev: 'node ./node_modules/vite/bin/vite.js',
            build: 'node ./node_modules/vite/bin/vite.js build',
        },
        dependencies: {
            react: '^18.3.1',
            'react-dom': '^18.3.1',
            'lucide-react': '^0.400.0',
            clsx: '^2.1.0',
            'tailwind-merge': '^2.2.0',
            'class-variance-authority': '^0.7.0',
            '@radix-ui/react-slot': '^1.0.0',
        },
        devDependencies: {
            '@types/react': '^18.3.0',
            '@types/react-dom': '^18.3.0',
            '@vitejs/plugin-react': '^4.3.0',
            typescript: '^5.5.0',
            vite: '^5.4.0',
            tailwindcss: '^4.0.0',
            '@tailwindcss/vite': '^4.0.0',
        },
    },
    null,
    2,
);

export const SNAPSHOT_TOOLCHAIN_VERSION = 'webcontainer-npm-v1';
export const DEP_FINGERPRINT_MARKER_PATH = '/.boltly/dep-fingerprint';
const SNAPSHOT_ARCHIVE_PATH = '/.boltly/dependency-snapshot.tgz';
export const VITE_REACT_BASE_FINGERPRINT = hashString(`${MINIMAL_ROOT_PACKAGE_JSON}\n---\n`);
const INSTALL_RETRY_TIMEOUT_MS = 420_000;
export const MAX_INDEXEDDB_SNAPSHOT_BYTES = 120 * 1024 * 1024;

export { buildSpawnEnv, WEBCONTAINER_SPAWN_ENV } from './webContainerShell';

const contentHashByThread = new Map<string, Map<string, string>>();

export function hashString(value: string): string {
    let hash = 5381;
    for (let i = 0; i < value.length; i += 1) {
        hash = ((hash << 5) + hash) ^ value.charCodeAt(i);
    }
    return (hash >>> 0).toString(16);
}

export function hashContent(content: string): string {
    return hashString(content);
}

const canonicalizePackageJsonForFingerprint = (content: string): string => {
    try {
        const pkg = JSON.parse(content);
        const sortKeys = (obj: Record<string, string>) =>
            Object.keys(obj)
                .sort()
                .reduce<Record<string, string>>((acc, key) => {
                    acc[key] = obj[key];
                    return acc;
                }, {});
        return JSON.stringify({
            dependencies: sortKeys(pkg.dependencies || {}),
            devDependencies: sortKeys(pkg.devDependencies || {}),
        });
    } catch {
        return content.trim();
    }
};

export const getDependencyFingerprint = (fileMap: Map<string, string>): string => {
    const pkg = canonicalizePackageJsonForFingerprint(fileMap.get('package.json') || '');
    const lock = (fileMap.get('package-lock.json') || '').replace(/\s+/g, ' ').trim();
    return hashString(`${pkg}\n---\n${lock}`);
};

export const getCriticalConfigFingerprint = (fileMap: Map<string, string>): string => {
    const packageJson = fileMap.get('package.json') || '';
    const lockfile = fileMap.get('package-lock.json') || '';
    const viteConfig = fileMap.get('vite.config.ts') || fileMap.get('vite.config.js') || '';
    const tsConfig = fileMap.get('tsconfig.json') || '';
    return hashString(`${packageJson}\n${lockfile}\n${viteConfig}\n${tsConfig}`);
};

export const parsePackageJsonDepNames = (content: string): Set<string> => {
    try {
        const pkg = JSON.parse(content);
        return new Set([
            ...Object.keys(pkg.dependencies || {}),
            ...Object.keys(pkg.devDependencies || {}),
        ]);
    } catch {
        return new Set();
    }
};

export const getAddedPackageNames = (basePkgContent: string, currentPkgContent: string): string[] => {
    const base = parsePackageJsonDepNames(basePkgContent);
    const current = parsePackageJsonDepNames(currentPkgContent);
    return [...current].filter((name) => !base.has(name));
};

export const isNpmInstallShellCommand = (command: string): boolean =>
    /^\s*npm\s+(install|i|ci)\b/i.test(command.trim());

export const filterInstallShellCommands = (commands: string[]): string[] =>
    commands.filter((c) => !isNpmInstallShellCommand(c));

type InstallPlan = {
    kind: 'ci' | 'install' | 'delta';
    label: string;
    program: string;
    args: string[];
    deltaPackages?: string[];
};

export const buildInstallPlan = (fileMap: Map<string, string>, deltaPackages: string[]): InstallPlan => {
    if (deltaPackages.length > 0) {
        return {
            kind: 'delta',
            label: `npm install ${deltaPackages.length} new package${deltaPackages.length > 1 ? 's' : ''}`,
            program: 'npm',
            args: ['install', ...deltaPackages, '--no-audit', '--no-fund', '--legacy-peer-deps', '--prefer-offline'],
            deltaPackages,
        };
    }
    const hasLockfile = !!(fileMap.get('package-lock.json') || '').trim();
    if (hasLockfile) {
        return {
            kind: 'ci',
            label: 'npm ci',
            program: 'npm',
            args: ['ci', '--no-audit', '--no-fund', '--legacy-peer-deps', '--prefer-offline'],
        };
    }
    return {
        kind: 'install',
        label: 'npm install',
        program: 'npm',
        args: ['install', '--no-audit', '--no-fund', '--legacy-peer-deps', '--prefer-offline'],
    };
};

const bytesToBase64 = (input: Uint8Array): string => {
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < input.length; i += chunkSize) {
        const chunk = input.subarray(i, i + chunkSize);
        binary += String.fromCharCode(...chunk);
    }
    return btoa(binary);
};

const isTarAvailable = async (wc: WebContainer): Promise<boolean> => {
    try {
        const proc = await wc.spawn('tar', ['--version'], { env: buildSpawnEnv('/') });
        const exitCode = await runProcessAndCollectExit(proc, 10_000);
        return exitCode === 0;
    } catch {
        return false;
    }
};

const createZipArchiveFromDirectory = async (wc: WebContainer, rootDir: string): Promise<Uint8Array | null> => {
    const zip = new JSZip();
    const walk = async (fsPath: string, relPath: string): Promise<void> => {
        const entries = await wc.fs.readdir(fsPath);
        for (const entry of entries as string[]) {
            const childFs = `${fsPath}/${entry}`;
            const childRel = relPath ? `${relPath}/${entry}` : entry;
            try {
                await wc.fs.readdir(childFs);
                zip.folder(childRel);
                await walk(childFs, childRel);
            } catch {
                try {
                    const content = await wc.fs.readFile(childFs);
                    zip.file(childRel, content);
                } catch {
                    /* ignore */
                }
            }
        }
    };
    try {
        await walk(resolveProjectFsPath(wc, rootDir, 'node_modules'), 'node_modules');
        return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
    } catch {
        return null;
    }
};

const createNodeModulesSnapshot = async (
    wc: WebContainer,
    projectDir: string,
): Promise<{ bytes: Uint8Array; format: 'tar.gz' | 'zip' } | null> => {
    const nmRel = resolveProjectFsPath(wc, projectDir, 'node_modules');
    const tarAvailable = await isTarAvailable(wc);
    if (!tarAvailable) {
        console.info('[SandboxPerf] tar_unavailable_using_js_fallback', { projectDir });
        const zipBytes = await createZipArchiveFromDirectory(wc, projectDir);
        if (!zipBytes) return null;
        return { bytes: zipBytes, format: 'zip' };
    }
    const proc = await wc.spawn('sh', ['-lc', `tar -czf "${SNAPSHOT_ARCHIVE_PATH.replace(/^\//, '')}" -C . "${nmRel}"`], {
        ...buildSpawnOptions(wc, projectDir),
    });
    const exitCode = await runProcessAndCollectExit(proc, 120_000);
    if (exitCode !== 0) return null;
    try {
        const archive = await wc.fs.readFile(SNAPSHOT_ARCHIVE_PATH.replace(/^\//, ''));
        return {
            bytes: archive instanceof Uint8Array ? archive : new Uint8Array(archive),
            format: 'tar.gz',
        };
    } catch {
        return null;
    }
};

const ZIP_WRITE_CONCURRENCY = 40;

const extractZipArchiveToDirectory = async (
    wc: WebContainer,
    projectDir: string,
    archiveBytes: Uint8Array,
    onProgress?: (message: string) => void,
): Promise<boolean> => {
    try {
        const zip = await JSZip.loadAsync(archiveBytes);
        const fileEntries = Object.values(zip.files).filter((e) => !e.dir);
        onProgress?.(`Restoring ${fileEntries.length} cached dependency files…`);
        for (let i = 0; i < fileEntries.length; i += ZIP_WRITE_CONCURRENCY) {
            const batch = fileEntries.slice(i, i + ZIP_WRITE_CONCURRENCY);
            await Promise.all(
                batch.map(async (entry) => {
                    const normalized = entry.name.replace(/\\/g, '/').replace(/^\/+/, '');
                    if (!normalized) return;
                    const fsPath = resolveProjectFsPath(wc, projectDir, normalized);
                    const folderPath = fsPath.slice(0, fsPath.lastIndexOf('/'));
                    if (folderPath) {
                        await wc.fs.mkdir(folderPath, { recursive: true });
                    }
                    const fileBytes = await entry.async('uint8array');
                    await wc.fs.writeFile(fsPath, fileBytes);
                }),
            );
        }
        return true;
    } catch {
        return false;
    }
};

const restoreNodeModulesSnapshot = async (
    wc: WebContainer,
    projectDir: string,
    archiveBytes: Uint8Array,
    archiveFormat: 'tar.gz' | 'zip' = 'tar.gz',
    onProgress?: (message: string) => void,
): Promise<boolean> => {
    if (archiveFormat === 'zip') {
        return extractZipArchiveToDirectory(wc, projectDir, archiveBytes, onProgress);
    }
    const tarAvailable = await isTarAvailable(wc);
    if (!tarAvailable) {
        return extractZipArchiveToDirectory(wc, projectDir, archiveBytes, onProgress);
    }
    try {
        await wc.fs.mkdir('.boltly', { recursive: true });
        await wc.fs.writeFile(SNAPSHOT_ARCHIVE_PATH.replace(/^\//, ''), archiveBytes);
        const archiveRel = SNAPSHOT_ARCHIVE_PATH.replace(/^\//, '');
        const proc = await wc.spawn('sh', ['-lc', `tar -xzf "${archiveRel}" -C .`], {
            ...buildSpawnOptions(wc, projectDir),
        });
        const exitCode = await runProcessAndCollectExit(proc, 120_000);
        return exitCode === 0;
    } catch {
        return false;
    }
};

const attemptRestoreFingerprintSnapshot = async (
    wc: WebContainer,
    projectDir: string,
    fingerprint: string,
    authToken: string,
    apiUrl: string,
    onProgress?: (message: string) => void,
): Promise<boolean> => {
    const indexedSnapshot = await loadDependencySnapshot(fingerprint);
    if (indexedSnapshot.status === 'hit' && indexedSnapshot.record.toolchainVersion === SNAPSHOT_TOOLCHAIN_VERSION) {
        const restored = await restoreNodeModulesSnapshot(
            wc,
            projectDir,
            indexedSnapshot.archiveBytes,
            indexedSnapshot.record.archiveFormat,
            onProgress,
        );
        if (restored) return true;
    }
    try {
        const snapshotRes = await fetch(`${apiUrl}/sandbox/snapshots/${encodeURIComponent(fingerprint)}`, {
            headers: { Authorization: `Bearer ${authToken}` },
        });
        if (!snapshotRes.ok) return false;
        const snapshotBytes = new Uint8Array(await snapshotRes.arrayBuffer());
        const isZip = snapshotBytes.length > 1 && snapshotBytes[0] === 0x50 && snapshotBytes[1] === 0x4b;
        const format: 'tar.gz' | 'zip' = isZip ? 'zip' : 'tar.gz';
        return restoreNodeModulesSnapshot(wc, projectDir, snapshotBytes, format, onProgress);
    } catch {
        return false;
    }
};

const readInstalledDependencyFingerprint = async (wc: WebContainer): Promise<string | null> => {
    try {
        const marker = await wc.fs.readFile(DEP_FINGERPRINT_MARKER_PATH.replace(/^\//, ''), 'utf-8');
        const normalized = typeof marker === 'string' ? marker.trim() : '';
        return normalized || null;
    } catch {
        return null;
    }
};

export const persistInstalledDependencyFingerprint = async (wc: WebContainer, fingerprint: string): Promise<void> => {
    try {
        await wc.fs.mkdir('.boltly', { recursive: true });
        await wc.fs.writeFile(DEP_FINGERPRINT_MARKER_PATH.replace(/^\//, ''), fingerprint);
    } catch {
        /* best effort */
    }
};

export const clearDependencyCacheMarker = async (wc: WebContainer): Promise<void> => {
    try {
        await wc.fs.rm(DEP_FINGERPRINT_MARKER_PATH.replace(/^\//, ''));
    } catch {
        /* best effort */
    }
};

const hasInstalledNodeModules = (wc: WebContainer, projectDir: string) =>
    hasNodeModulesInstalled(wc, projectDir);

const findBestAncestorSnapshot = (
    currentDepNames: Set<string>,
    snapshots: DependencySnapshotRecord[],
    targetFingerprint: string,
): DependencySnapshotRecord | null => {
    let best: DependencySnapshotRecord | null = null;
    let bestSize = -1;
    for (const record of snapshots) {
        if (record.depFingerprint === targetFingerprint) continue;
        if (!record.depNames?.length) continue;
        const subset = record.depNames.every((name) => currentDepNames.has(name));
        if (!subset) continue;
        if (record.depNames.length > bestSize) {
            best = record;
            bestSize = record.depNames.length;
        }
    }
    return best;
};

export type EnsureProjectDependenciesInput = {
    wc: WebContainer;
    threadId: string;
    fileMap: Map<string, string>;
    authToken: string;
    apiUrl: string;
    writeShellOutput: (data: string) => void;
    onPreviewStatus?: (status: 'starting' | 'error' | 'ready', message: string) => void;
    beforeInstall?: () => Promise<void>;
    repairRootForNpm?: (announce?: boolean) => Promise<void>;
    appendTerminalEvents?: (
        events: Array<{ eventType: string; payload: string; cwd?: string; exitCode?: number | null }>,
    ) => Promise<void>;
    abortIfStale?: () => boolean;
};

export type EnsureProjectDependenciesResult = {
    ok: boolean;
    depFingerprint: string;
    criticalFingerprint: string;
    projectDir: string;
    installed: boolean;
    cacheHit: boolean;
    decisionSource: string;
    deltaPackages: string[];
    errorMessage?: string;
    restoreMs: number;
    installMs: number;
};

export async function ensureProjectDependencies(
    input: EnsureProjectDependenciesInput,
): Promise<EnsureProjectDependenciesResult> {
    const {
        wc,
        threadId,
        fileMap,
        authToken,
        apiUrl,
        writeShellOutput,
        onPreviewStatus,
        beforeInstall,
        repairRootForNpm,
        appendTerminalEvents,
        abortIfStale,
    } = input;

    const depFingerprint = getDependencyFingerprint(fileMap);
    const criticalFingerprint = getCriticalConfigFingerprint(fileMap);
    const inferredProjectDir = inferProjectDirectory(fileMap);
    const projectDirResolution = await resolveProjectDirectoryForNpm(wc, fileMap, inferredProjectDir);
    const projectDir = projectDirResolution.projectDir;
    const currentPkg = fileMap.get('package.json') || '';
    const currentDepNames = parsePackageJsonDepNames(currentPkg);

    let restoreMs = 0;
    let installMs = 0;
    let hasLocalDependencyCache = false;
    let deltaPackages: string[] = [];
    let indexedSnapshotRecord: DependencySnapshotRecord | null = null;
    let indexedSnapshotBytes: Uint8Array | null = null;

    const restoreStart = performance.now();
    const localInstalledFingerprint = await readInstalledDependencyFingerprint(wc);
    const nodeModulesPresent = await hasInstalledNodeModules(wc, projectDir);
    const vitePresent = await hasViteInstalled(wc, projectDir);
    hasLocalDependencyCache = nodeModulesPresent && vitePresent && localInstalledFingerprint === depFingerprint;

    let cachedDependencyPlan: { snapshotState?: string; uploadAttemptCount?: number } | null = null;
    try {
        const cachedRes = await fetch(`${apiUrl}/sandbox/dependencies/${encodeURIComponent(depFingerprint)}`, {
            headers: { Authorization: `Bearer ${authToken}` },
        });
        if (cachedRes.ok) cachedDependencyPlan = await cachedRes.json();
    } catch {
        cachedDependencyPlan = null;
    }

    const setStatus = (message: string) => onPreviewStatus?.('starting', message);

    if (!hasLocalDependencyCache) {
        const indexedSnapshot = await loadDependencySnapshot(depFingerprint);
        if (indexedSnapshot.status === 'hit' && indexedSnapshot.record.toolchainVersion === SNAPSHOT_TOOLCHAIN_VERSION) {
            indexedSnapshotRecord = indexedSnapshot.record;
            indexedSnapshotBytes = indexedSnapshot.archiveBytes;
            const restored = await restoreNodeModulesSnapshot(
                wc,
                projectDir,
                indexedSnapshot.archiveBytes,
                indexedSnapshot.record.archiveFormat,
                setStatus,
            );
            if (restored) {
                await persistInstalledDependencyFingerprint(wc, depFingerprint);
                hasLocalDependencyCache = true;
                console.info('[SandboxPerf] indexeddb_hit', { threadId, depFingerprint, restoreMs: Math.round(performance.now() - restoreStart) });
            }
        }
    }

    if (
        cachedDependencyPlan?.snapshotState === 'upload_pending' &&
        indexedSnapshotRecord &&
        indexedSnapshotBytes &&
        (cachedDependencyPlan.uploadAttemptCount || 0) < 3
    ) {
        void fetch(
            `${apiUrl}/sandbox/snapshots/${encodeURIComponent(depFingerprint)}?toolchainVersion=${encodeURIComponent(SNAPSHOT_TOOLCHAIN_VERSION)}`,
            {
                method: 'PUT',
                headers: { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/gzip' },
                body: Uint8Array.from(indexedSnapshotBytes).buffer,
            },
        ).catch(() => undefined);
    }

    const canAttemptRemoteSnapshot = cachedDependencyPlan?.snapshotState !== 'upload_failed';
    if (!hasLocalDependencyCache && canAttemptRemoteSnapshot) {
        try {
            const snapshotRes = await fetch(`${apiUrl}/sandbox/snapshots/${encodeURIComponent(depFingerprint)}`, {
                headers: { Authorization: `Bearer ${authToken}` },
            });
            if (snapshotRes.ok) {
                const snapshotBytes = new Uint8Array(await snapshotRes.arrayBuffer());
                const isZip = snapshotBytes.length > 1 && snapshotBytes[0] === 0x50 && snapshotBytes[1] === 0x4b;
                const format: 'tar.gz' | 'zip' = isZip ? 'zip' : 'tar.gz';
                const restored = await restoreNodeModulesSnapshot(wc, projectDir, snapshotBytes, format, setStatus);
                if (restored) {
                    await persistInstalledDependencyFingerprint(wc, depFingerprint);
                    void saveDependencySnapshot({
                        depFingerprint,
                        toolchainVersion: SNAPSHOT_TOOLCHAIN_VERSION,
                        createdAt: Date.now(),
                        archiveBase64: bytesToBase64(snapshotBytes),
                        archiveFormat: format,
                        depNames: [...currentDepNames],
                        threadId,
                    }, { protectThreadId: threadId });
                    hasLocalDependencyCache = true;
                    console.info('[SandboxPerf] postgres_snapshot_hit', { threadId, depFingerprint });
                }
            }
        } catch (error) {
            console.warn('[SandboxPerf] snapshot_restore_failed', { threadId, error: String(error) });
        }
    }

    if (!hasLocalDependencyCache) {
        const cachedSnapshots = await listDependencySnapshots();
        const ancestor = findBestAncestorSnapshot(currentDepNames, cachedSnapshots, depFingerprint);
        const ancestorFingerprint = ancestor?.depFingerprint ?? VITE_REACT_BASE_FINGERPRINT;
        const baseRestored = await attemptRestoreFingerprintSnapshot(
            wc,
            projectDir,
            ancestorFingerprint,
            authToken,
            apiUrl,
            setStatus,
        );
        if (baseRestored) {
            if (depFingerprint === ancestorFingerprint) {
                await persistInstalledDependencyFingerprint(wc, depFingerprint);
                hasLocalDependencyCache = true;
                console.info('[SandboxPerf] ancestor_exact_hit', { threadId, depFingerprint: ancestorFingerprint });
            } else {
                const basePkg = ancestor?.depFingerprint === VITE_REACT_BASE_FINGERPRINT
                    ? MINIMAL_ROOT_PACKAGE_JSON
                    : cachedSnapshots.find((s) => s.depFingerprint === ancestorFingerprint)?.packageJsonSnapshot
                        ?? MINIMAL_ROOT_PACKAGE_JSON;
                deltaPackages = getAddedPackageNames(basePkg, currentPkg);
                setStatus(
                    deltaPackages.length > 0
                        ? `Restoring cached stack, installing ${deltaPackages.length} new package${deltaPackages.length > 1 ? 's' : ''}…`
                        : 'Restoring cached dependency stack…',
                );
                console.info('[SandboxPerf] ancestor_delta', { threadId, ancestorFingerprint, deltaPackages });
            }
        }
    } else {
        setStatus('Restored dependencies from cache.');
        console.info('[SandboxPerf] install_skipped_cache_hit', { threadId, depFingerprint });
    }

    restoreMs = Math.round(performance.now() - restoreStart);
    const shouldInstall = !hasLocalDependencyCache;
    const decisionSource = hasLocalDependencyCache ? 'local_cache_hit' : 'install_required';

    console.info('[SandboxDecision] install_gate', {
        threadId,
        depFingerprint,
        shouldInstall,
        decisionSource,
        deltaPackages,
        restoreMs,
    });

    if (abortIfStale?.()) {
        return {
            ok: false,
            depFingerprint,
            criticalFingerprint,
            projectDir,
            installed: false,
            cacheHit: hasLocalDependencyCache,
            decisionSource,
            deltaPackages,
            errorMessage: 'Stale thread switch',
            restoreMs,
            installMs: 0,
        };
    }

    if (!shouldInstall) {
        const viteOk = await hasViteInstalled(wc, projectDir);
        if (viteOk) {
            return {
                ok: true,
                depFingerprint,
                criticalFingerprint,
                projectDir,
                installed: false,
                cacheHit: true,
                decisionSource,
                deltaPackages,
                restoreMs,
                installMs: 0,
            };
        }
        writeShellOutput(
            '\r\n\x1b[33m⚠ Dependency cache marker found but vite is missing — running npm install…\x1b[0m\r\n',
        );
    }

    const installStart = performance.now();
    if (repairRootForNpm) await repairRootForNpm(true);
    if (beforeInstall) await beforeInstall();
    await ensureNpmCacheDir(wc, projectDir);

    const installPlan = buildInstallPlan(fileMap, deltaPackages);
    writeShellOutput(`\r\n\x1b[36m⬢ ${installPlan.label}...\x1b[0m\r\n`);
    onPreviewStatus?.(
        'starting',
        installPlan.kind === 'delta'
            ? `Installing ${installPlan.deltaPackages?.length ?? 0} new packages…`
            : installPlan.kind === 'ci'
                ? 'Installing dependencies from lockfile…'
                : 'Installing dependencies…',
    );

    const runInstallAttempt = async (timeoutMs: number): Promise<number> => {
        const cmdPayload = `${installPlan.program} ${installPlan.args.join(' ')}`;
        await appendTerminalEvents?.([
            { eventType: 'command', payload: cmdPayload, cwd: projectDir },
        ]);
        const installProc = await wc.spawn(installPlan.program, installPlan.args, buildSpawnOptions(wc, projectDir));
        installProc.output.pipeTo(new WritableStream({ write(data) { writeShellOutput(data); } }));
        const exitCode = await runProcessAndCollectExit(installProc, timeoutMs);
        await appendTerminalEvents?.([
            { eventType: 'status', payload: `${installPlan.label} exit ${exitCode}`, cwd: projectDir, exitCode: exitCode },
        ]);
        return exitCode;
    };

    let installExit = 0;
    for (let attempts = 0; attempts < 2; attempts += 1) {
        const timeoutMs = attempts === 0 ? INSTALL_FIRST_ATTEMPT_TIMEOUT_MS : INSTALL_RETRY_TIMEOUT_MS;
        installExit = await runInstallAttempt(timeoutMs);
        if (installExit === 0) break;
        if (attempts === 0) {
            writeShellOutput('\r\n\x1b[33m⚠ Install failed once, retrying with extended timeout...\x1b[0m\r\n');
        }
    }

    if (installExit !== 0) {
        const tailOutput = getShellOutputBuffer().slice(-12_000);
        const fixes = await applyDeterministicTerminalFixes({
            wc,
            terminalOutput: tailOutput,
            projectDir,
            fileMap,
            repairRootForNpm,
        });
        if (fixes.some((f) => f.applied)) {
            await ensureNpmCacheDir(wc, projectDir);
            writeShellOutput('\r\n\x1b[36m⬢ Retrying install after automatic fix…\x1b[0m\r\n');
            installExit = await runInstallAttempt(INSTALL_RETRY_TIMEOUT_MS);
        }
    }

    installMs = Math.round(performance.now() - installStart);
    console.info('[SandboxPerf] npm_install_ms', { threadId, depFingerprint, installMs, exitCode: installExit });

    if (installExit !== 0) {
        const msg = installExit === -1
            ? `${installPlan.label} timed out. Agent will attempt automatic recovery…`
            : `${installPlan.label} failed (exit ${installExit}). Agent will attempt automatic recovery…`;
        onPreviewStatus?.('error', msg);
        writeShellOutput(`\r\n\x1b[31m✗ ${msg}\x1b[0m\r\n`);
        return {
            ok: false,
            depFingerprint,
            criticalFingerprint,
            projectDir,
            installed: true,
            cacheHit: false,
            decisionSource,
            deltaPackages,
            errorMessage: msg,
            restoreMs,
            installMs,
        };
    }

    await persistInstalledDependencyFingerprint(wc, depFingerprint);
    const snapshotBytes = await createNodeModulesSnapshot(wc, projectDir);
    if (snapshotBytes) {
        const estimatedIndexedDbBytes = Math.ceil(snapshotBytes.bytes.length * 1.37);
        if (estimatedIndexedDbBytes <= MAX_INDEXEDDB_SNAPSHOT_BYTES) {
            void saveDependencySnapshot({
                depFingerprint,
                toolchainVersion: SNAPSHOT_TOOLCHAIN_VERSION,
                createdAt: Date.now(),
                archiveBase64: bytesToBase64(snapshotBytes.bytes),
                archiveFormat: snapshotBytes.format,
                depNames: [...currentDepNames],
                threadId,
                packageJsonSnapshot: currentPkg,
            }, { protectThreadId: threadId });
        } else {
            console.warn('[SandboxPerf] indexeddb_snapshot_too_large', { threadId, bytes: estimatedIndexedDbBytes });
        }
        void fetch(
            `${apiUrl}/sandbox/snapshots/${encodeURIComponent(depFingerprint)}?toolchainVersion=${encodeURIComponent(SNAPSHOT_TOOLCHAIN_VERSION)}`,
            {
                method: 'PUT',
                headers: { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/gzip' },
                body: Uint8Array.from(snapshotBytes.bytes).buffer,
            },
        ).catch(() => undefined);
    }

    return {
        ok: true,
        depFingerprint,
        criticalFingerprint,
        projectDir,
        installed: true,
        cacheHit: false,
        decisionSource,
        deltaPackages,
        restoreMs,
        installMs,
    };
}

/** Run install gate and verify vite exists on disk before starting the dev server. */
export async function ensureDepsReadyForDev(
    input: EnsureProjectDependenciesInput,
): Promise<EnsureProjectDependenciesResult> {
    let result = await ensureProjectDependencies(input);
    if (!result.ok) return result;
    if (await hasViteInstalled(input.wc, result.projectDir)) return result;

    input.writeShellOutput(
        '\r\n\x1b[33m⚠ vite missing from node_modules — clearing stale cache marker and running npm install…\x1b[0m\r\n',
    );
    await clearDependencyCacheMarker(input.wc);
    result = await ensureProjectDependencies(input);
    return result;
}

export type SyncProjectFilesResult = {
    written: number;
    skipped: number;
    deleted: number;
    ms: number;
};

export async function syncProjectFiles(
    wc: WebContainer,
    threadId: string,
    fileMap: Map<string, string>,
    filesToDelete: string[],
): Promise<SyncProjectFilesResult> {
    const started = performance.now();
    let written = 0;
    let skipped = 0;
    let deleted = 0;

    if (!contentHashByThread.has(threadId)) {
        contentHashByThread.set(threadId, new Map());
    }
    const hashMap = contentHashByThread.get(threadId)!;

    for (const filePath of filesToDelete) {
        try {
            await wc.fs.rm(filePath);
            hashMap.delete(filePath.replace(/^\//, ''));
            deleted += 1;
        } catch {
            /* ignore */
        }
    }

    for (const [filePath, content] of fileMap) {
        const normalized = filePath.replace(/^\//, '');
        const contentHash = hashContent(content);
        if (hashMap.get(normalized) === contentHash) {
            skipped += 1;
            continue;
        }
        try {
            const absPath = normalized;
            const dir = absPath.substring(0, absPath.lastIndexOf('/'));
            if (dir) {
                try { await wc.fs.mkdir(dir, { recursive: true }); } catch { /* exists */ }
            }
            await wc.fs.writeFile(absPath, content);
            hashMap.set(normalized, contentHash);
            written += 1;
        } catch (err) {
            console.error(`[syncProjectFiles] Failed to write ${filePath}:`, err);
        }
    }

    const ms = Math.round(performance.now() - started);
    console.info('[SandboxPerf] file_sync_ms', { threadId, written, skipped, deleted, ms });
    if (written > 0 || deleted > 0) {
        markPreviewStale();
    }
    return { written, skipped, deleted, ms };
}
