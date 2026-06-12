import React, { useEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Layers, Database, Boxes, GitBranch, Hammer, Figma,
    History, Users, Download, Cpu, Sparkles, Shield, Zap,
} from 'lucide-react';

interface MiniFeature {
    icon: React.ElementType;
    title: string;
    desc: string;
}

interface SectionDef {
    id: string;
    rail: string;
    headlineWhite: string;
    headlineGray: string;
    minis: MiniFeature[];
}

const SECTIONS: SectionDef[] = [
    {
        id: 'ai-models',
        rail: 'AI Models',
        headlineWhite: 'Pick the right brain.',
        headlineGray: 'OpenAI, Anthropic and Gemini behind one prompt — switch models without losing context.',
        minis: [
            {
                icon: Cpu,
                title: 'Multi-provider',
                desc: 'GPT, Claude and Gemini in a single dropdown. Use the best model for planning, coding or speed.',
            },
            {
                icon: Sparkles,
                title: 'Mode-aware prompts',
                desc: 'Plan mode keeps the AI in architecture-only mode. Build mode unlocks file writes and shell commands.',
            },
            {
                icon: Zap,
                title: 'Streaming output',
                desc: 'Responses stream token-by-token. Files and commands appear in real time as the model generates them.',
            },
        ],
    },
    {
        id: 'sandbox',
        rail: 'Live Sandbox',
        headlineWhite: 'Instant preview.',
        headlineGray: 'Run your app in an in-browser sandbox the moment it is generated.',
        minis: [
            {
                icon: Layers,
                title: 'Zero setup',
                desc: 'npm install and the dev server run automatically inside a WebContainer — nothing to install locally.',
            },
            {
                icon: Boxes,
                title: 'Real terminal',
                desc: 'A full shell with persisted history and automatic error recovery when builds go sideways.',
            },
            {
                icon: Database,
                title: 'Dependency snapshots',
                desc: 'Cached node_modules restore in seconds, so returning to a project never starts from scratch.',
            },
        ],
    },
    {
        id: 'workflow',
        rail: 'Plan & Build',
        headlineWhite: 'Plan first. Build second.',
        headlineGray: 'Approve the architecture before a single line of code is written.',
        minis: [
            {
                icon: GitBranch,
                title: 'Plan mode',
                desc: 'The AI proposes structure, pages and data flow as a reviewable plan — no file writes allowed.',
            },
            {
                icon: Hammer,
                title: 'Build mode',
                desc: 'Approved plans become real code: files stream in, commands execute, the preview updates live.',
            },
            {
                icon: Figma,
                title: 'Figma import',
                desc: 'Paste a Figma link and the design context flows straight into the prompt.',
            },
        ],
    },
    {
        id: 'collaboration',
        rail: 'Collaboration',
        headlineWhite: 'Every change versioned.',
        headlineGray: 'Restore any generation, invite collaborators, ship together.',
        minis: [
            {
                icon: History,
                title: 'Version history',
                desc: 'Every AI generation is an immutable version. Roll any file — or the whole project — back in one click.',
            },
            {
                icon: Users,
                title: 'Collaborators',
                desc: 'Invite editors to a project by email and build the same thread together.',
            },
            {
                icon: Download,
                title: 'Project export',
                desc: 'Download the entire generated project as a zip and take it anywhere.',
            },
        ],
    },
    {
        id: 'production',
        rail: 'Production-Grade',
        headlineWhite: 'Built to ship.',
        headlineGray: 'Persisted threads, Neon Postgres, and recovery when things break.',
        minis: [
            {
                icon: Shield,
                title: 'Durable storage',
                desc: 'Threads, messages and file versions live in Neon Postgres — not ephemeral browser state.',
            },
            {
                icon: Database,
                title: 'Snapshot restore',
                desc: 'Dependency snapshots and inline blobs mean cold starts are fast and projects reopen reliably.',
            },
            {
                icon: Boxes,
                title: 'Terminal recovery',
                desc: 'Automatic detection of build failures with guided recovery commands and audit trails.',
            },
        ],
    },
];

const EASE_OUT: [number, number, number, number] = [0.22, 1, 0.36, 1];
const NAV_OFFSET_PX = 72;

const headlineVariants = {
    hidden: { opacity: 0, y: 28, filter: 'blur(8px)' },
    visible: {
        opacity: 1,
        y: 0,
        filter: 'blur(0px)',
        transition: { duration: 0.55, ease: EASE_OUT },
    },
    exit: {
        opacity: 0,
        y: -16,
        filter: 'blur(4px)',
        transition: { duration: 0.28, ease: EASE_OUT },
    },
};

const miniContainerVariants = {
    hidden: {},
    visible: { transition: { staggerChildren: 0.09, delayChildren: 0.1 } },
    exit: { transition: { staggerChildren: 0.04, staggerDirection: -1 as const } },
};

const miniItemVariants = {
    hidden: { opacity: 0, y: 18 },
    visible: {
        opacity: 1,
        y: 0,
        transition: { duration: 0.45, ease: EASE_OUT },
    },
    exit: {
        opacity: 0,
        y: -10,
        transition: { duration: 0.2 },
    },
};

const SectionContent: React.FC<{ section: SectionDef }> = ({ section }) => (
    <motion.div
        className="w-full flex flex-col items-start"
        initial="hidden"
        animate="visible"
        exit="exit"
        variants={{
            hidden: {},
            visible: { transition: { staggerChildren: 0.06 } },
            exit: { transition: { staggerChildren: 0.03, staggerDirection: -1 } },
        }}
    >
        <motion.h2
            variants={headlineVariants}
            className="font-outfit text-3xl md:text-[2.75rem] font-semibold tracking-tight text-left max-w-2xl leading-[1.15] mb-14 md:mb-20"
        >
            <span className="text-white">{section.headlineWhite}</span>{' '}
            <span className="text-zinc-500">{section.headlineGray}</span>
        </motion.h2>

        <motion.div
            variants={miniContainerVariants}
            className="grid grid-cols-1 md:grid-cols-3 w-full border-t border-zinc-800/80 md:divide-x md:divide-zinc-800/80"
        >
            {section.minis.map((mini, idx) => (
                <motion.div
                    key={mini.title}
                    variants={miniItemVariants}
                    className={`text-left pt-10 ${idx === 0 ? 'md:pr-8' : idx === 1 ? 'md:px-8' : 'md:pl-8'}`}
                >
                    <div className="flex items-center gap-2 mb-2.5">
                        <mini.icon className="w-3.5 h-3.5 text-zinc-500 shrink-0" strokeWidth={1.5} />
                        <h3 className="text-sm font-medium text-white">{mini.title}</h3>
                    </div>
                    <p className="text-sm text-zinc-500 leading-relaxed">{mini.desc}</p>
                </motion.div>
            ))}
        </motion.div>
    </motion.div>
);

interface RailProps {
    activeIndex: number;
    onSelect: (index: number) => void;
}

const Rail: React.FC<RailProps> = ({ activeIndex, onSelect }) => (
    <aside className="hidden lg:flex flex-col w-40 shrink-0 pt-6">
        <nav className="flex flex-col gap-5" aria-label="Feature sections">
            {SECTIONS.map((section, i) => {
                const isActive = i === activeIndex;
                return (
                    <button
                        key={section.rail}
                        type="button"
                        onClick={() => onSelect(i)}
                        className="group flex items-center gap-3 text-left -ml-1.5"
                    >
                        <motion.span
                            className="w-1.5 h-1.5 rounded-full bg-white shrink-0"
                            animate={{
                                opacity: isActive ? 1 : 0,
                                scale: isActive ? 1 : 0.5,
                            }}
                            transition={{ duration: 0.25 }}
                        />
                        <span
                            className={`text-sm transition-colors duration-200 ${
                                isActive ? 'text-white' : 'text-zinc-500 group-hover:text-zinc-400'
                            }`}
                        >
                            {section.rail}
                        </span>
                    </button>
                );
            })}
        </nav>
    </aside>
);

const MobileSections: React.FC = () => (
    <div className="w-full border-b border-zinc-900">
        {SECTIONS.map((section) => (
            <section
                key={section.id}
                id={section.id}
                className="max-w-7xl mx-auto px-6 py-20 border-b border-zinc-900/50 last:border-b-0"
            >
                <div className="mb-8 font-mono text-[10px] tracking-[0.2em] uppercase text-neon">
                    {section.rail}
                </div>
                <motion.div
                    initial="hidden"
                    whileInView="visible"
                    viewport={{ once: true, amount: 0.25 }}
                    variants={{
                        hidden: {},
                        visible: { transition: { staggerChildren: 0.08 } },
                    }}
                >
                    <SectionContent section={section} />
                </motion.div>
            </section>
        ))}
    </div>
);

const DesktopScrollytelling: React.FC = () => {
    const [activeIndex, setActiveIndex] = useState(0);
    const containerRef = useRef<HTMLDivElement>(null);
    const triggerRefs = useRef<(HTMLDivElement | null)[]>([]);
    const activeSection = SECTIONS[activeIndex];

    useEffect(() => {
        const triggers = triggerRefs.current.filter(Boolean) as HTMLDivElement[];
        if (triggers.length === 0) return;

        const ratios = new Map<number, number>();

        const pickActive = () => {
            let best = 0;
            let bestRatio = -1;
            ratios.forEach((ratio, index) => {
                if (ratio > bestRatio) {
                    bestRatio = ratio;
                    best = index;
                }
            });
            if (bestRatio > 0) setActiveIndex(best);
        };

        const observers = triggers.map((el, index) => {
            const observer = new IntersectionObserver(
                ([entry]) => {
                    ratios.set(index, entry.intersectionRatio);
                    pickActive();
                },
                {
                    root: null,
                    threshold: [0, 0.25, 0.5, 0.75, 1],
                    rootMargin: `-${NAV_OFFSET_PX}px 0px -40% 0px`,
                },
            );
            observer.observe(el);
            return observer;
        });

        return () => observers.forEach((o) => o.disconnect());
    }, []);

    const scrollToIndex = useCallback((index: number) => {
        const trigger = triggerRefs.current[index];
        if (!trigger) return;
        const top = trigger.getBoundingClientRect().top + window.scrollY - NAV_OFFSET_PX;
        window.scrollTo({ top, behavior: 'smooth' });
    }, []);

    return (
        <section
            ref={containerRef}
            className="relative border-b border-zinc-900 bg-zinc-950"
            style={{ height: `${SECTIONS.length * 100}vh` }}
        >
            {/* Sticky frame — rail + content locked together for the whole scroll zone */}
            <div
                className="sticky z-20 max-w-7xl mx-auto flex gap-12 lg:gap-16 px-6 bg-zinc-950"
                style={{
                    top: NAV_OFFSET_PX,
                    height: `calc(100vh - ${NAV_OFFSET_PX}px)`,
                }}
            >
                <Rail activeIndex={activeIndex} onSelect={scrollToIndex} />

                <div className="flex-1 flex items-center min-w-0 py-8 pl-4 lg:pl-8">
                    <AnimatePresence mode="wait">
                        <motion.div
                            key={activeSection.id}
                            className="w-full"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: 0.2 }}
                        >
                            <SectionContent section={activeSection} />
                        </motion.div>
                    </AnimatePresence>
                </div>
            </div>

            {/* Scroll triggers — one viewport height each, drive which slide is active */}
            {SECTIONS.map((section, i) => (
                <div
                    key={section.id}
                    id={section.id}
                    ref={(el) => { triggerRefs.current[i] = el; }}
                    className="absolute left-0 right-0 pointer-events-none"
                    style={{ top: `${i * 100}vh`, height: '100vh' }}
                    aria-hidden
                />
            ))}
        </section>
    );
};

export const StatementSections: React.FC = () => {
    const [isDesktop, setIsDesktop] = useState(
        () => typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches,
    );

    useEffect(() => {
        const mq = window.matchMedia('(min-width: 1024px)');
        const update = () => setIsDesktop(mq.matches);
        mq.addEventListener('change', update);
        return () => mq.removeEventListener('change', update);
    }, []);

    return isDesktop ? <DesktopScrollytelling /> : <MobileSections />;
};
