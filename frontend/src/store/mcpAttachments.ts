import { atom } from 'jotai';
import type { StitchContextPayload } from '../components/Chat/StitchPanel';
import type { SupabaseContextPayload } from '../components/Chat/SupabasePanel';

export const manualFigmaLinksAtom = atom<string[]>([]);
export const stitchContextAtom = atom<StitchContextPayload | null>(null);
export const supabaseContextAtom = atom<SupabaseContextPayload | null>(null);
