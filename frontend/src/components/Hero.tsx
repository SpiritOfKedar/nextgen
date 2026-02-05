import React from 'react';
import { motion } from 'framer-motion';
import { Sparkles, ChevronRight } from 'lucide-react';

export const Hero: React.FC = () => {
    return (
        <div className="flex flex-col items-center justify-center w-full max-w-4xl mx-auto text-center mt-20 md:mt-32">
            {/* Top Pill */}
            <motion.div
                initial={{ opacity: 0, y: -20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5 }}
                className="inline-flex items-center gap-2 px-3 py-1.5 mb-8 text-xs font-medium text-zinc-300 bg-zinc-900/50 border border-zinc-800 rounded-full backdrop-blur-md hover:bg-zinc-800/50 transition-colors cursor-pointer"
            >
                <Sparkles className="w-3 h-3 text-cyan-400" />
                <span>Introducing Bolt V2</span>
                <ChevronRight className="w-3 h-3 text-zinc-500" />
            </motion.div>

            {/* Main Heading */}
            <motion.h1
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.5, delay: 0.1 }}
                className="text-6xl md:text-8xl font-bold tracking-tight text-white mb-6 font-outfit"
            >
                What will you <span className="bg-gradient-to-r from-blue-400 via-cyan-400 to-teal-400 bg-clip-text text-transparent italic pr-2">build</span> today?
            </motion.h1>

            {/* Subtext */}
            <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.5, delay: 0.2 }}
                className="text-lg text-zinc-400 mb-12 max-w-2xl"
            >
                Create stunning apps & websites by chatting with AI.
            </motion.p>
        </div>
    );
};
