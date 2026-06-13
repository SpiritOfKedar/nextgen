import type { WebContainer } from '@webcontainer/api';

export const INSTALL_FIRST_ATTEMPT_TIMEOUT_MS = 120_000;
const BUILD_INSTALL_TIMEOUT_MS = 300_000;
const DEFAULT_COMMAND_TIMEOUT_MS = 120_000;

export const normalizeWrittenPath = (p: string) => p.replace(/^\//, '').replace(/\\/g, '/');

export const normalizeWebContainerPath = (path: string): string => {
    const normalized = path.replace(/\\/g, '/').trim();
    if (!normalized) return '/';
    const parts = normalized.split('/').filter(Boolean);
    return `/${parts.join('/')}`;
};

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

let lastSyncedShellCwd: string | null = null;

export const resetSyncedShellCwd = (): void => {
    lastSyncedShellCwd = null;
};

export const syncShellWorkingDirectory = async (
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
    let commandCwd = initialCwd;
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

            const { program, args } = tokenizeShellCommand(adjustedCommand);
            const proc = await wc.spawn(program, args, {
                env: { FORCE_COLOR: '1' },
                cwd: commandCwd,
            });
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
