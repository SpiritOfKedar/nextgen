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

const initialFileSystem: FileSystemItem[] = [
    {
        type: 'folder',
        name: 'src',
        isOpen: true,
        children: [
            {
                type: 'folder',
                name: 'components',
                isOpen: false,
                children: [
                    { type: 'file', name: 'App.tsx', content: '// App.tsx content' },
                    { type: 'file', name: 'Button.tsx', content: '// Button component' },
                ]
            },
            {
                type: 'file',
                name: 'App.tsx',
                content: `import React from 'react';

export default function App() {
  return (
    <div className="min-h-screen bg-zinc-950 text-white flex items-center justify-center">
      <h1 className="text-4xl font-bold">Hello Bolt Clone!</h1>
      <p className="mt-4 text-zinc-400">Edit me in the file tree!</p>
    </div>
  );
}`
            },
            { type: 'file', name: 'main.tsx', content: '// Entry point' },
            { type: 'file', name: 'index.css', content: '/* Global styles */' },
        ]
    },
    {
        type: 'file',
        name: 'package.json',
        content: `{\n  "name": "bolt-clone",\n  "version": "1.0.0"\n}`
    }
];

export const fileSystemAtom = atom<FileSystemItem[]>(initialFileSystem);
export const activeFileAtom = atom<FileNode | null>(null);
