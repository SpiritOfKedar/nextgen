import React, { useCallback, useEffect, useRef, useState } from 'react';
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
import { shouldAutoRecover, RECOVERY_LLM_MODEL } from '../../lib/terminalAutoFix';
import { scheduleAutoTerminalRecovery } from '../../lib/terminalAutoRecovery';
import { useAuth } from '@clerk/clerk-react';
import { useChat } from '../../hooks/useChat';
import { X } from 'lucide-react';
import 'xterm/css/xterm.css';

/**
 * Terminal display — jsh shell is managed by useWebContainer.
 * Layout uses flex so banners/footer never overlap the scrollable xterm area.
 */
export const TerminalPanel: React.FC = () => {
    const terminalRef = useRef<HTMLDivElement>(null);
    const fitRef = useRef<(() => void) | null>(null);
    const shellWriterRef = useRef<WritableStreamDefaultWriter<string> | null>(null);
    const shellWriter = useAtomValue(shellInputWriterAtom);
    const currentThreadId = useAtomValue(currentThreadIdAtom);
    const setTerminalIssueByThread = useSetAtom(terminalIssueByThreadAtom);
    const setTerminalStatusByThread = useSetAtom(terminalStatusByThreadAtom);
    const { getToken } = useAuth();
    const { runTerminalRecovery } = useChat();
    const outputBufferRef = useRef('');
    const eventBufferRef = useRef<Array<{ eventType: string; payload: string; cwd?: string; exitCode?: number | null }>>([]);
    const [dismissedIssueCode, setDismissedIssueCode] = useState<string | null>(null);

    useEffect(() => {
        shellWriterRef.current = shellWriter;
    }, [shellWriter]);

    useEffect(() => {
        setDismissedIssueCode(null);
    }, [currentThreadId]);

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
            }).catch(() => undefined);
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
                /* ignore during unmount / zero-size layout */
            }
        };

        fitRef.current = fitTerm;

        const scheduleFit = () => {
            if (disposed) return;
            if (resizeRaf) cancelAnimationFrame(resizeRaf);
            resizeRaf = requestAnimationFrame(() => {
                resizeRaf = 0;
                fitTerm();
            });
        };

        const attachTimer = setTimeout(() => {
            requestAnimationFrame(() => {
                fitTerm();
                setShellOutputCallback((data) => {
                    try {
                        if (term.element) term.write(data);
                    } catch {
                        /* terminal disposed */
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

        term.onData((data) => {
            const writer = shellWriterRef.current;
            if (currentThreadId) {
                eventBufferRef.current.push({ eventType: 'input', payload: data });
            }
            if (writer) {
                writer.write(data).catch(() => undefined);
            }
        });

        term.onResize(({ cols, rows }) => {
            resizeShell({ cols, rows });
        });

        return () => {
            disposed = true;
            fitRef.current = null;
            clearTimeout(attachTimer);
            if (resizeRaf) cancelAnimationFrame(resizeRaf);
            ro.disconnect();
            setShellOutputCallback(null);
            removeOutputListener();
            term.dispose();
        };
    }, [currentThreadId, setTerminalIssueByThread, setTerminalStatusByThread]);

    const issue = useAtomValue(terminalIssueByThreadAtom)[currentThreadId || ''];
    const terminalStatus = useAtomValue(terminalStatusByThreadAtom)[currentThreadId || ''];
    const latestAudit = useAtomValue(recoveryAuditsByThreadAtom)[currentThreadId || '']?.[0];
    const isRecovering = terminalStatus === 'running';

    const showIssueBanner = !!(issue && currentThreadId && !isRecovering && dismissedIssueCode !== issue.code);

    const invokeRecovery = useCallback((triggerSource: 'manual' | 'auto') => {
        if (!currentThreadId || isRecovering) return;
        void runTerminalRecovery({
            threadId: currentThreadId,
            triggerSource,
            terminalOutput: outputBufferRef.current.slice(-12000),
            issue,
        });
    }, [currentThreadId, isRecovering, issue, runTerminalRecovery]);

    useEffect(() => {
        fitRef.current?.();
    }, [isRecovering, showIssueBanner, latestAudit?.status]);

    useEffect(() => {
        if (!currentThreadId || !issue || isRecovering || dismissedIssueCode === issue.code) return;
        if (!shouldAutoRecover(issue)) return;
        scheduleAutoTerminalRecovery(currentThreadId, issue.code, () => {
            invokeRecovery('auto');
        });
    }, [currentThreadId, issue, isRecovering, dismissedIssueCode, invokeRecovery]);

    return (
        <div className="flex h-full min-h-0 flex-col bg-zinc-950">
            {isRecovering && (
                <div className="shrink-0 border-b border-blue-800/40 bg-blue-950/30 px-3 py-1.5 text-xs text-blue-200">
                    Diagnosing and verifying fix (up to 3 rounds) · model: <span className="font-medium text-blue-100">{RECOVERY_LLM_MODEL}</span>
                </div>
            )}

            {showIssueBanner && (
                <div className="shrink-0 flex items-center gap-2 border-b border-amber-800/40 bg-amber-950/25 px-3 py-1.5 text-xs text-amber-200">
                    <span className="min-w-0 flex-1 truncate">{issue!.message}</span>
                    <button
                        type="button"
                        className="shrink-0 rounded border border-amber-600/50 px-2 py-0.5 hover:bg-amber-900/40 disabled:opacity-50"
                        disabled={isRecovering}
                        onClick={() => invokeRecovery('auto')}
                    >
                        Fix with agent
                    </button>
                    <button
                        type="button"
                        className="shrink-0 rounded p-0.5 text-amber-400/80 hover:bg-amber-900/40 hover:text-amber-200"
                        aria-label="Dismiss error banner"
                        onClick={() => setDismissedIssueCode(issue!.code)}
                    >
                        <X className="h-3.5 w-3.5" />
                    </button>
                </div>
            )}

            <div className="min-h-0 flex-1 overflow-hidden p-1">
                <div className="h-full w-full" ref={terminalRef} />
            </div>

            <div className="shrink-0 flex items-center justify-between gap-2 border-t border-zinc-800/80 bg-zinc-950 px-2 py-1.5">
                <div className="min-w-0 flex-1 truncate text-[11px] text-zinc-500">
                    {latestAudit ? (
                        <>
                            Last recovery: <span className={latestAudit.status === 'resolved' ? 'text-green-500/90' : 'text-red-400/90'}>{latestAudit.status}</span>
                            {latestAudit.status === 'failed' && latestAudit.detail ? (
                                <span className="text-zinc-600"> — {latestAudit.detail}</span>
                            ) : null}
                        </>
                    ) : (
                        <span>Errors auto-fix via agent ({RECOVERY_LLM_MODEL})</span>
                    )}
                </div>
                {currentThreadId && (
                    <button
                        type="button"
                        className="shrink-0 rounded border border-zinc-700 bg-zinc-900 px-2.5 py-1 text-[11px] text-zinc-300 hover:bg-zinc-800 hover:text-white disabled:opacity-50"
                        disabled={isRecovering}
                        onClick={() => invokeRecovery('manual')}
                        title={`Run recovery with ${RECOVERY_LLM_MODEL}`}
                    >
                        {isRecovering ? 'Recovering…' : 'Fix with agent'}
                    </button>
                )}
            </div>
        </div>
    );
};
