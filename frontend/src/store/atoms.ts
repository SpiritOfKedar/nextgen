import { atom } from 'jotai';

export const isWorkbenchActiveAtom = atom(false);

export interface Message {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    timestamp: number;
}


export interface Thread {
    _id: string;
    userId: string;
    title: string;
    createdAt: string;
    updatedAt: string;
}

export type ThreadSwitchStatus = 'idle' | 'loading' | 'error';

export interface ThreadSwitchState {
    status: ThreadSwitchStatus;
    targetThreadId: string | null;
    errorMessage: string | null;
}

// Read saved thread from localStorage on init
const savedThreadId = typeof window !== 'undefined' ? localStorage.getItem('currentThreadId') : null;

export const currentThreadIdAtom = atom<string | null>(savedThreadId);
export const threadsAtom = atom<Thread[]>([]);
export const messagesAtom = atom<Message[]>([]);
export const selectedModelAtom = atom<string>('gemini-2.5-flash');
export const threadSwitchStateAtom = atom<ThreadSwitchState>({
    status: 'idle',
    targetThreadId: null,
    errorMessage: null,
});
