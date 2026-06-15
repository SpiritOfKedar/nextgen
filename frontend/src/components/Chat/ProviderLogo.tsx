import { useState } from 'react';
import { twMerge } from 'tailwind-merge';
import type { ModelProvider } from '../../lib/models';

const CLAUDE_LOGO_SRC = '/claude-logo.png';
const GEMINI_LOGO_SRC = '/gemini-logo.png';
const OPENAI_LOGO_SRC = '/openai-logo.png';

const sizeClasses = {
    sm: 'h-4 w-4',
    md: 'h-7 w-7',
} as const;

const GeminiLogoFallback = ({ size }: { size: 'sm' | 'md' }) => (
    <svg viewBox="0 0 24 24" className={twMerge('shrink-0', sizeClasses[size])}>
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

const GeminiLogo = ({ size }: { size: 'sm' | 'md' }) => {
    const [failed, setFailed] = useState(false);
    if (failed) return <GeminiLogoFallback size={size} />;
    return (
        <span
            className={twMerge(
                'inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full border border-zinc-700/60 bg-zinc-950',
                sizeClasses[size],
            )}
        >
            <img
                src={GEMINI_LOGO_SRC}
                alt="Gemini"
                className="h-full w-full scale-[1.9] object-cover"
                onError={() => setFailed(true)}
            />
        </span>
    );
};

const OpenAILogoFallback = ({ size }: { size: 'sm' | 'md' }) => (
    <svg
        viewBox="0 0 24 24"
        className={twMerge('shrink-0 text-zinc-100', sizeClasses[size])}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
    >
        <path d="M12 3.2c1.8 0 3.3 1.5 3.3 3.3v1.2l1-.6c1.6-.9 3.7-.4 4.6 1.2.9 1.6.4 3.7-1.2 4.6l-1 .6 1 .6c1.6.9 2.1 3 1.2 4.6-.9 1.6-3 2.1-4.6 1.2l-1-.6v1.2c0 1.8-1.5 3.3-3.3 3.3s-3.3-1.5-3.3-3.3v-1.2l-1 .6c-1.6.9-3.7.4-4.6-1.2-.9-1.6-.4-3.7 1.2-4.6l1-.6-1-.6c-1.6-.9-2.1-3-1.2-4.6.9-1.6 3-2.1 4.6-1.2l1 .6V6.5c0-1.8 1.5-3.3 3.3-3.3z" />
    </svg>
);

const OpenAILogo = ({ size }: { size: 'sm' | 'md' }) => {
    const [failed, setFailed] = useState(false);
    if (failed) return <OpenAILogoFallback size={size} />;
    return (
        <span
            className={twMerge(
                'inline-flex shrink-0 items-center justify-center rounded-sm bg-zinc-100/95 p-[1px]',
                sizeClasses[size],
            )}
        >
            <img
                src={OPENAI_LOGO_SRC}
                alt="OpenAI"
                className="h-full w-full object-contain"
                onError={() => setFailed(true)}
            />
        </span>
    );
};

const AnthropicLogo = ({ size }: { size: 'sm' | 'md' }) => (
    <img
        src={CLAUDE_LOGO_SRC}
        alt="Claude"
        className={twMerge('shrink-0 rounded-sm object-cover', sizeClasses[size])}
    />
);

const AutoLogo = ({ size }: { size: 'sm' | 'md' }) => (
    <span
        className={twMerge(
            'inline-flex shrink-0 items-center justify-center rounded-md bg-zinc-800 text-zinc-400',
            sizeClasses[size],
        )}
    >
        <svg viewBox="0 0 24 24" className="w-[58%] h-[58%]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
        </svg>
    </span>
);

export const ProviderLogo = ({
    provider,
    size = 'sm',
}: {
    provider: ModelProvider;
    size?: 'sm' | 'md';
}) => {
    if (provider === 'auto') return <AutoLogo size={size} />;
    if (provider === 'google') return <GeminiLogo size={size} />;
    if (provider === 'anthropic') return <AnthropicLogo size={size} />;
    return <OpenAILogo size={size} />;
};
