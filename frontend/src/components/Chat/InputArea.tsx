import React, { useState, useRef, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Paperclip, ArrowRight } from 'lucide-react';
import { useChat } from '../../hooks/useChat';
import { ModelSelector } from './ModelSelector';

export const InputArea: React.FC = () => {
    const [inputValue, setInputValue] = useState('');
    const { sendMessage, isLoading } = useChat();
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Auto-resize textarea
    useEffect(() => {
        if (textareaRef.current) {
            textareaRef.current.style.height = 'auto';
            textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 400) + 'px';
        }
    }, [inputValue]);

    const handleSendMessage = async () => {
        if (!inputValue.trim() || isLoading) return;
        const content = inputValue;
        setInputValue('');
        if (textareaRef.current) textareaRef.current.style.height = 'auto'; // Reset height
        await sendMessage(content);
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
                    style={{ overflow: 'hidden' }}
                />

                {/* Grid: middle column minmax(0,1fr) shrinks so Build never clips (card uses overflow-hidden) */}
                <div className="grid w-full min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 px-2.5 py-2 bg-zinc-900/60 border-t border-zinc-800/70">
                    <input
                        type="file"
                        id="file-upload"
                        ref={fileInputRef}
                        className="hidden"
                        onChange={(e) => console.log('File selected:', e.target.files?.[0]?.name)}
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
                            ${!inputValue.trim() || isLoading
                                ? 'cursor-not-allowed border-zinc-700 bg-zinc-800 text-zinc-500'
                                : 'border-blue-500/70 bg-blue-600/90 text-white hover:bg-blue-600 hover:border-blue-400/80'}
                        `}
                        disabled={!inputValue.trim() || isLoading}
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
