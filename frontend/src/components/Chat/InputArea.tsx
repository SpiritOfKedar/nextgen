import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Paperclip, ArrowRight, Zap } from 'lucide-react';
import { useSetAtom } from 'jotai';
import { isWorkbenchActiveAtom, messagesAtom, type Message } from '../../store/atoms';

export const InputArea: React.FC = () => {
    const [isFocused, setIsFocused] = useState(false);
    const [inputValue, setInputValue] = useState('');
    const setIsWorkbenchActive = useSetAtom(isWorkbenchActiveAtom);
    const setMessages = useSetAtom(messagesAtom);

    const handleSendMessage = () => {
        if (!inputValue.trim()) return;

        const newMessage: Message = {
            id: Date.now().toString(),
            role: 'user',
            content: inputValue,
            timestamp: Date.now(),
        };

        setMessages((prev) => [...prev, newMessage]);
        setInputValue('');
        setIsWorkbenchActive(true);
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSendMessage();
        }
    };

    return (
        <div className="w-full max-w-3xl mx-auto mb-10 px-4">
            <motion.div
                className={`relative flex flex-col w-full bg-[#09090b] border rounded-3xl overflow-hidden transition-all duration-300 ${isFocused ? 'border-zinc-700 shadow-xl shadow-black/40' : 'border-zinc-800'}`}
                onFocus={() => setIsFocused(true)}
                onBlur={() => setIsFocused(false)}
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.3 }}
            >
                <textarea
                    className="w-full p-6 bg-transparent text-white placeholder-zinc-500 resize-none focus:outline-none text-lg leading-relaxed min-h-[140px] max-h-[400px]"
                    placeholder="Describe your app..."
                    rows={4}
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    onKeyDown={handleKeyDown}
                />

                {/* Bottom Controls */}
                <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 bg-transparent mt-auto">
                    {/* Left: Attachment */}
                    <div className="relative">
                        <input
                            type="file"
                            id="file-upload"
                            className="hidden"
                            onChange={(e) => console.log('File selected:', e.target.files?.[0]?.name)}
                        />
                        <button
                            onClick={() => document.getElementById('file-upload')?.click()}
                            className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-zinc-400 hover:text-white hover:bg-zinc-800/50 rounded-lg transition-colors group"
                        >
                            <Paperclip className="w-4 h-4" />
                            <span>Add files</span>
                        </button>
                    </div>

                    {/* Right: Actions */}
                    <div className="flex items-center gap-4">
                        <div className="flex items-center gap-1.5 text-xs font-medium text-zinc-400">
                            <Zap className="w-3 h-3 text-zinc-500" />
                            <span>Sonnet 4.5</span>
                        </div>

                        <button
                            onClick={handleSendMessage}
                            className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-500 rounded-lg shadow-md shadow-blue-500/10 transition-all ${!inputValue.trim() ? 'opacity-50 cursor-not-allowed' : 'hover:scale-[1.02] active:scale-[0.98]'}`}
                            disabled={!inputValue.trim()}
                        >
                            <span>Build</span>
                            <ArrowRight className="w-4 h-4 ml-1" />
                        </button>
                    </div>
                </div>
            </motion.div>

            <div className="text-center mt-6">
                <p className="text-xs text-zinc-500 font-medium">
                    Use <span className="text-zinc-400 transition-colors">Shift + Return</span> for new line
                </p>
            </div>
        </div>
    );
};
