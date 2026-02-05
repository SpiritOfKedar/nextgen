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
        <div className="w-full max-w-3xl mx-auto mb-20 relative">
            {/* The Glowing Horizon Effect */}
            <div
                className={`absolute -inset-1 rounded-2xl bg-gradient-to-r from-blue-600 via-cyan-500 to-blue-600 opacity-20 blur-xl transition-opacity duration-500 ${isFocused ? 'opacity-40' : 'opacity-20'}`}
            />
            <div
                className={`absolute -top-10 left-1/2 -translate-x-1/2 w-3/4 h-20 bg-cyan-500/20 blur-[100px] rounded-full pointer-events-none transition-all duration-700 ${isFocused ? 'w-full h-32 bg-cyan-500/30' : ''}`}
            />

            {/* Input Container */}
            <motion.div
                className="relative flex flex-col w-full min-h-[160px] bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden shadow-2xl transition-colors duration-300 focus-within:border-zinc-700"
                onFocus={() => setIsFocused(true)}
                onBlur={() => setIsFocused(false)}
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.3 }}
            >
                <textarea
                    className="w-full h-full p-5 bg-transparent text-lg text-white placeholder-zinc-500 resize-none focus:outline-none font-medium leading-relaxed"
                    placeholder="Let's build a dashboard..."
                    rows={3}
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    onKeyDown={handleKeyDown}
                />

                {/* Bottom Controls */}
                <div className="flex items-center justify-between px-4 py-3 bg-zinc-900/50 backdrop-blur-sm mt-auto">
                    {/* Left: Attachment */}
                    <button className="p-2 text-zinc-400 hover:text-white transition-colors hover:bg-zinc-800 rounded-lg">
                        <Paperclip className="w-5 h-5" />
                    </button>

                    {/* Right: Model & Actions */}
                    <div className="flex items-center gap-3">
                        <button className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-zinc-400 hover:text-white bg-zinc-800/50 hover:bg-zinc-800 rounded-lg transition-colors border border-transparent hover:border-zinc-700">
                            <Zap className="w-4 h-4 text-yellow-500" />
                            <span>Sonnet 4.5</span>
                        </button>

                        <div className="h-4 w-[1px] bg-zinc-700 mx-1" />

                        <button className="px-4 py-2 text-sm font-medium text-zinc-300 hover:text-white transition-colors">
                            Plan
                        </button>

                        <button
                            onClick={handleSendMessage}
                            className="flex items-center gap-2 px-4 py-2 text-sm font-bold text-white bg-blue-600 hover:bg-blue-500 rounded-lg shadow-lg shadow-blue-900/20 transition-all hover:scale-105 active:scale-95"
                        >
                            Build now
                            <ArrowRight className="w-4 h-4" />
                        </button>
                    </div>
                </div>
            </motion.div>

            {/* Footer Links under input */}
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.5 }}
                className="flex items-center justify-center gap-4 mt-6 text-sm text-zinc-500"
            >
                <span>or import from</span>
                <button className="hover:text-zinc-300 transition-colors">Figma</button>
                <button className="hover:text-zinc-300 transition-colors">GitHub</button>
            </motion.div>
        </div>
    );
};
