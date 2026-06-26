
import React, { useEffect } from 'react';
import Editor, { useMonaco } from '@monaco-editor/react';
import { useAtom, useAtomValue } from 'jotai';
import { X } from 'lucide-react';
import {
    activeEditorTabAtom,
    editorTabsAtom,
    updateEditorTabContentAtom,
    closeEditorTabAtom,
    setActiveEditorTabAtom,
    fileSystemAtom,
} from '../../store/fileSystem';
import type { FolderNode, FileSystemItem } from '../../store/fileSystem';
import { webContainerAtom, markPreviewStale } from '../../store/webContainer';
import { writeProjectFile } from '../../lib/webContainerShell';

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
    readOnly = false,
}) => {
    const monaco = useMonaco();
    const tabs = useAtomValue(editorTabsAtom);
    const activeTab = useAtomValue(activeEditorTabAtom);
    const [, updateTabContent] = useAtom(updateEditorTabContentAtom);
    const [, closeTab] = useAtom(closeEditorTabAtom);
    const [, setActiveTab] = useAtom(setActiveEditorTabAtom);
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
                },
            });
            monaco.editor.setTheme('bolt-dark');
        }
    }, [monaco]);

    const handleEditorChange = (value: string | undefined) => {
        if (!activeTab || value === undefined) return;

        const updateContent = (nodes: FileSystemItem[], segments: string[]): FileSystemItem[] => {
            const [current, ...rest] = segments;
            return nodes.map((node) => {
                if (rest.length === 0 && node.name === current && node.type === 'file') {
                    return { ...node, content: value };
                }
                if (node.type === 'folder' && node.name === current && node.children) {
                    return { ...node, children: updateContent(node.children, rest) };
                }
                return node;
            });
        };

        const pathSegments = activeTab.path.split('/');
        setFileSystem(updateContent(fileSystem, pathSegments) as FolderNode[]);
        updateTabContent({ path: activeTab.path, content: value, dirty: true });

        if (webContainerInstance) {
            writeProjectFile(webContainerInstance, activeTab.path, value).then(() => {
                markPreviewStale();
            }).catch((err) => {
                console.error(`[Editor] Failed to write ${activeTab.path}:`, err);
            });
        }
    };

    const handleCloseTab = (e: React.MouseEvent, path: string) => {
        e.stopPropagation();
        closeTab(path);
    };

    if (tabs.length === 0) {
        return (
            <div className="flex h-full w-full items-center justify-center bg-zinc-950 text-zinc-600">
                <div className="text-center px-6">
                    <p className="text-sm text-zinc-500">No files open</p>
                    <p className="mt-1 text-[11px] text-zinc-600">
                        Click a file in the explorer to open it. Tabs stay open so you can switch between files.
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div className="flex h-full w-full flex-col bg-zinc-950">
            <div className="flex shrink-0 items-stretch overflow-x-auto border-b border-zinc-800/80 bg-[#0c0c0e] custom-scrollbar">
                {tabs.map((tab) => {
                    const isActive = activeTab?.path === tab.path;
                    return (
                        <button
                            key={tab.path}
                            type="button"
                            onClick={() => setActiveTab(tab.path)}
                            className={`
                                group relative flex max-w-[180px] shrink-0 items-center gap-1.5 border-r border-zinc-800/60 px-3
                                h-9 text-[11px] transition-colors
                                ${isActive
                                    ? 'bg-zinc-950 text-zinc-100'
                                    : 'bg-transparent text-zinc-500 hover:bg-zinc-900/80 hover:text-zinc-300'
                                }
                            `}
                        >
                            {isActive && (
                                <span className="absolute inset-x-0 top-0 h-[2px] bg-blue-500" aria-hidden />
                            )}
                            <TabTypeDot name={tab.name} />
                            <span className="truncate">{tab.name}</span>
                            {tab.dirty && (
                                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-zinc-400" aria-label="Unsaved changes" />
                            )}
                            <span
                                role="button"
                                tabIndex={0}
                                onClick={(e) => handleCloseTab(e, tab.path)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' || e.key === ' ') {
                                        e.preventDefault();
                                        closeTab(tab.path);
                                    }
                                }}
                                className="ml-0.5 shrink-0 rounded p-0.5 opacity-0 transition-opacity hover:bg-zinc-700/80 group-hover:opacity-100"
                                aria-label={`Close ${tab.name}`}
                            >
                                <X className="h-3 w-3" />
                            </span>
                        </button>
                    );
                })}
            </div>

            {activeTab ? (
                <div className="min-h-0 flex-1">
                    <Editor
                        height="100%"
                        language={getLanguage(activeTab.name)}
                        path={activeTab.path}
                        value={activeTab.content}
                        onChange={handleEditorChange}
                        theme="bolt-dark"
                        options={{
                            minimap: { enabled: false },
                            fontSize: 13,
                            fontLigatures: true,
                            lineNumbers: 'on',
                            roundedSelection: false,
                            scrollBeyondLastLine: false,
                            readOnly,
                            automaticLayout: true,
                            padding: { top: 12, bottom: 12 },
                            fontFamily: "JetBrains Mono, Menlo, Monaco, 'Courier New', monospace",
                            renderLineHighlight: 'line',
                            scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8 },
                        }}
                    />
                </div>
            ) : (
                <div className="flex flex-1 items-center justify-center text-zinc-600 text-sm">
                    Select a tab
                </div>
            )}
        </div>
    );
};

const TabTypeDot: React.FC<{ name: string }> = ({ name }) => {
    const ext = name.includes('.') ? name.split('.').pop()?.toLowerCase() : '';
    let color = 'bg-zinc-500';
    if (ext === 'tsx' || ext === 'ts') color = 'bg-blue-400';
    else if (ext === 'jsx' || ext === 'js') color = 'bg-amber-400';
    else if (ext === 'css') color = 'bg-sky-400';
    return <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${color}`} aria-hidden />;
};
