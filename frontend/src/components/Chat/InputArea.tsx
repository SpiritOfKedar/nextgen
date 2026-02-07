import React, { useState, useRef, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Paperclip, ArrowRight } from 'lucide-react';
import { useChat } from '../../hooks/useChat';
import { ModelSelector } from './ModelSelector';

export const InputArea: React.FC = () => {
    const [isFocused, setIsFocused] = useState(false);
    const [inputValue, setInputValue] = useState('');
    const { sendMessage, isLoading } = useChat();
    const textareaRef = useRef<HTMLTextAreaElement>(null);

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
                    bg-zinc-900/80 backdrop-blur-xl 
                    border 
                    rounded-2xl overflow-hidden 
                    transition-all duration-300 ease-out
                    ${isFocused
                        ? 'border-zinc-700/80 shadow-[0_0_40px_-10px_rgba(0,0,0,0.5)] ring-1 ring-zinc-700/50'
                        : 'border-zinc-800/50 shadow-sm'
                    }
                `}
                onFocus={() => setIsFocused(true)}
                onBlur={() => setIsFocused(false)}
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.1, duration: 0.4 }}
            >
                <textarea
                    ref={textareaRef}
                    className="w-full py-5 px-6 bg-transparent text-zinc-100 placeholder-zinc-500/80 resize-none focus:outline-none text-base md:text-lg leading-relaxed min-h-[100px] max-h-[400px] scrollbar-hide"
                    placeholder="Describe your app idea..."
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    onKeyDown={handleKeyDown}
                    style={{ overflow: 'hidden' }}
                />

                {/* Bottom Controls */}
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 px-4 py-3 bg-zinc-900/40 border-t border-white/5">
                    {/* Left: Attachment */}
                    <div className="flex items-center gap-2">
                        <input
                            type="file"
                            id="file-upload"
                            className="hidden"
                            onChange={(e) => console.log('File selected:', e.target.files?.[0]?.name)}
                        />
                        <button
                            onClick={() => document.getElementById('file-upload')?.click()}
                            className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-zinc-400 hover:text-zinc-200 hover:bg-white/5 rounded-full transition-colors group"
                        >
                            <Paperclip className="w-3.5 h-3.5 group-hover:text-blue-400 transition-colors" />
                            <span>Add files</span>
                        </button>
                    </div>

                    {/* Right: Actions */}
                    <div className="flex items-center gap-2 justify-end">
                        <ModelSelector side="top" />

                        <button
                            onClick={handleSendMessage}
                            className={`
                                flex items-center gap-2 px-3.5 py-1.5 
                                text-sm font-semibold text-white 
                                bg-blue-600 hover:bg-blue-500 
                                rounded-lg 
                                shadow-[0_0_15px_-3px_rgba(37,99,235,0.4)] hover:shadow-[0_0_20px_-3px_rgba(37,99,235,0.6)]
                                transition-all duration-200
                                ${!inputValue.trim() || isLoading ? 'opacity-50 cursor-not-allowed grayscale' : 'hover:scale-[1.02] active:scale-[0.98]'}
                            `}
                            disabled={!inputValue.trim() || isLoading}
                        >
                            <span className="text-xs uppercase tracking-wide">{isLoading ? 'Building...' : 'Build'}</span>
                            <ArrowRight className="w-3.5 h-3.5" />
                        </button>
                    </div>
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
