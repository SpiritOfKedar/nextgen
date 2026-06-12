import React from 'react';

const SEGMENTS = [
    '■ SYSTEM: NEXTGEN BUILD PLATFORM',
    '|||||||||||||||||',
    '[ STATUS: ONLINE ]',
    '| | | | | | |',
    '[ SANDBOX: READY ]',
    '|||||||||||||||||',
    '[ MODELS: GPT · CLAUDE · GEMINI ]',
    '| | | | | | |',
    '[ CONNECTION: STABLE ]',
    '|||||||||||||||||',
];

export const StatusTicker: React.FC = () => {
    const line = SEGMENTS.join('   ');
    return (
        <div className="w-full border-y border-zinc-900 bg-zinc-950 overflow-hidden py-2.5 select-none">
            <div className="landing-ticker flex whitespace-nowrap w-max">
                {[0, 1].map((copy) => (
                    <span
                        key={copy}
                        aria-hidden={copy === 1}
                        className="font-mono text-[10px] tracking-widest text-zinc-600 pr-12"
                    >
                        {line}
                    </span>
                ))}
            </div>
        </div>
    );
};
