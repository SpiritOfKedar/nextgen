import { useCallback, useState, useRef } from 'react';
import { useAtom, useSetAtom, useAtomValue } from 'jotai';
import { messagesAtom, currentThreadIdAtom, threadsAtom, selectedModelAtom } from '../store/atoms';
import { webContainerAtom, serverUrlAtom, writeShellOutput } from '../store/webContainer';
import { getWebContainerInstance } from './useWebContainer';
import { fileSystemAtom, activeFileAtom } from '../store/fileSystem';
import type { FileSystemItem, FileNode, FolderNode, ActiveFile } from '../store/fileSystem';
import { useAuth } from '@clerk/clerk-react';
import { useNavigate } from 'react-router-dom';
import { BoltParser } from '../lib/boltProtocol';
import type { BoltAction } from '../lib/boltProtocol';

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
    const pkgContent = writtenFiles.get('package.json');
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

export const useChat = () => {
    const { getToken, isLoaded, isSignedIn } = useAuth();
    const [messages, setMessages] = useAtom(messagesAtom);
    const [currentThreadId, setCurrentThreadId] = useAtom(currentThreadIdAtom);
    const setThreads = useSetAtom(threadsAtom);
    const navigate = useNavigate();
    const [selectedModel] = useAtom(selectedModelAtom);
    const webContainerInstance = useAtomValue(webContainerAtom);
    const setFileSystem = useSetAtom(fileSystemAtom);
    const setActiveFile = useSetAtom(activeFileAtom);
    const setServerUrl = useSetAtom(serverUrlAtom);

    const [isLoading, setIsLoading] = useState(false);

    const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';

    const sendMessage = async (content: string) => {
        if (!content.trim() || !isLoaded || !isSignedIn) {
            console.warn('[useChat] sendMessage blocked:', { hasContent: !!content.trim(), isLoaded, isSignedIn });
            return;
        }

        console.log('[useChat] sendMessage called:', { content: content.substring(0, 50), model: selectedModel });

        // Optimistic UI update
        const userMessage = {
            id: Date.now().toString(),
            role: 'user' as const,
            content,
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
                    // Read threadId from localStorage for freshest value —
                    // the atom value in the closure may be stale if LandingPage
                    // just cleared it before this async function continues.
                    threadId: localStorage.getItem('currentThreadId') || null,
                    model: selectedModel,
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

            let assistantMessageId = Date.now() + 1 + '';
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

            // ── Phase 1.5: Patch missing dependencies before npm install ──
            await patchMissingDependencies(writtenFiles, webContainerInstance ?? getWebContainerInstance(), setFileSystem);

            // ── Phase 2: Execute queued shell commands sequentially ──
            // Use the shared jsh shell so the terminal shows the output and
            // PATH resolution works (fixes ENOENT for npm/npx).
            const wc = webContainerInstance ?? getWebContainerInstance();
            if (wc && pendingShellCommands.length > 0) {
                for (const command of pendingShellCommands) {
                    try {
                        // Skip useless/dangerous commands
                        if (!command || /^\s*$/.test(command)) continue;            // empty
                        if (/^\s*cd(\s|$)/.test(command)) continue;                 // cd (shell builtin, hangs spawn)
                        if (/^\s*(echo|pwd|ls|cat|mkdir)\s/.test(command)) continue; // informational only

                        writeShellOutput(`\r\n\x1b[36m❯ ${command}\x1b[0m\r\n`);

                        // Append --legacy-peer-deps for npm install
                        let adjustedCommand = command;
                        if (/^npm\s+install\b/.test(command) && !command.includes('--legacy-peer-deps')) {
                            adjustedCommand += ' --legacy-peer-deps';
                        }

                        // For long-running commands like "npm run dev", fire and forget
                        const isLongRunning = /\b(dev|start|serve|watch)\b/.test(command);

                        // Spawn the command directly (better process control than piping to jsh)
                        const parts = adjustedCommand.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [adjustedCommand];
                        const program = parts[0];
                        const args = parts.slice(1).map((a: string) => a.replace(/^["']|["']$/g, ''));

                        const proc = await wc.spawn(program, args, {
                            env: { FORCE_COLOR: '1' },
                        });
                        proc.output.pipeTo(new WritableStream({
                            write(data) { writeShellOutput(data); }
                        }));

                        if (!isLongRunning) {
                            const exitPromise = proc.exit;
                            const timeoutPromise = new Promise<number>((resolve) => setTimeout(() => resolve(-1), 120_000));
                            const exitCode = await Promise.race([exitPromise, timeoutPromise]);
                            if (exitCode === -1) {
                                writeShellOutput(`\r\n\x1b[33m⚠ Command timed out after 120s: ${command}\x1b[0m\r\n`);
                            } else if (exitCode !== 0) {
                                writeShellOutput(`\r\n\x1b[33m⚠ Command exited with code ${exitCode}: ${command}\x1b[0m\r\n`);
                            }
                        }
                    } catch (err) {
                        console.error(`[Bolt] spawn failed for "${command}":`, err);
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
        if (!isLoaded || !isSignedIn) return;
        try {
            const token = await getToken();
            if (!token) return;
            const res = await fetch(`${API_URL}/chat/history`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            if (res.ok) {
                const data = await res.json();
                setThreads(data);
            }
        } catch (error) {
            console.error('Failed to load threads', error);
        }
    }, [getToken, isLoaded, isSignedIn, setThreads]);

    // Global flag specifically to prevent concurrent loadThread executions during hot-reloads
    const loadThreadInProgress = useRef(false);

    const loadThread = useCallback(async (threadId: string) => {
        if (!isLoaded || !isSignedIn || loadThreadInProgress.current) return;
        try {
            loadThreadInProgress.current = true;
            const token = await getToken();
            if (!token) return;

            // ── Clear stale state immediately ──
            setServerUrl(null); // Reset preview URL for the new thread
            setFileSystem([]);
            setActiveFile(null);

            // Fetch messages and thread files in parallel
            const [messagesRes, filesRes] = await Promise.all([
                fetch(`${API_URL}/chat/${threadId}`, {
                    headers: { Authorization: `Bearer ${token}` }
                }),
                fetch(`${API_URL}/chat/${threadId}/files`, {
                    headers: { Authorization: `Bearer ${token}` }
                }),
            ]);

            if (!messagesRes.ok) return;

            const rawMessages = await messagesRes.json();
            const threadFiles: { filePath: string; content: string }[] = filesRes.ok ? await filesRes.json() : [];

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

            // Write all files to WebContainer
            if (wc && fileMap.size > 0) {
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
                    restoredFileSystem = upsertFile(restoredFileSystem, 'package.json', defaultPkg);
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

                // ── Clean WebContainer filesystem before writing new thread files ──
                // Remove old project files so we don't get stale leftovers from a
                // previous thread. Only remove known project directories/files.
                for (const name of ['src', 'public', 'node_modules', 'package.json', 'package-lock.json', 'index.html', 'vite.config.ts', 'tsconfig.json']) {
                    try { await wc.fs.rm(name, { recursive: true }); } catch { /* doesn't exist */ }
                }

                // Write each file using fs.writeFile with proper directory creation
                for (const [filePath, content] of fileMap) {
                    try {
                        const absPath = filePath.startsWith('/') ? filePath.substring(1) : filePath;
                        const dir = absPath.substring(0, absPath.lastIndexOf('/'));
                        if (dir && dir !== '') {
                            try { await wc.fs.mkdir(dir, { recursive: true }); } catch { /* exists */ }
                        }
                        await wc.fs.writeFile(absPath, content);
                    } catch (err) {
                        console.error(`[loadThread] Failed to write ${filePath}:`, err);
                    }
                }

                // Run npm install then npm run dev using direct spawn
                try {
                    writeShellOutput('\r\n\x1b[36m⬢ Installing dependencies...\x1b[0m\r\n');
                    const installProc = await wc.spawn('npm', ['install', '--no-audit', '--no-fund', '--legacy-peer-deps'], {
                        env: { FORCE_COLOR: '1' },
                    });
                    installProc.output.pipeTo(new WritableStream({
                        write(data) { writeShellOutput(data); }
                    }));

                    const installTimeout = new Promise<number>((r) => setTimeout(() => r(-1), 180_000));
                    const installExit = await Promise.race([installProc.exit, installTimeout]);

                    if (installExit === 0) {
                        writeShellOutput('\r\n\x1b[36m⬢ Starting dev server...\x1b[0m\r\n');
                        const devProc = await wc.spawn('npm', ['run', 'dev'], {
                            env: { FORCE_COLOR: '1' },
                        });
                        devProc.output.pipeTo(new WritableStream({
                            write(data) { writeShellOutput(data); }
                        }));
                        // dev server is long-running, don't await
                    } else {
                        const msg = installExit === -1 ? 'npm install timed out (180s)' : `npm install failed (exit ${installExit})`;
                        writeShellOutput(`\r\n\x1b[31m✗ ${msg}\x1b[0m\r\n`);
                    }
                } catch (err) {
                    console.error('[loadThread] install error:', err);
                    writeShellOutput(`\r\n\x1b[31m✗ Install error: ${err}\x1b[0m\r\n`);
                }
            }

            // Update file system atom if we found files
            if (restoredFileSystem.length > 0) {
                setFileSystem(restoredFileSystem);
            }

            // Set last file as active in editor
            if (lastFile) {
                setActiveFile(lastFile);
            }

            // Map backend messages to frontend format (strip bolt tags for display)
            const formattedMessages = rawMessages.map((m: any) => ({
                id: m._id,
                role: m.role,
                content: m.role === 'assistant' ? stripBoltTags(m.content) : m.content,
                timestamp: new Date(m.createdAt).getTime(),
            }));
            setMessages(formattedMessages);
            setCurrentThreadId(threadId);
            localStorage.setItem('currentThreadId', threadId);
            navigate('/builder');
        } catch (error) {
            console.error('Failed to load thread', error);
        } finally {
            loadThreadInProgress.current = false;
        }
    }, [getToken, isLoaded, isSignedIn, setMessages, setCurrentThreadId, navigate, setFileSystem, setActiveFile, setServerUrl, webContainerInstance]);

    return {
        messages,
        sendMessage,
        fetchThreads,
        loadThread,
        currentThreadId,
        isLoading,
    };
};
