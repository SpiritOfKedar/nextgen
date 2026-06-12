import React from 'react';
import { motion } from 'framer-motion';

export const Hero: React.FC = () => {
    return (
        <div className="flex flex-col items-center justify-center w-full max-w-5xl mx-auto text-center mt-24 md:mt-32">
            {/* Mono kicker */}
            <motion.div
                initial={{ opacity: 0, y: -12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5 }}
                className="inline-flex items-center gap-2 mb-8 font-mono text-[11px] tracking-[0.25em] uppercase text-neon"
            >
                <span className="status-blink">◆</span>
                <span>AI-powered no-code platform</span>
            </motion.div>

            {/* Main Heading — Neon-style two-tone */}
            <motion.h1
                initial={{ opacity: 0, scale: 0.97 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.5, delay: 0.1 }}
                className="text-5xl md:text-7xl font-bold tracking-tight mb-6 font-outfit leading-[1.05]"
            >
                <span className="text-white">NextGen is the AI builder</span>
                <br />
                <span className="text-zinc-500">designed for apps and ideas.</span>
            </motion.h1>

            {/* Subtext */}
            <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.5, delay: 0.2 }}
                className="text-lg text-zinc-400 mb-12 max-w-2xl"
            >
                Describe what you want. NextGen plans it, writes the code, and runs it
                live in your browser — no setup, no code, no waiting.
            </motion.p>
        </div>
    );
};
