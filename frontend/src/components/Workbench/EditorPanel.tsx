
import React, { useEffect } from 'react';
import Editor, { useMonaco } from '@monaco-editor/react';
import { useAtom, useAtomValue } from 'jotai';
import { activeFileAtom, fileSystemAtom } from '../../store/fileSystem';
import type { FolderNode, FileSystemItem } from '../../store/fileSystem';
import { webContainerAtom } from '../../store/webContainer';

interface EditorPanelProps {
    readOnly?: boolean;
}

const getLanguage = (fileName: string): string => {
    const ext = fileName.split('.').pop()?.toLowerCase();
    switch (ext) {
        case 'ts': case 'tsx': return 'typescript';
        case 'js': case 'jsx': return 'javascript';
        case 'css': return 'css';
        case 'html': return 'html';
        case 'json': return 'json';
        case 'md': return 'markdown';
        case 'svg': case 'xml': return 'xml';
        default: return 'plaintext';
    }
};

export const EditorPanel: React.FC<EditorPanelProps> = ({
    readOnly = false
}) => {
    const monaco = useMonaco();
    const [activeFile, setActiveFile] = useAtom(activeFileAtom);
    const [fileSystem, setFileSystem] = useAtom(fileSystemAtom);
    const webContainerInstance = useAtomValue(webContainerAtom);

    useEffect(() => {
        if (monaco) {
            monaco.editor.defineTheme('bolt-dark', {
                base: 'vs-dark',
                inherit: true,
                rules: [],
                colors: {
                    'editor.background': '#09090b',
                }
            });
            monaco.editor.setTheme('bolt-dark');
        }
    }, [monaco]);

    const handleEditorChange = (value: string | undefined) => {
        if (!activeFile || value === undefined) return;

        // Update file system atom tree
        const updateContent = (nodes: FileSystemItem[], segments: string[]): FileSystemItem[] => {
            const [current, ...rest] = segments;
            return nodes.map(node => {
                if (rest.length === 0 && node.name === current && node.type === 'file') {
                    return { ...node, content: value };
                }
                if (node.type === 'folder' && node.name === current && node.children) {
                    return { ...node, children: updateContent(node.children, rest) };
                }
                return node;
            });
        };

        const pathSegments = activeFile.path.split('/');
        const newFileSystem = updateContent(fileSystem, pathSegments) as FolderNode[];
        setFileSystem(newFileSystem);

        // Keep activeFile in sync
        setActiveFile({ ...activeFile, content: value });

        // Write change to WebContainer
        if (webContainerInstance) {
            const wcPath = '/' + activeFile.path.replace(/^\//, '');
            webContainerInstance.fs.writeFile(wcPath, value).catch(err => {
                console.error(`[Editor] Failed to write ${wcPath}:`, err);
            });
        }
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
            {/* Tab bar */}
            <div className="h-8 border-b border-zinc-800 flex items-center px-3 bg-zinc-950 shrink-0">
                <span className="text-xs text-zinc-400 truncate">{activeFile.path}</span>
            </div>
            <Editor
                height="calc(100% - 32px)"
                language={getLanguage(activeFile.name)}
                path={activeFile.path}
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
