import type { WebContainer } from '@webcontainer/api';
import { repairViteScriptsForWebContainer } from './webContainerScripts';

export const INSTALL_FIRST_ATTEMPT_TIMEOUT_MS = 120_000;

export const NPM_CACHE_DIR_NAME = '.npm-cache';

/**
 * Root-level paths (e.g. /.npm-cache) are NOT reliably writable inside WebContainer and
 * trigger npm's EACCES "cache folder contains root-owned files" guard. The container's
 * writable home is /home, so we default there and verify before use.
 */
export const DEFAULT_NPM_CACHE_PATH = '/home/.npm-cache';

const NPM_CACHE_CANDIDATES = ['/home/.npm-cache', '/tmp/.npm-cache'] as const;

/** Resolved-once writable cache path for the booted WebContainer (module singleton). */
let verifiedNpmCachePath: string | null = null;

const SPAWN_ENV_BASE = {
    FORCE_COLOR: '1',
    npm_config_prefer_offline: 'true',
    npm_config_audit: 'false',
    npm_config_fund: 'false',
} as const;

/**
 * Returns the npm cache path to use. After {@link ensureNpmCacheDir} has probed a writable
 * location it returns that; otherwise it falls back to the writable-home default. Never
 * returns a root-level path, which is the source of the recurring EACCES loop.
 */
export function resolveNpmCachePath(_projectDir = '/'): string {
    return verifiedNpmCachePath ?? DEFAULT_NPM_CACHE_PATH;
}

export function buildSpawnEnv(projectDir = '/'): Record<string, string> {
    return {
        ...SPAWN_ENV_BASE,
        npm_config_cache: resolveNpmCachePath(projectDir),
    };
}

/** @deprecated Prefer buildSpawnEnv(projectDir) — kept for callers without a known cwd */
export const WEBCONTAINER_SPAWN_ENV: Record<string, string> = buildSpawnEnv('/');

/** mkdir + write+read+delete a probe file to confirm npm can actually use this dir. */
async function isDirWritable(wc: WebContainer, dir: string): Promise<boolean> {
    const probe = `${dir}/.write-probe-${Date.now()}`;
    try {
        await wc.fs.mkdir(dir, { recursive: true });
        await wc.fs.writeFile(probe, 'ok');
        await wc.fs.rm(probe);
        return true;
    } catch {
        return false;
    }
}

/**
 * Probes candidate cache locations (writable home, then /tmp, then project-relative),
 * caches the first that genuinely accepts writes, and persists it to .npmrc so
 * shell-driven `npm` runs (not just env-spawned ones) honor the same cache.
 *
 * Returns the verified writable cache path. Surfaces nothing on failure but leaves the
 * default in place so callers can still proceed and let recovery report the real error.
 */
export async function ensureNpmCacheDir(wc: WebContainer, projectDir = '/'): Promise<string> {
    if (verifiedNpmCachePath) {
        // Already resolved this session — just make sure it still exists.
        try { await wc.fs.mkdir(verifiedNpmCachePath, { recursive: true }); } catch { /* best effort */ }
        await writeNpmrc(wc, projectDir, verifiedNpmCachePath);
        return verifiedNpmCachePath;
    }

    const projectRelative = projectDir && projectDir !== '/'
        ? `${projectDir.replace(/\/$/, '')}/${NPM_CACHE_DIR_NAME}`
        : `/${NPM_CACHE_DIR_NAME}`;
    const candidates = [...NPM_CACHE_CANDIDATES, projectRelative];

    for (const candidate of candidates) {
        if (await isDirWritable(wc, candidate)) {
            verifiedNpmCachePath = candidate;
            await writeNpmrc(wc, projectDir, candidate);
            return candidate;
        }
    }

    // Nothing probed clean — fall back to the writable-home default (still better than root).
    verifiedNpmCachePath = DEFAULT_NPM_CACHE_PATH;
    try { await wc.fs.mkdir(DEFAULT_NPM_CACHE_PATH, { recursive: true }); } catch { /* best effort */ }
    await writeNpmrc(wc, projectDir, DEFAULT_NPM_CACHE_PATH);
    return DEFAULT_NPM_CACHE_PATH;
}

/** Persist the cache path into the project's .npmrc so all npm invocations agree. */
async function writeNpmrc(wc: WebContainer, projectDir: string, cachePath: string): Promise<void> {
    const dir = projectDir && projectDir !== '/' ? projectDir.replace(/\/$/, '') : '';
    const npmrcPath = dir ? `${dir}/.npmrc` : '/.npmrc';
    const content = `cache=${cachePath}\nprefer-offline=true\naudit=false\nfund=false\n`;
    try {
        await wc.fs.writeFile(npmrcPath.replace(/^\//, ''), content);
    } catch {
        // best effort — env var still carries the cache path
    }
}

/** Resets the cached writable path. Used when a fresh WebContainer boots. */
export function resetNpmCacheResolution(): void {
    verifiedNpmCachePath = null;
}
const BUILD_INSTALL_TIMEOUT_MS = 300_000;
const DEFAULT_COMMAND_TIMEOUT_MS = 120_000;

export const normalizeWrittenPath = (p: string) => p.replace(/^\//, '').replace(/\\/g, '/');

export const normalizeWebContainerPath = (path: string): string => {
    const normalized = path.replace(/\\/g, '/').trim();
    if (!normalized) return '/';
    const parts = normalized.split('/').filter(Boolean);
    return `/${parts.join('/')}`;
};

/** WebContainer project root — files live here, not at OS `/`. */
export function getWebContainerWorkdir(wc: WebContainer): string {
    return wc.workdir;
}

/**
 * Map legacy `/` (and mistaken absolute paths) to the instance workdir where
 * `wc.fs.writeFile('package.json')` actually lands.
 */
export function normalizeProjectDir(wc: WebContainer, projectDir: string): string {
    const workdir = wc.workdir;
    const normalized = normalizeWebContainerPath(projectDir);
    if (!normalized || normalized === '/') return workdir;
    if (normalized === workdir) return workdir;
    if (normalized.startsWith(`${workdir}/`)) return normalized;
    if (!normalized.startsWith('/')) {
        return normalizeWebContainerPath(`${workdir}/${normalized}`);
    }
    // Absolute path outside workdir (e.g. `/`) — project files are in workdir.
    return workdir;
}

/** `spawn` cwd is relative to workdir; omit when already at project root. */
export function resolveSpawnCwd(wc: WebContainer, projectDir: string): string | undefined {
    const workdir = wc.workdir;
    const absolute = normalizeProjectDir(wc, projectDir);
    if (absolute === workdir) return undefined;
    if (absolute.startsWith(`${workdir}/`)) {
        const rel = absolute.slice(workdir.length + 1);
        return rel || undefined;
    }
    return undefined;
}

export function buildSpawnOptions(
    wc: WebContainer,
    projectDir: string,
): { env: Record<string, string>; cwd?: string } {
    const absolute = normalizeProjectDir(wc, projectDir);
    const cwd = resolveSpawnCwd(wc, projectDir);
    const opts: { env: Record<string, string>; cwd?: string } = {
        env: buildSpawnEnv(absolute),
    };
    if (cwd) opts.cwd = cwd;
    return opts;
}

export const resolveWorkingDirectory = (currentDir: string, targetPath: string): string => {
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

export const splitCdAndCommand = (command: string): { nextDir: string | null; remainder: string | null } => {
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

/** Split `cmd1 && cmd2 && cmd3` into separate commands (quote-aware). */
export const splitShellChain = (command: string): string[] => {
    const parts: string[] = [];
    let current = '';
    let inSingle = false;
    let inDouble = false;

    for (let i = 0; i < command.length; i += 1) {
        const ch = command[i];
        const next = command[i + 1];

        if (ch === "'" && !inDouble) {
            inSingle = !inSingle;
            current += ch;
        } else if (ch === '"' && !inSingle) {
            inDouble = !inDouble;
            current += ch;
        } else if (!inSingle && !inDouble && ch === '&' && next === '&') {
            const trimmed = current.trim();
            if (trimmed) parts.push(trimmed);
            current = '';
            i += 1;
            while (command[i + 1] === ' ') i += 1;
        } else {
            current += ch;
        }
    }

    const trimmed = current.trim();
    if (trimmed) parts.push(trimmed);
    return parts.length > 0 ? parts : [command.trim()].filter(Boolean);
};

const orderShellCommands = (commands: string[]): string[] => {
    const trimmed = commands.map((c) => c.trim()).filter(Boolean);
    const seen = new Set<string>();
    const unique: string[] = [];
    for (const c of trimmed) {
        const key = c.replace(/\s+/g, ' ');
        if (seen.has(key)) continue;
        seen.add(key);
        unique.push(c);
    }
    const isNpmInstall = (c: string) => /^npm\s+(install|i|ci)\b/i.test(c);
    const isNpmDev = (c: string) => /^npm\s+run\s+dev\b/i.test(c);
    const installs = unique.filter(isNpmInstall);
    const devs = unique.filter(isNpmDev);
    const rest = unique.filter((c) => !isNpmInstall(c) && !isNpmDev(c));
    return [...installs, ...devs, ...rest];
};

/** Expand `&&` chains, dedupe, and order install before dev. */
export const normalizeShellCommandQueue = (commands: string[]): string[] => {
    const expanded = commands.flatMap((c) => splitShellChain(c));
    return orderShellCommands(expanded);
};

export const inferProjectDirectory = (writtenFiles: Map<string, string>): string => {
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

const hasValidPackageJsonInDir = async (wc: WebContainer, dir: string): Promise<boolean> => {
    const workdir = wc.workdir;
    const absolute = normalizeProjectDir(wc, dir);
    const rel = absolute === workdir
        ? 'package.json'
        : `${absolute.slice(workdir.length + 1)}/package.json`;
    const pathsToTry = [rel, 'package.json'].filter((p, i, arr) => arr.indexOf(p) === i);
    for (const packagePath of pathsToTry) {
        try {
            const raw = await wc.fs.readFile(packagePath, 'utf-8');
            if (!raw?.trim()) continue;
            JSON.parse(raw);
            return true;
        } catch {
            /* try next */
        }
    }
    return false;
};

export const resolveProjectDirectoryForNpm = async (
    wc: WebContainer,
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
        const projectDir = normalizeProjectDir(wc, candidate);
        return {
            projectDir,
            packageJsonPath: projectDir === wc.workdir ? 'package.json' : `${projectDir}/package.json`,
            reasonCode: candidate === normalizeWebContainerPath(inferredDir) ? 'inferred_project_dir' : 'fallback_probe_dir',
        };
    }

    return {
        projectDir: wc.workdir,
        packageJsonPath: null,
        reasonCode: 'package_json_missing_all_candidates',
    };
};

let lastSyncedShellCwd: string | null = null;

export const resetSyncedShellCwd = (): void => {
    lastSyncedShellCwd = null;
};

export const syncShellWorkingDirectory = async (
    shellWriter: WritableStreamDefaultWriter<string> | null,
    wc: WebContainer,
    projectDir: string,
): Promise<void> => {
    if (!shellWriter) return;
    const target = normalizeProjectDir(wc, projectDir);
    if (lastSyncedShellCwd === target) return;
    try {
        await shellWriter.write(`cd "${target}"\n`);
        lastSyncedShellCwd = target;
    } catch {
        // best effort only
    }
};

export const runProcessAndCollectExit = async (proc: { exit: Promise<number> }, timeoutMs: number): Promise<number> => {
    const timeout = new Promise<number>((resolve) => setTimeout(() => resolve(-1), timeoutMs));
    return Promise.race([proc.exit, timeout]);
};

const tokenizeShellCommand = (command: string): { program: string; args: string[] } => {
    const parts = command.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [command];
    const program = parts[0] ?? command;
    const args = parts.slice(1).map((a) => a.replace(/^["']|["']$/g, ''));
    return { program, args };
};

const isInformationalCommand = (command: string): boolean =>
    /^\s*(echo|pwd|ls|cat)\s/.test(command);

const isLongRunningCommand = (command: string): boolean =>
    /\b(dev|start|serve|watch)\b/.test(command);

const isNpmInstallCommand = (command: string): boolean =>
    /^npm\s+(install|i|ci)\b/i.test(command.trim());

export type ShellExecutionResult = {
    status: 'resolved' | 'failed';
    detail?: string;
    executedCommands: string[];
    devServerStarted: boolean;
    installSucceeded: boolean;
    finalCwd: string;
    devProcess?: unknown;
};

export type ExecuteShellCommandsOptions = {
    wc: WebContainer;
    commands: string[];
    initialCwd: string;
    writeOutput: (data: string) => void;
    beforeNpmInstall?: () => Promise<void>;
    onCommandStart?: (command: string, cwd: string) => void;
    onCommandComplete?: (command: string, cwd: string, exitCode: number) => void | Promise<void>;
    onDevServerStarted?: (proc: unknown, command: string, cwd: string) => void;
    onCommandError?: (command: string, error: unknown) => void;
    onTimeout?: (command: string, timeoutMs: number) => void;
    onNonZeroExit?: (command: string, exitCode: number) => void;
    failOnNonZeroExit?: boolean;
    installTimeoutMs?: number;
    defaultTimeoutMs?: number;
};

const isNpmRunScript = (command: string): boolean =>
    /^npm\s+run\s+(dev|build|preview)\b/i.test(command.trim());

export async function runCommandWithCapturedOutput(
    wc: WebContainer,
    command: string,
    cwd: string,
    options?: {
        timeoutMs?: number;
        writeOutput?: (data: string) => void;
        beforeNpmInstall?: () => Promise<void>;
    },
): Promise<{ exitCode: number; output: string }> {
    const chunks: string[] = [];
    const writeOutput = options?.writeOutput ?? (() => undefined);
    const { program, args } = tokenizeShellCommand(command);

    if (isNpmInstallCommand(command)) {
        await options?.beforeNpmInstall?.();
    }
    if (isNpmRunScript(command)) {
        await repairViteScriptsForWebContainer(wc, {
            projectDir: cwd,
            announce: options?.writeOutput,
        });
    }

    const spawnOpts = buildSpawnOptions(wc, cwd);
    const proc = await wc.spawn(program, args, spawnOpts);
    await proc.output.pipeTo(new WritableStream({
        write(data) {
            chunks.push(data);
            writeOutput(data);
        },
    }));

    const timeoutMs = isNpmInstallCommand(command)
        ? (options?.timeoutMs ?? BUILD_INSTALL_TIMEOUT_MS)
        : (options?.timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS);
    const exitCode = await runProcessAndCollectExit(proc, timeoutMs);
    return { exitCode, output: chunks.join('') };
}

export const packageJsonHasScript = (fileMap: Map<string, string>, scriptName: string): boolean => {
    try {
        const pkg = JSON.parse(fileMap.get('package.json') || '{}');
        return typeof pkg.scripts?.[scriptName] === 'string';
    } catch {
        return false;
    }
};

export async function executeShellCommandsInWebContainer(
    options: ExecuteShellCommandsOptions,
): Promise<ShellExecutionResult> {
    const {
        wc,
        commands,
        initialCwd,
        writeOutput,
        beforeNpmInstall,
        onCommandStart,
        onCommandComplete,
        onDevServerStarted,
        onCommandError,
        onTimeout,
        onNonZeroExit,
        failOnNonZeroExit = false,
        installTimeoutMs = BUILD_INSTALL_TIMEOUT_MS,
        defaultTimeoutMs = DEFAULT_COMMAND_TIMEOUT_MS,
    } = options;

    const shellQueue = normalizeShellCommandQueue(commands);
    const executedCommands: string[] = [];
    let commandCwd = normalizeProjectDir(wc, initialCwd);
    let status: 'resolved' | 'failed' = 'resolved';
    let detail: string | undefined;
    let devServerStarted = false;
    let installSucceeded = false;
    let devProcess: unknown;

    for (const command of shellQueue) {
        if (!command || /^\s*$/.test(command)) continue;
        if (isInformationalCommand(command)) continue;

        const { nextDir, remainder } = splitCdAndCommand(command);
        if (nextDir) {
            commandCwd = resolveWorkingDirectory(commandCwd, nextDir);
            writeOutput(`\r\n\x1b[2mcd ${commandCwd}\x1b[0m\r\n`);
            if (!remainder) continue;
        }
        if (!remainder || /^\s*$/.test(remainder)) continue;

        writeOutput(`\r\n\x1b[36m❯ [${commandCwd}] ${remainder}\x1b[0m\r\n`);
        onCommandStart?.(remainder, commandCwd);
        executedCommands.push(remainder);

        let adjustedCommand = remainder;
        if (/^npm\s+(install|i)\b/i.test(remainder.trim()) && !remainder.includes('--legacy-peer-deps')) {
            adjustedCommand += ' --legacy-peer-deps';
        }

        const isLongRunning = isLongRunningCommand(remainder);

        try {
            if (isNpmInstallCommand(adjustedCommand)) {
                await beforeNpmInstall?.();
            }
            if (isNpmRunScript(adjustedCommand)) {
                await repairViteScriptsForWebContainer(wc, {
                    projectDir: commandCwd,
                    announce: writeOutput,
                });
            }

            const { program, args } = tokenizeShellCommand(adjustedCommand);
            const proc = await wc.spawn(program, args, buildSpawnOptions(wc, commandCwd));
            proc.output.pipeTo(new WritableStream({
                write(data) { writeOutput(data); },
            }));

            if (isLongRunning) {
                devServerStarted = true;
                devProcess = proc;
                onDevServerStarted?.(proc, remainder, commandCwd);
                await onCommandComplete?.(remainder, commandCwd, 0);
                continue;
            }

            const timeoutMs = isNpmInstallCommand(remainder) ? installTimeoutMs : defaultTimeoutMs;
            const exitCode = await runProcessAndCollectExit(proc, timeoutMs);
            await onCommandComplete?.(remainder, commandCwd, exitCode);

            if (exitCode === 0 && isNpmInstallCommand(remainder)) {
                installSucceeded = true;
            }

            if (exitCode === -1) {
                onTimeout?.(remainder, timeoutMs);
                if (failOnNonZeroExit) {
                    detail = `${remainder} timed out after ${timeoutMs / 1000}s`;
                    status = 'failed';
                    break;
                }
            } else if (exitCode !== 0) {
                onNonZeroExit?.(remainder, exitCode);
                if (failOnNonZeroExit) {
                    detail = `${remainder} failed with exit ${exitCode}`;
                    status = 'failed';
                    break;
                }
            }
        } catch (error) {
            onCommandError?.(remainder, error);
            if (failOnNonZeroExit) {
                detail = error instanceof Error ? error.message : String(error);
                status = 'failed';
                break;
            }
        }
    }

    return {
        status,
        detail,
        executedCommands,
        devServerStarted,
        installSucceeded,
        finalCwd: commandCwd,
        devProcess,
    };
}
