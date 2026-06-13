import React, { useState, useRef, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Paperclip, ArrowRight, X, Figma, MessageSquare, Loader2, Plus } from 'lucide-react';
import { SignInButton, useAuth } from '@clerk/clerk-react';
import { useChat } from '../../hooks/useChat';
import { ModelSelector } from './ModelSelector';
import { FigmaPanel } from './FigmaPanel';
import { StitchPanel, type StitchContextPayload } from './StitchPanel';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { chatModeAtom, threadsAtom, threadSwitchStateAtom, currentThreadIdAtom, messagesAtom } from '../../store/atoms';

const FIGMA_URL_REGEX = /https:\/\/(?:www\.)?figma\.com\/(?:design|file|proto|board)\/[^\s"'<>]+/gi;

interface InputAreaProps {
    variant?: 'default' | 'mac';
}

const MacTrafficLights: React.FC = () => (
    <div className="flex items-center gap-2" aria-hidden>
        <span className="w-3 h-3 rounded-full bg-[#ff5f57] border border-[#e0443e]/80" />
        <span className="w-3 h-3 rounded-full bg-[#febc2e] border border-[#dea123]/80" />
        <span className="w-3 h-3 rounded-full bg-[#28c840] border border-[#1aab29]/80" />
    </div>
);

const formatRelativeDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
};

export const InputArea: React.FC<InputAreaProps> = ({ variant = 'default' }) => {
    const isMac = variant === 'mac';
    const { isSignedIn, isLoaded } = useAuth();
    const [inputValue, setInputValue] = useState('');
    const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
    const [showFigmaPanel, setShowFigmaPanel] = useState(false);
    const [showStitchPanel, setShowStitchPanel] = useState(false);
    const [manualFigmaLinks, setManualFigmaLinks] = useState<string[]>([]);
    const [stitchContext, setStitchContext] = useState<StitchContextPayload | null>(null);
    const { sendMessage, isLoading, fetchThreads, loadThread } = useChat();
    const [chatMode, setChatMode] = useAtom(chatModeAtom);
    const threads = useAtomValue(threadsAtom);
    const threadSwitchState = useAtomValue(threadSwitchStateAtom);
    const currentThreadId = useAtomValue(currentThreadIdAtom);
    const setMessages = useSetAtom(messagesAtom);
    const setCurrentThreadId = useSetAtom(currentThreadIdAtom);
    const [historyError, setHistoryError] = useState<string | null>(null);
    const [submitError, setSubmitError] = useState<string | null>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const figmaButtonRef = useRef<HTMLButtonElement>(null);
    const stitchButtonRef = useRef<HTMLButtonElement>(null);
    const MAX_FILE_CHARS = 25_000;
    const MAX_TOTAL_ATTACHMENT_CHARS = 80_000;
    const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;
    const MAX_IMAGE_SIZE_BYTES = 1_500_000;
    const TEXT_EXTENSIONS = new Set([
        'txt', 'md', 'json', 'js', 'jsx', 'ts', 'tsx', 'css', 'scss', 'html', 'xml', 'yml', 'yaml', 'csv', 'log',
    ]);

    const readFileAsText = (file: File): Promise<string> => new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(reader.error || new Error(`Failed to read ${file.name}`));
        reader.readAsText(file);
    });

    const readFileAsDataUrl = (file: File): Promise<string> => new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(reader.error || new Error(`Failed to read ${file.name}`));
        reader.readAsDataURL(file);
    });

    const getExtension = (name: string): string => {
        const idx = name.lastIndexOf('.');
        return idx === -1 ? '' : name.slice(idx + 1).toLowerCase();
    };

    const isTextLikeFile = (file: File): boolean => {
        if (file.type.startsWith('text/')) return true;
        if (file.type === 'application/json' || file.type === 'application/xml') return true;
        return TEXT_EXTENSIONS.has(getExtension(file.name));
    };

    type OutgoingAttachment = {
        kind: 'image' | 'text';
        name: string;
        mimeType: string;
        sizeBytes: number;
        textContent?: string;
        dataBase64?: string;
    };

    const buildOutgoingAttachments = async (files: File[]): Promise<OutgoingAttachment[]> => {
        if (files.length === 0) return [];
        const attachments: OutgoingAttachment[] = [];
        let totalChars = 0;
        for (const file of files) {
            if (file.size > MAX_FILE_SIZE_BYTES) {
                continue;
            }
            if (file.type.startsWith('image/')) {
                if (file.size > MAX_IMAGE_SIZE_BYTES) continue;
                try {
                    const dataUrl = await readFileAsDataUrl(file);
                    const commaIdx = dataUrl.indexOf(',');
                    if (commaIdx === -1) continue;
                    const dataBase64 = dataUrl.slice(commaIdx + 1);
                    attachments.push({
                        kind: 'image',
                        name: file.name,
                        mimeType: file.type || 'image/png',
                        sizeBytes: file.size,
                        dataBase64,
                    });
                } catch {
                    // ignore unreadable image files
                }
                continue;
            }
            if (!isTextLikeFile(file)) continue;
            try {
                const text = await readFileAsText(file);
                const clipped = text.length > MAX_FILE_CHARS
                    ? `${text.slice(0, MAX_FILE_CHARS)}\n\n[...truncated ${text.length - MAX_FILE_CHARS} chars]`
                    : text;
                const remaining = MAX_TOTAL_ATTACHMENT_CHARS - totalChars;
                if (remaining <= 0) {
                    break;
                }
                const bounded = clipped.length > remaining
                    ? `${clipped.slice(0, remaining)}\n\n[...truncated for total payload limit]`
                    : clipped;
                totalChars += bounded.length;
                attachments.push({
                    kind: 'text',
                    name: file.name,
                    mimeType: file.type || 'text/plain',
                    sizeBytes: file.size,
                    textContent: bounded,
                });
            } catch {
                // ignore unreadable files
            }
        }
        return attachments;
    };

    const mergeFilesDeduped = (incoming: File[]) => {
        if (incoming.length === 0) return;
        setAttachedFiles((prev) => {
            const merged = [...prev, ...incoming];
            const deduped: File[] = [];
            const seen = new Set<string>();
            for (const f of merged) {
                const key = `${f.name}-${f.size}-${f.lastModified}`;
                if (seen.has(key)) continue;
                seen.add(key);
                deduped.push(f);
            }
            return deduped;
        });
    };

    const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
        const items = Array.from(e.clipboardData?.items || []);
        const pastedImages: File[] = [];
        for (const item of items) {
            if (!item.type.startsWith('image/')) continue;
            const file = item.getAsFile();
            if (!file) continue;
            const extension = item.type.split('/')[1] || 'png';
            const safeName = `pasted-image-${Date.now()}.${extension}`;
            const named = new File([file], safeName, { type: file.type || item.type, lastModified: Date.now() });
            pastedImages.push(named);
        }
        if (pastedImages.length > 0) {
            e.preventDefault();
            mergeFilesDeduped(pastedImages);
        }
    };

    useEffect(() => {
        if (isMac && isLoaded && isSignedIn) {
            void fetchThreads();
        }
    }, [isMac, isLoaded, isSignedIn, fetchThreads]);

    // Auto-resize textarea (default variant only — mac uses flex fill)
    useEffect(() => {
        if (isMac || !textareaRef.current) return;
        textareaRef.current.style.height = 'auto';
        textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 400) + 'px';
    }, [inputValue, isMac]);

    const handleOpenThread = async (threadId: string) => {
        setHistoryError(null);
        try {
            await loadThread(threadId);
        } catch (e) {
            setHistoryError(e instanceof Error ? e.message : 'Could not open this project');
        }
    };

    const handleNewProject = () => {
        setMessages([]);
        setCurrentThreadId(null);
        setInputValue('');
        setAttachedFiles([]);
        setManualFigmaLinks([]);
        setStitchContext(null);
        localStorage.removeItem('currentThreadId');
    };

    const imagePreviewUrls = React.useMemo(() => {
        return attachedFiles.map((file) => ({
            file,
            isImage: file.type.startsWith('image/'),
            previewUrl: file.type.startsWith('image/') ? URL.createObjectURL(file) : '',
        }));
    }, [attachedFiles]);

    const figmaLinks = React.useMemo(() => {
        const links: { url: string }[] = [];
        const seen = new Set<string>();
        // Links auto-detected from textarea
        for (const match of inputValue.matchAll(FIGMA_URL_REGEX)) {
            const cleaned = match[0].replace(/[),.;]+$/g, '');
            if (seen.has(cleaned)) continue;
            seen.add(cleaned);
            links.push({ url: cleaned });
            if (links.length >= 3) break;
        }
        // Links added via the Figma button popover
        for (const url of manualFigmaLinks) {
            if (seen.has(url)) continue;
            seen.add(url);
            links.push({ url });
            if (links.length >= 3) break;
        }
        return links;
    }, [inputValue, manualFigmaLinks]);

    const handleAddFigmaLink = useCallback((url: string) => {
        setManualFigmaLinks((prev) => {
            if (prev.includes(url)) return prev;
            return [...prev, url].slice(0, 3);
        });
    }, []);

    const handleRemoveFigmaLink = useCallback((url: string) => {
        setManualFigmaLinks((prev) => prev.filter((l) => l !== url));
    }, []);

    useEffect(() => {
        return () => {
            imagePreviewUrls.forEach((item) => {
                if (item.previewUrl) {
                    URL.revokeObjectURL(item.previewUrl);
                }
            });
        };
    }, [imagePreviewUrls]);

    const handleSendMessage = async () => {
        if ((!inputValue.trim() && attachedFiles.length === 0) || isLoading) return;

        if (!isLoaded) {
            setSubmitError('Still loading — try again in a moment.');
            return;
        }
        if (!isSignedIn) {
            setSubmitError('Sign in to start building.');
            return;
        }

        setSubmitError(null);
        const content = inputValue.trim() || 'Use attached file(s) as context.';
        const savedInput = inputValue;
        const savedFiles = attachedFiles;
        const savedFigmaLinks = manualFigmaLinks;
        const savedStitchContext = stitchContext;
        const attachments = await buildOutgoingAttachments(attachedFiles);
        setInputValue('');
        setAttachedFiles([]);
        setManualFigmaLinks([]);
        setStitchContext(null);
        setShowFigmaPanel(false);
        setShowStitchPanel(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
        if (textareaRef.current) textareaRef.current.style.height = 'auto';
        const result = await sendMessage(content, attachments, figmaLinks, stitchContext);
        if (!result.ok) {
            setInputValue(savedInput);
            setAttachedFiles(savedFiles);
            setManualFigmaLinks(savedFigmaLinks);
            setStitchContext(savedStitchContext);
            setSubmitError(result.error);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSendMessage();
        }
    };

    const shellClass = isMac
        ? 'relative flex flex-col w-full overflow-hidden rounded-xl border border-zinc-700/50 bg-[#1c1c1e] shadow-[0_24px_64px_-16px_rgba(0,0,0,0.75)]'
        : `
            relative flex flex-col w-full 
            bg-zinc-900/85 backdrop-blur-xl 
            border rounded-xl border-zinc-800/70 shadow-sm
            transition-all duration-300 ease-out
            focus-within:border-zinc-700/80 focus-within:shadow-lg focus-within:ring-1 focus-within:ring-zinc-700/40
        `;

    const textareaClass = isMac
        ? 'w-full h-full min-h-[200px] py-4 px-5 bg-[#141416] text-zinc-100 placeholder-zinc-600 resize-none focus:outline-none text-[15px] leading-relaxed scrollbar-hide font-sans'
        : 'w-full py-3 px-4 bg-transparent text-zinc-100 placeholder-zinc-500/80 resize-none focus:outline-none text-base leading-relaxed min-h-[68px] max-h-[320px] scrollbar-hide';

    const toolbarClass = isMac
        ? 'grid w-full min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 px-3 py-2 bg-[#232326] border-t border-black/50'
        : 'grid w-full min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 px-2.5 py-1.5 bg-zinc-900/65 border-t border-zinc-800/70';

    const iconBtnClass = isMac
        ? 'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-zinc-400 hover:text-zinc-200 hover:bg-white/5 transition-colors'
        : 'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-zinc-700/80 bg-zinc-900 text-zinc-300 hover:text-zinc-100 hover:bg-zinc-800/70 transition-colors';

    const figmaBtnActive = isMac
        ? 'text-purple-300 bg-purple-500/10'
        : 'border-purple-500/50 bg-purple-950/40 text-purple-300 hover:bg-purple-900/40';

    const figmaBtnIdle = isMac
        ? 'text-zinc-400 hover:text-zinc-200 hover:bg-white/5'
        : 'border-zinc-700/80 bg-zinc-900 text-zinc-300 hover:text-zinc-100 hover:bg-zinc-800/70';

    const stitchBtnActive = isMac
        ? 'text-blue-300 bg-blue-500/10'
        : 'border-blue-500/50 bg-blue-950/40 text-blue-300 hover:bg-blue-900/40';

    const stitchBtnIdle = isMac
        ? 'text-zinc-400 hover:text-zinc-200 hover:bg-white/5'
        : 'border-zinc-700/80 bg-zinc-900 text-zinc-300 hover:text-zinc-100 hover:bg-zinc-800/70';

    const modeToggleClass = isMac
        ? 'inline-flex rounded-md bg-black/30 p-0.5 text-[10px] font-semibold uppercase tracking-wide'
        : 'inline-flex rounded-md border border-zinc-700/80 bg-zinc-900 p-0.5 text-[10px] font-semibold uppercase tracking-wide';

    const sendBtnEnabled = isMac
        ? 'bg-white text-zinc-900 hover:bg-zinc-200'
        : 'border-blue-500/70 bg-blue-600/90 text-white hover:bg-blue-600 hover:border-blue-400/80';

    const sendBtnDisabled = isMac
        ? 'bg-zinc-800 text-zinc-600 cursor-not-allowed'
        : 'cursor-not-allowed border-zinc-700 bg-zinc-800 text-zinc-500';

    const windowTitle = isMac
        ? (currentThreadId
            ? threads.find((t) => t._id === currentThreadId)?.title ?? 'Project'
            : 'New Project')
        : '';

    return (
        <div className={`w-full mx-auto px-3 sm:px-4 ${isMac ? 'max-w-5xl' : 'max-w-4xl'}`}>
            <motion.div
                className={`${shellClass} ${isMac ? 'h-[min(480px,70vh)] max-h-[70vh]' : ''}`}
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.1, duration: 0.4 }}
            >
                {isMac && (
                    <div className="flex items-center h-11 px-4 bg-[#2b2b2d] border-b border-black/50 shrink-0">
                        <MacTrafficLights />
                        <span className="flex-1 text-center text-[11px] font-medium text-zinc-500 truncate pr-12 select-none">
                            NextGen — {windowTitle}
                        </span>
                    </div>
                )}

                {isMac ? (
                    <div className="flex flex-1 min-h-0 overflow-hidden">
                        {/* History sidebar */}
                        <aside className="w-52 shrink-0 flex flex-col min-h-0 overflow-hidden border-r border-black/50 bg-[#1a1a1c]">
                            <div className="flex items-center justify-between px-3 py-2.5 border-b border-black/40">
                                <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                                    History
                                </span>
                                <button
                                    type="button"
                                    onClick={handleNewProject}
                                    className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-zinc-400 hover:text-white hover:bg-white/5 transition-colors"
                                    title="New project"
                                >
                                    <Plus className="w-3 h-3" />
                                    New
                                </button>
                            </div>
                            <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar py-1">
                                {!isLoaded ? (
                                    <p className="px-3 py-4 text-xs text-zinc-600">Loading…</p>
                                ) : !isSignedIn ? (
                                    <div className="px-3 py-4 space-y-3">
                                        <p className="text-xs text-zinc-500 leading-relaxed">
                                            Sign in to see your previous projects.
                                        </p>
                                        <SignInButton mode="modal">
                                            <button
                                                type="button"
                                                className="w-full rounded-md bg-white/10 px-2 py-1.5 text-xs font-medium text-zinc-200 hover:bg-white/15 transition-colors"
                                            >
                                                Sign in
                                            </button>
                                        </SignInButton>
                                    </div>
                                ) : threads.length === 0 ? (
                                    <p className="px-3 py-4 text-xs text-zinc-600">No projects yet.</p>
                                ) : (
                                    threads.map((thread) => {
                                        const isActive = thread._id === currentThreadId;
                                        const isOpening = threadSwitchState.status === 'loading'
                                            && threadSwitchState.targetThreadId === thread._id;
                                        return (
                                            <button
                                                key={thread._id}
                                                type="button"
                                                onClick={() => void handleOpenThread(thread._id)}
                                                disabled={threadSwitchState.status === 'loading'}
                                                className={`w-full flex items-start gap-2 px-3 py-2.5 text-left transition-colors ${
                                                    isActive
                                                        ? 'bg-white/10 text-white'
                                                        : 'text-zinc-400 hover:bg-white/5 hover:text-zinc-200'
                                                }`}
                                            >
                                                {isOpening ? (
                                                    <Loader2 className="w-3.5 h-3.5 mt-0.5 shrink-0 animate-spin" />
                                                ) : (
                                                    <MessageSquare className="w-3.5 h-3.5 mt-0.5 shrink-0 opacity-60" />
                                                )}
                                                <span className="min-w-0 flex-1">
                                                    <span className="block text-xs truncate">{thread.title}</span>
                                                    <span className="block text-[10px] text-zinc-600 mt-0.5">
                                                        {formatRelativeDate(thread.updatedAt)}
                                                    </span>
                                                </span>
                                            </button>
                                        );
                                    })
                                )}
                            </div>
                            {historyError && (
                                <p className="px-3 py-2 text-[10px] text-red-400 border-t border-black/40">
                                    {historyError}
                                </p>
                            )}
                        </aside>

                        {/* Prompt area */}
                        <div className="flex-1 flex flex-col min-w-0 min-h-0 bg-[#141416]">
                            <textarea
                                ref={textareaRef}
                                className={`${textareaClass} flex-1`}
                                placeholder={chatMode === 'plan'
                                    ? 'Describe what you want to build — get a detailed plan first…'
                                    : 'Describe your app idea…'}
                                value={inputValue}
                                onChange={(e) => {
                                    setInputValue(e.target.value);
                                    if (submitError) setSubmitError(null);
                                }}
                                onKeyDown={handleKeyDown}
                                onPaste={handlePaste}
                            />
                            {attachedFiles.length > 0 && (
                                <div className="px-4 pb-3 shrink-0">
                                    <div className="flex flex-wrap gap-2">
                                        {imagePreviewUrls.map(({ file, previewUrl, isImage }, index) => (
                                            <div
                                                key={`${file.name}-${file.size}-${index}`}
                                                className={`relative overflow-hidden rounded-lg border border-zinc-700/80 bg-zinc-900/70 ${
                                                    isImage ? 'h-16 w-16' : 'inline-flex h-8 max-w-[220px] items-center gap-1 px-2'
                                                }`}
                                            >
                                                {isImage ? (
                                                    <>
                                                        <img
                                                            src={previewUrl}
                                                            alt={file.name}
                                                            className="h-full w-full object-cover"
                                                        />
                                                        <button
                                                            type="button"
                                                            className="absolute right-1 top-1 inline-flex h-4 w-4 items-center justify-center rounded-full bg-black/65 text-zinc-200 hover:bg-black/85"
                                                            onClick={() => {
                                                                setAttachedFiles((prev) => prev.filter((_, i) => i !== index));
                                                            }}
                                                            aria-label={`Remove ${file.name}`}
                                                        >
                                                            <X className="h-2.5 w-2.5" />
                                                        </button>
                                                    </>
                                                ) : (
                                                    <>
                                                        <span className="truncate text-[11px] text-zinc-300">{file.name}</span>
                                                        <button
                                                            type="button"
                                                            className="shrink-0 text-zinc-400 hover:text-zinc-200"
                                                            onClick={() => {
                                                                setAttachedFiles((prev) => prev.filter((_, i) => i !== index));
                                                            }}
                                                            aria-label={`Remove ${file.name}`}
                                                        >
                                                            <X className="h-3 w-3" />
                                                        </button>
                                                    </>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                ) : (
                    <textarea
                        ref={textareaRef}
                        className={textareaClass}
                        placeholder={chatMode === 'plan'
                            ? 'Describe what you want to build — get a detailed plan first…'
                            : 'Describe your app idea…'}
                        value={inputValue}
                        onChange={(e) => {
                            setInputValue(e.target.value);
                            if (submitError) setSubmitError(null);
                        }}
                        onKeyDown={handleKeyDown}
                        onPaste={handlePaste}
                        style={{ overflow: 'hidden' }}
                    />
                )}

                {!isMac && attachedFiles.length > 0 && (
                    <div className="px-3 pb-2.5">
                        <div className="flex flex-wrap gap-2">
                            {imagePreviewUrls.map(({ file, previewUrl, isImage }, index) => (
                                <div
                                    key={`${file.name}-${file.size}-${index}`}
                                    className={`relative overflow-hidden rounded-lg border border-zinc-700/80 bg-zinc-900/70 ${
                                        isImage ? 'h-16 w-16' : 'inline-flex h-8 max-w-[220px] items-center gap-1 px-2'
                                    }`}
                                >
                                    {isImage ? (
                                        <>
                                            <img
                                                src={previewUrl}
                                                alt={file.name}
                                                className="h-full w-full object-cover"
                                            />
                                            <button
                                                type="button"
                                                className="absolute right-1 top-1 inline-flex h-4 w-4 items-center justify-center rounded-full bg-black/65 text-zinc-200 hover:bg-black/85"
                                                onClick={() => {
                                                    setAttachedFiles((prev) => prev.filter((_, i) => i !== index));
                                                }}
                                                aria-label={`Remove ${file.name}`}
                                            >
                                                <X className="h-3 w-3" />
                                            </button>
                                        </>
                                    ) : (
                                        <>
                                            <span className="truncate text-[11px] text-zinc-300">{file.name}</span>
                                            <button
                                                type="button"
                                                className="text-zinc-500 hover:text-zinc-200"
                                                onClick={() => {
                                                    setAttachedFiles((prev) => prev.filter((_, i) => i !== index));
                                                }}
                                                aria-label={`Remove ${file.name}`}
                                            >
                                                <X className="w-3 h-3" />
                                            </button>
                                        </>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {figmaLinks.length > 0 && (
                    <div className="px-3 pb-2.5">
                        <div className="flex flex-wrap gap-2">
                            {figmaLinks.map((link, index) => (
                                <div
                                    key={`${link.url}-${index}`}
                                    className="inline-flex h-8 max-w-full items-center gap-1.5 rounded-lg border border-purple-500/30 bg-purple-950/30 px-2.5 text-[11px] text-purple-100"
                                >
                                    <Figma className="h-3 w-3 shrink-0 text-purple-300" />
                                    <span className="truncate max-w-[180px]" title={link.url}>Figma design {index + 1}</span>
                                    {manualFigmaLinks.includes(link.url) && (
                                        <button
                                            type="button"
                                            className="ml-0.5 text-purple-400 hover:text-purple-100 transition-colors"
                                            onClick={() => handleRemoveFigmaLink(link.url)}
                                            aria-label={`Remove Figma link ${index + 1}`}
                                        >
                                            <X className="h-3 w-3" />
                                        </button>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {stitchContext && (
                    <div className="px-3 pb-2.5">
                        <div className="inline-flex h-8 max-w-full items-center gap-1.5 rounded-lg border border-blue-500/30 bg-blue-950/30 px-2.5 text-[11px] text-blue-100">
                            <span className="truncate max-w-[220px]">Stitch context attached</span>
                            <button
                                type="button"
                                className="ml-0.5 text-blue-400 hover:text-blue-100 transition-colors"
                                onClick={() => setStitchContext(null)}
                                aria-label="Remove Stitch context"
                            >
                                <X className="h-3 w-3" />
                            </button>
                        </div>
                    </div>
                )}

                <div className={toolbarClass}>
                    <input
                        type="file"
                        id="file-upload"
                        ref={fileInputRef}
                        className="hidden"
                        multiple
                        onChange={(e) => {
                            const files = Array.from(e.target.files || []);
                            if (files.length === 0) return;
                            mergeFilesDeduped(files);
                        }}
                    />

                    <div className="flex items-center gap-1.5 shrink-0">
                        <button
                            type="button"
                            onClick={() => fileInputRef.current?.click()}
                            className={iconBtnClass}
                            title="Add files"
                            aria-label="Add files"
                        >
                            <Paperclip className="w-3.5 h-3.5" />
                        </button>

                        <button
                            ref={figmaButtonRef}
                            type="button"
                            onClick={() => setShowFigmaPanel((v) => !v)}
                            className={`${iconBtnClass} ${
                                showFigmaPanel || figmaLinks.length > 0 ? figmaBtnActive : figmaBtnIdle
                            }`}
                            title="Figma MCP"
                            aria-label="Figma MCP"
                            id="figma-mcp-button"
                        >
                            <Figma className="w-3.5 h-3.5" />
                        </button>

                        <FigmaPanel
                            anchorRef={figmaButtonRef}
                            isOpen={showFigmaPanel}
                            onClose={() => setShowFigmaPanel(false)}
                            figmaLinks={figmaLinks}
                            onAddLink={handleAddFigmaLink}
                            onRemoveLink={handleRemoveFigmaLink}
                            manualFigmaLinks={manualFigmaLinks}
                        />

                        <button
                            ref={stitchButtonRef}
                            type="button"
                            onClick={() => setShowStitchPanel((v) => !v)}
                            className={`${iconBtnClass} ${
                                showStitchPanel || stitchContext ? stitchBtnActive : stitchBtnIdle
                            }`}
                            title="Google Stitch MCP"
                            aria-label="Google Stitch MCP"
                            id="stitch-mcp-button"
                        >
                            <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="currentColor" aria-hidden>
                                <path d="M12 2L2 7l10 5 10-5-10-5zm0 7.5L4.5 6.75 12 10.5l7.5-3.75L12 9.5zm-8 3.25L12 17.5l8-4.75v2.5L12 20l-8-4.75v-2.5z" />
                            </svg>
                        </button>

                        <StitchPanel
                            anchorRef={stitchButtonRef}
                            isOpen={showStitchPanel}
                            onClose={() => setShowStitchPanel(false)}
                            stitchContext={stitchContext}
                            onStitchContextChange={setStitchContext}
                        />
                    </div>

                    <div className="min-w-0 w-full flex justify-start overflow-hidden">
                        <div className="flex min-w-0 items-center gap-2 overflow-hidden">
                            <div className={modeToggleClass}>
                                <button
                                    type="button"
                                    onClick={() => setChatMode('plan')}
                                    className={`rounded px-2 py-1 transition-colors ${
                                        chatMode === 'plan'
                                            ? isMac ? 'bg-zinc-600 text-white' : 'bg-blue-600/90 text-white'
                                            : 'text-zinc-500 hover:text-zinc-300'
                                    }`}
                                    aria-label="Switch to plan mode"
                                >
                                    Plan
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setChatMode('build')}
                                    className={`rounded px-2 py-1 transition-colors ${
                                        chatMode === 'build'
                                            ? isMac ? 'bg-zinc-600 text-white' : 'bg-blue-600/90 text-white'
                                            : 'text-zinc-500 hover:text-zinc-300'
                                    }`}
                                    aria-label="Switch to build mode"
                                >
                                    Build
                                </button>
                            </div>
                            <ModelSelector side="top" />
                        </div>
                    </div>

                    <button
                        type="button"
                        onClick={handleSendMessage}
                        className={`
                            inline-flex shrink-0 items-center justify-center gap-1 h-7 px-3
                            text-[10px] font-semibold uppercase tracking-wide
                            rounded-md transition-colors duration-150
                            ${(!inputValue.trim() && attachedFiles.length === 0) || isLoading
                                ? sendBtnDisabled
                                : `${sendBtnEnabled} ${isMac ? '' : 'border'}`}
                        `}
                        disabled={(!inputValue.trim() && attachedFiles.length === 0) || isLoading}
                    >
                        <span className="whitespace-nowrap">
                            {isLoading ? (chatMode === 'plan' ? 'Planning' : 'Building') : (chatMode === 'plan' ? 'Plan' : 'Build')}
                        </span>
                        <ArrowRight className="w-3 h-3 shrink-0" />
                    </button>
                </div>

                {submitError && (
                    <div className="px-3 py-2 border-t border-red-500/20 bg-red-950/30 text-xs text-red-300 flex items-start justify-between gap-2">
                        <span>{submitError}</span>
                        {!isSignedIn && isLoaded && (
                            <SignInButton mode="modal">
                                <button
                                    type="button"
                                    className="shrink-0 rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide bg-white/10 text-zinc-100 hover:bg-white/15 transition-colors"
                                >
                                    Sign in
                                </button>
                            </SignInButton>
                        )}
                    </div>
                )}
            </motion.div>

            {!isMac && (
                <div className="text-center mt-4">
                    <p className="text-[10px] uppercase tracking-widest text-zinc-600 font-medium">
                        Shift + Return for new line
                    </p>
                </div>
            )}
        </div>
    );
};
