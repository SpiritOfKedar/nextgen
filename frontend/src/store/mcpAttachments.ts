import { atom } from 'jotai';
import type { StitchContextPayload } from '../components/Chat/StitchPanel';

export const manualFigmaLinksAtom = atom<string[]>([]);
export const stitchContextAtom = atom<StitchContextPayload | null>(null);
