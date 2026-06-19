import React, { useEffect, useRef, useState } from 'react';

const LERP = 0.16;
const RADIUS = 36;

function lerp(a: number, b: number, t: number) {
    return a + (b - a) * t;
}

interface CursorGlowProps {
    boundsRef: React.RefObject<HTMLElement | null>;
}

export const CursorGlow: React.FC<CursorGlowProps> = ({ boundsRef }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const target = useRef({ x: -9999, y: -9999 });
    const current = useRef({ x: -9999, y: -9999 });
    const active = useRef(false);
    const [enabled, setEnabled] = useState(false);

    useEffect(() => {
        const coarse = window.matchMedia('(pointer: coarse)').matches;
        const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        setEnabled(!coarse && !reduced);
    }, []);

    useEffect(() => {
        if (!enabled) return;

        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const resize = () => {
            const dpr = Math.min(window.devicePixelRatio || 1, 2);
            canvas.width = window.innerWidth * dpr;
            canvas.height = window.innerHeight * dpr;
            canvas.style.width = `${window.innerWidth}px`;
            canvas.style.height = `${window.innerHeight}px`;
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        };

        resize();
        window.addEventListener('resize', resize);

        const draw = () => {
            ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);

            if (!active.current) return;

            current.current.x = lerp(current.current.x, target.current.x, LERP);
            current.current.y = lerp(current.current.y, target.current.y, LERP);

            const { x, y } = current.current;

            const glow = ctx.createRadialGradient(x, y, 0, x, y, RADIUS);
            glow.addColorStop(0, 'rgba(255,255,255,0.07)');
            glow.addColorStop(0.45, 'rgba(255,255,255,0.025)');
            glow.addColorStop(1, 'rgba(255,255,255,0)');
            ctx.fillStyle = glow;
            ctx.beginPath();
            ctx.arc(x, y, RADIUS, 0, Math.PI * 2);
            ctx.fill();

            ctx.strokeStyle = 'rgba(255,255,255,0.18)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(x - 5, y);
            ctx.lineTo(x + 5, y);
            ctx.moveTo(x, y - 5);
            ctx.lineTo(x, y + 5);
            ctx.stroke();

            ctx.fillStyle = 'rgba(255,255,255,0.55)';
            ctx.beginPath();
            ctx.arc(x, y, 1, 0, Math.PI * 2);
            ctx.fill();
        };

        let rafId = 0;
        const loop = () => {
            draw();
            rafId = requestAnimationFrame(loop);
        };
        rafId = requestAnimationFrame(loop);

        const bounds = boundsRef.current;
        if (!bounds) {
            cancelAnimationFrame(rafId);
            window.removeEventListener('resize', resize);
            return;
        }

        const onMove = (e: MouseEvent) => {
            target.current = { x: e.clientX, y: e.clientY };
            active.current = true;
        };

        const onLeave = (e: MouseEvent) => {
            if (e.relatedTarget instanceof Node && bounds.contains(e.relatedTarget)) return;
            active.current = false;
        };

        bounds.addEventListener('mousemove', onMove);
        bounds.addEventListener('mouseleave', onLeave);

        return () => {
            cancelAnimationFrame(rafId);
            window.removeEventListener('resize', resize);
            bounds.removeEventListener('mousemove', onMove);
            bounds.removeEventListener('mouseleave', onLeave);
        };
    }, [enabled, boundsRef]);

    if (!enabled) return null;

    return (
        <canvas
            ref={canvasRef}
            className="fixed inset-0 z-[5] pointer-events-none"
            aria-hidden
        />
    );
};
