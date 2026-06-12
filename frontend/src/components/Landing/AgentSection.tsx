import React from 'react';
import { motion } from 'framer-motion';
import { SignedOut, SignInButton } from '@clerk/clerk-react';

const STATS = [
    { value: '< 60s', label: 'PROMPT TO LIVE PREVIEW' },
    { value: '3', label: 'FRONTIER MODEL PROVIDERS' },
    { value: '∞', label: 'VERSIONS PER PROJECT' },
    { value: '0', label: 'LINES OF CODE REQUIRED' },
];

export const AgentSection: React.FC = () => {
    return (
        <section id="platform" className="w-full bg-zinc-950">
            <div className="max-w-7xl mx-auto px-6 py-32">
                <motion.div
                    initial={{ opacity: 0, y: 16 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true, margin: '-80px' }}
                    transition={{ duration: 0.5 }}
                    className="font-mono text-[11px] tracking-[0.25em] text-neon mb-8"
                >
                    ► BUILD PIPELINE
                </motion.div>

                <motion.h2
                    initial={{ opacity: 0, y: 24 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true, margin: '-80px' }}
                    transition={{ duration: 0.55, delay: 0.05 }}
                    className="font-outfit text-5xl md:text-7xl font-bold tracking-tight leading-[1.05] mb-8"
                >
                    <span className="text-white">From prompt to production.</span>
                    <br />
                    <span className="text-zinc-500">In minutes.</span>
                </motion.h2>

                <motion.p
                    initial={{ opacity: 0 }}
                    whileInView={{ opacity: 1 }}
                    viewport={{ once: true }}
                    transition={{ duration: 0.5, delay: 0.15 }}
                    className="text-lg text-zinc-400 max-w-2xl mb-16"
                >
                    NextGen runs the full loop — planning, code generation, dependency
                    install, dev server, preview — without leaving the browser. Your idea
                    stays in motion from the first word you type.
                </motion.p>

                <div className="grid grid-cols-2 lg:grid-cols-4 border border-zinc-900 divide-x divide-y lg:divide-y-0 divide-zinc-900">
                    {STATS.map((s, i) => (
                        <motion.div
                            key={s.label}
                            initial={{ opacity: 0 }}
                            whileInView={{ opacity: 1 }}
                            viewport={{ once: true, margin: '-40px' }}
                            transition={{ duration: 0.4, delay: i * 0.08 }}
                            className="p-8"
                        >
                            <div className="font-outfit text-4xl font-bold text-white mb-2">{s.value}</div>
                            <div className="font-mono text-[10px] tracking-widest text-zinc-600">{s.label}</div>
                        </motion.div>
                    ))}
                </div>

                <SignedOut>
                    <div className="mt-16 flex items-center gap-4">
                        <SignInButton mode="modal">
                            <button className="px-6 py-2.5 text-sm font-semibold text-zinc-950 bg-neon rounded-full hover:bg-neon-dim transition-colors">
                                Get started free
                            </button>
                        </SignInButton>
                        <a
                            href="#features"
                            className="px-6 py-2.5 text-sm font-medium text-zinc-300 border border-zinc-700 rounded-full hover:border-zinc-500 hover:text-white transition-colors"
                        >
                            Explore features
                        </a>
                    </div>
                </SignedOut>
            </div>
        </section>
    );
};
