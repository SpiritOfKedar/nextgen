import { useCallback, useState } from 'react';
import { useAtom, useSetAtom, useAtomValue } from 'jotai';
import { messagesAtom, currentThreadIdAtom, threadSwitchStateAtom, threadsAtom, selectedModelAtom, chatModeAtom, type ChatMode } from '../store/atoms';
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
    type TerminalIssue,
} from '../store/webContainer';
import { getWebContainerInstance } from './useWebContainer';
import { fileSystemAtom, openEditorTabAtom, clearEditorTabsAtom } from '../store/fileSystem';
import type { FileSystemItem, FileNode, FolderNode, ActiveFile } from '../store/fileSystem';
import { useAuth } from '@clerk/clerk-react';
import { useNavigate } from 'react-router-dom';
import { BoltParser } from '../lib/boltProtocol';
import type { BoltAction } from '../lib/boltProtocol';
import { detectTerminalIssue } from '../lib/terminalIssues';
import { runIterativeRecovery } from '../lib/terminalRecoveryLoop';
import {
    executeShellCommandsInWebContainer,
    inferProjectDirectory,
    normalizeShellCommandQueue,
    normalizeWrittenPath,
    resetSyncedShellCwd,
    syncShellWorkingDirectory,
    WEBCONTAINER_SPAWN_ENV,
} from '../lib/webContainerShell';
import { repairViteScriptsForWebContainer } from '../lib/webContainerScripts';
import {
    ensureProjectDependencies,
    filterInstallShellCommands,
    getCriticalConfigFingerprint,
    getDependencyFingerprint,
    MINIMAL_ROOT_PACKAGE_JSON,
    syncProjectFiles,
} from '../lib/sandboxInstall';
import {
    injectSupabaseEnv,
    applySupabaseMigrations,
    type SupabaseMigrationInput,
} from '../lib/supabaseSandboxEnv';
import type { WebContainer } from '@webcontainer/api';

/** Serialize WebContainer fs writes so the chat stream reader never stalls on slow I/O (fixes dropped Claude streams). */
const queueBoltFileWrite = (
    chainRef: { current: Promise<void> },
    wc: WebContainer,
    filePath: string,
    fileContent: string,
) => {
    chainRef.current = chainRef.current.then(async () => {
        try {
            const absPath = '/' + filePath.replace(/^\//, '');
            const dir = absPath.substring(0, absPath.lastIndexOf('/'));
            if (dir && dir !== '/') {
                try {
                    await wc.fs.mkdir(dir, { recursive: true });
                } catch {
                    // Directory may already exist
                }
            }
            await wc.fs.writeFile(absPath, fileContent);
        } catch (err) {
            console.error(`[Bolt] Failed to write ${filePath}:`, err);
        }
    });
};

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
// MINIMAL_ROOT_PACKAGE_JSON imported from sandboxInstall

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
        pkg.dependencies[p] = pinnedVersionForPackage(p);
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
const lastRestoredTargetSeqByThread = new Map<string, number>();
let mountedProjectFiles = new Set<string>();
const mountedFilesByThread = new Map<string, Set<string>>();
let activeMountedThreadId: string | null = null;
let activeDevProcess: any = null;
let activeDevServerFingerprint: string | null = null;
let activeCriticalFingerprint: string | null = null;

const COMMON_PACKAGE_VERSIONS: Record<string, string> = {
    'framer-motion': '^11.0.0',
    'react-router-dom': '^6.28.0',
    'date-fns': '^3.6.0',
    uuid: '^10.0.0',
    zod: '^3.23.0',
    zustand: '^5.0.0',
    '@tanstack/react-query': '^5.60.0',
    axios: '^1.7.0',
    'react-icons': '^5.3.0',
    '@dnd-kit/core': '^6.1.0',
    '@dnd-kit/sortable': '^8.0.0',
    recharts: '^2.13.0',
    sonner: '^1.7.0',
    '@supabase/supabase-js': '^2.45.0',
};

const pinnedVersionForPackage = (name: string): string =>
    COMMON_PACKAGE_VERSIONS[name] ?? '^1.0.0';

const flattenFileSystem = (items: FileSystemItem[], prefix = ''): { filePath: string; content: string }[] => {
    const out: { filePath: string; content: string }[] = [];
    for (const item of items) {
        const path = prefix ? `${prefix}/${item.name}` : item.name;
        if (item.type === 'file') {
            out.push({ filePath: path, content: item.content });
        } else {
            out.push(...flattenFileSystem(item.children, path));
        }
    }
    return out;
};

const buildFileMap = (
    tree: FileSystemItem[],
    writtenFiles: Map<string, string> = new Map(),
): Map<string, string> => {
    const map = new Map<string, string>();
    for (const f of flattenFileSystem(tree)) {
        map.set(f.filePath, f.content);
    }
    for (const [k, v] of writtenFiles) {
        map.set(normalizeWrittenPath(k), v);
    }
    return map;
};

const RECOVERY_BOOTSTRAP_ISSUE_CODES = new Set([
    'cwd_package_json_missing',
    'install_failed',
    'dev_server_failed',
    'vite_permission_denied',
    'vite_missing_binary',
    'module_resolution_failed',
    'peer_dependency_conflict',
    'vite_plugin_missing',
    'wrong_working_directory',
    'invalid_shell_chain',
]);

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
    const openEditorTab = useSetAtom(openEditorTabAtom);
    const clearEditorTabs = useSetAtom(clearEditorTabsAtom);
    const setServerUrl = useSetAtom(serverUrlAtom);
    const setPreviewStatus = useSetAtom(previewStatusAtom);
    const setPreviewStatusMessage = useSetAtom(previewStatusMessageAtom);
    const setSandboxRuntimeMetadata = useSetAtom(sandboxRuntimeMetadataAtom);
    const setThreadSwitchState = useSetAtom(threadSwitchStateAtom);
    const setTerminalSessionByThread = useSetAtom(terminalSessionByThreadAtom);
    const setRecoveryAuditsByThread = useSetAtom(recoveryAuditsByThreadAtom);
    const setTerminalStatusByThread = useSetAtom(terminalStatusByThreadAtom);
    const setTerminalIssueByThread = useSetAtom(terminalIssueByThreadAtom);
    const fileSystem = useAtomValue(fileSystemAtom);

    const [isLoading, setIsLoading] = useState(false);
    type ThreadVersionItem = {
        seq: number;
        messageId: string;
        createdAt: string;
        model: string | null;
        changedFileCount: number;
    };
    type ChatAttachmentPayload = {
        kind: 'image' | 'text';
        name: string;
        mimeType: string;
        sizeBytes: number;
        dataBase64?: string;
        textContent?: string;
    };
    type FigmaLinkPayload = {
        url: string;
    };
    type StitchContextPayload = {
        projectId?: string;
        prompt?: string;
        screenId?: string;
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
        input: {
            threadId: string;
            triggerSource: 'manual' | 'auto';
            terminalOutput?: string;
            issue?: TerminalIssue | null;
            model?: string;
        },
    ) => {
        const { threadId, triggerSource, terminalOutput = '', issue = null, model = selectedModel } = input;
        if (!threadId || !isLoaded || !isSignedIn) return;
        const token = await getToken();
        if (!token) return;
        const issueCode = issue?.code || 'auto_recovery';
        const wc = webContainerInstance ?? getWebContainerInstance();
        if (!wc) return;

        const baseFileMap = buildFileMap(fileSystem);
        const sessionWrites = new Map<string, string>();

        setTerminalStatusByThread((prev) => ({ ...prev, [threadId]: 'running' }));
        writeShellOutput(`\r\n\x1b[36m⬢ Agent analyzing terminal output (up to 3 fix rounds, model: ${model})…\x1b[0m\r\n`);
        setPreviewStatus('starting');
        setPreviewStatusMessage('Agent is diagnosing and fixing…');

        let status: 'resolved' | 'failed' = 'failed';
        let detail = '';
        let plannedCommands: string[] = [];
        let executedCommands: string[] = [];
        let projectDir = '/';

        try {
            const result = await runIterativeRecovery({
                wc,
                threadId,
                token,
                apiUrl: API_URL,
                model,
                initialTerminalOutput: terminalOutput,
                initialIssue: issue,
                getFileMap: () => {
                    const map = new Map(baseFileMap);
                    for (const [k, v] of sessionWrites) map.set(k, v);
                    return map;
                },
                shellWriter,
                repairRootForNpm: (announce) => repairRootForNpm(wc, announce),
                ensureRootPackageJson: async () => {
                    await ensureRootPackageJsonExists(sessionWrites, wc, setFileSystem);
                },
                patchMissingDeps: async () => {
                    await patchMissingDependencies(sessionWrites, wc, setFileSystem);
                },
                onFileWritten: (path, content) => {
                    const normalized = path.replace(/^\//, '');
                    sessionWrites.set(normalized, content);
                    setFileSystem((prev) => upsertFile(prev, path, content));
                    const fileName = path.split('/').pop()!;
                    openEditorTab({ path: normalized, name: fileName, content });
                },
                onPreviewStatus: (previewStatus, message) => {
                    setPreviewStatus(previewStatus);
                    setPreviewStatusMessage(message);
                },
                appendTerminalEvents: (events) => appendTerminalEvents(threadId, token, events),
                killActiveDevProcess: async () => {
                    if (activeDevProcess?.kill) {
                        try { await activeDevProcess.kill(); } catch { /* ignore */ }
                        activeDevProcess = null;
                    }
                },
                onDevServerStarted: (proc) => {
                    activeDevProcess = proc;
                    const fileMap = buildFileMap(fileSystem, sessionWrites);
                    activeDevServerFingerprint = getDependencyFingerprint(fileMap);
                    activeCriticalFingerprint = getCriticalConfigFingerprint(fileMap);
                },
                bootstrapIssueCodes: RECOVERY_BOOTSTRAP_ISSUE_CODES,
                initialIssueCode: issueCode,
            });

            status = result.status;
            detail = result.detail ?? '';
            plannedCommands = result.plannedCommands;
            executedCommands = result.executedCommands;
            projectDir = result.projectDir;

            if (status === 'resolved') {
                writeShellOutput(
                    `\r\n\x1b[32m✓ Recovery succeeded${result.roundsUsed > 1 ? ` after ${result.roundsUsed} rounds` : ''}\x1b[0m\r\n`,
                );
                const prevMeta = threadRuntimeMeta.get(threadId);
                if (prevMeta) {
                    threadRuntimeMeta.set(threadId, {
                        ...prevMeta,
                        projectDir,
                        installSucceeded: true,
                    });
                }
                setPreviewStatus('starting');
                setPreviewStatusMessage('Recovery verified. Preview should load shortly…');
            } else {
                writeShellOutput(`\r\n\x1b[31m✗ Recovery failed after ${result.roundsUsed} round(s): ${detail}\x1b[0m\r\n`);
                setPreviewStatus('error');
                setPreviewStatusMessage(detail);
            }

            setTerminalIssueByThread((prev) => ({
                ...prev,
                [threadId]: status === 'resolved' ? null : result.finalIssue,
            }));
        } catch (error) {
            detail = error instanceof Error ? error.message : String(error);
            status = 'failed';
            writeShellOutput(`\r\n\x1b[31m✗ Recovery failed: ${detail}\x1b[0m\r\n`);
            setPreviewStatus('error');
            setPreviewStatusMessage(detail);
        }

        setTerminalStatusByThread((prev) => ({ ...prev, [threadId]: status === 'resolved' ? 'idle' : 'error' }));

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
        }).catch(() => undefined);

        await refreshTerminalSession(threadId, token);
    }, [
        API_URL,
        appendTerminalEvents,
        fileSystem,
        getToken,
        isLoaded,
        isSignedIn,
        refreshTerminalSession,
        openEditorTab,
        setFileSystem,
        setPreviewStatus,
        setPreviewStatusMessage,
        setTerminalIssueByThread,
        setTerminalStatusByThread,
        shellWriter,
        webContainerInstance,
        selectedModel,
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
                scripts: {
                    dev: 'node ./node_modules/vite/bin/vite.js',
                    build: 'node ./node_modules/vite/bin/vite.js build',
                },
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
        const incomingFiles = new Set([...fileMap.keys()].map((p) => p.replace(/^\//, '')));
        const currentlyMountedFiles = activeMountedThreadId
            ? (mountedFilesByThread.get(activeMountedThreadId) ?? mountedProjectFiles)
            : mountedProjectFiles;
        const filesToDelete = [...currentlyMountedFiles].filter((p) => !incomingFiles.has(p));

        if (abortIfStale('before_file_sync')) return;
        const syncResult = await syncProjectFiles(wc, threadId, fileMap, filesToDelete);
        mountedProjectFiles = incomingFiles;
        mountedFilesByThread.set(threadId, incomingFiles);
        activeMountedThreadId = threadId;

        if (authToken) {
            await injectSupabaseEnv(wc, authToken);
        }

        const depFingerprint = getDependencyFingerprint(fileMap);
        const criticalFingerprint = getCriticalConfigFingerprint(fileMap);
        const shouldRestartServer =
            !activeDevProcess ||
            activeDevServerFingerprint !== depFingerprint ||
            activeCriticalFingerprint !== criticalFingerprint;

        try {
            if (abortIfStale('before_install_gate')) return;

            const depResult = await ensureProjectDependencies({
                wc,
                threadId,
                fileMap,
                authToken,
                apiUrl: API_URL,
                writeShellOutput,
                onPreviewStatus: (status, message) => {
                    setPreviewStatus(status);
                    setPreviewStatusMessage(message);
                },
                repairRootForNpm: (announce) => repairRootForNpm(wc, announce),
                appendTerminalEvents: (events) => appendTerminalEvents(threadId, authToken, events),
                abortIfStale: () => abortIfStale('during_install'),
            });

            const projectDir = depResult.projectDir;
            await syncShellWorkingDirectory(shellWriter, projectDir);

            if (!depResult.ok) {
                if (depResult.errorMessage === 'Stale thread switch') return;
                threadRuntimeMeta.set(threadId, {
                    depFingerprint: depResult.depFingerprint,
                    criticalFingerprint: depResult.criticalFingerprint,
                    projectDir,
                    lastAppliedSeq: latestSeq,
                    installSucceeded: false,
                    lastBootAt: Date.now(),
                    knownFiles: incomingFiles,
                    installFailureReason: depResult.errorMessage,
                });
                return;
            }

            if (abortIfStale('after_install')) return;

            if (depResult.cacheHit && !depResult.installed) {
                setPreviewStatus('starting');
                setPreviewStatusMessage('Dependencies ready. Starting dev server…');
            }

            if (shouldRestartServer) {
                if (abortIfStale('before_dev_server_restart')) return;
                if (activeDevProcess?.kill) {
                    try { await activeDevProcess.kill(); } catch { /* ignore */ }
                }
                await repairViteScriptsForWebContainer(wc, {
                    fileMap,
                    projectDir,
                    announce: writeShellOutput,
                    onPatched: (content) => {
                        fileMap.set('package.json', content);
                        setFileSystem((prev) => upsertFile(prev, 'package.json', content));
                    },
                });
                setPreviewStatus('starting');
                setPreviewStatusMessage('Starting development server…');
                writeShellOutput('\r\n\x1b[36m⬢ Starting dev server...\x1b[0m\r\n');
                const devProc = await wc.spawn('npm', ['run', 'dev'], {
                    env: WEBCONTAINER_SPAWN_ENV,
                    cwd: projectDir,
                });
                await appendTerminalEvents(threadId, authToken, [
                    { eventType: 'command', payload: 'npm run dev', cwd: projectDir },
                ]);
                console.info('[SandboxDecision] npm_spawn', {
                    threadId,
                    command: 'npm run dev',
                    cwd: projectDir,
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
                installed: depResult.installed,
                cacheHit: depResult.cacheHit,
                restoreMs: depResult.restoreMs,
                installMs: depResult.installMs,
                fileSyncMs: syncResult.ms,
                restartedServer: shouldRestartServer,
            });
        } catch (err) {
            console.error('[loadThread] install error:', err);
            setPreviewStatus('error');
            setPreviewStatusMessage(`Install error: ${String(err)}`);
            writeShellOutput(`\r\n\x1b[31m✗ Install error: ${err}\x1b[0m\r\n`);
            const errProjectDir = inferProjectDirectory(fileMap);
            threadRuntimeMeta.set(threadId, {
                depFingerprint,
                criticalFingerprint,
                projectDir: errProjectDir,
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
                    projectDir: errProjectDir,
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

    type SendMessageResult = { ok: true } | { ok: false; error: string };
    type SendMessageOptions = { mode?: ChatMode };

    const sendMessage = async (
        content: string,
        attachments: ChatAttachmentPayload[] = [],
        figmaLinks: FigmaLinkPayload[] = [],
        stitchContext: StitchContextPayload | null = null,
        options?: SendMessageOptions,
    ): Promise<SendMessageResult> => {
        if (!content.trim()) {
            return { ok: false, error: 'Enter a prompt describing what you want to build.' };
        }
        if (!isLoaded) {
            return { ok: false, error: 'Still loading — try again in a moment.' };
        }
        if (!isSignedIn) {
            return { ok: false, error: 'Sign in to start building.' };
        }

        const effectiveMode = options?.mode ?? chatMode;
        if (options?.mode) {
            setChatMode(options.mode);
        }

        console.log('[useChat] sendMessage called:', { content: content.substring(0, 50), model: selectedModel, mode: effectiveMode });

        const stitchSuffix = stitchContext ? '\n[Stitch context attached]' : '';
        const figmaSuffix = figmaLinks.length > 0
            ? `\n[Figma context: ${figmaLinks.length} link${figmaLinks.length > 1 ? 's' : ''}]`
            : '';

        // Optimistic UI update
        const userMessage = {
            id: Date.now().toString(),
            role: 'user' as const,
            content: attachments.length > 0
                ? `[Mode: ${effectiveMode === 'plan' ? 'Plan' : 'Build'}]\n${content}\n\n[Attached ${attachments.length} file${attachments.length > 1 ? 's' : ''}]${figmaSuffix}${stitchSuffix}`
                : `[Mode: ${effectiveMode === 'plan' ? 'Plan' : 'Build'}]\n${content}${figmaSuffix || stitchSuffix ? `\n\n${figmaSuffix}${stitchSuffix}` : ''}`,
            timestamp: Date.now(),
            conversationMode: effectiveMode,
        };
        setMessages((prev) => [...prev, userMessage]);
        setIsLoading(true);

        try {
            const token = await getToken();
            if (!token) {
                console.error('[useChat] Failed to get token. Aborting send.');
                return { ok: false, error: 'Could not get auth token. Try signing in again.' };
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
                    mode: effectiveMode,
                    attachments,
                    figmaLinks,
                    stitchContext: stitchContext || undefined,
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
            if (!reader) {
                return { ok: false, error: 'Server returned an empty response.' };
            }

            const assistantMessageId = Date.now() + 1 + '';
            let accumulatedContent = '';

            setMessages((prev) => [
                ...prev,
                {
                    id: assistantMessageId,
                    role: 'assistant',
                    content: '',
                    timestamp: Date.now(),
                    conversationMode: effectiveMode,
                    model: selectedModel,
                },
            ]);

            const parser = new BoltParser();
            const pendingShellCommands: string[] = [];
            const pendingMigrations: SupabaseMigrationInput[] = [];
            // Track all files written during this stream for dependency patching
            const writtenFiles = new Map<string, string>();
            const fsWriteChain = { current: Promise.resolve() };

            // ── Phase 1: Read the stream — write files immediately, queue shell commands ──
            // Navigate only after the first bytes arrive so the TCP reader is not starved by
            // heavy /builder layout + WebContainer work (which previously correlated with Claude streams dying mid-flight).
            let didNavigateForStream = false;
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                if (!didNavigateForStream && value && value.byteLength > 0 && effectiveMode === 'build') {
                    didNavigateForStream = true;
                    navigate('/builder');
                }

                const chunk = decoder.decode(value);
                accumulatedContent += chunk;

                // Parse for artifacts (parser now returns ALL complete actions per call)
                const actions = parser.parse(chunk);

                // Get WC instance — atom or module fallback
                const wc = webContainerInstance ?? getWebContainerInstance();

                for (const action of actions) {
                    if (effectiveMode !== 'build') continue;
                    if (action.type === 'file' && action.filePath) {
                        const path = action.filePath;
                        const fileContent = action.content;

                        // Queue WebContainer writes — never await them here or the stream reader
                        // stalls, TCP buffers fill, and the server-side Claude stream aborts mid-flight.
                        if (wc) {
                            queueBoltFileWrite(fsWriteChain, wc, path, fileContent);
                        }

                        // Track for dependency patching
                        writtenFiles.set(path.replace(/^\//, ''), fileContent);

                        // Update file system atom (file tree + editor)
                        setFileSystem((prev) => upsertFile(prev, path, fileContent));

                        // Set as active file in editor
                        const fileName = path.split('/').pop()!;
                        openEditorTab({ path: path.replace(/^\//, ''), name: fileName, content: fileContent });
                    }
                    if (action.type === 'shell') {
                        pendingShellCommands.push(action.content.trim());
                    }
                    if (action.type === 'supabase-migration' && action.id) {
                        const sql = action.content.trim();
                        pendingMigrations.push({ migrationId: action.id, sql });
                        const migrationPath = `supabase/migrations/${action.id}.sql`;
                        if (wc) queueBoltFileWrite(fsWriteChain, wc, migrationPath, sql);
                        writtenFiles.set(migrationPath, sql);
                        setFileSystem((prev) => upsertFile(prev, migrationPath, sql));
                    }
                }

                setMessages((prev) =>
                    prev.map((msg) =>
                        msg.id === assistantMessageId
                            ? { ...msg, content: stripBoltTags(accumulatedContent), conversationMode: effectiveMode }
                            : msg
                    )
                );
            }

            await fsWriteChain.current;

            // Flush any remaining buffered actions from the parser
            const remaining = parser.parse('');
            for (const action of remaining) {
                if (effectiveMode !== 'build') continue;
                if (action.type === 'file' && action.filePath) {
                    const path = action.filePath;
                    const fileContent = action.content;
                    const wc = webContainerInstance ?? getWebContainerInstance();
                    if (wc) {
                        queueBoltFileWrite(fsWriteChain, wc, path, fileContent);
                    }
                    writtenFiles.set(path.replace(/^\//, ''), fileContent);
                    setFileSystem((prev) => upsertFile(prev, path, fileContent));
                    const fileName = path.split('/').pop()!;
                    openEditorTab({ path: path.replace(/^\//, ''), name: fileName, content: fileContent });
                }
                if (action.type === 'shell') {
                    pendingShellCommands.push(action.content.trim());
                }
                if (action.type === 'supabase-migration' && action.id) {
                    const sql = action.content.trim();
                    pendingMigrations.push({ migrationId: action.id, sql });
                    const migrationPath = `supabase/migrations/${action.id}.sql`;
                    const wc = webContainerInstance ?? getWebContainerInstance();
                    if (wc) queueBoltFileWrite(fsWriteChain, wc, migrationPath, sql);
                    writtenFiles.set(migrationPath, sql);
                    setFileSystem((prev) => upsertFile(prev, migrationPath, sql));
                }
            }

            await fsWriteChain.current;

            if (effectiveMode === 'build') {
                const wcForNpm = webContainerInstance ?? getWebContainerInstance();
                await ensureRootPackageJsonExists(writtenFiles, wcForNpm, setFileSystem);
                await patchMissingDependencies(writtenFiles, wcForNpm, setFileSystem);

                // Supabase backend: apply schema migrations server-side, then inject the
                // browser-safe client env so the dev server boots against the live project.
                if (token && pendingMigrations.length > 0) {
                    setPreviewStatus('starting');
                    setPreviewStatusMessage('Applying Supabase migrations…');
                    writeShellOutput(`\r\n\x1b[36m⬢ Applying ${pendingMigrations.length} Supabase migration(s)...\x1b[0m\r\n`);
                    try {
                        const results = await applySupabaseMigrations(token, pendingMigrations);
                        for (const r of results) {
                            const color = r.status === 'failed' || r.status === 'blocked' ? '31'
                                : r.status === 'applied' ? '32' : '90';
                            writeShellOutput(`\x1b[${color}m  • ${r.migrationId}: ${r.status}${r.detail ? ` — ${r.detail}` : ''}\x1b[0m\r\n`);
                        }
                    } catch (err) {
                        writeShellOutput(`\r\n\x1b[31m✗ Supabase migration error: ${err instanceof Error ? err.message : String(err)}\x1b[0m\r\n`);
                    }
                }
                if (wcForNpm && token) {
                    await injectSupabaseEnv(wcForNpm, token);
                }

                const wc = wcForNpm;
                const buildThreadId = newThreadId ?? currentThreadId ?? localStorage.getItem('currentThreadId') ?? '';
                const installFileMap = new Map<string, string>();
                for (const [k, v] of writtenFiles) {
                    installFileMap.set(normalizeWrittenPath(k), v);
                }

                if (wc && installFileMap.size > 0 && buildThreadId && token) {
                    setPreviewStatus('starting');
                    setPreviewStatusMessage('Ensuring dependencies…');

                    const depResult = await ensureProjectDependencies({
                        wc,
                        threadId: buildThreadId,
                        fileMap: installFileMap,
                        authToken: token,
                        apiUrl: API_URL,
                        writeShellOutput,
                        onPreviewStatus: (previewStatus, message) => {
                            setPreviewStatus(previewStatus);
                            setPreviewStatusMessage(message);
                        },
                        repairRootForNpm: (announce) => repairRootForNpm(wc, announce),
                    });

                    if (!depResult.ok) {
                        setPreviewStatus('error');
                        setPreviewStatusMessage(depResult.errorMessage ?? 'Dependency install failed');
                    } else {
                        activeDevServerFingerprint = depResult.depFingerprint;
                        activeCriticalFingerprint = depResult.criticalFingerprint;
                        await syncShellWorkingDirectory(shellWriter, depResult.projectDir);

                        const shellQueue = filterInstallShellCommands(normalizeShellCommandQueue(pendingShellCommands));
                        const hasDevCommand = shellQueue.some((c) => /npm\s+run\s+dev\b/i.test(c));

                        if (shellQueue.length > 0) {
                            setPreviewStatus('starting');
                            setPreviewStatusMessage('Running start commands inside the sandbox…');
                            await executeShellCommandsInWebContainer({
                                wc,
                                commands: shellQueue,
                                initialCwd: depResult.projectDir,
                                writeOutput: writeShellOutput,
                                beforeNpmInstall: () => repairRootForNpm(wc, true),
                                onDevServerStarted: (proc) => {
                                    activeDevProcess = proc;
                                    activeDevServerFingerprint = depResult.depFingerprint;
                                    activeCriticalFingerprint = depResult.criticalFingerprint;
                                },
                                onTimeout: (command, timeoutMs) => {
                                    setPreviewStatus('error');
                                    setPreviewStatusMessage(`Command timed out: ${command}`);
                                    writeShellOutput(
                                        `\r\n\x1b[33m⚠ Command timed out after ${timeoutMs / 1000}s: ${command}\x1b[0m\r\n`,
                                    );
                                },
                                onNonZeroExit: (command, exitCode) => {
                                    setPreviewStatus('error');
                                    setPreviewStatusMessage(`Command failed (${exitCode}): ${command}`);
                                    writeShellOutput(`\r\n\x1b[33m⚠ Command exited with code ${exitCode}: ${command}\x1b[0m\r\n`);
                                },
                                onCommandError: (command, err) => {
                                    console.error(`[Bolt] spawn failed for "${command}":`, err);
                                    setPreviewStatus('error');
                                    setPreviewStatusMessage(`Failed to run command: ${command}`);
                                    writeShellOutput(`\r\n\x1b[31m✗ Failed: ${command} — ${err}\x1b[0m\r\n`);
                                },
                            });
                        } else if (!hasDevCommand && !activeDevProcess) {
                            setPreviewStatus('starting');
                            setPreviewStatusMessage('Starting development server…');
                            writeShellOutput('\r\n\x1b[36m⬢ Starting dev server...\x1b[0m\r\n');
                            const devProc = await wc.spawn('npm', ['run', 'dev'], {
                                env: WEBCONTAINER_SPAWN_ENV,
                                cwd: depResult.projectDir,
                            });
                            devProc.output.pipeTo(new WritableStream({
                                write(data) { writeShellOutput(data); },
                            }));
                            activeDevProcess = devProc;
                        }
                    }
                } else if (wc) {
                    const shellQueue = filterInstallShellCommands(normalizeShellCommandQueue(pendingShellCommands));
                    if (shellQueue.length > 0) {
                        setPreviewStatus('starting');
                        setPreviewStatusMessage('Running commands inside the sandbox…');
                        await executeShellCommandsInWebContainer({
                            wc,
                            commands: shellQueue,
                            initialCwd: inferProjectDirectory(writtenFiles),
                            writeOutput: writeShellOutput,
                            beforeNpmInstall: () => repairRootForNpm(wc, true),
                            onDevServerStarted: (proc) => {
                                activeDevProcess = proc;
                            },
                            onTimeout: (command, _timeoutMs) => {
                                setPreviewStatus('error');
                                setPreviewStatusMessage(`Command timed out: ${command}`);
                            },
                            onNonZeroExit: (command, exitCode) => {
                                setPreviewStatus('error');
                                setPreviewStatusMessage(`Command failed (${exitCode}): ${command}`);
                            },
                            onCommandError: (command, err) => {
                                console.error(`[Bolt] spawn failed for "${command}":`, err);
                                setPreviewStatus('error');
                                setPreviewStatusMessage(`Failed to run command: ${command}`);
                            },
                        });
                    }
                }
            }

            setMessages((prev) =>
                prev.map((msg) =>
                    msg.id === assistantMessageId
                        ? {
                            ...msg,
                            content: stripBoltTags(accumulatedContent),
                            conversationMode: effectiveMode,
                        }
                        : msg,
                ),
            );

            return { ok: true };
        } catch (error) {
            console.error('Chat Error:', error);
            const errorMsg = error instanceof Error ? error.message : 'Something went wrong';
            setMessages((prev) => [
                ...prev,
                {
                    id: Date.now() + 2 + '',
                    role: 'assistant',
                    content: `⚠️ **Error:** ${errorMsg}\n\nPlease try again. If the problem persists, check that the backend server is running and the API keys are configured.`,
                    timestamp: Date.now(),
                    model: selectedModel,
                },
            ]);
            return { ok: false, error: errorMsg };
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

    const deleteThread = useCallback(async (threadId: string): Promise<{ ok: true } | { ok: false; error: string }> => {
        if (!isLoaded || !isSignedIn) {
            return { ok: false, error: 'You need to be signed in to delete projects.' };
        }
        const token = await getToken();
        if (!token) {
            return { ok: false, error: 'Could not get auth token. Try signing in again.' };
        }
        const res = await fetch(`${API_URL}/chat/${encodeURIComponent(threadId)}`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) {
            const errBody = await res.text().catch(() => '');
            return {
                ok: false,
                error: `Failed to delete project (${res.status}): ${errBody || res.statusText}`.trim(),
            };
        }
        setThreads((prev) => prev.filter((t) => t._id !== threadId));
        if (currentThreadId === threadId) {
            setMessages([]);
            setCurrentThreadId(null);
            setFileSystem([]);
            clearEditorTabs();
            setServerUrl(null);
            setPreviewStatus('idle');
            setPreviewStatusMessage('Start a new prompt to generate and run a project.');
            setThreadSwitchState({ status: 'idle', targetThreadId: null, errorMessage: null });
            localStorage.removeItem('currentThreadId');
        }
        return { ok: true };
    }, [
        API_URL,
        clearEditorTabs,
        currentThreadId,
        getToken,
        isLoaded,
        isSignedIn,
        setCurrentThreadId,
        setFileSystem,
        setMessages,
        setPreviewStatus,
        setPreviewStatusMessage,
        setServerUrl,
        setThreadSwitchState,
        setThreads,
    ]);

    const fetchThreadVersions = useCallback(async (threadId: string): Promise<ThreadVersionItem[]> => {
        if (!threadId) throw new Error('threadId is required');
        if (!isLoaded || !isSignedIn) {
            throw new Error('You need to be signed in to view versions.');
        }
        const token = await getToken();
        if (!token) {
            throw new Error('Could not get auth token. Try signing in again.');
        }
        const res = await fetch(`${API_URL}/chat/${encodeURIComponent(threadId)}/versions`, {
            headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) {
            const errBody = await res.text().catch(() => '');
            throw new Error(`Failed to load versions (${res.status}): ${errBody || res.statusText}`);
        }
        const data = await res.json();
        return Array.isArray(data?.items) ? data.items : [];
    }, [API_URL, getToken, isLoaded, isSignedIn]);

    const restoreThreadToSeq = useCallback(async (threadId: string, seq: number) => {
        if (!threadId) throw new Error('threadId is required');
        if (!Number.isFinite(seq) || seq < 1) throw new Error('Invalid seq');
        if (!isLoaded || !isSignedIn) {
            throw new Error('You need to be signed in to restore versions.');
        }
        const token = await getToken();
        if (!token) {
            throw new Error('Could not get auth token. Try signing in again.');
        }
        const res = await fetch(`${API_URL}/chat/${encodeURIComponent(threadId)}/restore`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ seq }),
        });
        if (!res.ok) {
            const errBody = await res.text().catch(() => '');
            throw new Error(`Failed to restore version (${res.status}): ${errBody || res.statusText}`);
        }
        const data = await res.json();
        const restoredFiles = Array.isArray(data?.files) ? data.files : [];
        const deletedPaths = Array.isArray(data?.deletedPaths) ? data.deletedPaths : [];
        const restoredToSeq = Number(data?.restoredToSeq || seq);
        const isNoOp = data?.noOp === true;

        if (lastRestoredTargetSeqByThread.get(threadId) === restoredToSeq && isNoOp) {
            return {
                restoredToSeq,
                fileCount: restoredFiles.length,
                deletedCount: deletedPaths.length,
                noOp: true,
            };
        }

        let restoredFileSystem: FileSystemItem[] = [];
        let activeFileCandidate: ActiveFile | null = null;
        const fileMap = new Map<string, string>();

        for (const file of restoredFiles) {
            const filePath = String(file.filePath || '').replace(/^\//, '');
            const content = String(file.content || '');
            if (!filePath) continue;
            restoredFileSystem = upsertFile(restoredFileSystem, filePath, content);
            fileMap.set(filePath, content);
            if (!activeFileCandidate) {
                const fileName = filePath.split('/').pop() || filePath;
                activeFileCandidate = { path: filePath, name: fileName, content };
            }
        }

        setFileSystem(restoredFileSystem);
        if (activeFileCandidate) {
            openEditorTab(activeFileCandidate);
        }

        const wc = webContainerInstance ?? getWebContainerInstance();
        if (wc) {
            const deletedNormalized = deletedPaths
                .map((p: string) => String(p || '').replace(/^\//, ''))
                .filter(Boolean);
            await syncProjectFiles(wc, threadId, fileMap, deletedNormalized);
        }

        const incomingFiles = new Set([...fileMap.keys()]);
        mountedProjectFiles = incomingFiles;
        mountedFilesByThread.set(threadId, incomingFiles);
        activeMountedThreadId = threadId;

        if (!isNoOp && wc && fileMap.size > 0) {
            const switchSeq = ++latestThreadSwitchSeq;
            const syntheticSeq = Math.max(Date.now(), 1);
            void startThreadSandboxInBackground(wc, threadId, new Map(fileMap), syntheticSeq, token, switchSeq);
        }
        lastRestoredTargetSeqByThread.set(threadId, restoredToSeq);

        return {
            restoredToSeq,
            fileCount: fileMap.size,
            deletedCount: deletedPaths.length,
            noOp: isNoOp,
        };
    }, [API_URL, getToken, isLoaded, isSignedIn, openEditorTab, setFileSystem, startThreadSandboxInBackground, webContainerInstance]);

    const loadThread = useCallback(async (threadId: string) => {
        resetSyncedShellCwd();
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
                conversationMode: m.conversationMode === 'plan' || m.conversationMode === 'build'
                    ? m.conversationMode
                    : undefined,
                model: m.model ?? undefined,
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
                clearEditorTabs();
                openEditorTab(lastFile);
            } else {
                clearEditorTabs();
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
    }, [getToken, isLoaded, isSignedIn, navigate, refreshTerminalSession, setThreadSwitchState, setServerUrl, setPreviewStatus, setPreviewStatusMessage, webContainerInstance, setMessages, setCurrentThreadId, setFileSystem, openEditorTab, clearEditorTabs, setChatMode, startThreadSandboxInBackground]);

    const getCollaborators = useCallback(async (threadId: string) => {
        if (!isLoaded || !isSignedIn) return [];
        const token = await getToken();
        if (!token) return [];

        const res = await fetch(`${API_URL}/chat/${threadId}/collaborators`, {
            headers: {
                Authorization: `Bearer ${token}`,
            },
        });
        if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            throw new Error(data.error || 'Failed to fetch collaborators');
        }
        return res.json();
    }, [isLoaded, isSignedIn, getToken]);

    const addCollaborator = useCallback(async (threadId: string, email: string, role: string) => {
        if (!isLoaded || !isSignedIn) throw new Error('Not authenticated');
        const token = await getToken();
        if (!token) throw new Error('Failed to get token');

        const res = await fetch(`${API_URL}/chat/${threadId}/collaborators`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ email, role }),
        });
        if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            throw new Error(data.error || 'Failed to add collaborator');
        }
        return res.json();
    }, [isLoaded, isSignedIn, getToken]);

    const removeCollaborator = useCallback(async (threadId: string, userId: string) => {
        if (!isLoaded || !isSignedIn) throw new Error('Not authenticated');
        const token = await getToken();
        if (!token) throw new Error('Failed to get token');

        const res = await fetch(`${API_URL}/chat/${threadId}/collaborators/${userId}`, {
            method: 'DELETE',
            headers: {
                Authorization: `Bearer ${token}`,
            },
        });
        if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            throw new Error(data.error || 'Failed to remove collaborator');
        }
        return res.json();
    }, [isLoaded, isSignedIn, getToken]);

    type PlanAction = 'build' | 'change' | 'comment';

    const executePlanAction = useCallback(async (
        action: PlanAction,
        feedback = '',
    ): Promise<SendMessageResult> => {
        if (action === 'build') {
            return sendMessage(
                'Implement the approved plan above exactly. Follow the saved plan context — create all listed files, install dependencies, and start the dev server.',
                [],
                [],
                null,
                { mode: 'build' },
            );
        }
        if (action === 'change') {
            if (!feedback.trim()) {
                return { ok: false, error: 'Describe what to change in the plan.' };
            }
            return sendMessage(
                `Revise the implementation plan with these changes:\n\n${feedback.trim()}\n\nReturn the full updated plan using the same structured sections.`,
                [],
                [],
                null,
                { mode: 'plan' },
            );
        }
        if (action === 'comment') {
            if (!feedback.trim()) {
                return { ok: false, error: 'Enter your comments first.' };
            }
            return sendMessage(
                `Incorporate the following feedback into the plan (add notes or adjust sections as needed):\n\n${feedback.trim()}\n\nReturn the full updated plan using the same structured sections.`,
                [],
                [],
                null,
                { mode: 'plan' },
            );
        }
        return { ok: false, error: 'Unknown plan action.' };
    }, [sendMessage]);

    return {
        messages,
        sendMessage,
        executePlanAction,
        fetchThreads,
        deleteThread,
        fetchThreadVersions,
        restoreThreadToSeq,
        loadThread,
        runTerminalRecovery,
        refreshTerminalSession,
        currentThreadId,
        isLoading,
        getCollaborators,
        addCollaborator,
        removeCollaborator,
    };
};
