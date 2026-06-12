import React from 'react';
import { motion } from 'framer-motion';
import { MessageSquare, MonitorPlay, GitBranch, Cpu, History } from 'lucide-react';

const FEATURES = [
    {
        icon: MessageSquare,
        title: 'Chat-to-Build',
        desc: 'Describe an app and AI generates the files and commands.',
        badge: null,
    },
    {
        icon: MonitorPlay,
        title: 'Live Preview',
        desc: 'In-browser Node sandbox with an instant dev server.',
        badge: 'LIVE',
    },
    {
        icon: GitBranch,
        title: 'Plan & Build',
        desc: 'Approve the architecture before code gets written.',
        badge: null,
    },
    {
        icon: Cpu,
        title: 'Multi-Model AI',
        desc: 'OpenAI, Anthropic and Gemini behind one prompt box.',
        badge: null,
    },
    {
        icon: History,
        title: 'Version History',
        desc: 'Restore any file to any previous generation.',
        badge: 'EARLY ACCESS',
    },
];

export const FeatureStrip: React.FC = () => {
    return (
        <section id="features" className="w-full border-t border-zinc-900 mt-20">
            <div className="max-w-7xl mx-auto grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 divide-y sm:divide-y-0 divide-zinc-900 lg:divide-x">
                {FEATURES.map((f, i) => (
                    <motion.div
                        key={f.title}
                        initial={{ opacity: 0, y: 16 }}
                        whileInView={{ opacity: 1, y: 0 }}
                        viewport={{ once: true, margin: '-40px' }}
                        transition={{ duration: 0.4, delay: i * 0.06 }}
                        className="px-6 py-8 text-left"
                    >
                        <div className="flex items-center gap-2 mb-3">
                            <f.icon className="w-4 h-4 text-zinc-300" />
                            <span className="text-sm font-semibold text-white">{f.title}</span>
                            {f.badge && (
                                <span className="font-mono text-[9px] tracking-wider px-1.5 py-0.5 rounded-sm bg-neon/15 text-neon border border-neon/30">
                                    {f.badge}
                                </span>
                            )}
                        </div>
                        <p className="text-sm text-zinc-500 leading-relaxed">{f.desc}</p>
                    </motion.div>
                ))}
            </div>
        </section>
    );
};
