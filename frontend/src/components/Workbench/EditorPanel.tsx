
import React, { useEffect } from 'react';
import Editor, { useMonaco } from '@monaco-editor/react';
import { useAtom, useAtomValue } from 'jotai';
import { activeFileAtom, fileSystemAtom } from '../../store/fileSystem';
import type { FolderNode, FileSystemItem } from '../../store/fileSystem';

interface EditorPanelProps {
    readOnly?: boolean;
}

export const EditorPanel: React.FC<EditorPanelProps> = ({
    readOnly = false
}) => {
    const monaco = useMonaco();
    const activeFile = useAtomValue(activeFileAtom);
    const [fileSystem, setFileSystem] = useAtom(fileSystemAtom);

    // Initial load
    useEffect(() => {
        if (monaco) {
            monaco.editor.defineTheme('bolt-dark', {
                base: 'vs-dark',
                inherit: true,
                rules: [],
                colors: {
                    'editor.background': '#09090b', // zinc-950
                }
            });
            monaco.editor.setTheme('bolt-dark');
        }
    }, [monaco]);

    // Handle content change: update the file system state
    const handleEditorChange = (value: string | undefined) => {
        if (!activeFile || value === undefined) return;

        // Recursive update helper
        const updateContent = (nodes: FileSystemItem[]): FileSystemItem[] => {
            return nodes.map(node => {
                if (node.name === activeFile.name && node.type === 'file') {
                    return { ...node, content: value };
                }
                if (node.type === 'folder' && node.children) {
                    return { ...node, children: updateContent(node.children) };
                }
                return node;
            });
        };

        const newFileSystem = updateContent(fileSystem) as FolderNode[];
        setFileSystem(newFileSystem);

        // Also update the active file atom itself so it stays in sync if we read from it elsewhere
        // Note: activeFileAtom here is a copy, but in a real app we might rely on ID/Path.
        // For now, this just triggers re-renders if needed.
    };

    if (!activeFile) {
        return (
            <div className="h-full w-full flex items-center justify-center text-zinc-500">
                <div className="text-center">
                    <p className="mb-2">Select a file to edit</p>
                </div>
            </div>
        );
    }

    return (
        <div className="h-full w-full">
            <Editor
                height="100%"
                defaultLanguage="typescript" // Should be dynamic based on ext
                path={activeFile.name} // Important for Monaco model management
                value={activeFile.content}
                onChange={handleEditorChange}
                theme="bolt-dark"
                options={{
                    minimap: { enabled: false },
                    fontSize: 14,
                    fontLigatures: true,
                    lineNumbers: 'on',
                    roundedSelection: false,
                    scrollBeyondLastLine: false,
                    readOnly: readOnly,
                    automaticLayout: true,
                    padding: { top: 16, bottom: 16 },
                    fontFamily: "Menlo, Monaco, 'Courier New', monospace"
                }}
            />
        </div>
    );
};
