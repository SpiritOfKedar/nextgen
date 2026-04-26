import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { twMerge } from 'tailwind-merge';
import { Check, ChevronUp } from 'lucide-react';
import { useAtom } from 'jotai';
import { selectedModelAtom } from '../../store/atoms';

interface ModelOption {
    id: string;
    label: string;
    description: string;
    provider: 'openai' | 'anthropic' | 'google';
}

const MODELS: ModelOption[] = [
    {
        id: 'gemini-2.5-flash',
        label: 'Gemini 2.5 Flash',
        description: 'Fast & Cheap',
        provider: 'google',
    },
    {
        id: 'gpt-4o-mini',
        label: 'GPT-4o Mini',
        description: 'Fast & Cheap',
        provider: 'openai',
    },
    {
        id: 'gpt-5.2',
        label: 'ChatGPT 5.2',
        description: 'Reasoning',
        provider: 'openai',
    },
    {
        id: 'gemini-3-pro',
        label: 'Gemini 3 Pro',
        description: 'Multimodal',
        provider: 'google',
    },
    {
        id: 'claude-opus-4.5',
        label: 'Claude Opus 4.5',
        description: 'High Intelligence',
        provider: 'anthropic',
    },
    {
        id: 'claude-opus-4.6',
        label: 'Claude Opus 4.6',
        description: 'Experimental',
        provider: 'anthropic',
    },
    {
        id: 'claude-sonnet-4.5',
        label: 'Claude Sonnet 4.5',
        description: 'Balanced',
        provider: 'anthropic',
    },
    {
        id: 'claude-haiku-4.5',
        label: 'Claude Haiku 4.5',
        description: 'Fast',
        provider: 'anthropic',
    }
];

const CLAUDE_LOGO_SRC = '/claude-logo.png';

const AnthropicLogo = () => (
    <img
        src={CLAUDE_LOGO_SRC}
        alt="Claude"
        className="w-4 h-4 shrink-0 rounded-sm object-cover"
    />
);

const GEMINI_LOGO_SRC = '/gemini-logo.png';

const GeminiLogoFallback = () => (
    <svg viewBox="0 0 24 24" className="w-4 h-4 shrink-0">
        <defs>
            <linearGradient id="geminiGradientFallback" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#1D9BF0" />
                <stop offset="100%" stopColor="#A78BFA" />
            </linearGradient>
        </defs>
        <path
            d="M12 2 C12.9 8.6, 15.4 11.1, 22 12 C15.4 12.9, 12.9 15.4, 12 22 C11.1 15.4, 8.6 12.9, 2 12 C8.6 11.1, 11.1 8.6, 12 2 Z"
            fill="url(#geminiGradientFallback)"
        />
    </svg>
);

const GeminiLogo = () => {
    const [failed, setFailed] = useState(false);
    if (failed) return <GeminiLogoFallback />;
    return (
        <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center overflow-hidden rounded-full border border-zinc-700/60 bg-zinc-950">
            <img
                src={GEMINI_LOGO_SRC}
                alt="Gemini"
                className="h-full w-full scale-[1.9] object-cover"
                onError={() => setFailed(true)}
            />
        </span>
    );
};

const OPENAI_LOGO_SRC = '/openai-logo.png';

const OpenAILogoFallback = () => (
    <svg viewBox="0 0 24 24" className="w-4 h-4 shrink-0 text-zinc-100" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 3.2c1.8 0 3.3 1.5 3.3 3.3v1.2l1-.6c1.6-.9 3.7-.4 4.6 1.2.9 1.6.4 3.7-1.2 4.6l-1 .6 1 .6c1.6.9 2.1 3 1.2 4.6-.9 1.6-3 2.1-4.6 1.2l-1-.6v1.2c0 1.8-1.5 3.3-3.3 3.3s-3.3-1.5-3.3-3.3v-1.2l-1 .6c-1.6.9-3.7.4-4.6-1.2-.9-1.6-.4-3.7 1.2-4.6l1-.6-1-.6c-1.6-.9-2.1-3-1.2-4.6.9-1.6 3-2.1 4.6-1.2l1 .6V6.5c0-1.8 1.5-3.3 3.3-3.3z" />
    </svg>
);

const OpenAILogo = () => {
    const [failed, setFailed] = useState(false);
    if (failed) return <OpenAILogoFallback />;
    return (
        <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-sm bg-zinc-100/95 p-[1px]">
            <img
                src={OPENAI_LOGO_SRC}
                alt="OpenAI"
                className="h-full w-full object-contain"
                onError={() => setFailed(true)}
            />
        </span>
    );
};

const ProviderLogo = ({ provider }: { provider: ModelOption['provider'] }) => {
    if (provider === 'google') return <GeminiLogo />;
    if (provider === 'anthropic') return <AnthropicLogo />;
    return <OpenAILogo />;
};

export const ModelSelector: React.FC<{ side?: 'top' | 'bottom'; className?: string }> = ({
    side = 'top',
    className = '',
}) => {
    const [selectedModelId, setSelectedModelId] = useAtom(selectedModelAtom);
    const [isOpen, setIsOpen] = useState(false);
    const buttonRef = useRef<HTMLButtonElement>(null);
    const dropdownRef = useRef<HTMLDivElement>(null);
    const [dropdownPos, setDropdownPos] = useState({ top: 0, left: 0 });

    const selectedModel = MODELS.find(m => m.id === selectedModelId) || MODELS[0];

    const updatePosition = useCallback(() => {
        if (!buttonRef.current) return;
        const rect = buttonRef.current.getBoundingClientRect();
        const dropdownWidth = 260;

        // Clamp horizontal position so dropdown doesn't overflow viewport
        let left = rect.right - dropdownWidth;
        if (left < 8) left = 8;
        if (left + dropdownWidth > window.innerWidth - 8) {
            left = window.innerWidth - dropdownWidth - 8;
        }

        if (side === 'top') {
            setDropdownPos({ top: rect.top - 8, left });
        } else {
            setDropdownPos({ top: rect.bottom + 8, left });
        }
    }, [side]);

    // Recalculate position on open, scroll, resize
    useEffect(() => {
        if (!isOpen) return;
        updatePosition();

        const handleUpdate = () => updatePosition();
        window.addEventListener('scroll', handleUpdate, true);
        window.addEventListener('resize', handleUpdate);
        return () => {
            window.removeEventListener('scroll', handleUpdate, true);
            window.removeEventListener('resize', handleUpdate);
        };
    }, [isOpen, updatePosition]);

    // Close on click outside
    useEffect(() => {
        if (!isOpen) return;
        const handleClickOutside = (e: MouseEvent) => {
            const target = e.target as Node;
            if (
                buttonRef.current && !buttonRef.current.contains(target) &&
                dropdownRef.current && !dropdownRef.current.contains(target)
            ) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [isOpen]);

    // Close on Escape
    useEffect(() => {
        if (!isOpen) return;
        const handleEsc = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setIsOpen(false);
        };
        document.addEventListener('keydown', handleEsc);
        return () => document.removeEventListener('keydown', handleEsc);
    }, [isOpen]);

    const handleSelect = (modelId: string) => {
        setSelectedModelId(modelId);
        setIsOpen(false);
    };

    const dropdownPanel = (
        <motion.div
            ref={dropdownRef}
            initial={{ opacity: 0, y: side === 'top' ? 6 : -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
            style={{
                position: 'fixed',
                zIndex: 99999,
                ...(side === 'top'
                    ? { bottom: window.innerHeight - dropdownPos.top, left: dropdownPos.left }
                    : { top: dropdownPos.top, left: dropdownPos.left }
                ),
                width: 260,
            }}
            className="model-selector-dropdown"
        >
            <div
                className="
                    bg-zinc-900 border border-zinc-700/60
                    rounded-xl shadow-2xl shadow-black/80
                    ring-1 ring-white/4
                    backdrop-blur-xl overflow-hidden
                "
            >
                <div className="px-3 pt-3 pb-1.5">
                    <span className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
                        Model
                    </span>
                </div>
                <div className="flex flex-col max-h-95 overflow-y-auto model-selector-scroll px-1.5 pb-1.5">
                    {MODELS.map((model) => {
                        const isSelected = selectedModelId === model.id;
                        return (
                            <button
                                key={model.id}
                                type="button"
                                onClick={() => handleSelect(model.id)}
                                className={`
                                    relative flex items-center gap-3 w-full px-2.5 py-2 text-left
                                    rounded-lg transition-colors duration-100
                                    ${isSelected
                                        ? 'bg-zinc-800/80 text-white'
                                        : 'text-zinc-400 hover:bg-zinc-800/40 hover:text-zinc-200'
                                    }
                                `}
                            >
                                <ProviderLogo provider={model.provider} />

                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-1.5">
                                        <span className="text-[13px] font-medium leading-tight">
                                            {model.label}
                                        </span>
                                    </div>
                                    <span className="text-[11px] text-zinc-500 leading-tight">
                                        {model.description}
                                    </span>
                                </div>

                                {isSelected && (
                                    <Check className="w-3.5 h-3.5 text-zinc-300 shrink-0" />
                                )}
                            </button>
                        );
                    })}
                </div>
            </div>
        </motion.div>
    );

    return (
        <>
            <style>{`
                .model-selector-scroll::-webkit-scrollbar {
                    width: 4px;
                }
                .model-selector-scroll::-webkit-scrollbar-track {
                    background: transparent;
                }
                .model-selector-scroll::-webkit-scrollbar-thumb {
                    background: #3f3f46;
                    border-radius: 4px;
                }
                .model-selector-scroll::-webkit-scrollbar-thumb:hover {
                    background: #52525b;
                }
            `}</style>

            <button
                type="button"
                ref={buttonRef}
                onClick={() => setIsOpen(!isOpen)}
                className={twMerge(
                    'inline-flex h-8 min-w-0 w-full max-w-[12.5rem] items-center gap-1.5 px-2',
                    'text-[11px] font-medium text-zinc-200',
                    'bg-zinc-900 hover:bg-zinc-800/80',
                    'border border-zinc-700/80 hover:border-zinc-600',
                    'rounded-md transition-colors duration-150',
                    isOpen ? 'bg-zinc-800 border-zinc-600 text-zinc-100' : null,
                    className,
                )}
            >
                <ProviderLogo provider={selectedModel.provider} />
                <span className="min-w-0 flex-1 truncate text-left">{selectedModel.label}</span>
                <ChevronUp className={`w-2.5 h-2.5 shrink-0 text-zinc-500 transition-transform duration-200 ${isOpen ? '' : 'rotate-180'}`} />
            </button>

            {typeof document !== 'undefined' && isOpen
                ? createPortal(dropdownPanel, document.body)
                : null}
        </>
    );
};
