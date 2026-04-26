import React, { useState, useRef, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Paperclip, ArrowRight, X } from 'lucide-react';
import { useChat } from '../../hooks/useChat';
import { ModelSelector } from './ModelSelector';

export const InputArea: React.FC = () => {
    const [inputValue, setInputValue] = useState('');
    const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
    const { sendMessage, isLoading } = useChat();
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
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

    // Auto-resize textarea
    useEffect(() => {
        if (textareaRef.current) {
            textareaRef.current.style.height = 'auto';
            textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 400) + 'px';
        }
    }, [inputValue]);

    const handleSendMessage = async () => {
        if ((!inputValue.trim() && attachedFiles.length === 0) || isLoading) return;
        const content = inputValue.trim() || 'Use attached file(s) as context.';
        const attachments = await buildOutgoingAttachments(attachedFiles);
        setInputValue('');
        setAttachedFiles([]);
        if (fileInputRef.current) fileInputRef.current.value = '';
        if (textareaRef.current) textareaRef.current.style.height = 'auto'; // Reset height
        await sendMessage(content, attachments);
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSendMessage();
        }
    };

    return (
        <div className="w-full max-w-4xl mx-auto px-4">
            <motion.div
                className={`
                    relative flex flex-col w-full 
                    bg-zinc-900/85 backdrop-blur-xl 
                    border 
                    rounded-xl overflow-hidden 
                    border-zinc-800/70 shadow-sm
                    transition-all duration-300 ease-out
                    focus-within:border-zinc-700/80 focus-within:shadow-lg focus-within:ring-1 focus-within:ring-zinc-700/40
                `}
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.1, duration: 0.4 }}
            >
                <textarea
                    ref={textareaRef}
                    className="w-full py-3.5 px-5 bg-transparent text-zinc-100 placeholder-zinc-500/80 resize-none focus:outline-none text-base leading-relaxed min-h-[76px] max-h-[360px] scrollbar-hide"
                    placeholder="Describe your app idea..."
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    onKeyDown={handleKeyDown}
                    onPaste={handlePaste}
                    style={{ overflow: 'hidden' }}
                />

                {attachedFiles.length > 0 && (
                    <div className="px-3 pb-2 flex flex-wrap gap-1.5">
                        {attachedFiles.map((file, index) => (
                            <span
                                key={`${file.name}-${file.size}-${index}`}
                                className="inline-flex items-center gap-1 rounded-md border border-zinc-700 bg-zinc-800/60 px-2 py-1 text-[11px] text-zinc-300"
                            >
                                <span className="max-w-[180px] truncate">{file.name}</span>
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
                            </span>
                        ))}
                    </div>
                )}

                {/* Grid: middle column minmax(0,1fr) shrinks so Build never clips (card uses overflow-hidden) */}
                <div className="grid w-full min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 px-2.5 py-2 bg-zinc-900/60 border-t border-zinc-800/70">
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

                    <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-zinc-700/80 bg-zinc-900 text-zinc-300 hover:text-zinc-100 hover:bg-zinc-800/70 transition-colors"
                        title="Add files"
                        aria-label="Add files"
                    >
                        <Paperclip className="w-3.5 h-3.5 text-zinc-400" />
                    </button>

                    <div className="min-w-0 w-full flex justify-start overflow-hidden">
                        <ModelSelector side="top" />
                    </div>

                    <button
                        type="button"
                        onClick={handleSendMessage}
                        className={`
                            inline-flex shrink-0 items-center justify-center gap-1 h-8 px-2.5
                            text-[10px] font-semibold uppercase tracking-wide
                            rounded-md border transition-colors duration-150
                            ${(!inputValue.trim() && attachedFiles.length === 0) || isLoading
                                ? 'cursor-not-allowed border-zinc-700 bg-zinc-800 text-zinc-500'
                                : 'border-blue-500/70 bg-blue-600/90 text-white hover:bg-blue-600 hover:border-blue-400/80'}
                        `}
                        disabled={(!inputValue.trim() && attachedFiles.length === 0) || isLoading}
                    >
                        <span className="whitespace-nowrap">{isLoading ? 'Building' : 'Build'}</span>
                        <ArrowRight className="w-3 h-3 shrink-0" />
                    </button>
                </div>
            </motion.div>

            <div className="text-center mt-4">
                <p className="text-[10px] uppercase tracking-widest text-zinc-600 font-medium">
                    Shift + Return for new line
                </p>
            </div>
        </div>
    );
};
