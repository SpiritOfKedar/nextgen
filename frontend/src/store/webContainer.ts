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
    lastAppliedSeq: number;
    installSucceeded: boolean;
    lastBootAt: number;
    devServerRunning: boolean;
}
export const sandboxRuntimeMetadataAtom = atom<Record<string, SandboxRuntimeMetadata>>({});

// Shared jsh shell input writer — used by TerminalPanel and useChat shell actions
export const shellInputWriterAtom = atom<WritableStreamDefaultWriter<string> | null>(null);

// Signal that the shell is ready and idle (accepted input)
export const shellReadyAtom = atom<boolean>(false);

// ── Module-level shell output plumbing ────────────────────────────────
// These are imperative (not React state) — bridge between the jsh process
// running in WebContainer and whichever xterm instance is currently displayed.

let _outputCb: ((data: string) => void) | null = null;
let _outputBuf = '';

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
}

let _resizeFn: ((dims: { cols: number; rows: number }) => void) | null = null;
export function setShellResizeFn(fn: typeof _resizeFn) { _resizeFn = fn; }
export function resizeShell(dims: { cols: number; rows: number }) { _resizeFn?.(dims); }
