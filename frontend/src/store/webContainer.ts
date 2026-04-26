import { atom } from 'jotai';
import { WebContainer } from '@webcontainer/api';

export const webContainerAtom = atom<WebContainer | null>(null);
export const serverUrlAtom = atom<string | null>(null);
export const previewStatusAtom = atom<'idle' | 'booting' | 'starting' | 'ready' | 'error'>('idle');
export const previewStatusMessageAtom = atom<string | null>(null);
export interface SandboxRuntimeMetadata {
    threadId: string;
    depFingerprint: string;
    criticalFingerprint: string;
    projectDir?: string;
    lastAppliedSeq: number;
    installSucceeded: boolean;
    lastBootAt: number;
    devServerRunning: boolean;
}
export const sandboxRuntimeMetadataAtom = atom<Record<string, SandboxRuntimeMetadata>>({});

// Shared jsh shell input writer — used by TerminalPanel and useChat shell actions
export const shellInputWriterAtom = atom<WritableStreamDefaultWriter<string> | null>(null);
export const shellCwdByThreadAtom = atom<Record<string, string>>({});

// Signal that the shell is ready and idle (accepted input)
export const shellReadyAtom = atom<boolean>(false);

// ── Module-level shell output plumbing ────────────────────────────────
// These are imperative (not React state) — bridge between the jsh process
// running in WebContainer and whichever xterm instance is currently displayed.

let _outputCb: ((data: string) => void) | null = null;
let _outputBuf = '';
const _outputListeners = new Set<(data: string) => void>();

/** Register xterm.write as the output consumer. Replays all buffered output. */
export function setShellOutputCallback(cb: ((data: string) => void) | null) {
    _outputCb = cb;
    if (cb && _outputBuf) {
        cb(_outputBuf);
    }
}

/** Called by the shell process output stream. Routes to xterm or buffer. */
export function writeShellOutput(data: string) {
    _outputBuf += data;
    // Cap at ~120 KB so we don't leak memory on long-running sessions
    if (_outputBuf.length > 120_000) {
        _outputBuf = _outputBuf.slice(-80_000);
    }
    _outputCb?.(data);
    for (const listener of _outputListeners) {
        listener(data);
    }
}

export function addShellOutputListener(listener: (data: string) => void) {
    _outputListeners.add(listener);
    return () => _outputListeners.delete(listener);
}

let _resizeFn: ((dims: { cols: number; rows: number }) => void) | null = null;
export function setShellResizeFn(fn: typeof _resizeFn) { _resizeFn = fn; }
export function resizeShell(dims: { cols: number; rows: number }) { _resizeFn?.(dims); }

export interface TerminalIssue {
    code: string;
    confidence: number;
    message: string;
    suggestedCommands: string[];
}

export interface RecoveryAudit {
    triggerSource: 'manual' | 'auto';
    issueCode: string;
    plannedCommands: string[];
    executedCommands: string[];
    status: 'resolved' | 'failed';
    detail?: string;
    createdAt: string;
}

export interface TerminalSessionEvent {
    event_type: string;
    payload: string;
    cwd?: string | null;
    exit_code?: number | null;
    created_at: string;
}

export const terminalIssueByThreadAtom = atom<Record<string, TerminalIssue | null>>({});
export const terminalSessionByThreadAtom = atom<Record<string, TerminalSessionEvent[]>>({});
export const recoveryAuditsByThreadAtom = atom<Record<string, RecoveryAudit[]>>({});
export const terminalStatusByThreadAtom = atom<Record<string, 'idle' | 'running' | 'error'>>({});

export const shellInputWithTrackingAtom = atom(
    null,
    async (get, _set, input: { text: string }) => {
        const writer = get(shellInputWriterAtom);
        if (!writer) throw new Error('Shell is not ready');
        await writer.write(input.text);
    },
);
