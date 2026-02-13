import React, { useEffect, useRef } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import { useAtomValue } from 'jotai';
import {
    shellInputWriterAtom,
    setShellOutputCallback,
    resizeShell,
} from '../../store/webContainer';
import 'xterm/css/xterm.css';

/**
 * Pure display component — the jsh shell process is managed by useWebContainer.
 * This component only:
 *   1. Creates an xterm instance
 *   2. Attaches to the shared shell output (replays buffered output on mount)
 *   3. Forwards keystrokes to the shared shell input writer
 */
export const TerminalPanel: React.FC = () => {
    const terminalRef = useRef<HTMLDivElement>(null);
    const shellWriterRef = useRef<WritableStreamDefaultWriter<string> | null>(null);
    const shellWriter = useAtomValue(shellInputWriterAtom);

    // Keep ref in sync so the onData closure always has the latest writer
    useEffect(() => {
        shellWriterRef.current = shellWriter;
    }, [shellWriter]);

    useEffect(() => {
        if (!terminalRef.current) return;

        const term = new Terminal({
            cursorBlink: true,
            theme: {
                background: '#09090b',
                foreground: '#d4d4d8',
                cursor: '#3b82f6',
                selectionBackground: '#3b82f640',
                black: '#09090b',
                red: '#ef4444',
                green: '#22c55e',
                yellow: '#eab308',
                blue: '#3b82f6',
                magenta: '#a855f7',
                cyan: '#06b6d4',
                white: '#d4d4d8',
                brightBlack: '#52525b',
                brightRed: '#f87171',
                brightGreen: '#4ade80',
                brightYellow: '#facc15',
                brightBlue: '#60a5fa',
                brightMagenta: '#c084fc',
                brightCyan: '#22d3ee',
                brightWhite: '#fafafa',
            },
            fontFamily: "Menlo, Monaco, 'Courier New', monospace",
            fontSize: 13,
            lineHeight: 1.4,
            scrollback: 5000,
            allowProposedApi: true,
        });

        const fitAddon = new FitAddon();
        term.loadAddon(fitAddon);
        term.open(terminalRef.current);

        const fitTerm = () => {
            const el = terminalRef.current;
            if (!el || el.clientWidth === 0 || el.clientHeight === 0) return;
            try {
                fitAddon.fit();
                resizeShell({ cols: term.cols, rows: term.rows });
            } catch {
                // ignore — can happen during unmount
            }
        };

        // Wait for layout to complete and terminal to have valid dimensions
        // before attaching output callback, otherwise xterm crashes on 'dimensions'.
        // Use requestAnimationFrame + setTimeout to ensure the DOM has painted.
        const attachTimer = setTimeout(() => {
            requestAnimationFrame(() => {
                fitTerm();
                // Only attach output callback after terminal is properly sized
                setShellOutputCallback((data) => {
                    try {
                        if (term.element) {
                            term.write(data);
                        }
                    } catch {
                        // swallow write errors (e.g. terminal disposed)
                    }
                });
            });
        }, 150);

        const ro = new ResizeObserver(() => requestAnimationFrame(fitTerm));
        ro.observe(terminalRef.current);

        // Forward keystrokes → shell stdin
        term.onData((data) => {
            shellWriterRef.current?.write(data);
        });

        // Forward resize → shell process
        term.onResize(({ cols, rows }) => {
            resizeShell({ cols, rows });
        });

        return () => {
            clearTimeout(attachTimer);
            setShellOutputCallback(null);
            ro.disconnect();
            term.dispose();
        };
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    return <div className="h-full w-full bg-zinc-950 p-1 overflow-hidden" ref={terminalRef} />;
};
