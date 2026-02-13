import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Zap, Check, ChevronUp, Sparkles } from 'lucide-react';
import { useAtom } from 'jotai';
import { selectedModelAtom } from '../../store/atoms';

interface ModelOption {
    id: string;
    label: string;
    description: string;
    provider: 'openai' | 'anthropic' | 'google';
    icon?: React.ReactNode;
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
        icon: <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
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
        icon: <Sparkles className="w-3.5 h-3.5 text-purple-400" />
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

const PROVIDER_COLORS: Record<string, string> = {
    openai: '#22c55e',
    anthropic: '#f59e0b',
    google: '#3b82f6',
};

export const ModelSelector: React.FC<{ side?: 'top' | 'bottom' }> = ({ side = 'top' }) => {
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

    const getProviderDot = (provider: string) => PROVIDER_COLORS[provider] || '#71717a';

    const handleSelect = (modelId: string) => {
        setSelectedModelId(modelId);
        setIsOpen(false);
    };

    const dropdown = (
        <AnimatePresence>
            {isOpen && (
                <motion.div
                    ref={dropdownRef}
                    initial={{ opacity: 0, y: side === 'top' ? 6 : -6, scale: 0.97 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: side === 'top' ? 6 : -6, scale: 0.97 }}
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
                                        {/* Provider color dot */}
                                        <span
                                            className="w-2 h-2 rounded-full shrink-0"
                                            style={{
                                                backgroundColor: getProviderDot(model.provider),
                                                boxShadow: `0 0 6px ${getProviderDot(model.provider)}44`,
                                            }}
                                        />

                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-1.5">
                                                <span className="text-[13px] font-medium leading-tight">
                                                    {model.label}
                                                </span>
                                                {model.icon && model.icon}
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
            )}
        </AnimatePresence>
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
                ref={buttonRef}
                onClick={() => setIsOpen(!isOpen)}
                className={`
                    flex items-center gap-2 px-3 py-1.5 
                    text-xs font-medium text-zinc-300 
                    bg-zinc-800/50 hover:bg-zinc-700/60 
                    border border-zinc-700/50 hover:border-zinc-600 
                    rounded-lg transition-all duration-150
                    ${isOpen ? 'bg-zinc-700/60 border-zinc-600 text-zinc-100' : ''}
                `}
            >
                <Zap className="w-3.5 h-3.5 text-zinc-500" />
                <span>{selectedModel.label}</span>
                <ChevronUp className={`w-3 h-3 text-zinc-500 transition-transform duration-200 ${isOpen ? '' : 'rotate-180'}`} />
            </button>

            {createPortal(dropdown, document.body)}
        </>
    );
};
