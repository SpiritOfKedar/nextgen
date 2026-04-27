import React, { useEffect, useRef } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import { useAtomValue, useSetAtom } from 'jotai';
import {
    shellInputWriterAtom,
    setShellOutputCallback,
    resizeShell,
    addShellOutputListener,
    terminalIssueByThreadAtom,
    terminalStatusByThreadAtom,
    recoveryAuditsByThreadAtom,
} from '../../store/webContainer';
import { currentThreadIdAtom } from '../../store/atoms';
import { detectTerminalIssue } from '../../lib/terminalIssues';
import { useAuth } from '@clerk/clerk-react';
import { useChat } from '../../hooks/useChat';
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
    const currentThreadId = useAtomValue(currentThreadIdAtom);
    const setTerminalIssueByThread = useSetAtom(terminalIssueByThreadAtom);
    const setTerminalStatusByThread = useSetAtom(terminalStatusByThreadAtom);
    const { getToken } = useAuth();
    const { runTerminalRecovery } = useChat();
    const outputBufferRef = useRef('');
    const eventBufferRef = useRef<Array<{ eventType: string; payload: string; cwd?: string; exitCode?: number | null }>>([]);

    // Keep ref in sync so the onData closure always has the latest writer
    useEffect(() => {
        shellWriterRef.current = shellWriter;
    }, [shellWriter]);

    useEffect(() => {
        if (!currentThreadId) return;
        const flush = async () => {
            if (eventBufferRef.current.length === 0) return;
            const token = await getToken();
            if (!token) return;
            const events = [...eventBufferRef.current];
            eventBufferRef.current = [];
            await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:3001/api'}/terminal/${encodeURIComponent(currentThreadId)}/events`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({ events }),
            }).catch(() => {
                // best effort
            });
        };
        const timer = setInterval(() => void flush(), 1200);
        return () => clearInterval(timer);
    }, [currentThreadId, getToken]);

    useEffect(() => {
        if (!terminalRef.current) return;
        let disposed = false;
        let resizeRaf = 0;

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
            if (disposed) return;
            const el = terminalRef.current;
            if (!el?.isConnected || el.clientWidth === 0 || el.clientHeight === 0) return;
            if (!term.element?.isConnected) return;
            try {
                fitAddon.fit();
                resizeShell({ cols: term.cols, rows: term.rows });
            } catch {
                // ignore — can happen during unmount / zero-size layout
            }
        };

        const scheduleFit = () => {
            if (disposed) return;
            if (resizeRaf) cancelAnimationFrame(resizeRaf);
            resizeRaf = requestAnimationFrame(() => {
                resizeRaf = 0;
                fitTerm();
            });
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

        const removeOutputListener = addShellOutputListener((data) => {
            outputBufferRef.current += data;
            if (currentThreadId) {
                eventBufferRef.current.push({ eventType: 'output', payload: data });
                const issue = detectTerminalIssue(outputBufferRef.current.slice(-12000));
                if (issue && issue.confidence >= 0.8) {
                    setTerminalIssueByThread((prev) => ({ ...prev, [currentThreadId]: issue }));
                    setTerminalStatusByThread((prev) => ({ ...prev, [currentThreadId]: 'error' }));
                }
            }
        });

        const ro = new ResizeObserver(() => scheduleFit());
        ro.observe(terminalRef.current);

        // Forward keystrokes → shell stdin
        term.onData((data) => {
            const writer = shellWriterRef.current;
            if (currentThreadId) {
                eventBufferRef.current.push({ eventType: 'input', payload: data });
            }
            if (writer) {
                writer.write(data).catch(() => {
                    // Writer may be closed — ignore
                });
            }
        });

        // Forward resize → shell process
        term.onResize(({ cols, rows }) => {
            resizeShell({ cols, rows });
        });

        return () => {
            disposed = true;
            clearTimeout(attachTimer);
            if (resizeRaf) cancelAnimationFrame(resizeRaf);
            ro.disconnect();
            setShellOutputCallback(null);
            removeOutputListener();
            term.dispose();
        };
    }, [currentThreadId, setTerminalIssueByThread, setTerminalStatusByThread]); // eslint-disable-line react-hooks/exhaustive-deps
    const issue = useAtomValue(terminalIssueByThreadAtom)[currentThreadId || ''];
    const latestAudit = useAtomValue(recoveryAuditsByThreadAtom)[currentThreadId || '']?.[0];
    return (
        <div className="relative h-full w-full bg-zinc-950 p-1 overflow-hidden">
            {issue && currentThreadId && (
                <div className="mx-1 mb-1 flex items-center justify-between rounded border border-amber-700/50 bg-amber-900/20 px-2 py-1 text-xs text-amber-200">
                    <span>{issue.message}</span>
                    <button
                        className="rounded border border-amber-600/60 px-2 py-0.5 hover:bg-amber-800/30"
                        onClick={() => void runTerminalRecovery({ threadId: currentThreadId, triggerSource: 'auto' })}
                    >
                        Fix with agent
                    </button>
                </div>
            )}
            <div className="h-full w-full" ref={terminalRef} />
            {latestAudit && (
                <div className="absolute left-3 bottom-3 rounded border border-zinc-800 bg-zinc-900/80 px-2 py-1 text-[11px] text-zinc-400">
                    last recovery: {latestAudit.status}
                </div>
            )}
            {currentThreadId && (
                <div className="absolute bottom-3 right-3">
                    <button
                        className="rounded border border-zinc-700 bg-zinc-900/80 px-2 py-1 text-[11px] text-zinc-300 hover:text-white"
                        onClick={() => void runTerminalRecovery({ threadId: currentThreadId, triggerSource: 'manual' })}
                    >
                        Run recovery
                    </button>
                </div>
            )}
        </div>
    );
};
