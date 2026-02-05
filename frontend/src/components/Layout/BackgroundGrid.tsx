import React from 'react';

export const BackgroundGrid: React.FC = () => {
    return (
        <div className="absolute inset-0 pointer-events-none z-0 overflow-hidden">
            {/* Base Grid */}
            <div
                className="absolute inset-0 bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:24px_24px]"
            />

            {/* Radial Gradient Fade */}
            <div className="absolute inset-0 bg-zinc-950 [mask-image:radial-gradient(ellipse_at_center,transparent_20%,black)]" />

            {/* Spiral/Dynamic Effect (Top Right) */}
            <div className="absolute -top-[10%] -right-[10%] w-[50%] h-[50%] bg-blue-500/10 blur-[100px] rounded-full mix-blend-screen animate-pulse" />

            {/* Spiral/Dynamic Effect (Bottom Left) */}
            <div className="absolute -bottom-[10%] -left-[10%] w-[50%] h-[50%] bg-purple-500/10 blur-[100px] rounded-full mix-blend-screen animate-pulse delay-1000" />
        </div>
    );
};
