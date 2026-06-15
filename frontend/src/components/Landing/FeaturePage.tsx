import React from 'react';
import { motion } from 'framer-motion';
import { SignedOut, SignInButton } from '@clerk/clerk-react';
import { Link } from 'react-router-dom';
import { Navbar } from '../Navbar';
import { Footer } from '../Footer';
import { BackgroundGrid } from '../Layout/BackgroundGrid';
import type { FeatureDefinition } from '../../data/features';

interface FeaturePageProps {
    feature: FeatureDefinition;
}

export const FeaturePage: React.FC<FeaturePageProps> = ({ feature }) => {
    const Icon = feature.icon;

    return (
        <div className="min-h-screen bg-zinc-950 text-white selection:bg-neon/30 font-sans relative">
            <Navbar />

            <div className="relative overflow-hidden">
                <BackgroundGrid />

                <div className="relative z-10 max-w-7xl mx-auto px-6 pt-32 pb-24">
                    <motion.div
                        initial={{ opacity: 0, y: 16 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.5 }}
                        className="font-mono text-[11px] tracking-[0.25em] text-neon mb-8"
                    >
                        {feature.eyebrow}
                    </motion.div>

                    <motion.div
                        initial={{ opacity: 0, y: 16 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.5, delay: 0.05 }}
                        className="flex items-center gap-3 mb-8"
                    >
                        <div className="flex items-center justify-center w-10 h-10 rounded-lg border border-zinc-800 bg-zinc-900">
                            <Icon className="w-5 h-5 text-zinc-300" />
                        </div>
                        <span className="text-sm font-semibold text-zinc-400">{feature.title}</span>
                        {feature.badge && (
                            <span className="font-mono text-[9px] tracking-wider px-1.5 py-0.5 rounded-sm bg-neon/15 text-neon border border-neon/30">
                                {feature.badge}
                            </span>
                        )}
                    </motion.div>

                    <motion.h1
                        initial={{ opacity: 0, y: 24 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.55, delay: 0.08 }}
                        className="font-outfit text-5xl md:text-7xl font-bold tracking-tight leading-[1.05] mb-8"
                    >
                        <span className="text-white">{feature.headline}</span>
                        <br />
                        <span className="text-zinc-500">{feature.headlineMuted}</span>
                    </motion.h1>

                    <motion.p
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ duration: 0.5, delay: 0.15 }}
                        className="text-lg text-zinc-400 max-w-2xl mb-20"
                    >
                        {feature.description}
                    </motion.p>

                    <div className="grid grid-cols-1 md:grid-cols-3 border border-zinc-900 divide-y md:divide-y-0 md:divide-x divide-zinc-900">
                        {feature.highlights.map((h, i) => (
                            <motion.div
                                key={h.title}
                                initial={{ opacity: 0, y: 16 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ duration: 0.4, delay: 0.2 + i * 0.08 }}
                                className="p-8"
                            >
                                <h.icon className="w-4 h-4 text-zinc-300 mb-4" />
                                <h3 className="text-sm font-semibold text-white mb-2">{h.title}</h3>
                                <p className="text-sm text-zinc-500 leading-relaxed">{h.description}</p>
                            </motion.div>
                        ))}
                    </div>

                    <SignedOut>
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            transition={{ duration: 0.5, delay: 0.4 }}
                            className="mt-16 flex items-center gap-4"
                        >
                            <SignInButton mode="modal">
                                <button className="px-6 py-2.5 text-sm font-semibold text-zinc-950 bg-neon rounded-full hover:bg-neon-dim transition-colors">
                                    Start building
                                </button>
                            </SignInButton>
                            <Link
                                to="/"
                                className="px-6 py-2.5 text-sm font-medium text-zinc-300 border border-zinc-700 rounded-full hover:border-zinc-500 hover:text-white transition-colors"
                            >
                                Back to home
                            </Link>
                        </motion.div>
                    </SignedOut>
                </div>
            </div>

            <Footer />
        </div>
    );
};
