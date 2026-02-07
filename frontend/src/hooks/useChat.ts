import { useCallback, useState } from 'react';
import { useAtom, useSetAtom, useAtomValue } from 'jotai';
import { messagesAtom, currentThreadIdAtom, threadsAtom, selectedModelAtom } from '../store/atoms';
import { webContainerAtom } from '../store/webContainer';
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

    const [isLoading, setIsLoading] = useState(false);

    const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';

    const sendMessage = async (content: string) => {
        if (!content.trim() || !isLoaded || !isSignedIn) return;

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
            console.log('[useChat] Got token, sending message...');
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

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const chunk = decoder.decode(value);
                accumulatedContent += chunk;

                // Parse for artifacts
                const actions = parser.parse(chunk);

                for (const action of actions) {
                    if (action.type === 'file' && action.filePath) {
                        const path = action.filePath;
                        const fileContent = action.content;
                        console.log(`[Bolt] Writing file: ${path}`);

                        // Write to WebContainer
                        if (webContainerInstance) {
                            try {
                                // Ensure parent directories exist
                                const dir = path.substring(0, path.lastIndexOf('/'));
                                if (dir) {
                                    try {
                                        await webContainerInstance.fs.mkdir(dir, { recursive: true });
                                    } catch {
                                        // Directory may already exist, ignore
                                    }
                                }
                                await webContainerInstance.fs.writeFile('/' + path.replace(/^\//, ''), fileContent);
                            } catch (err) {
                                console.error(`[Bolt] Failed to write ${path}:`, err);
                            }
                        }

                        // Update file system atom (file tree + editor)
                        setFileSystem((prev) => upsertFile(prev, path, fileContent));

                        // Set as active file in editor
                        const fileName = path.split('/').pop()!;
                        setActiveFile({ path: path.replace(/^\//, ''), name: fileName, content: fileContent });
                    }
                    if (action.type === 'shell') {
                        const command = action.content.trim();
                        console.log(`[Bolt] Executing shell: ${command}`);
                        if (webContainerInstance) {
                            try {
                                const process = await webContainerInstance.spawn('sh', ['-c', command]);
                                // Consume output silently — only log meaningful lines, skip ANSI noise
                                process.output.pipeTo(new WritableStream({
                                    write(data) {
                                        const clean = data.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').trim();
                                        if (clean && clean.length > 1) {
                                            console.log(`[Shell] ${clean}`);
                                        }
                                    }
                                }));
                            } catch (err) {
                                console.error(`[Bolt] Failed to execute shell:`, err);
                            }
                        }
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

    const loadThread = useCallback(async (threadId: string) => {
        if (!isLoaded || !isSignedIn) return;
        try {
            const token = await getToken();
            if (!token) return;
            const res = await fetch(`${API_URL}/chat/${threadId}`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            if (res.ok) {
                const rawMessages = await res.json();

                // Rebuild file system from all assistant messages
                let restoredFileSystem: FileSystemItem[] = [];
                let lastFile: ActiveFile | null = null;

                for (const m of rawMessages) {
                    if (m.role === 'assistant') {
                        const fileActions = extractFileActions(m.content);
                        for (const action of fileActions) {
                            if (action.filePath) {
                                restoredFileSystem = upsertFile(restoredFileSystem, action.filePath, action.content);
                                const fileName = action.filePath.split('/').pop()!;
                                lastFile = { path: action.filePath.replace(/^\//, ''), name: fileName, content: action.content };

                                // Write to WebContainer too
                                if (webContainerInstance) {
                                    try {
                                        const dir = action.filePath.substring(0, action.filePath.lastIndexOf('/'));
                                        if (dir) {
                                            try {
                                                await webContainerInstance.fs.mkdir(dir, { recursive: true });
                                            } catch { /* ignore */ }
                                        }
                                        await webContainerInstance.fs.writeFile(
                                            '/' + action.filePath.replace(/^\//, ''),
                                            action.content
                                        );
                                    } catch (err) {
                                        console.error(`[loadThread] Failed to write ${action.filePath}:`, err);
                                    }
                                }
                            }
                        }
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
            }
        } catch (error) {
            console.error('Failed to load thread', error);
        }
    }, [getToken, isLoaded, isSignedIn, setMessages, setCurrentThreadId, navigate, setFileSystem, setActiveFile, webContainerInstance]);

    return {
        messages,
        sendMessage,
        fetchThreads,
        loadThread,
        currentThreadId,
        isLoading,
    };
};
