import { atom } from 'jotai';

export const isWorkbenchActiveAtom = atom(false);

export interface Message {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    timestamp: number;
}

export const messagesAtom = atom<Message[]>([]);
