import { atom } from 'jotai';
import { WebContainer } from '@webcontainer/api';

export const webContainerAtom = atom<WebContainer | null>(null);
export const serverUrlAtom = atom<string | null>(null);
