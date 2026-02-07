import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Zap, Check, ChevronDown, Sparkles } from 'lucide-react';
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

export const ModelSelector: React.FC<{ side?: 'top' | 'bottom' }> = ({ side = 'top' }) => {
    const [selectedModelId, setSelectedModelId] = useAtom(selectedModelAtom);
    const [isOpen, setIsOpen] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);

    const selectedModel = MODELS.find(m => m.id === selectedModelId) || MODELS[0];

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const getProviderColor = (provider: string) => {
        switch (provider) {
            case 'openai': return 'bg-green-500';
            case 'anthropic': return 'bg-amber-600';
            case 'google': return 'bg-blue-500';
            default: return 'bg-zinc-500';
        }
    };

    return (
        <div className="relative" ref={containerRef}>
            <style>{`
                .custom-scrollbar::-webkit-scrollbar {
                    width: 4px;
                }
                .custom-scrollbar::-webkit-scrollbar-track {
                    background: transparent;
                }
                .custom-scrollbar::-webkit-scrollbar-thumb {
                    background: #3f3f46;
                    border-radius: 4px;
                }
                .custom-scrollbar::-webkit-scrollbar-thumb:hover {
                    background: #52525b;
                }
            `}</style>

            <button
                onClick={() => setIsOpen(!isOpen)}
                className={`
                    flex items-center gap-2 px-3 py-1.5 
                    text-xs font-medium text-zinc-300 
                    bg-zinc-800/40 hover:bg-zinc-700/50 
                    border border-zinc-700/50 hover:border-zinc-600 
                    rounded-md transition-all duration-200
                    ${isOpen ? 'bg-zinc-700/50 border-zinc-600' : ''}
                `}
            >
                {selectedModel.icon ? selectedModel.icon : <Zap className="w-3.5 h-3.5 text-zinc-400" />}
                <span>{selectedModel.label}</span>
                <ChevronDown className={`w-3.5 h-3.5 text-zinc-500 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
            </button>

            <AnimatePresence>
                {isOpen && (
                    <motion.div
                        initial={{ opacity: 0, y: side === 'top' ? 8 : -8, scale: 0.98 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: side === 'top' ? 8 : -8, scale: 0.98 }}
                        transition={{ duration: 0.15, ease: "easeOut" }}
                        className={`
                            absolute ${side === 'top' ? 'bottom-full mb-2' : 'top-full mt-2'} right-0 w-[240px] 
                            bg-[#09090b] 
                            border border-zinc-700/50 
                            rounded-lg shadow-2xl shadow-black/90 
                            overflow-hidden z-50 ring-1 ring-white/5
                        `}
                    >
                        {/* Increased max-height to 320px to fit all 6 items without scrolling if possible, 
                            but kept scrollbar logic just in case on small screens */}
                        <div className="flex flex-col max-h-[320px] overflow-y-auto custom-scrollbar p-1.5 gap-1">
                            {MODELS.map((model) => (
                                <button
                                    key={model.id}
                                    onClick={() => {
                                        setSelectedModelId(model.id);
                                        setIsOpen(false);
                                    }}
                                    className={`
                                        relative flex items-center gap-3 w-full px-3 py-2.5 text-left rounded-md transition-all duration-150 group
                                        ${selectedModelId === model.id
                                            ? 'bg-zinc-800 text-zinc-100'
                                            : 'text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200'
                                        }
                                    `}
                                >
                                    <div className={`w-2 h-2 rounded-full flex-shrink-0 ${getProviderColor(model.provider)} shadow-[0_0_8px_rgba(0,0,0,0.5)]`} />

                                    <div className="flex-1 min-w-0 flex flex-col">
                                        <div className="flex items-center justify-between">
                                            <span className="text-sm font-medium">
                                                {model.label}
                                            </span>
                                            {selectedModelId === model.id && (
                                                <Check className="w-3.5 h-3.5 text-white flex-shrink-0 ml-2" />
                                            )}
                                        </div>
                                        <span className="text-[11px] text-zinc-500 truncate mt-0.5">{model.description}</span>
                                    </div>
                                </button>
                            ))}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};
