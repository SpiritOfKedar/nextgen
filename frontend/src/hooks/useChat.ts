import { useCallback, useState } from 'react';
import { useAtom, useSetAtom, useAtomValue } from 'jotai';
import { messagesAtom, currentThreadIdAtom, threadSwitchStateAtom, threadsAtom, selectedModelAtom, chatModeAtom } from '../store/atoms';
import {
    previewStatusAtom,
    previewStatusMessageAtom,
    sandboxRuntimeMetadataAtom,
    webContainerAtom,
    serverUrlAtom,
    shellInputWriterAtom,
    terminalSessionByThreadAtom,
    recoveryAuditsByThreadAtom,
    terminalStatusByThreadAtom,
    terminalIssueByThreadAtom,
    writeShellOutput,
} from '../store/webContainer';
import { getWebContainerInstance } from './useWebContainer';
import { fileSystemAtom, activeFileAtom } from '../store/fileSystem';
import type { FileSystemItem, FileNode, FolderNode, ActiveFile } from '../store/fileSystem';
import { useAuth } from '@clerk/clerk-react';
import { useNavigate } from 'react-router-dom';
import { BoltParser } from '../lib/boltProtocol';
import type { BoltAction } from '../lib/boltProtocol';
import { loadDependencySnapshot, saveDependencySnapshot } from '../lib/sandboxSnapshotCache';
import JSZip from 'jszip';
import { detectTerminalIssue } from '../lib/terminalIssues';

// Strip bolt protocol XML tags from content for display in chat
// Preserves narrative text and generates clean file summaries
const stripBoltTags = (text: string): string => {
    // 1. Remove complete boltAction blocks (with closing tag)
    let narrative = text
        .replace(/<boltAction[^>]*>[\s\S]*?<\/boltAction>/g, '');

    // 2. Remove any UNCLOSED boltAction tag and everything after it
    //    (during streaming, the closing tag hasn't arrived yet)
    const unclosedActionIdx = narrative.indexOf('<boltAction');
    if (unclosedActionIdx !== -1) {
        narrative = narrative.substring(0, unclosedActionIdx);
    }

    // 3. Remove artifact wrapper tags
    narrative = narrative
        .replace(/<boltArtifact[^>]*>/g, '')
        .replace(/<\/boltArtifact>/g, '')
        .replace(/<\/boltAction>/g, '')
        .trim();

    // 4. Also strip anything after an unclosed <boltArtifact (streaming edge case)
    const unclosedArtifactIdx = narrative.indexOf('<boltArtifact');
    if (unclosedArtifactIdx !== -1) {
        narrative = narrative.substring(0, unclosedArtifactIdx).trim();
    }

    // 5. Extract file info for summary
    const fileActions = extractFileActions(text);

    // 6. Build final output
    const parts: string[] = [];

    // Add file summary if there are files
    if (fileActions.length > 0) {
        const fileList = fileActions
            .filter(a => a.filePath)
            .map(a => `- \`${a.filePath}\``)
            .join('\n');
        parts.push(`Generated ${fileActions.length} file${fileActions.length > 1 ? 's' : ''}:\n${fileList}`);
    }

    // Add narrative if present (clean up excessive whitespace)
    if (narrative) {
        const cleaned = narrative
            .replace(/\n{3,}/g, '\n\n')  // Collapse 3+ newlines to 2
            .trim();
        if (cleaned) {
            parts.push(cleaned);
        }
    }

    return parts.join('\n\n') || 'Generated code.';
};

// Extract all file actions from a complete message (non-streaming)
const extractFileActions = (content: string): BoltAction[] => {
    const actions: BoltAction[] = [];
    // Match boltAction with type and filePath in any order
    const regex = /<boltAction\s+(?:[^>]*?)type="file"(?:[^>]*?)filePath="([^"]+)"[^>]*>([\s\S]*?)<\/boltAction>/g;
    let match;
    while ((match = regex.exec(content)) !== null) {
        actions.push({
            type: 'file',
            filePath: match[1],
            content: match[2],
        });
    }
    // Also try reverse attribute order: filePath before type
    const regex2 = /<boltAction\s+(?:[^>]*?)filePath="([^"]+)"(?:[^>]*?)type="file"[^>]*>([\s\S]*?)<\/boltAction>/g;
    while ((match = regex2.exec(content)) !== null) {
        // Avoid duplicates
        if (!actions.some(a => a.filePath === match![1])) {
            actions.push({
                type: 'file',
                filePath: match[1],
                content: match[2],
            });
        }
    }
    return actions;
};

// Helper: insert or update a file in the file system atom tree
// Returns a brand-new tree with new references on the modified path so React detects the change
const upsertFile = (tree: FileSystemItem[], filePath: string, content: string): FileSystemItem[] => {
    // Normalize: remove leading slash
    const normalized = filePath.replace(/^\//, '');
    const segments = normalized.split('/');
    const fileName = segments.pop()!;
    if (!fileName) return tree;

    // If no subdirectories, insert/update at root level
    if (segments.length === 0) {
        const idx = tree.findIndex(n => n.type === 'file' && n.name === fileName);
        const fileNode: FileNode = { type: 'file', name: fileName, content };
        if (idx >= 0) {
            return tree.map((n, i) => i === idx ? fileNode : n);
        }
        return [...tree, fileNode];
    }

    // Recursively build/descend into folders
    const folderName = segments[0];
    const remainingPath = [...segments.slice(1), fileName].join('/');

    const existingFolder = tree.find(n => n.type === 'folder' && n.name === folderName) as FolderNode | undefined;

    if (existingFolder) {
        // Clone the folder with updated children
        const updatedFolder: FolderNode = {
            ...existingFolder,
            children: upsertFile(existingFolder.children, remainingPath, content),
        };
        return tree.map(n => (n === existingFolder ? updatedFolder : n));
    }

    // Folder doesn't exist — create it
    const newFolder: FolderNode = {
        type: 'folder',
        name: folderName,
        isOpen: true,
        children: upsertFile([], remainingPath, content),
    };
    return [...tree, newFolder];
};

// Built-in/core modules that should never be added to package.json
const BUILTIN_MODULES = new Set([
    'react', 'react-dom', 'react/jsx-runtime', 'react-dom/client',
    'fs', 'path', 'os', 'url', 'util', 'crypto', 'stream', 'events',
    'http', 'https', 'child_process', 'assert', 'buffer', 'querystring',
    'zlib', 'net', 'tls', 'vite', 'typescript',
]);

/** Vite + React + Tailwind v4 baseline when the model forgets root package.json (prevents ENOENT on npm). */
const MINIMAL_ROOT_PACKAGE_JSON = JSON.stringify(
    {
        name: 'generated-app',
        private: true,
        version: '0.0.0',
        type: 'module',
        scripts: { dev: 'vite', build: 'vite build' },
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

const normalizeWrittenPath = (p: string) => p.replace(/^\//, '').replace(/\\/g, '/');

const getRootPackageJsonFromMap = (writtenFiles: Map<string, string>): string | undefined => {
    for (const [k, v] of writtenFiles) {
        if (normalizeWrittenPath(k) === 'package.json') return v;
    }
    return undefined;
};

/** Readable valid root package.json on disk (WebContainer may use `package.json` or `/package.json`). */
async function hasValidRootPackageJsonOnDisk(wc: any): Promise<boolean> {
    for (const p of ['package.json', '/package.json']) {
        try {
            const raw = await wc.fs.readFile(p, 'utf-8');
            if (!raw?.trim()) continue;
            JSON.parse(raw);
            return true;
        } catch {
            /* missing or invalid */
        }
    }
    return false;
}

/**
 * Recover from broken npm state: package-lock.json exists but package.json is missing/invalid
 * (interrupted install, rm, or path mismatch). Removes stale lock and writes minimal package.json.
 */
async function repairRootForNpm(wc: any, announce = true): Promise<void> {
    if (!wc) return;
    if (await hasValidRootPackageJsonOnDisk(wc)) return;

    for (const lock of ['package-lock.json', '/package-lock.json']) {
        try {
            await wc.fs.rm(lock);
        } catch {
            /* */
        }
    }
    for (const p of ['package.json', '/package.json']) {
        try {
            await wc.fs.writeFile(p, MINIMAL_ROOT_PACKAGE_JSON);
        } catch {
            /* try alternate path */
        }
    }
    if (announce) {
        writeShellOutput(
            '\r\n\x1b[33m⚠ Missing or invalid package.json (stale lock or interrupted install). Removed package-lock.json and wrote minimal package.json.\x1b[0m\r\n',
        );
    }
}

/**
 * Models sometimes skip package.json or emit npm shell actions anyway. WebContainer runs npm in `/`,
 * so missing root package.json yields ENOENT. Write a minimal scaffold before npm runs.
 */
async function ensureRootPackageJsonExists(
    writtenFiles: Map<string, string>,
    wc: any,
    setFileSystem: (updater: (prev: FileSystemItem[]) => FileSystemItem[]) => void,
): Promise<void> {
    const fromMap = getRootPackageJsonFromMap(writtenFiles);
    if (fromMap) {
        try {
            JSON.parse(fromMap);
            writtenFiles.set('package.json', fromMap);
            return;
        } catch {
            for (const k of [...writtenFiles.keys()]) {
                if (normalizeWrittenPath(k) === 'package.json') writtenFiles.delete(k);
            }
        }
    }

    if (wc) {
        for (const p of ['/package.json', 'package.json']) {
            try {
                const existing = await wc.fs.readFile(p, 'utf-8');
                if (existing?.trim()) {
                    try {
                        JSON.parse(existing);
                        writtenFiles.set('package.json', existing);
                        setFileSystem((prev) => upsertFile(prev, 'package.json', existing));
                        return;
                    } catch {
                        /* invalid JSON — fall through to rewrite */
                    }
                }
            } catch {
                /* missing */
            }
        }
        try {
            await repairRootForNpm(wc, false);
        } catch (err) {
            console.error('[useChat] Failed to repair/write fallback package.json:', err);
            return;
        }
    }

    writtenFiles.set('package.json', MINIMAL_ROOT_PACKAGE_JSON);
    setFileSystem((prev) => upsertFile(prev, 'package.json', MINIMAL_ROOT_PACKAGE_JSON));
    writeShellOutput(
        '\r\n\x1b[33m⚠ No valid root package.json from the model — wrote a minimal Vite/React scaffold so npm can run.\x1b[0m\r\n',
    );
}

/** Dedupe commands and run `npm install` before `npm run dev` even if the model emitted them out of order. */
const normalizeShellCommandQueue = (commands: string[]): string[] => {
    const trimmed = commands.map((c) => c.trim()).filter(Boolean);
    const seen = new Set<string>();
    const unique: string[] = [];
    for (const c of trimmed) {
        const key = c.replace(/\s+/g, ' ');
        if (seen.has(key)) continue;
        seen.add(key);
        unique.push(c);
    }
    const isNpmInstall = (c: string) => /^npm\s+install\b/i.test(c);
    const isNpmDev = (c: string) => /^npm\s+run\s+dev\b/i.test(c);
    const installs = unique.filter(isNpmInstall);
    const devs = unique.filter(isNpmDev);
    const rest = unique.filter((c) => !isNpmInstall(c) && !isNpmDev(c));
    return [...installs, ...devs, ...rest];
};

const normalizeWebContainerPath = (path: string): string => {
    const normalized = path.replace(/\\/g, '/').trim();
    if (!normalized) return '/';
    const parts = normalized.split('/').filter(Boolean);
    return `/${parts.join('/')}`;
};

const resolveWorkingDirectory = (currentDir: string, targetPath: string): string => {
    const cleaned = targetPath.trim().replace(/^["']|["']$/g, '');
    if (!cleaned || cleaned === '.') return currentDir;
    if (cleaned === '/') return '/';
    if (cleaned === '..') {
        const parts = currentDir.split('/').filter(Boolean);
        return parts.length <= 1 ? '/' : `/${parts.slice(0, -1).join('/')}`;
    }
    if (cleaned.startsWith('/')) {
        return normalizeWebContainerPath(cleaned);
    }
    const base = currentDir === '/' ? '' : currentDir;
    return normalizeWebContainerPath(`${base}/${cleaned}`);
};

const splitCdAndCommand = (command: string): { nextDir: string | null; remainder: string | null } => {
    const trimmed = command.trim();
    const chained = trimmed.match(/^cd\s+(.+?)\s*&&\s*(.+)$/i);
    if (chained) {
        return {
            nextDir: chained[1].trim(),
            remainder: chained[2].trim(),
        };
    }
    const onlyCd = trimmed.match(/^cd\s+(.+)$/i);
    if (onlyCd) {
        return {
            nextDir: onlyCd[1].trim(),
            remainder: null,
        };
    }
    return { nextDir: null, remainder: trimmed };
};

const inferProjectDirectory = (writtenFiles: Map<string, string>): string => {
    if (writtenFiles.has('package.json')) return '/';
    for (const key of writtenFiles.keys()) {
        const normalized = normalizeWrittenPath(key);
        if (!normalized.endsWith('/package.json')) continue;
        const dir = normalized.slice(0, -'/package.json'.length);
        if (!dir || dir === 'node_modules') continue;
        return normalizeWebContainerPath(dir);
    }
    return '/';
};

const hasValidPackageJsonInDir = async (wc: any, dir: string): Promise<boolean> => {
    const normalizedDir = normalizeWebContainerPath(dir);
    const packagePath = normalizedDir === '/' ? '/package.json' : `${normalizedDir}/package.json`;
    try {
        const raw = await wc.fs.readFile(packagePath, 'utf-8');
        if (!raw?.trim()) return false;
        JSON.parse(raw);
        return true;
    } catch {
        return false;
    }
};

const resolveProjectDirectoryForNpm = async (
    wc: any,
    fileMap: Map<string, string>,
    inferredDir: string,
): Promise<{ projectDir: string; packageJsonPath: string | null; reasonCode: string }> => {
    const candidates: string[] = [];
    const pushCandidate = (dir: string) => {
        const normalized = normalizeWebContainerPath(dir);
        if (!candidates.includes(normalized)) candidates.push(normalized);
    };
    pushCandidate(inferredDir);
    pushCandidate('/');
    for (const key of fileMap.keys()) {
        const normalized = normalizeWrittenPath(key);
        if (!normalized.endsWith('/package.json')) continue;
        const dir = normalized.slice(0, -'/package.json'.length);
        if (!dir || dir === 'node_modules') continue;
        pushCandidate(dir);
    }

    for (const candidate of candidates) {
        const exists = await hasValidPackageJsonInDir(wc, candidate);
        if (!exists) continue;
        return {
            projectDir: candidate,
            packageJsonPath: candidate === '/' ? '/package.json' : `${candidate}/package.json`,
            reasonCode: candidate === normalizeWebContainerPath(inferredDir) ? 'inferred_project_dir' : 'fallback_probe_dir',
        };
    }

    return {
        projectDir: normalizeWebContainerPath(inferredDir),
        packageJsonPath: null,
        reasonCode: 'package_json_missing_all_candidates',
    };
};

const syncShellWorkingDirectory = async (
    shellWriter: WritableStreamDefaultWriter<string> | null,
    projectDir: string,
): Promise<void> => {
    if (!shellWriter) return;
    const normalizedDir = normalizeWebContainerPath(projectDir);
    if (lastSyncedShellCwd === normalizedDir) return;
    try {
        await shellWriter.write(`cd "${normalizedDir}"\n`);
        lastSyncedShellCwd = normalizedDir;
    } catch {
        // best effort only
    }
};

/**
 * Scan all written source files for import statements that reference packages
 * NOT listed in package.json. If found, patch package.json with the missing
 * packages and rewrite it to WebContainer before npm install runs.
 */
async function patchMissingDependencies(
    writtenFiles: Map<string, string>,
    wc: any,
    setFileSystem: (updater: (prev: FileSystemItem[]) => FileSystemItem[]) => void,
) {
    const pkgContent = getRootPackageJsonFromMap(writtenFiles);
    if (!pkgContent) return;

    let pkg: any;
    try { pkg = JSON.parse(pkgContent); } catch { return; }

    const allDeps = new Set([
        ...Object.keys(pkg.dependencies || {}),
        ...Object.keys(pkg.devDependencies || {}),
    ]);

    // Scan all source files for imports
    const importRegex = /(?:import\s[\s\S]*?from\s+['"]([^'"./][^'"]*?)['"]|require\s*\(\s*['"]([^'"./][^'"]*?)['"]\s*\))/g;
    const missingPackages = new Set<string>();

    for (const [filePath, content] of writtenFiles) {
        if (!/\.(tsx?|jsx?|mts|cts)$/.test(filePath)) continue;
        if (filePath === 'vite.config.ts') continue; // dev deps handled separately
        let match;
        importRegex.lastIndex = 0;
        while ((match = importRegex.exec(content)) !== null) {
            const raw = match[1] || match[2];
            if (!raw) continue;
            const pkgName = raw.startsWith('@')
                ? raw.split('/').slice(0, 2).join('/')
                : raw.split('/')[0];
            if (!allDeps.has(pkgName) && !BUILTIN_MODULES.has(pkgName)) {
                missingPackages.add(pkgName);
            }
        }
    }

    if (missingPackages.size === 0) return;

    console.log('[useChat] Auto-patching missing deps:', [...missingPackages]);

    if (!pkg.dependencies) pkg.dependencies = {};
    for (const p of missingPackages) {
        pkg.dependencies[p] = 'latest';
    }

    const patchedPkg = JSON.stringify(pkg, null, 2);
    writtenFiles.set('package.json', patchedPkg);

    // Write patched package.json to WebContainer
    if (wc) {
        try {
            await wc.fs.writeFile('/package.json', patchedPkg);
        } catch (err) {
            console.error('[useChat] Failed to write patched package.json:', err);
        }
    }

    // Update file tree atom
    setFileSystem((prev) => upsertFile(prev, 'package.json', patchedPkg));
}

let latestThreadSwitchSeq = 0;

type ThreadRuntimeMetadata = {
    depFingerprint: string;
    criticalFingerprint: string;
    projectDir: string;
    lastAppliedSeq: number;
    installSucceeded: boolean;
    lastBootAt: number;
    knownFiles: Set<string>;
    installFailureReason?: string;
};

const threadRuntimeMeta = new Map<string, ThreadRuntimeMetadata>();
let mountedProjectFiles = new Set<string>();
const mountedFilesByThread = new Map<string, Set<string>>();
let activeMountedThreadId: string | null = null;
let activeDevProcess: any = null;
let activeDevServerFingerprint: string | null = null;
let activeCriticalFingerprint: string | null = null;
let lastSyncedShellCwd: string | null = null;

const hashString = (value: string): string => {
    let hash = 5381;
    for (let i = 0; i < value.length; i += 1) {
        hash = ((hash << 5) + hash) ^ value.charCodeAt(i);
    }
    return (hash >>> 0).toString(16);
};

const getDependencyFingerprint = (fileMap: Map<string, string>): string => {
    const pkg = fileMap.get('package.json') || '';
    const lock = fileMap.get('package-lock.json') || '';
    return hashString(`${pkg}\n---\n${lock}`);
};

const getCriticalConfigFingerprint = (fileMap: Map<string, string>): string => {
    const packageJson = fileMap.get('package.json') || '';
    const lockfile = fileMap.get('package-lock.json') || '';
    const viteConfig = fileMap.get('vite.config.ts') || fileMap.get('vite.config.js') || '';
    const tsConfig = fileMap.get('tsconfig.json') || '';
    return hashString(`${packageJson}\n${lockfile}\n${viteConfig}\n${tsConfig}`);
};

const DEP_FINGERPRINT_MARKER_PATH = '/.boltly/dep-fingerprint';
const SNAPSHOT_ARCHIVE_PATH = '/.boltly/dependency-snapshot.tgz';
const SNAPSHOT_TOOLCHAIN_VERSION = 'webcontainer-npm-v1';
const INSTALL_TIMEOUT_MS = 420_000;
const MAX_INDEXEDDB_SNAPSHOT_BYTES = 120 * 1024 * 1024;

const readInstalledDependencyFingerprint = async (wc: any): Promise<string | null> => {
    try {
        const marker = await wc.fs.readFile(DEP_FINGERPRINT_MARKER_PATH, 'utf-8');
        const normalized = typeof marker === 'string' ? marker.trim() : '';
        return normalized || null;
    } catch {
        return null;
    }
};

const persistInstalledDependencyFingerprint = async (wc: any, fingerprint: string): Promise<void> => {
    try {
        await wc.fs.mkdir('/.boltly', { recursive: true });
        await wc.fs.writeFile(DEP_FINGERPRINT_MARKER_PATH, fingerprint);
    } catch {
        // Best effort only; failed marker write should never block sandbox startup.
    }
};

const hasInstalledNodeModules = async (wc: any, projectDir: string): Promise<boolean> => {
    const normalizedProjectDir = projectDir === '/' ? '' : projectDir;
    const nodeModulesPath = `${normalizedProjectDir}/node_modules`;
    try {
        const entries = await wc.fs.readdir(nodeModulesPath || '/node_modules');
        return Array.isArray(entries) && entries.length > 0;
    } catch {
        return false;
    }
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

const base64ToBytes = (value: string): Uint8Array => {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
};

const runProcessAndCollectExit = async (proc: any, timeoutMs: number): Promise<number> => {
    const timeout = new Promise<number>((resolve) => setTimeout(() => resolve(-1), timeoutMs));
    return Promise.race([proc.exit, timeout]);
};

const isTarAvailable = async (wc: any): Promise<boolean> => {
    try {
        const proc = await wc.spawn('tar', ['--version'], { env: { FORCE_COLOR: '1' } });
        const exitCode = await runProcessAndCollectExit(proc, 10_000);
        return exitCode === 0;
    } catch {
        return false;
    }
};

const createZipArchiveFromDirectory = async (wc: any, rootDir: string): Promise<Uint8Array | null> => {
    const zip = new JSZip();
    const walk = async (absPath: string, relPath: string): Promise<void> => {
        const entries = await wc.fs.readdir(absPath);
        for (const entry of entries as string[]) {
            const childAbs = absPath === '/' ? `/${entry}` : `${absPath}/${entry}`;
            const childRel = relPath ? `${relPath}/${entry}` : entry;
            try {
                const stat = await wc.fs.stat(childAbs);
                if (stat?.isDirectory?.()) {
                    zip.folder(childRel);
                    await walk(childAbs, childRel);
                } else {
                    const content = await wc.fs.readFile(childAbs);
                    zip.file(childRel, content);
                }
            } catch {
                // ignore unreadable entries
            }
        }
    };
    try {
        await walk(rootDir === '/' ? '/node_modules' : `${rootDir}/node_modules`, 'node_modules');
        const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
        return bytes;
    } catch {
        return null;
    }
};

const createNodeModulesSnapshot = async (
    wc: any,
    projectDir: string,
): Promise<{ bytes: Uint8Array; format: 'tar.gz' | 'zip' } | null> => {
    const cwd = projectDir || '/';
    const tarAvailable = await isTarAvailable(wc);
    if (!tarAvailable) {
        console.info('[SandboxDecision] tar_unavailable_using_js_fallback', { cwd });
        const zipBytes = await createZipArchiveFromDirectory(wc, cwd);
        if (!zipBytes) return null;
        return { bytes: zipBytes, format: 'zip' };
    }
    const proc = await wc.spawn('sh', ['-lc', `tar -czf "${SNAPSHOT_ARCHIVE_PATH}" -C "${cwd}" node_modules`], {
        env: { FORCE_COLOR: '1' },
    });
    const exitCode = await runProcessAndCollectExit(proc, 120_000);
    if (exitCode !== 0) return null;
    try {
        const archive = await wc.fs.readFile(SNAPSHOT_ARCHIVE_PATH);
        return {
            bytes: archive instanceof Uint8Array ? archive : new Uint8Array(archive),
            format: 'tar.gz',
        };
    } catch {
        return null;
    }
};

const extractZipArchiveToDirectory = async (wc: any, projectDir: string, archiveBytes: Uint8Array): Promise<boolean> => {
    try {
        const zip = await JSZip.loadAsync(archiveBytes);
        const writes = Object.values(zip.files).map(async (entry) => {
            const normalized = entry.name.replace(/\\/g, '/').replace(/^\/+/, '');
            if (!normalized) return;
            const absPath = projectDir === '/' ? `/${normalized}` : `${projectDir}/${normalized}`;
            if (entry.dir) {
                await wc.fs.mkdir(absPath, { recursive: true });
                return;
            }
            const folderPath = absPath.slice(0, absPath.lastIndexOf('/'));
            if (folderPath) {
                await wc.fs.mkdir(folderPath, { recursive: true });
            }
            const fileBytes = await entry.async('uint8array');
            await wc.fs.writeFile(absPath, fileBytes);
        });
        await Promise.all(writes);
        return true;
    } catch {
        return false;
    }
};

const restoreNodeModulesSnapshot = async (
    wc: any,
    projectDir: string,
    archiveBytes: Uint8Array,
    archiveFormat: 'tar.gz' | 'zip' = 'tar.gz',
): Promise<boolean> => {
    const cwd = projectDir || '/';
    if (archiveFormat === 'zip') {
        return extractZipArchiveToDirectory(wc, cwd, archiveBytes);
    }
    const tarAvailable = await isTarAvailable(wc);
    if (!tarAvailable) {
        console.info('[SandboxDecision] tar_unavailable_using_js_fallback', { cwd, mode: 'restore' });
        return extractZipArchiveToDirectory(wc, cwd, archiveBytes);
    }
    try {
        await wc.fs.mkdir('/.boltly', { recursive: true });
        await wc.fs.writeFile(SNAPSHOT_ARCHIVE_PATH, archiveBytes);
        const proc = await wc.spawn('sh', ['-lc', `mkdir -p "${cwd}" && tar -xzf "${SNAPSHOT_ARCHIVE_PATH}" -C "${cwd}"`], {
            env: { FORCE_COLOR: '1' },
        });
        const exitCode = await runProcessAndCollectExit(proc, 120_000);
        return exitCode === 0;
    } catch {
        return false;
    }
};

export const useChat = () => {
    const { getToken, isLoaded, isSignedIn } = useAuth();
    const [messages, setMessages] = useAtom(messagesAtom);
    const [currentThreadId, setCurrentThreadId] = useAtom(currentThreadIdAtom);
    const setThreads = useSetAtom(threadsAtom);
    const navigate = useNavigate();
    const [selectedModel] = useAtom(selectedModelAtom);
    const [chatMode] = useAtom(chatModeAtom);
    const setChatMode = useSetAtom(chatModeAtom);
    const webContainerInstance = useAtomValue(webContainerAtom);
    const shellWriter = useAtomValue(shellInputWriterAtom);
    const setFileSystem = useSetAtom(fileSystemAtom);
    const setActiveFile = useSetAtom(activeFileAtom);
    const setServerUrl = useSetAtom(serverUrlAtom);
    const setPreviewStatus = useSetAtom(previewStatusAtom);
    const setPreviewStatusMessage = useSetAtom(previewStatusMessageAtom);
    const setSandboxRuntimeMetadata = useSetAtom(sandboxRuntimeMetadataAtom);
    const setThreadSwitchState = useSetAtom(threadSwitchStateAtom);
    const setTerminalSessionByThread = useSetAtom(terminalSessionByThreadAtom);
    const setRecoveryAuditsByThread = useSetAtom(recoveryAuditsByThreadAtom);
    const setTerminalStatusByThread = useSetAtom(terminalStatusByThreadAtom);
    const setTerminalIssueByThread = useSetAtom(terminalIssueByThreadAtom);

    const [isLoading, setIsLoading] = useState(false);
    type ChatAttachmentPayload = {
        kind: 'image' | 'text';
        name: string;
        mimeType: string;
        sizeBytes: number;
        dataBase64?: string;
        textContent?: string;
    };


    const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';

    const appendTerminalEvents = useCallback(async (
        threadId: string,
        token: string,
        events: Array<{ eventType: string; payload: string; cwd?: string; exitCode?: number | null }>,
    ) => {
        if (!threadId || events.length === 0) return;
        await fetch(`${API_URL}/terminal/${encodeURIComponent(threadId)}/events`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ events }),
        }).catch(() => {
            // best effort telemetry
        });
    }, [API_URL]);

    const refreshTerminalSession = useCallback(async (threadId: string, token: string) => {
        if (!threadId) return;
        const res = await fetch(`${API_URL}/terminal/${encodeURIComponent(threadId)}/session`, {
            headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return;
        const data = await res.json();
        const events = Array.isArray(data?.events) ? data.events : [];
        const audits = Array.isArray(data?.recoveryAudits) ? data.recoveryAudits : [];
        setTerminalSessionByThread((prev) => ({ ...prev, [threadId]: events }));
        setRecoveryAuditsByThread((prev) => ({ ...prev, [threadId]: audits }));
        const combinedOutput = events
            .filter((e: any) => e?.event_type === 'output')
            .map((e: any) => String(e.payload || ''))
            .join('\n');
        const issue = detectTerminalIssue(combinedOutput);
        setTerminalIssueByThread((prev) => ({ ...prev, [threadId]: issue }));
    }, [API_URL, setRecoveryAuditsByThread, setTerminalIssueByThread, setTerminalSessionByThread]);

    const runTerminalRecovery = useCallback(async (
        input: { threadId: string; triggerSource: 'manual' | 'auto' },
    ) => {
        const { threadId, triggerSource } = input;
        if (!threadId || !isLoaded || !isSignedIn) return;
        const token = await getToken();
        if (!token) return;
        const meta = threadRuntimeMeta.get(threadId);
        const cwd = meta?.projectDir || '/';
        const issueCode = 'auto_recovery';
        const plannedCommands = [
            `cd "${cwd}"`,
            'npm install --legacy-peer-deps --prefer-offline',
            'npm run dev',
        ];
        const executedCommands: string[] = [];
        const wc = webContainerInstance ?? getWebContainerInstance();
        if (!wc) return;

        setTerminalStatusByThread((prev) => ({ ...prev, [threadId]: 'running' }));
        let status: 'resolved' | 'failed' = 'failed';
        let detail = '';
        for (const command of plannedCommands) {
            executedCommands.push(command);
            try {
                const [program, ...args] = command.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [command];
                const normalizedArgs = args.map((a) => a.replace(/^["']|["']$/g, ''));
                const proc = await wc.spawn(program, normalizedArgs, { cwd, env: { FORCE_COLOR: '1' } });
                proc.output.pipeTo(new WritableStream({ write(data) { writeShellOutput(data); } }));
                const exitCode = await proc.exit;
                await appendTerminalEvents(threadId, token, [
                    { eventType: 'command', payload: command, cwd },
                    { eventType: 'status', payload: `exit:${exitCode}`, cwd, exitCode },
                ]);
                if (exitCode !== 0) {
                    detail = `${command} failed with exit ${exitCode}`;
                    status = 'failed';
                    break;
                }
                if (command.includes('npm run dev')) status = 'resolved';
            } catch (error) {
                detail = error instanceof Error ? error.message : String(error);
                status = 'failed';
                break;
            }
        }

        setTerminalStatusByThread((prev) => ({ ...prev, [threadId]: status === 'resolved' ? 'idle' : 'error' }));
        setTerminalIssueByThread((prev) => ({ ...prev, [threadId]: status === 'resolved' ? null : prev[threadId] ?? null }));

        await fetch(`${API_URL}/terminal/${encodeURIComponent(threadId)}/recovery-audits`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
                triggerSource,
                issueCode,
                plannedCommands,
                executedCommands,
                status,
                detail,
            }),
        }).catch(() => {
            // ignore best effort
        });

        await refreshTerminalSession(threadId, token);
    }, [
        API_URL,
        appendTerminalEvents,
        getToken,
        isLoaded,
        isSignedIn,
        refreshTerminalSession,
        setTerminalIssueByThread,
        setTerminalStatusByThread,
        webContainerInstance,
    ]);

    const startThreadSandboxInBackground = useCallback(async (
        wc: any,
        threadId: string,
        fileMap: Map<string, string>,
        latestSeq: number,
        authToken: string,
        switchSeq: number,
    ) => {
        if (!wc || fileMap.size === 0) return;
        const startedAt = performance.now();
        const isStaleSwitch = () => switchSeq !== latestThreadSwitchSeq;
        const abortIfStale = (stage: string): boolean => {
            if (!isStaleSwitch()) return false;
            console.info('[SandboxDecision] stale_thread_switch_abort', { threadId, stage, switchSeq });
            return true;
        };
        if (abortIfStale('start')) return;

        // If the AI didn't generate package.json, index.html, or vite.config,
        // provide sensible defaults so npm install can work.
        if (!fileMap.has('package.json')) {
            const defaultPkg = JSON.stringify({
                name: 'restored-project',
                private: true,
                version: '0.0.0',
                type: 'module',
                scripts: { dev: 'vite', build: 'vite build' },
                dependencies: {
                    'react': '^18.3.1',
                    'react-dom': '^18.3.1',
                    'lucide-react': '^0.400.0',
                    'clsx': '^2.1.0',
                    'tailwind-merge': '^2.2.0',
                    'class-variance-authority': '^0.7.0',
                    '@radix-ui/react-slot': '^1.0.0',
                },
                devDependencies: {
                    '@types/react': '^18.3.0',
                    '@types/react-dom': '^18.3.0',
                    '@vitejs/plugin-react': '^4.3.0',
                    'typescript': '^5.5.0',
                    'vite': '^5.4.0',
                    'tailwindcss': '^4.0.0',
                    '@tailwindcss/vite': '^4.0.0',
                },
            }, null, 2);
            fileMap.set('package.json', defaultPkg);
        }

        if (!fileMap.has('index.html')) {
            const defaultHtml = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>App</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>`;
            fileMap.set('index.html', defaultHtml);
        }

        if (!fileMap.has('vite.config.ts')) {
            const defaultVite = `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
});
`;
            fileMap.set('vite.config.ts', defaultVite);
        }

        if (!fileMap.has('tsconfig.json')) {
            const defaultTsconfig = JSON.stringify({
                compilerOptions: {
                    target: 'ES2020',
                    useDefineForClassFields: true,
                    lib: ['ES2020', 'DOM', 'DOM.Iterable'],
                    module: 'ESNext',
                    skipLibCheck: true,
                    moduleResolution: 'bundler',
                    allowImportingTsExtensions: true,
                    resolveJsonModule: true,
                    isolatedModules: true,
                    noEmit: true,
                    jsx: 'react-jsx',
                    strict: true,
                },
                include: ['src'],
            }, null, 2);
            fileMap.set('tsconfig.json', defaultTsconfig);
        }

        // Tailwind v4: ensure src/index.css uses @import "tailwindcss" (not v3 directives)
        const existingCss = fileMap.get('src/index.css') || '';
        if (!existingCss.includes('@import "tailwindcss"') && !existingCss.includes("@import 'tailwindcss'")) {
            const fixedCss = '@import "tailwindcss";\n' + existingCss.replace(/@tailwind\s+(base|components|utilities);?\s*/g, '');
            fileMap.set('src/index.css', fixedCss);
        }

        // Ensure src/main.tsx imports index.css
        if (!fileMap.has('src/main.tsx')) {
            const defaultMain = `import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
`;
            fileMap.set('src/main.tsx', defaultMain);
        } else {
            const mainContent = fileMap.get('src/main.tsx')!;
            if (!mainContent.includes('index.css')) {
                fileMap.set('src/main.tsx', "import './index.css';\n" + mainContent);
            }
        }

        // Patch missing dependencies before writing files
        await patchMissingDependencies(fileMap, wc, setFileSystem);

        if (abortIfStale('after_dependency_patch')) return;
        const depFingerprint = getDependencyFingerprint(fileMap);
        const criticalFingerprint = getCriticalConfigFingerprint(fileMap);
        const inferredProjectDir = inferProjectDirectory(fileMap);
        const projectDirResolution = await resolveProjectDirectoryForNpm(wc, fileMap, inferredProjectDir);
        const projectDir = projectDirResolution.projectDir;
        await syncShellWorkingDirectory(shellWriter, projectDir);
        console.info('[SandboxDecision] project_dir_resolved', {
            threadId,
            depFingerprint,
            inferredProjectDir,
            projectDir,
            packageJsonPath: projectDirResolution.packageJsonPath,
            reasonCode: projectDirResolution.reasonCode,
        });
        const localInstalledFingerprint = await readInstalledDependencyFingerprint(wc);
        const nodeModulesPresent = await hasInstalledNodeModules(wc, projectDir);
        let hasLocalDependencyCache =
            nodeModulesPresent &&
            localInstalledFingerprint === depFingerprint;
        let indexedSnapshotRecord: { archiveBase64: string; archiveFormat: 'tar.gz' | 'zip' } | null = null;
        const prevMeta = threadRuntimeMeta.get(threadId);
        const incomingFiles = new Set([...fileMap.keys()].map((p) => p.replace(/^\//, '')));
        let cachedDependencyPlan: any = null;
        try {
            const cachedRes = await fetch(`${API_URL}/sandbox/dependencies/${encodeURIComponent(depFingerprint)}`, {
                headers: {
                    Authorization: `Bearer ${authToken}`,
                },
            });
            if (cachedRes.ok) {
                cachedDependencyPlan = await cachedRes.json();
            }
        } catch {
            cachedDependencyPlan = null;
        }
        const hasCachedDependencyPlan = !!cachedDependencyPlan;
        const hasThreadRuntimeHit = !!(
            prevMeta?.installSucceeded &&
            prevMeta.depFingerprint === depFingerprint &&
            prevMeta.criticalFingerprint === criticalFingerprint
        );

        if (!hasLocalDependencyCache) {
            const indexedSnapshot = await loadDependencySnapshot(depFingerprint);
            if (indexedSnapshot.status === 'miss') {
                console.info('[SandboxDecision] indexeddb_miss', { threadId, depFingerprint });
            }
            if (indexedSnapshot.status === 'corrupt') {
                console.warn('[SandboxDecision] indexeddb_evicted_or_corrupt', { threadId, depFingerprint });
            }
            if (indexedSnapshot.status === 'hit' && indexedSnapshot.record.toolchainVersion === SNAPSHOT_TOOLCHAIN_VERSION) {
                indexedSnapshotRecord = indexedSnapshot.record;
                const restoredFromIndexedDb = await restoreNodeModulesSnapshot(
                    wc,
                    projectDir,
                    base64ToBytes(indexedSnapshot.record.archiveBase64),
                    indexedSnapshot.record.archiveFormat,
                );
                if (restoredFromIndexedDb) {
                    await persistInstalledDependencyFingerprint(wc, depFingerprint);
                    hasLocalDependencyCache = true;
                    console.info('[SandboxDecision] indexeddb_snapshot_restored', { threadId, depFingerprint });
                } else {
                    console.warn('[SandboxDecision] indexeddb_restore_failed', { threadId, depFingerprint });
                }
            }
        }

        if (
            cachedDependencyPlan?.snapshotState === 'upload_pending' &&
            indexedSnapshotRecord &&
            (cachedDependencyPlan?.uploadAttemptCount || 0) < 3
        ) {
            const retryAttempt = (cachedDependencyPlan?.uploadAttemptCount || 0) + 1;
            console.info(`[SandboxDecision] snapshot_upload_retry_attempt_${retryAttempt}`, {
                threadId,
                depFingerprint,
            });
            const pendingBytes = base64ToBytes(indexedSnapshotRecord.archiveBase64);
            try {
                await fetch(
                    `${API_URL}/sandbox/snapshots/${encodeURIComponent(depFingerprint)}?toolchainVersion=${encodeURIComponent(SNAPSHOT_TOOLCHAIN_VERSION)}`,
                    {
                        method: 'PUT',
                        headers: {
                            Authorization: `Bearer ${authToken}`,
                            'Content-Type': 'application/gzip',
                        },
                        body: Uint8Array.from(pendingBytes).buffer,
                    },
                );
            } catch {
                // backend tracks retry budget; local flow continues
            }
        }

        const canAttemptRemoteSnapshot = cachedDependencyPlan?.snapshotState !== 'upload_failed';
        if (!canAttemptRemoteSnapshot && !hasLocalDependencyCache) {
            console.warn('[SandboxDecision] snapshot_upload_failed', {
                threadId,
                depFingerprint,
                reason: 'upload_failed_state',
            });
        }

        if (!hasLocalDependencyCache && canAttemptRemoteSnapshot) {
            try {
                const snapshotRes = await fetch(`${API_URL}/sandbox/snapshots/${encodeURIComponent(depFingerprint)}`, {
                    headers: {
                        Authorization: `Bearer ${authToken}`,
                    },
                });
                if (snapshotRes.ok) {
                    const snapshotBytes = new Uint8Array(await snapshotRes.arrayBuffer());
                    const isZipSnapshot = snapshotBytes.length > 1 && snapshotBytes[0] === 0x50 && snapshotBytes[1] === 0x4b;
                    const remoteFormat: 'tar.gz' | 'zip' = isZipSnapshot ? 'zip' : 'tar.gz';
                    const restoredFromRemote = await restoreNodeModulesSnapshot(wc, projectDir, snapshotBytes, remoteFormat);
                    if (restoredFromRemote) {
                        await persistInstalledDependencyFingerprint(wc, depFingerprint);
                        const saveResult = await saveDependencySnapshot({
                            depFingerprint,
                            toolchainVersion: SNAPSHOT_TOOLCHAIN_VERSION,
                            createdAt: Date.now(),
                            archiveBase64: bytesToBase64(snapshotBytes),
                            archiveFormat: remoteFormat,
                        });
                        if (saveResult === 'quota_exceeded') {
                            console.warn('[SandboxDecision] indexeddb_quota_exceeded', { threadId, depFingerprint });
                        }
                        hasLocalDependencyCache = true;
                        console.info('[SandboxDecision] supabase_snapshot_restored', { threadId, depFingerprint });
                    } else {
                        console.warn('[SandboxDecision] remote_snapshot_restore_failed', { threadId, depFingerprint });
                    }
                } else if (snapshotRes.status === 404 && hasCachedDependencyPlan) {
                    console.warn('[SandboxDecision] remote_meta_hit_snapshot_404', { threadId, depFingerprint });
                }
            } catch (error) {
                console.warn('[SandboxDecision] supabase_snapshot_restore_failed', {
                    threadId,
                    depFingerprint,
                    error: String(error),
                });
            }
        }
        if (abortIfStale('after_snapshot_restore_checks')) return;

        // Incremental sync: delete only files known in mounted project but absent now.
        const currentlyMountedFiles = activeMountedThreadId
            ? (mountedFilesByThread.get(activeMountedThreadId) ?? mountedProjectFiles)
            : mountedProjectFiles;
        const filesToDelete = [...currentlyMountedFiles].filter((p) => !incomingFiles.has(p));
        for (const filePath of filesToDelete) {
            try { await wc.fs.rm(filePath); } catch { /* ignore missing */ }
        }

        for (const [filePath, content] of fileMap) {
            try {
                const absPath = filePath.startsWith('/') ? filePath.substring(1) : filePath;
                const dir = absPath.substring(0, absPath.lastIndexOf('/'));
                if (dir && dir !== '') {
                    try { await wc.fs.mkdir(dir, { recursive: true }); } catch { /* exists */ }
                }
                let shouldWrite = true;
                try {
                    const existing = await wc.fs.readFile(absPath, 'utf-8');
                    shouldWrite = existing !== content;
                } catch {
                    shouldWrite = true;
                }
                if (shouldWrite) {
                    await wc.fs.writeFile(absPath, content);
                }
            } catch (err) {
                console.error(`[loadThread] Failed to write ${filePath}:`, err);
            }
        }

        mountedProjectFiles = incomingFiles;
        mountedFilesByThread.set(threadId, incomingFiles);
        activeMountedThreadId = threadId;

        // Only skip install when dependency cache evidence matches this exact fingerprint.
        // Mere node_modules presence is insufficient across thread switches.
        const shouldInstall = !hasLocalDependencyCache;
        const decisionSource = hasLocalDependencyCache
            ? 'local_cache_hit'
            : hasThreadRuntimeHit
                ? 'thread_meta_hit'
                : prevMeta?.depFingerprint && prevMeta.depFingerprint !== depFingerprint
                    ? 'fingerprint_changed'
                    : 'install_missing_evidence';
        console.info('[SandboxDecision] install_gate', {
            threadId,
            depFingerprint,
            criticalFingerprint,
            localInstalledFingerprint,
            nodeModulesPresent,
            hasCachedDependencyPlan,
            hasThreadRuntimeHit,
            shouldInstall,
            decisionSource,
        });

        const shouldRestartServer =
            !activeDevProcess ||
            activeDevServerFingerprint !== depFingerprint ||
            activeCriticalFingerprint !== criticalFingerprint;

        try {
            if (abortIfStale('before_install_gate')) return;
            if (shouldInstall) {
                await repairRootForNpm(wc, true);
                setPreviewStatus('starting');
                setPreviewStatusMessage('Installing dependencies (fingerprint changed)...');
                writeShellOutput('\r\n\x1b[36m⬢ Installing dependencies...\x1b[0m\r\n');
                let installExit = 0;
                let attempts = 0;
                while (attempts < 2) {
                    attempts += 1;
                    await appendTerminalEvents(threadId, authToken, [
                        { eventType: 'command', payload: 'npm install --no-audit --no-fund --legacy-peer-deps --prefer-offline', cwd: projectDir },
                    ]);
                    const installProc = await wc.spawn(
                        'npm',
                        ['install', '--no-audit', '--no-fund', '--legacy-peer-deps', '--prefer-offline'],
                        { env: { FORCE_COLOR: '1' }, cwd: projectDir },
                    );
                    console.info('[SandboxDecision] npm_spawn', {
                        threadId,
                        command: 'npm install',
                        cwd: projectDir,
                        packageJsonPath: projectDirResolution.packageJsonPath,
                    });
                    installProc.output.pipeTo(new WritableStream({
                        write(data) { writeShellOutput(data); }
                    }));
                    installExit = await runProcessAndCollectExit(installProc, INSTALL_TIMEOUT_MS);
                    await appendTerminalEvents(threadId, authToken, [
                        { eventType: 'status', payload: `npm install exit ${installExit}`, cwd: projectDir, exitCode: installExit },
                    ]);
                    if (installExit === 0) break;
                    if (attempts < 2) {
                        writeShellOutput('\r\n\x1b[33m⚠ Install failed once, retrying...\x1b[0m\r\n');
                        console.warn('[SandboxDecision] install_retry', { threadId, depFingerprint, installExit, attempts });
                    }
                }

                if (installExit !== 0) {
                    const msg = installExit === -1 ? `npm install timed out (${INSTALL_TIMEOUT_MS / 1000}s)` : `npm install failed (exit ${installExit})`;
                    setPreviewStatus('error');
                    setPreviewStatusMessage(msg);
                    writeShellOutput(`\r\n\x1b[31m✗ ${msg}\x1b[0m\r\n`);
                    threadRuntimeMeta.set(threadId, {
                        depFingerprint,
                        criticalFingerprint,
                        projectDir,
                        lastAppliedSeq: latestSeq,
                        installSucceeded: false,
                        lastBootAt: Date.now(),
                        knownFiles: incomingFiles,
                        installFailureReason: msg,
                    });
                    return;
                }
                if (abortIfStale('after_install_success')) return;
                await persistInstalledDependencyFingerprint(wc, depFingerprint);
                const snapshotBytes = await createNodeModulesSnapshot(wc, projectDir);
                if (snapshotBytes) {
                    const estimatedIndexedDbBytes = Math.ceil(snapshotBytes.bytes.length * 1.37);
                    if (estimatedIndexedDbBytes > MAX_INDEXEDDB_SNAPSHOT_BYTES) {
                        console.warn('[SandboxDecision] indexeddb_quota_exceeded', {
                            threadId,
                            depFingerprint,
                            estimatedBytes: estimatedIndexedDbBytes,
                        });
                    } else {
                        const saveResult = await saveDependencySnapshot({
                            depFingerprint,
                            toolchainVersion: SNAPSHOT_TOOLCHAIN_VERSION,
                            createdAt: Date.now(),
                            archiveBase64: bytesToBase64(snapshotBytes.bytes),
                            archiveFormat: snapshotBytes.format,
                        });
                        if (saveResult === 'quota_exceeded') {
                            console.warn('[SandboxDecision] indexeddb_quota_exceeded', { threadId, depFingerprint });
                        } else if (saveResult !== 'ok') {
                            console.warn('[SandboxDecision] indexeddb_restore_failed', {
                                threadId,
                                depFingerprint,
                                reason: 'indexeddb_save_failed',
                            });
                        }
                    }
                    const snapshotBody = Uint8Array.from(snapshotBytes.bytes).buffer;
                    void fetch(
                        `${API_URL}/sandbox/snapshots/${encodeURIComponent(depFingerprint)}?toolchainVersion=${encodeURIComponent(SNAPSHOT_TOOLCHAIN_VERSION)}`,
                        {
                            method: 'PUT',
                            headers: {
                                Authorization: `Bearer ${authToken}`,
                                'Content-Type': 'application/gzip',
                            },
                            body: snapshotBody,
                        },
                    )
                        .then(async (res) => {
                            if (!res.ok) {
                                console.warn('[SandboxDecision] snapshot_upload_failed', {
                                    threadId,
                                    depFingerprint,
                                    status: res.status,
                                });
                            }
                        })
                        .catch(() => {
                            console.warn('[SandboxDecision] snapshot_upload_failed', { threadId, depFingerprint });
                        });
                } else {
                    console.warn('[SandboxDecision] snapshot_create_failed', { threadId, depFingerprint });
                }
            } else {
                setPreviewStatus('starting');
                setPreviewStatusMessage('Reusing installed dependencies from cache...');
            }

            if (shouldRestartServer) {
                if (abortIfStale('before_dev_server_restart')) return;
                if (activeDevProcess?.kill) {
                    try { await activeDevProcess.kill(); } catch { /* ignore */ }
                }
                setPreviewStatus('starting');
                setPreviewStatusMessage('Starting development server...');
                writeShellOutput('\r\n\x1b[36m⬢ Starting dev server...\x1b[0m\r\n');
                const devProc = await wc.spawn('npm', ['run', 'dev'], {
                    env: { FORCE_COLOR: '1' },
                    cwd: projectDir,
                });
                await appendTerminalEvents(threadId, authToken, [
                    { eventType: 'command', payload: 'npm run dev', cwd: projectDir },
                ]);
                console.info('[SandboxDecision] npm_spawn', {
                    threadId,
                    command: 'npm run dev',
                    cwd: projectDir,
                    packageJsonPath: projectDirResolution.packageJsonPath,
                });
                devProc.output.pipeTo(new WritableStream({
                    write(data) { writeShellOutput(data); }
                }));
                activeDevProcess = devProc;
                activeDevServerFingerprint = depFingerprint;
                activeCriticalFingerprint = criticalFingerprint;
            } else {
                setPreviewStatus('ready');
                setPreviewStatusMessage('Reusing running dev server.');
            }

            threadRuntimeMeta.set(threadId, {
                depFingerprint,
                criticalFingerprint,
                projectDir,
                lastAppliedSeq: latestSeq,
                installSucceeded: true,
                lastBootAt: Date.now(),
                knownFiles: incomingFiles,
                installFailureReason: undefined,
            });
            setSandboxRuntimeMetadata((prev) => ({
                ...prev,
                [threadId]: {
                    threadId,
                    depFingerprint,
                    criticalFingerprint,
                    projectDir,
                    lastAppliedSeq: latestSeq,
                    installSucceeded: true,
                    lastBootAt: Date.now(),
                    devServerRunning: !!activeDevProcess,
                },
            }));
            const elapsed = Math.round(performance.now() - startedAt);
            console.info('[SandboxPerf] thread_boot_complete', {
                threadId,
                elapsedMs: elapsed,
                installed: shouldInstall,
                restartedServer: shouldRestartServer,
            });
        } catch (err) {
            console.error('[loadThread] install error:', err);
            setPreviewStatus('error');
            setPreviewStatusMessage(`Install error: ${String(err)}`);
            writeShellOutput(`\r\n\x1b[31m✗ Install error: ${err}\x1b[0m\r\n`);
            threadRuntimeMeta.set(threadId, {
                depFingerprint,
                criticalFingerprint,
                projectDir,
                lastAppliedSeq: latestSeq,
                installSucceeded: false,
                lastBootAt: Date.now(),
                knownFiles: incomingFiles,
                installFailureReason: String(err),
            });
            setSandboxRuntimeMetadata((prev) => ({
                ...prev,
                [threadId]: {
                    threadId,
                    depFingerprint,
                    criticalFingerprint,
                    projectDir,
                    lastAppliedSeq: latestSeq,
                    installSucceeded: false,
                    lastBootAt: Date.now(),
                    devServerRunning: false,
                },
            }));
            const elapsed = Math.round(performance.now() - startedAt);
            console.warn('[SandboxPerf] thread_boot_failed', {
                threadId,
                elapsedMs: elapsed,
                error: String(err),
            });
        }
    }, [API_URL, appendTerminalEvents, setFileSystem, setPreviewStatus, setPreviewStatusMessage, setSandboxRuntimeMetadata, shellWriter]);

    const sendMessage = async (content: string, attachments: ChatAttachmentPayload[] = []) => {
        if (!content.trim() || !isLoaded || !isSignedIn) {
            console.warn('[useChat] sendMessage blocked:', { hasContent: !!content.trim(), isLoaded, isSignedIn });
            return;
        }

        console.log('[useChat] sendMessage called:', { content: content.substring(0, 50), model: selectedModel });

        // Optimistic UI update
        const userMessage = {
            id: Date.now().toString(),
            role: 'user' as const,
            content: attachments.length > 0
                ? `[Mode: ${chatMode === 'plan' ? 'Plan' : 'Build'}]\n${content}\n\n[Attached ${attachments.length} file${attachments.length > 1 ? 's' : ''}]`
                : `[Mode: ${chatMode === 'plan' ? 'Plan' : 'Build'}]\n${content}`,
            timestamp: Date.now(),
        };
        setMessages((prev) => [...prev, userMessage]);
        setIsLoading(true);

        try {
            const token = await getToken();
            if (!token) {
                console.error('[useChat] Failed to get token. Aborting send.');
                return;
            }
            console.log('[useChat] Sending to API...', { threadId: localStorage.getItem('currentThreadId'), model: selectedModel });
            const response = await fetch(`${API_URL}/chat`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                },
                body: JSON.stringify({
                    message: content,
                    threadId: currentThreadId,
                    model: selectedModel,
                    mode: chatMode,
                    attachments,
                }),
            });

            console.log('[useChat] API response:', { status: response.status, ok: response.ok });

            if (!response.ok) {
                const errorText = await response.text().catch(() => '');
                throw new Error(`Server error (${response.status}): ${errorText || response.statusText}`);
            }
            // Update threadId if new
            const newThreadId = response.headers.get('X-Thread-Id');
            if (newThreadId && newThreadId !== currentThreadId) {
                setCurrentThreadId(newThreadId);
                localStorage.setItem('currentThreadId', newThreadId);
                // Refresh threads list in background
                fetchThreads();
            }

            // Handle Streaming Response
            const reader = response.body?.getReader();
            const decoder = new TextDecoder();
            if (!reader) return;

            const assistantMessageId = Date.now() + 1 + '';
            let accumulatedContent = '';

            setMessages((prev) => [
                ...prev,
                {
                    id: assistantMessageId,
                    role: 'assistant',
                    content: '', // Start empty, shows spinner
                    timestamp: Date.now(),
                },
            ]);

            // Navigate to builder now that we have a valid response
            navigate('/builder');

            const parser = new BoltParser();
            const pendingShellCommands: string[] = [];
            // Track all files written during this stream for dependency patching
            const writtenFiles = new Map<string, string>();

            // ── Phase 1: Read the stream — write files immediately, queue shell commands ──
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const chunk = decoder.decode(value);
                accumulatedContent += chunk;

                // Parse for artifacts (parser now returns ALL complete actions per call)
                const actions = parser.parse(chunk);

                // Get WC instance — atom or module fallback
                const wc = webContainerInstance ?? getWebContainerInstance();

                for (const action of actions) {
                    if (action.type === 'file' && action.filePath) {
                        const path = action.filePath;
                        const fileContent = action.content;

                        // Write to WebContainer immediately so files are ready
                        if (wc) {
                            try {
                                const absPath = '/' + path.replace(/^\//, '');
                                const dir = absPath.substring(0, absPath.lastIndexOf('/'));
                                if (dir && dir !== '/') {
                                    try {
                                        await wc.fs.mkdir(dir, { recursive: true });
                                    } catch {
                                        // Directory may already exist, ignore
                                    }
                                }
                                await wc.fs.writeFile(absPath, fileContent);
                            } catch (err) {
                                console.error(`[Bolt] Failed to write ${path}:`, err);
                            }
                        }

                        // Track for dependency patching
                        writtenFiles.set(path.replace(/^\//, ''), fileContent);

                        // Update file system atom (file tree + editor)
                        setFileSystem((prev) => upsertFile(prev, path, fileContent));

                        // Set as active file in editor
                        const fileName = path.split('/').pop()!;
                        setActiveFile({ path: path.replace(/^\//, ''), name: fileName, content: fileContent });
                    }
                    if (action.type === 'shell') {
                        // Queue shell commands — don't execute during stream reading
                        // because `await proc.exit` would block the reader and cause
                        // subsequent actions to be missed.
                        pendingShellCommands.push(action.content.trim());
                    }
                }

                setMessages((prev) =>
                    prev.map((msg) =>
                        msg.id === assistantMessageId
                            ? { ...msg, content: stripBoltTags(accumulatedContent) }
                            : msg
                    )
                );
            }

            // Flush any remaining buffered actions from the parser
            const remaining = parser.parse('');
            for (const action of remaining) {
                if (action.type === 'file' && action.filePath) {
                    const path = action.filePath;
                    const fileContent = action.content;
                    const wc = webContainerInstance ?? getWebContainerInstance();
                    if (wc) {
                        try {
                            const absPath = '/' + path.replace(/^\//, '');
                            const dir = absPath.substring(0, absPath.lastIndexOf('/'));
                            if (dir && dir !== '/') {
                                try { await wc.fs.mkdir(dir, { recursive: true }); } catch { /* exists */ }
                            }
                            await wc.fs.writeFile(absPath, fileContent);
                        } catch (err) {
                            console.error(`[Bolt] Failed to write ${path}:`, err);
                        }
                    }
                    writtenFiles.set(path.replace(/^\//, ''), fileContent);
                    setFileSystem((prev) => upsertFile(prev, path, fileContent));
                    const fileName = path.split('/').pop()!;
                    setActiveFile({ path: path.replace(/^\//, ''), name: fileName, content: fileContent });
                }
                if (action.type === 'shell') {
                    pendingShellCommands.push(action.content.trim());
                }
            }

            // ── Phase 1.5: Ensure root package.json, patch deps, then run shell ──
            const wcForNpm = webContainerInstance ?? getWebContainerInstance();
            await ensureRootPackageJsonExists(writtenFiles, wcForNpm, setFileSystem);
            await patchMissingDependencies(writtenFiles, wcForNpm, setFileSystem);

            // ── Phase 2: Execute queued shell commands sequentially ──
            // Use the shared jsh shell so the terminal shows the output and
            // PATH resolution works (fixes ENOENT for npm/npx).
            const wc = wcForNpm;
            const shellQueue = normalizeShellCommandQueue(pendingShellCommands);
            if (wc && shellQueue.length > 0) {
                setPreviewStatus('starting');
                setPreviewStatusMessage('Running install/start commands inside the sandbox...');
                let commandCwd = inferProjectDirectory(writtenFiles);
                for (const command of shellQueue) {
                    try {
                        // Skip useless/dangerous commands
                        if (!command || /^\s*$/.test(command)) continue;            // empty
                        if (/^\s*(echo|pwd|ls|cat)\s/.test(command)) continue;       // informational only

                        const { nextDir, remainder } = splitCdAndCommand(command);
                        if (nextDir) {
                            commandCwd = resolveWorkingDirectory(commandCwd, nextDir);
                            writeShellOutput(`\r\n\x1b[2mcd ${commandCwd}\x1b[0m\r\n`);
                            if (!remainder) continue;
                        }
                        if (!remainder || /^\s*$/.test(remainder)) continue;

                        writeShellOutput(`\r\n\x1b[36m❯ [${commandCwd}] ${remainder}\x1b[0m\r\n`);

                        // Append --legacy-peer-deps for npm install
                        let adjustedCommand = remainder;
                        if (/^npm\s+(install|i)\b/i.test(remainder.trim()) && !remainder.includes('--legacy-peer-deps')) {
                            adjustedCommand += ' --legacy-peer-deps';
                        }

                        // For long-running commands like "npm run dev", fire and forget
                        const isLongRunning = /\b(dev|start|serve|watch)\b/.test(remainder);

                        if (/^npm\s+(install|i)\b/i.test(adjustedCommand.trim())) {
                            await repairRootForNpm(wc, true);
                        }

                        // Spawn the command directly (better process control than piping to jsh)
                        const parts = adjustedCommand.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [adjustedCommand];
                        const program = parts[0];
                        const args = parts.slice(1).map((a: string) => a.replace(/^["']|["']$/g, ''));

                        const proc = await wc.spawn(program, args, {
                            env: { FORCE_COLOR: '1' },
                            cwd: commandCwd,
                        });
                        proc.output.pipeTo(new WritableStream({
                            write(data) { writeShellOutput(data); }
                        }));

                        if (!isLongRunning) {
                            const exitPromise = proc.exit;
                            // npm install in WebContainer often exceeds 2m (cold cache + registry I/O).
                            const installTimeoutMs =
                                /^npm\s+(install|i)\b/i.test(remainder.trim()) ? 300_000 : 120_000;
                            const timeoutPromise = new Promise<number>((resolve) =>
                                setTimeout(() => resolve(-1), installTimeoutMs),
                            );
                            const exitCode = await Promise.race([exitPromise, timeoutPromise]);
                            if (exitCode === -1) {
                                setPreviewStatus('error');
                                setPreviewStatusMessage(`Command timed out: ${remainder}`);
                                writeShellOutput(
                                    `\r\n\x1b[33m⚠ Command timed out after ${installTimeoutMs / 1000}s: ${remainder}\x1b[0m\r\n`,
                                );
                            } else if (exitCode !== 0) {
                                setPreviewStatus('error');
                                setPreviewStatusMessage(`Command failed (${exitCode}): ${remainder}`);
                                writeShellOutput(`\r\n\x1b[33m⚠ Command exited with code ${exitCode}: ${remainder}\x1b[0m\r\n`);
                            }
                        }
                    } catch (err) {
                        console.error(`[Bolt] spawn failed for "${command}":`, err);
                        setPreviewStatus('error');
                        setPreviewStatusMessage(`Failed to run command: ${command}`);
                        writeShellOutput(`\r\n\x1b[31m✗ Failed: ${command} — ${err}\x1b[0m\r\n`);
                    }
                }
            }

        } catch (error) {
            console.error('Chat Error:', error);
            // Show error as an assistant message so the user knows what happened
            const errorMsg = error instanceof Error ? error.message : 'Something went wrong';
            setMessages((prev) => [
                ...prev,
                {
                    id: Date.now() + 2 + '',
                    role: 'assistant',
                    content: `⚠️ **Error:** ${errorMsg}\n\nPlease try again. If the problem persists, check that the backend server is running and the API keys are configured.`,
                    timestamp: Date.now(),
                },
            ]);
        } finally {
            setIsLoading(false);
        }
    };

    const fetchThreads = useCallback(async () => {
        if (!isLoaded || !isSignedIn) {
            throw new Error('You need to be signed in to load history.');
        }
        const token = await getToken();
        if (!token) {
            throw new Error('Could not get auth token. Try signing in again.');
        }
        const res = await fetch(`${API_URL}/chat/history`, {
            headers: { Authorization: `Bearer ${token}` }
        });
        if (!res.ok) {
            const errBody = await res.text().catch(() => '');
            throw new Error(`Failed to load history (${res.status}): ${errBody || res.statusText}`);
        }
        const data = await res.json();
        setThreads(data);
    }, [getToken, isLoaded, isSignedIn, setThreads]);

    const loadThread = useCallback(async (threadId: string) => {
        if (!threadId || typeof threadId !== 'string') {
            setThreadSwitchState({
                status: 'error',
                targetThreadId: null,
                errorMessage: 'Invalid thread id.',
            });
            throw new Error('Invalid thread id');
        }
        if (!isLoaded || !isSignedIn) {
            setThreadSwitchState({
                status: 'error',
                targetThreadId: threadId,
                errorMessage: 'You need to be signed in to switch threads.',
            });
            throw new Error('You need to be signed in to switch threads.');
        }
        const switchSeq = ++latestThreadSwitchSeq;
        const isStale = () => switchSeq !== latestThreadSwitchSeq;
        const switchStartedAt = performance.now();
        setThreadSwitchState({
            status: 'loading',
            targetThreadId: threadId,
            errorMessage: null,
        });
        navigate('/builder');
        const id = encodeURIComponent(threadId);
        try {
            const token = await getToken();
            if (!token) {
                throw new Error('Could not get auth token. Try signing in again.');
            }
            if (isStale()) return;
            setServerUrl(null);
            setPreviewStatus('starting');
            setPreviewStatusMessage('Loading thread files and preparing preview environment...');

            const previousMeta = threadRuntimeMeta.get(threadId);
            const previousSeq = previousMeta?.lastAppliedSeq;

            // Fetch messages and thread files in parallel (delta when possible)
            const deltaUrl = previousSeq && previousSeq > 0
                ? `${API_URL}/chat/${id}/files/delta?sinceSeq=${previousSeq}`
                : null;
            const [messagesRes, filesRes] = await Promise.all([
                fetch(`${API_URL}/chat/${id}`, {
                    headers: { Authorization: `Bearer ${token}` }
                }),
                fetch(deltaUrl || `${API_URL}/chat/${id}/files`, {
                    headers: { Authorization: `Bearer ${token}` }
                }),
            ]);

            if (!messagesRes.ok) {
                const errBody = await messagesRes.text().catch(() => '');
                throw new Error(
                    `Could not load thread (${messagesRes.status}): ${errBody || messagesRes.statusText}`.trim(),
                );
            }
            if (!filesRes.ok) {
                const filesErrBody = await filesRes.text().catch(() => '');
                throw new Error(
                    `Could not load thread files (${filesRes.status}): ${filesErrBody || filesRes.statusText}`.trim(),
                );
            }
            if (isStale()) return;

            const rawMessages = await messagesRes.json();
            const latestSeq = rawMessages.reduce((max: number, m: any) => {
                const seq = Number(m.seq ?? 0);
                return Number.isFinite(seq) ? Math.max(max, seq) : max;
            }, 0);
            const filesPayload = await filesRes.json();
            let threadFiles: { filePath: string; content: string }[] = Array.isArray(filesPayload)
                ? filesPayload
                : (filesPayload.files || []);
            if (!Array.isArray(filesPayload) && filesPayload?.isDelta) {
                const fullFilesRes = await fetch(`${API_URL}/chat/${id}/files`, {
                    headers: { Authorization: `Bearer ${token}` }
                });
                if (!fullFilesRes.ok) {
                    const errBody = await fullFilesRes.text().catch(() => '');
                    throw new Error(
                        `Could not load full thread files (${fullFilesRes.status}): ${errBody || fullFilesRes.statusText}`.trim(),
                    );
                }
                threadFiles = await fullFilesRes.json();
            }

            // Get the WebContainer instance — prefer atom, fallback to module singleton
            const wc = webContainerInstance ?? getWebContainerInstance();

            // ── Restore file system from stored thread files ──
            let restoredFileSystem: FileSystemItem[] = [];
            let lastFile: ActiveFile | null = null;
            const fileMap = new Map<string, string>();

            // Primary: use the consolidated thread files from the API
            if (threadFiles.length > 0) {
                for (const f of threadFiles) {
                    const normalizedPath = f.filePath.replace(/^\//, '');
                    restoredFileSystem = upsertFile(restoredFileSystem, f.filePath, f.content);
                    const fileName = f.filePath.split('/').pop()!;
                    lastFile = { path: normalizedPath, name: fileName, content: f.content };
                    fileMap.set(normalizedPath, f.content);
                }
            } else {
                // Fallback: re-extract from raw message content (for old threads before migration)
                for (const m of rawMessages) {
                    if (m.role === 'assistant') {
                        // Use per-message files array if available
                        const msgFiles = m.files && m.files.length > 0
                            ? m.files
                            : extractFileActions(m.rawContent || m.content);
                        for (const action of msgFiles) {
                            const fp = action.filePath;
                            if (fp) {
                                const normalizedPath = fp.replace(/^\//, '');
                                restoredFileSystem = upsertFile(restoredFileSystem, fp, action.content);
                                const fileName = fp.split('/').pop()!;
                                lastFile = { path: normalizedPath, name: fileName, content: action.content };
                                fileMap.set(normalizedPath, action.content);
                            }
                        }
                    }
                }
            }

            if (isStale()) return;

            const formattedMessages = rawMessages.map((m: any) => ({
                id: m._id,
                role: m.role,
                content: m.role === 'assistant' ? stripBoltTags(m.content) : m.content,
                timestamp: new Date(m.createdAt).getTime(),
            }));
            const latestModeMessage = [...rawMessages]
                .reverse()
                .find((m: any) => m?.conversationMode === 'plan' || m?.conversationMode === 'build');
            if (latestModeMessage?.conversationMode === 'plan' || latestModeMessage?.conversationMode === 'build') {
                setChatMode(latestModeMessage.conversationMode);
            }
            setMessages(formattedMessages);
            setCurrentThreadId(threadId);
            localStorage.setItem('currentThreadId', threadId);
            void refreshTerminalSession(threadId, token);

            if (wc && fileMap.size > 0) {
                // Make thread switching responsive: restore UI immediately,
                // then prepare/install sandbox in background.
                void startThreadSandboxInBackground(wc, threadId, new Map(fileMap), latestSeq, token, switchSeq);
            }
            if (isStale()) return;

            // Update file system atom if we found files
            if (restoredFileSystem.length > 0) {
                setFileSystem(restoredFileSystem);
            } else {
                setFileSystem([]);
            }

            // Set last file as active in editor
            if (lastFile) {
                setActiveFile(lastFile);
            } else {
                setActiveFile(null);
            }
            if (!isStale()) {
                setThreadSwitchState({
                    status: 'idle',
                    targetThreadId: null,
                    errorMessage: null,
                });
                const elapsed = Math.round(performance.now() - switchStartedAt);
                console.info('[SandboxPerf] thread_visible', {
                    threadId,
                    elapsedMs: elapsed,
                    latestSeq,
                });
            }
        } catch (error) {
            console.error('[useChat] loadThread failed:', threadId, error);
            if (!isStale()) {
                setThreadSwitchState({
                    status: 'error',
                    targetThreadId: threadId,
                    errorMessage: error instanceof Error ? error.message : 'Could not switch thread.',
                });
                const elapsed = Math.round(performance.now() - switchStartedAt);
                console.warn('[SandboxPerf] thread_switch_failed', {
                    threadId,
                    elapsedMs: elapsed,
                    error: error instanceof Error ? error.message : String(error),
                });
            }
            throw error;
        }
    }, [getToken, isLoaded, isSignedIn, navigate, refreshTerminalSession, setThreadSwitchState, setServerUrl, setPreviewStatus, setPreviewStatusMessage, webContainerInstance, setMessages, setCurrentThreadId, setFileSystem, setActiveFile, setChatMode, startThreadSandboxInBackground]);

    return {
        messages,
        sendMessage,
        fetchThreads,
        loadThread,
        runTerminalRecovery,
        refreshTerminalSession,
        currentThreadId,
        isLoading,
    };
};
