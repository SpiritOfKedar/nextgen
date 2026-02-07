import { atom } from 'jotai';

export type FileSystemItem = FileNode | FolderNode;

export interface FileNode {
    type: 'file';
    name: string;
    content: string;
}

export interface FolderNode {
    type: 'folder';
    name: string;
    children: FileSystemItem[];
    isOpen?: boolean;
}

const initialFileSystem: FileSystemItem[] = [];

export const fileSystemAtom = atom<FileSystemItem[]>(initialFileSystem);

export interface ActiveFile {
    path: string; // full path like "src/App.tsx"
    name: string;
    content: string;
}

export const activeFileAtom = atom<ActiveFile | null>(null);
