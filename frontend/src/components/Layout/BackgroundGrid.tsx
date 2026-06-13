import React from 'react';

export const BackgroundGrid: React.FC = () => {
    return (
        <div className="absolute inset-0 pointer-events-none z-0 overflow-hidden">
            {/* Small square grid */}
            <div
                className="absolute inset-0 bg-[linear-gradient(to_right,rgba(255,255,255,0.045)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.045)_1px,transparent_1px)] bg-[size:12px_12px]"
            />
            {/* Slightly offset larger grid for depth */}
            <div
                className="absolute inset-0 bg-[linear-gradient(to_right,rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:48px_48px]"
            />
            {/* Soft vignette — keeps grid visible behind hero text & input */}
            <div className="absolute inset-0 bg-zinc-950/40 [mask-image:radial-gradient(ellipse_80%_70%_at_50%_40%,transparent_20%,black_85%)]" />
        </div>
    );
};
