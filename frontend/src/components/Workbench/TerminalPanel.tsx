import React, { useEffect, useRef } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import { useAtomValue } from 'jotai';
import { webContainerAtom } from '../../store/webContainer';
import 'xterm/css/xterm.css';

export const TerminalPanel: React.FC = () => {
    const terminalRef = useRef<HTMLDivElement>(null);
    const xtermRef = useRef<Terminal | null>(null);
    const webContainer = useAtomValue(webContainerAtom);
    const isAttached = useRef(false);

    useEffect(() => {
        if (!terminalRef.current) return;

        // Initialize xterm
        const term = new Terminal({
            cursorBlink: true,
            theme: {
                background: '#09090b', // zinc-950
                foreground: '#d4d4d8', // zinc-300
                cursor: '#3b82f6',     // blue-500
                selectionBackground: '#3b82f640'
            },
            fontFamily: "Menlo, Monaco, 'Courier New', monospace",
            fontSize: 14,
            allowProposedApi: true
        });

        const fitAddon = new FitAddon();
        term.loadAddon(fitAddon);

        term.open(terminalRef.current);

        // Use ResizeObserver for robust fitting
        // We delay the initial fit slightly to ensure DOM is painted
        const fitTerm = () => {
            try {
                fitAddon.fit();
            } catch (err) {
                console.error('Failed to fit terminal:', err);
            }
        };

        requestAnimationFrame(() => fitTerm());

        xtermRef.current = term;

        // Resize observer to auto-fit
        const resizeObserver = new ResizeObserver(() => {
            // Debounce or just RAF
            requestAnimationFrame(() => fitTerm());
        });
        resizeObserver.observe(terminalRef.current);

        // Attach to WebContainer Process if available
        if (webContainer && !isAttached.current) {
            connectToWebContainer(term, webContainer);
            isAttached.current = true;
        } else if (!webContainer) {
            term.writeln('\x1b[33mBooting WebContainer...\x1b[0m');
        }

        return () => {
            term.dispose();
            resizeObserver.disconnect();
            isAttached.current = false;
        };
    }, [webContainer]);

    const connectToWebContainer = async (term: Terminal, wc: any) => {
        term.clear();
        term.writeln('\x1b[32mWebContainer Ready.\x1b[0m Starting Shell...');
        term.writeln('Installing dependencies... (this may take a minute)');

        // Spawn shell (jsh)
        const process = await wc.spawn('jsh', {
            terminal: {
                cols: term.cols,
                rows: term.rows,
            },
        });

        // Pipe process output to terminal
        process.output.pipeTo(
            new WritableStream({
                write(data) {
                    term.write(data);
                },
            })
        );

        // Pipe terminal input to process
        const inputWriter = process.input.getWriter();
        term.onData((data) => {
            inputWriter.write(data);
        });

        // Auto-start development server
        // We wrap in a small timeout to ensure the shell is ready and user sees the command
        setTimeout(() => {
            inputWriter.write('npm install && npm run dev\r');
        }, 500);

        // Handle resize
        // Note: xterm-addon-fit handles the visual resize, 
        // but we should ideally tell the process about it too if the API supports it.
        // process.resize({ cols, rows }); // Not always available in basic types, skipping for mvp
    };

    return <div className="h-full w-full bg-zinc-950 p-2 overflow-hidden" ref={terminalRef} />;
};
