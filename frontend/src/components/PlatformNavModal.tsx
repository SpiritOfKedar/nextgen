import React from 'react';
import { useNavigate } from 'react-router-dom';
import { X, ChevronRight } from 'lucide-react';
import { getFeaturesByCategory, featureHref } from '../data/features';

interface PlatformNavModalProps {
    isOpen: boolean;
    onClose: () => void;
}

export const PlatformNavModal: React.FC<PlatformNavModalProps> = ({ isOpen, onClose }) => {
    const navigate = useNavigate();
    const platformFeatures = getFeaturesByCategory('Platform');

    if (!isOpen) return null;

    const handleSelect = (slug: string) => {
        onClose();
        navigate(featureHref(slug));
    };

    return (
        <div
            className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
            onClick={onClose}
        >
            <div
                className="bg-zinc-900 border border-zinc-800 rounded-xl w-full max-w-lg overflow-hidden flex flex-col shadow-2xl"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-center justify-between p-4 border-b border-zinc-800 bg-zinc-950">
                    <span className="font-mono text-[10px] tracking-[0.2em] uppercase text-zinc-500">
                        Platform
                    </span>
                    <button
                        type="button"
                        onClick={onClose}
                        className="text-zinc-500 hover:text-zinc-300 transition-colors"
                        aria-label="Close"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <div className="p-2">
                    {platformFeatures.map((feature) => {
                        const Icon = feature.icon;
                        return (
                            <button
                                key={feature.slug}
                                type="button"
                                onClick={() => handleSelect(feature.slug)}
                                className="flex items-center gap-4 w-full px-4 py-3.5 text-left rounded-lg border border-transparent hover:border-zinc-700 hover:bg-zinc-800/50 transition-colors group"
                            >
                                <div className="flex items-center justify-center w-9 h-9 rounded-lg border border-zinc-800 bg-zinc-950 shrink-0 group-hover:border-zinc-700">
                                    <Icon className="w-4 h-4 text-zinc-400 group-hover:text-zinc-200" />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="text-sm font-medium text-zinc-200 group-hover:text-white">
                                        {feature.title}
                                    </div>
                                    <div className="text-xs text-zinc-500 truncate mt-0.5">
                                        {feature.description}
                                    </div>
                                </div>
                                <ChevronRight className="w-4 h-4 text-zinc-600 group-hover:text-zinc-400 shrink-0" />
                            </button>
                        );
                    })}
                </div>
            </div>
        </div>
    );
};
