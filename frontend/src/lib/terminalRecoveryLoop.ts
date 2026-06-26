import type { WebContainer } from '@webcontainer/api';
import { BoltParser, applyPatchToContent } from './boltProtocol';
import { detectTerminalIssue } from './terminalIssues';
import type { TerminalIssue } from '../store/webContainer';
import {
    getShellOutputBuffer,
    getShellOutputSince,
    markShellOutputPosition,
    writeShellOutput,
} from '../store/webContainer';
import {
    ensureDepsReadyForDev,
    filterInstallShellCommands,
    syncProjectFiles,
} from './sandboxInstall';
import {
    extractErrorSnippets,
    extractPathsFromTerminalOutput,
    selectRecoveryFiles,
} from './terminalRecoveryContext';
import {
    executeShellCommandsInWebContainer,
    inferProjectDirectory,
    normalizeShellCommandQueue,
    packageJsonHasScript,
    resolveProjectDirectoryForNpm,
    runCommandWithCapturedOutput,
    syncShellWorkingDirectory,
    buildSpawnOptions,
} from './webContainerShell';
import { applyDeterministicTerminalFixes, isDeterministicFixCode } from './terminalAutoFix';
import { DEFAULT_RECOVERY_MODEL, resolveRecoveryModel } from './models';
import { repairViteScriptsForWebContainer, terminalShowsVitePermissionError } from './webContainerScripts';

export const MAX_RECOVERY_ROUNDS = 3;
export const VERIFY_WAIT_AFTER_DEV_MS = 14_000;
export const BUILD_VERIFY_TIMEOUT_MS = 180_000;

export type PriorRecoveryAttempt = {
    round: number;
    filesChanged: string[];
    commandsExecuted: string[];
    result: string;
    errorSnippets: string;
    issueCode?: string;
};

export type IterativeRecoveryResult = {
    status: 'resolved' | 'failed';
    detail?: string;
    plannedCommands: string[];
    executedCommands: string[];
    roundsUsed: number;
    projectDir: string;
    devServerStarted: boolean;
    finalIssue: TerminalIssue | null;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const writeFileToWebContainer = async (
    wc: WebContainer,
    filePath: string,
    content: string,
): Promise<void> => {
    const rel = filePath.replace(/^\//, '');
    const dir = rel.substring(0, rel.lastIndexOf('/'));
    if (dir) {
        try { await wc.fs.mkdir(dir, { recursive: true }); } catch { /* exists */ }
    }
    await wc.fs.writeFile(rel, content);
};

const viteReadyPattern = /Local:\s*https?:\/\/|ready in \d+|VITE v[\d.]+/i;

export type VerifyRecoveryInput = {
    wc: WebContainer;
    projectDir: string;
    fileMap: Map<string, string>;
    verifyMark: number;
    devServerStartedThisRound: boolean;
    devServerRunning: boolean;
};

export async function verifyRecoveryFix(input: VerifyRecoveryInput): Promise<{
    success: boolean;
    detail?: string;
    output: string;
}> {
    const { wc, projectDir, fileMap, verifyMark, devServerStartedThisRound, devServerRunning } = input;

    if (packageJsonHasScript(fileMap, 'build')) {
        writeShellOutput('\r\n\x1b[36m⬢ Verifying fix (npm run build)…\x1b[0m\r\n');
        const { exitCode, output } = await runCommandWithCapturedOutput(wc, 'npm run build', projectDir, {
            timeoutMs: BUILD_VERIFY_TIMEOUT_MS,
            writeOutput: writeShellOutput,
        });
        const issue = detectTerminalIssue(output);
        if (exitCode === 0 && !issue) {
            writeShellOutput('\r\n\x1b[32m✓ Build passed — error appears fixed\x1b[0m\r\n');
            return { success: true, output };
        }
        return {
            success: false,
            detail: issue?.message ?? (exitCode !== 0 ? `npm run build exited ${exitCode}` : 'Build output still shows errors'),
            output,
        };
    }

    if (devServerStartedThisRound || devServerRunning) {
        writeShellOutput('\r\n\x1b[36m⬢ Waiting for dev server to confirm fix…\x1b[0m\r\n');
        await sleep(VERIFY_WAIT_AFTER_DEV_MS);
        const since = getShellOutputSince(verifyMark);
        const issue = detectTerminalIssue(since);
        // Also scan for runtime errors that appear after "ready" (e.g. PostCSS, HMR errors)
        const hasRuntimeError = /\[postcss\]|Pre-transform error|Internal server error|error TS\d+:/i.test(since);
        if (viteReadyPattern.test(since) && (!issue || issue.confidence < 0.82) && !hasRuntimeError) {
            writeShellOutput('\r\n\x1b[32m✓ Dev server ready — error appears fixed\x1b[0m\r\n');
            return { success: true, output: since };
        }
        const runtimeDetail = hasRuntimeError ? 'Runtime errors detected after dev server start' : undefined;
        return {
            success: false,
            detail: runtimeDetail ?? issue?.message ?? 'Dev server did not become ready after fix',
            output: since,
        };
    }

    const since = getShellOutputSince(verifyMark);
    const tailIssue = detectTerminalIssue(since || getShellOutputBuffer().slice(-8000));
    if (!tailIssue) {
        writeShellOutput('\r\n\x1b[32m✓ No errors detected after applying fixes\x1b[0m\r\n');
        return { success: true, output: since };
    }

    return {
        success: false,
        detail: tailIssue.message,
        output: since,
    };
};

type ParseRecoveryStreamCallbacks = {
    onFile: (path: string, content: string) => void;
    onPatch: (path: string, patchContent: string) => void;
    onShell: (command: string) => void;
};

async function parseRecoveryStream(
    response: Response,
    callbacks: ParseRecoveryStreamCallbacks,
): Promise<void> {
    const reader = response.body?.getReader();
    if (!reader) throw new Error('Recovery stream unavailable');

    const decoder = new TextDecoder();
    const parser = new BoltParser();

    const processActions = (actions: ReturnType<BoltParser['parse']>) => {
        for (const action of actions) {
            if (action.type === 'file' && action.filePath) {
                callbacks.onFile(action.filePath, action.content);
            }
            if (action.type === 'patch' && action.filePath) {
                callbacks.onPatch(action.filePath, action.content);
            }
            if (action.type === 'shell') {
                callbacks.onShell(action.content.trim());
            }
        }
    };

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        processActions(parser.parse(decoder.decode(value)));
    }
    processActions(parser.parse(''));
}

export type RunIterativeRecoveryInput = {
    wc: WebContainer;
    threadId: string;
    getToken: () => Promise<string | null>;
    apiUrl: string;
    model?: string;
    initialTerminalOutput: string;
    initialIssue: TerminalIssue | null;
    getFileMap: () => Map<string, string>;
    shellWriter: WritableStreamDefaultWriter<string> | null;
    repairRootForNpm: (announce?: boolean) => Promise<void>;
    ensureRootPackageJson: () => Promise<void>;
    patchMissingDeps: () => Promise<void>;
    onFileWritten: (path: string, content: string) => void;
    onPreviewStatus: (status: 'starting' | 'error' | 'ready', message: string) => void;
    appendTerminalEvents: (
        events: Array<{ eventType: string; payload: string; cwd?: string; exitCode?: number | null }>,
    ) => Promise<void>;
    killActiveDevProcess?: () => Promise<void>;
    onDevServerStarted?: (proc: unknown) => void;
    bootstrapIssueCodes: Set<string>;
    initialIssueCode: string;
};

export async function runIterativeRecovery(input: RunIterativeRecoveryInput): Promise<IterativeRecoveryResult> {
    const {
        wc,
        threadId,
        getToken,
        apiUrl,
        model = DEFAULT_RECOVERY_MODEL,
        initialTerminalOutput,
        initialIssue,
        getFileMap,
        shellWriter,
        repairRootForNpm,
        ensureRootPackageJson,
        patchMissingDeps,
        onFileWritten,
        onPreviewStatus,
        appendTerminalEvents,
        killActiveDevProcess,
        onDevServerStarted,
        bootstrapIssueCodes,
        initialIssueCode,
    } = input;

    let terminalOutput = initialTerminalOutput || getShellOutputBuffer().slice(-12_000);
    let currentIssue = initialIssue;
    const priorAttempts: PriorRecoveryAttempt[] = [];
    const allPlannedCommands: string[] = [];
    const allExecutedCommands: string[] = [];

    let projectDir = (await resolveProjectDirectoryForNpm(
        wc,
        getFileMap(),
        inferProjectDirectory(getFileMap()),
    )).projectDir;
    await syncShellWorkingDirectory(shellWriter, wc, projectDir);

    let status: 'resolved' | 'failed' = 'failed';
    let detail = '';
    let devServerStarted = false;
    let roundsUsed = 0;

    writeShellOutput('\r\n\x1b[36m⬢ Running automatic terminal fixes (no LLM)…\x1b[0m\r\n');
    const preFixes = await applyDeterministicTerminalFixes({
        wc,
        terminalOutput,
        projectDir,
        fileMap: getFileMap(),
        repairRootForNpm,
        onPackageJsonPatched: (content) => onFileWritten('package.json', content),
        onFilePatched: (path, content) => onFileWritten(path, content),
        syncShellCwd: () => syncShellWorkingDirectory(shellWriter, wc, projectDir, true),
    });
    if (preFixes.some((f) => f.applied)) {
        const preToken = await getToken();
        if (preToken) {
            const preDep = await ensureDepsReadyForDev({
                wc,
                threadId,
                fileMap: getFileMap(),
                authToken: preToken,
                apiUrl,
                writeShellOutput,
                onPreviewStatus,
                repairRootForNpm,
                appendTerminalEvents: (events) => appendTerminalEvents(events),
            });
            if (preDep.ok) {
                projectDir = preDep.projectDir;
                writeShellOutput('\r\n\x1b[32m✓ Automatic fix resolved install — skipping LLM recovery\x1b[0m\r\n');
                await syncShellWorkingDirectory(shellWriter, wc, projectDir);
                if (!devServerStarted) {
                    writeShellOutput('\r\n\x1b[36m⬢ Starting dev server…\x1b[0m\r\n');
                    onPreviewStatus('starting', 'Starting development server…');
                    const devProc = await wc.spawn('npm', ['run', 'dev'], buildSpawnOptions(wc, projectDir));
                    devProc.output.pipeTo(new WritableStream({ write(data) { writeShellOutput(data); } }));
                    devServerStarted = true;
                    onDevServerStarted?.(devProc);
                }
                return {
                    status: 'resolved',
                    detail: preFixes.filter((f) => f.applied).map((f) => f.message).join('; '),
                    plannedCommands: [],
                    executedCommands: devServerStarted ? ['npm run dev'] : [],
                    roundsUsed: 0,
                    projectDir,
                    devServerStarted,
                    finalIssue: null,
                };
            }
            terminalOutput = getShellOutputBuffer().slice(-12_000);
            currentIssue = detectTerminalIssue(terminalOutput);
        }

        // If the remaining problem is purely environmental, the LLM cannot help.
        // Bail out with an actionable message instead of burning recovery rounds.
        if (isDeterministicFixCode(currentIssue)) {
            writeShellOutput(
                '\r\n\x1b[33m⚠ Environmental issue persists after automatic fixes — skipping LLM recovery.\x1b[0m\r\n',
            );
            return {
                status: 'failed',
                detail: currentIssue?.message
                    ? `${currentIssue.message} (automatic fixes applied; manual retry may be needed)`
                    : 'Environmental sandbox issue could not be auto-resolved',
                plannedCommands: [],
                executedCommands: [],
                roundsUsed: 0,
                projectDir,
                devServerStarted: false,
                finalIssue: currentIssue,
            };
        }
    }

    for (let round = 1; round <= MAX_RECOVERY_ROUNDS; round += 1) {
        roundsUsed = round;
        const issueCode = currentIssue?.code ?? initialIssueCode;
        writeShellOutput(`\r\n\x1b[36m⬢ Recovery round ${round}/${MAX_RECOVERY_ROUNDS} — diagnosing (${model})…\x1b[0m\r\n`);
        onPreviewStatus('starting', `Recovery round ${round}/${MAX_RECOVERY_ROUNDS}: analyzing error…`);

        const token = await getToken();
        if (!token) {
            throw new Error('Auth token unavailable — sign in again');
        }

        const flatFiles = [...getFileMap().entries()].map(([filePath, content]) => ({ filePath, content }));
        const recoveryFiles = selectRecoveryFiles(flatFiles, terminalOutput);
        const errorSnippets = extractErrorSnippets(terminalOutput);
        const referencedPaths = extractPathsFromTerminalOutput(terminalOutput);

        const response = await fetch(`${apiUrl}/terminal/${encodeURIComponent(threadId)}/recover`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
                terminalOutput,
                issueCode,
                issueMessage: currentIssue?.message,
                diagnosticHints: currentIssue?.diagnosticHints ?? [],
                errorSnippets,
                referencedPaths,
                projectDir,
                files: recoveryFiles,
                model,
                recoveryRound: round,
                maxRecoveryRounds: MAX_RECOVERY_ROUNDS,
                priorAttempts,
            }),
        });

        if (!response.ok) {
            const errText = await response.text().catch(() => '');
            throw new Error(`Recovery API failed (${response.status}): ${errText || response.statusText}`);
        }

        const pendingShellCommands: string[] = [];
        const writtenThisRound = new Map<string, string>();
        const pendingPatches: Array<{ path: string; patchContent: string }> = [];

        await parseRecoveryStream(response, {
            onFile: (path, content) => {
                const normalized = path.replace(/^\//, '');
                writtenThisRound.set(normalized, content);
            },
            onPatch: (path, patchContent) => {
                pendingPatches.push({ path: path.replace(/^\//, ''), patchContent });
            },
            onShell: (command) => pendingShellCommands.push(command),
        });

        // Apply patches: read current file, apply search/replace hunks, write back
        for (const { path, patchContent } of pendingPatches) {
            const existing =
                writtenThisRound.get(path) ??
                getFileMap().get(path) ??
                getFileMap().get(path.replace(/^\//, ''));
            let base = existing;
            if (!base) {
                try { base = await wc.fs.readFile(path, 'utf-8'); } catch { /* new file */ }
            }
            if (base) {
                const patched = applyPatchToContent(base, patchContent);
                if (patched !== null) {
                    writtenThisRound.set(path, patched);
                    writeShellOutput(`\r\n\x1b[36m⬢ Applied patch to ${path}\x1b[0m\r\n`);
                } else {
                    writeShellOutput(`\r\n\x1b[33m⚠ Patch for ${path} — search text not found, skipping\x1b[0m\r\n`);
                }
            } else {
                // No existing file: treat patch content as full file content
                writtenThisRound.set(path, patchContent);
            }
        }

        if (writtenThisRound.size === 0 && pendingShellCommands.length === 0) {
            const snippets = extractErrorSnippets(terminalOutput);
            priorAttempts.push({
                round,
                filesChanged: [],
                commandsExecuted: [],
                result: 'Agent returned no fixes',
                errorSnippets: snippets,
                issueCode,
            });
            detail = 'Agent returned no file or shell fixes';
            break;
        }

        for (const [path, content] of writtenThisRound) {
            await writeFileToWebContainer(wc, path, content);
            onFileWritten(path, content);
        }

        await ensureRootPackageJson();
        await patchMissingDeps();

        const recoveryFileMap = getFileMap();
        for (const [k, v] of writtenThisRound) {
            recoveryFileMap.set(k, v);
        }
        await syncProjectFiles(wc, threadId, recoveryFileMap, []);

        if (terminalShowsVitePermissionError(terminalOutput)) {
            await repairViteScriptsForWebContainer(wc, {
                fileMap: recoveryFileMap,
                projectDir,
                onPatched: (patched) => onFileWritten('package.json', patched),
                announce: writeShellOutput,
            });
        }

        projectDir = (await resolveProjectDirectoryForNpm(
            wc,
            recoveryFileMap,
            inferProjectDirectory(recoveryFileMap),
        )).projectDir;
        await syncShellWorkingDirectory(shellWriter, wc, projectDir);

        const verifyMark = markShellOutputPosition();
        let devServerStartedThisRound = false;
        const roundCommands: string[] = [];

        const depResult = await ensureDepsReadyForDev({
            wc,
            threadId,
            fileMap: recoveryFileMap,
            authToken: token,
            apiUrl,
            writeShellOutput,
            onPreviewStatus,
            repairRootForNpm,
            appendTerminalEvents: (events) => appendTerminalEvents(events),
        });

        if (!depResult.ok) {
            terminalOutput = getShellOutputSince(verifyMark) || getShellOutputBuffer().slice(-12_000);
            currentIssue = detectTerminalIssue(terminalOutput);
            priorAttempts.push({
                round,
                filesChanged: [...writtenThisRound.keys()],
                commandsExecuted: roundCommands,
                result: depResult.errorMessage ?? 'Dependency install failed',
                errorSnippets: extractErrorSnippets(terminalOutput),
                issueCode: currentIssue?.code ?? issueCode,
            });
            detail = depResult.errorMessage ?? 'Dependency install failed during recovery';
            if (round < MAX_RECOVERY_ROUNDS) {
                writeShellOutput('\r\n\x1b[33m⚠ Install still failing — trying another fix approach…\x1b[0m\r\n');
                continue;
            }
            break;
        }

        projectDir = depResult.projectDir;
        await syncShellWorkingDirectory(shellWriter, wc, projectDir);

        const shellQueue = filterInstallShellCommands(normalizeShellCommandQueue(pendingShellCommands));
        allPlannedCommands.push(...shellQueue);
        roundCommands.push(...shellQueue);

        if (shellQueue.length > 0) {
            if (shellQueue.some((c) => /npm\s+run\s+dev\b/i.test(c)) && killActiveDevProcess) {
                await killActiveDevProcess();
            }
            const execResult = await executeShellCommandsInWebContainer({
                wc,
                commands: shellQueue,
                initialCwd: projectDir,
                writeOutput: writeShellOutput,
                failOnNonZeroExit: false,
                beforeNpmInstall: () => repairRootForNpm(true),
                onCommandComplete: async (command, cwd, exitCode) => {
                    await appendTerminalEvents([
                        { eventType: 'command', payload: command, cwd },
                        { eventType: 'status', payload: `exit:${exitCode}`, cwd, exitCode },
                    ]);
                },
                onDevServerStarted: (proc, command, cwd) => {
                    devServerStarted = true;
                    devServerStartedThisRound = true;
                    onDevServerStarted?.(proc);
                    void appendTerminalEvents([{ eventType: 'command', payload: command, cwd }]);
                },
            });
            allExecutedCommands.push(...execResult.executedCommands);
            roundCommands.push(...execResult.executedCommands);
            devServerStarted = devServerStarted || execResult.devServerStarted;
            projectDir = execResult.finalCwd;

            if (execResult.status === 'failed' && execResult.detail) {
                terminalOutput = getShellOutputSince(verifyMark) || getShellOutputBuffer().slice(-12_000);
                currentIssue = detectTerminalIssue(terminalOutput);
                priorAttempts.push({
                    round,
                    filesChanged: [...writtenThisRound.keys()],
                    commandsExecuted: roundCommands,
                    result: execResult.detail,
                    errorSnippets: extractErrorSnippets(terminalOutput),
                    issueCode: currentIssue?.code ?? issueCode,
                });
                detail = execResult.detail;
                if (round < MAX_RECOVERY_ROUNDS) {
                    writeShellOutput('\r\n\x1b[33m⚠ Command failed — re-analyzing with new output…\x1b[0m\r\n');
                    continue;
                }
                break;
            }
        } else if (
            !devServerStarted &&
            bootstrapIssueCodes.has(issueCode)
        ) {
            if (killActiveDevProcess) await killActiveDevProcess();
            allPlannedCommands.push('npm run dev');
            roundCommands.push('npm run dev');
            writeShellOutput('\r\n\x1b[36m⬢ Starting dev server to verify…\x1b[0m\r\n');
            const devProc = await wc.spawn('npm', ['run', 'dev'], buildSpawnOptions(wc, projectDir));
            devProc.output.pipeTo(new WritableStream({ write(data) { writeShellOutput(data); } }));
            devServerStarted = true;
            devServerStartedThisRound = true;
            onDevServerStarted?.(devProc);
            allExecutedCommands.push('npm run dev');
            await appendTerminalEvents([{ eventType: 'command', payload: 'npm run dev', cwd: projectDir }]);
        }

        const verify = await verifyRecoveryFix({
            wc,
            projectDir,
            fileMap: recoveryFileMap,
            verifyMark,
            devServerStartedThisRound,
            devServerRunning: devServerStarted,
        });

        terminalOutput = verify.output || getShellOutputSince(verifyMark) || getShellOutputBuffer().slice(-12_000);
        currentIssue = detectTerminalIssue(terminalOutput);

        if (verify.success) {
            status = 'resolved';
            detail = round > 1 ? `Fixed after ${round} recovery rounds` : '';
            break;
        }

        priorAttempts.push({
            round,
            filesChanged: [...writtenThisRound.keys()],
            commandsExecuted: roundCommands,
            result: verify.detail ?? 'Verification failed',
            errorSnippets: extractErrorSnippets(terminalOutput),
            issueCode: currentIssue?.code ?? issueCode,
        });
        detail = verify.detail ?? currentIssue?.message ?? 'Verification failed';

        if (round < MAX_RECOVERY_ROUNDS) {
            writeShellOutput(`\r\n\x1b[33m⚠ Still failing: ${detail}\x1b[0m\r\n`);
            writeShellOutput('\r\n\x1b[36m⬢ Re-analyzing with updated terminal output…\x1b[0m\r\n');
        }
    }

    if (status !== 'resolved' && !detail) {
        detail = currentIssue?.message ?? `Recovery failed after ${roundsUsed} rounds`;
    }

    if (status === 'resolved' && !devServerStarted) {
        await syncShellWorkingDirectory(shellWriter, wc, projectDir);
        writeShellOutput('\r\n\x1b[36m⬢ Starting dev server…\x1b[0m\r\n');
        onPreviewStatus('starting', 'Starting development server…');
        const devProc = await wc.spawn('npm', ['run', 'dev'], buildSpawnOptions(wc, projectDir));
        devProc.output.pipeTo(new WritableStream({ write(data) { writeShellOutput(data); } }));
        devServerStarted = true;
        onDevServerStarted?.(devProc);
        allExecutedCommands.push('npm run dev');
        await appendTerminalEvents([{ eventType: 'command', payload: 'npm run dev', cwd: projectDir }]);
    }

    return {
        status,
        detail,
        plannedCommands: allPlannedCommands,
        executedCommands: allExecutedCommands,
        roundsUsed,
        projectDir,
        devServerStarted,
        finalIssue: status === 'resolved' ? null : currentIssue,
    };
}
