import React, { useEffect, useRef } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import { useSetAtom } from 'jotai';
import { fileSystemAtom } from '../../store/fileSystem';
import type { FileSystemItem } from '../../store/fileSystem';
import 'xterm/css/xterm.css';

export const TerminalPanel: React.FC = () => {
    const terminalRef = useRef<HTMLDivElement>(null);
    const xtermRef = useRef<Terminal | null>(null);
    const setFileSystem = useSetAtom(fileSystemAtom);

    // Helper to find node by path (simplified for single level or specific structure)
    // For this mock, we'll just support creating in root or src for simplicity, 
    // or we can implement a proper path traversal if needed.
    // Let's stick to root-level or simple recursive addition.

    const addToFileSystem = (name: string, type: 'file' | 'folder') => {
        // Simple implementation: Add to appropriate folder or root
        // We will assume "current directory" is root for simplicity in this VFS version

        const newItem: FileSystemItem = type === 'folder'
            ? { type: 'folder', name, children: [], isOpen: true }
            : { type: 'file', name, content: '' };

        setFileSystem((prev) => [...prev, newItem]);
    };

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
        fitAddon.fit();

        // Initial content
        term.writeln('\x1b[1;34m➜\x1b[0m  \x1b[1;36m~/project\x1b[0m \x1b[0;37m$\x1b[0m npm run dev');
        term.writeln('\r\n\x1b[0;32m➜\x1b[0m  \x1b[1mLocal:\x1b[0m   \x1b[0;36mhttp://localhost:5173/\x1b[0m');
        term.writeln('\x1b[0;32m➜\x1b[0m  \x1b[1mNetwork:\x1b[0m \x1b[0;37muse --host to expose\x1b[0m\r\n');

        const prompt = '\x1b[1;34m➜\x1b[0m  \x1b[1;36m~/project\x1b[0m \x1b[0;37m$\x1b[0m ';
        term.write(prompt);

        // Basic Input Handling (Local Echo)
        let commandBuffer = '';
        term.onData(e => {
            switch (e) {
                case '\r': // Enter
                    term.write('\r\n');
                    const cmd = commandBuffer.trim().split(' ');
                    const command = cmd[0];
                    const arg = cmd[1];

                    // Process command (mocks)
                    if (command === 'ls') {
                        // list root items
                        // We can't easily access the *latest* atom state here inside the closure without a ref or specialized hook
                        // For this demo, we'll just log a static msg or try to use a ref to current fileSystem
                        term.writeln('src  package.json  tsconfig.json  vite.config.ts  index.html');
                    } else if (command === 'clear') {
                        term.clear();
                    } else if (command === 'mkdir' && arg) {
                        addToFileSystem(arg, 'folder');
                        term.writeln(`Created directory: ${arg}`);
                    } else if (command === 'touch' && arg) {
                        addToFileSystem(arg, 'file');
                        term.writeln(`Created file: ${arg}`);
                    } else if (command !== '') {
                        term.writeln(`boit: command not found: ${commandBuffer}`);
                    }

                    commandBuffer = '';
                    term.write(prompt);
                    break;
                case '\u007F': // Backspace (DEL)
                    if (term.buffer.active.cursorX > 2) {
                        if (commandBuffer.length > 0) {
                            term.write('\b \b');
                            commandBuffer = commandBuffer.slice(0, -1);
                        }
                    }
                    break;
                default:
                    if (e >= String.fromCharCode(0x20) && e <= String.fromCharCode(0x7E) || e >= '\u00a0') {
                        commandBuffer += e;
                        term.write(e);
                    }
            }
        });

        xtermRef.current = term;

        // Resize observer to auto-fit
        const resizeObserver = new ResizeObserver(() => {
            fitAddon.fit();
        });
        resizeObserver.observe(terminalRef.current);

        return () => {
            term.dispose();
            resizeObserver.disconnect();
        };
    }, []); // Note: Empty dependency array means this effect runs once. 
    // `addToFileSystem` inside won't see updated state if we use it directly, 
    // but `setFileSystem` uses a callback, which IS safe.
    // However, `ls` listing won't be dynamic without a ref.

    return <div className="h-full w-full bg-zinc-950 p-2 overflow-hidden" ref={terminalRef} />;
};
