import { useCallback, useState } from 'react';
import { useAtom, useSetAtom, useAtomValue } from 'jotai';
import { messagesAtom, currentThreadIdAtom, threadSwitchStateAtom, threadsAtom, selectedModelAtom } from '../store/atoms';
import { previewStatusAtom, previewStatusMessageAtom, webContainerAtom, serverUrlAtom, writeShellOutput } from '../store/webContainer';
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
    const setPreviewStatus = useSetAtom(previewStatusAtom);
    const setPreviewStatusMessage = useSetAtom(previewStatusMessageAtom);
    const setThreadSwitchState = useSetAtom(threadSwitchStateAtom);

    const [isLoading, setIsLoading] = useState(false);

    const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';

    const startThreadSandboxInBackground = useCallback(async (
        wc: any,
        fileMap: Map<string, string>,
    ) => {
        if (!wc || fileMap.size === 0) return;

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

        // Clean sandbox before writing new project files.
        for (const name of ['src', 'public', 'node_modules', 'package.json', 'package-lock.json', 'index.html', 'vite.config.ts', 'tsconfig.json']) {
            try { await wc.fs.rm(name, { recursive: true }); } catch { /* doesn't exist */ }
        }

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

        try {
            await repairRootForNpm(wc, true);
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
                setPreviewStatus('starting');
                setPreviewStatusMessage('Dependencies installed. Starting npm run dev...');
                writeShellOutput('\r\n\x1b[36m⬢ Starting dev server...\x1b[0m\r\n');
                const devProc = await wc.spawn('npm', ['run', 'dev'], {
                    env: { FORCE_COLOR: '1' },
                });
                devProc.output.pipeTo(new WritableStream({
                    write(data) { writeShellOutput(data); }
                }));
            } else {
                const msg = installExit === -1 ? 'npm install timed out (180s)' : `npm install failed (exit ${installExit})`;
                setPreviewStatus('error');
                setPreviewStatusMessage(msg);
                writeShellOutput(`\r\n\x1b[31m✗ ${msg}\x1b[0m\r\n`);
            }
        } catch (err) {
            console.error('[loadThread] install error:', err);
            setPreviewStatus('error');
            setPreviewStatusMessage(`Install error: ${String(err)}`);
            writeShellOutput(`\r\n\x1b[31m✗ Install error: ${err}\x1b[0m\r\n`);
        }
    }, [setFileSystem, setPreviewStatus, setPreviewStatusMessage]);

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
                    threadId: currentThreadId,
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

            // Fetch messages and thread files in parallel
            const [messagesRes, filesRes] = await Promise.all([
                fetch(`${API_URL}/chat/${id}`, {
                    headers: { Authorization: `Bearer ${token}` }
                }),
                fetch(`${API_URL}/chat/${id}/files`, {
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
            const threadFiles: { filePath: string; content: string }[] = await filesRes.json();

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
            setMessages(formattedMessages);
            setCurrentThreadId(threadId);
            localStorage.setItem('currentThreadId', threadId);

            if (wc && fileMap.size > 0) {
                // Make thread switching responsive: restore UI immediately,
                // then prepare/install sandbox in background.
                void startThreadSandboxInBackground(wc, new Map(fileMap));
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
            }
        } catch (error) {
            console.error('[useChat] loadThread failed:', threadId, error);
            if (!isStale()) {
                setThreadSwitchState({
                    status: 'error',
                    targetThreadId: threadId,
                    errorMessage: error instanceof Error ? error.message : 'Could not switch thread.',
                });
            }
            throw error;
        }
    }, [getToken, isLoaded, isSignedIn, navigate, setThreadSwitchState, setServerUrl, setPreviewStatus, setPreviewStatusMessage, webContainerInstance, setMessages, setCurrentThreadId, setFileSystem, setActiveFile, startThreadSandboxInBackground]);

    return {
        messages,
        sendMessage,
        fetchThreads,
        loadThread,
        currentThreadId,
        isLoading,
    };
};
