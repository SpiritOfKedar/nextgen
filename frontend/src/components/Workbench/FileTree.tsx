
import React from 'react';
import { useAtom, useAtomValue } from 'jotai';
import {
    File,
    Folder,
    ChevronRight,
    ChevronDown,
    Download,
} from 'lucide-react';
import { fileSystemAtom, activeFileAtom } from '../../store/fileSystem';
import { webContainerAtom } from '../../store/webContainer';
import type { FileSystemItem, FolderNode } from '../../store/fileSystem';
import { downloadProjectFromWebContainer } from '../../lib/projectDownload';

export const FileTree: React.FC = () => {
    const fileSystem = useAtomValue(fileSystemAtom);
    const webContainer = useAtomValue(webContainerAtom);
    const [isDownloading, setIsDownloading] = React.useState(false);

    const handleDownload = async () => {
        if (!webContainer) {
            window.alert('WebContainer is not ready yet.');
            return;
        }
        setIsDownloading(true);
        try {
            const count = await downloadProjectFromWebContainer(webContainer, { fileNamePrefix: 'project' });
            window.alert(`Downloaded ${count} file${count === 1 ? '' : 's'} as zip.`);
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to download project zip.';
            window.alert(message);
        } finally {
            setIsDownloading(false);
        }
    };

    return (
        <div className="h-full flex flex-col">
            <div className="h-10 border-b border-zinc-800 flex items-center justify-between px-3 shrink-0 gap-2">
                <span className="text-xs font-bold text-zinc-400 tracking-wider">FILES</span>
                <button
                    type="button"
                    onClick={handleDownload}
                    disabled={isDownloading}
                    className="inline-flex items-center gap-1.5 rounded-md border border-zinc-700 px-2 py-1 text-[11px] font-medium text-zinc-300 hover:text-white hover:border-zinc-600 disabled:opacity-50 disabled:cursor-not-allowed"
                    title="Download project as zip"
                >
                    <Download className="w-3.5 h-3.5" />
                    {isDownloading ? 'Preparing...' : 'Download'}
                </button>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-0.5 custom-scrollbar">
                {fileSystem.map((item, index) => (
                    <FileTreeNode key={index} item={item} depth={0} parentPath="" />
                ))}
            </div>
        </div>
    );
};

const FileTreeNode: React.FC<{ item: FileSystemItem, depth: number, parentPath: string }> = ({ item, depth, parentPath }) => {
    const [fileSystem, setFileSystem] = useAtom(fileSystemAtom);
    const [activeFile, setActiveFile] = useAtom(activeFileAtom);

    const currentPath = parentPath ? `${parentPath}/${item.name}` : item.name;

    const toggleFolder = () => {
        if (item.type !== 'folder') return;

        const toggleItem = (nodes: FileSystemItem[]): FileSystemItem[] => {
            return nodes.map(node => {
                if (node === item) {
                    return { ...node, isOpen: !node.isOpen } as FolderNode;
                }
                if (node.type === 'folder' && node.children) {
                    return { ...node, children: toggleItem(node.children) } as FolderNode;
                }
                return node;
            });
        };

        setFileSystem(toggleItem(fileSystem));
    };

    const handleFileClick = () => {
        if (item.type === 'file') {
            setActiveFile({ path: currentPath, name: item.name, content: item.content });
        }
    };

    const isFolder = item.type === 'folder';
    const isOpen = (item as FolderNode).isOpen;
    const isActive = activeFile?.path === currentPath;

    return (
        <div className="select-none">
            <div
                onClick={isFolder ? toggleFolder : handleFileClick}
                className={`flex items-center gap-1.5 px-2 py-1.5 rounded-md text-sm cursor-pointer transition-colors ${isActive ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50'
                    }`}
                style={{ paddingLeft: `${depth * 12 + 8}px` }}
            >
                {isFolder && (
                    <span className="text-zinc-500">
                        {isOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                    </span>
                )}

                {isFolder ? (
                    <Folder className={`w-4 h-4 ${isActive ? 'text-blue-400' : 'text-zinc-500'}`} />
                ) : (
                    <FileIcon name={item.name} />
                )}

                <span className="truncate">{item.name}</span>
            </div>

            {isFolder && isOpen && (item as FolderNode).children && (
                <div>
                    {(item as FolderNode).children.map((child, idx) => (
                        <FileTreeNode key={idx} item={child} depth={depth + 1} parentPath={currentPath} />
                    ))}
                </div>
            )}
        </div>
    );
};

const FileIcon = ({ name }: { name: string }) => {
    const extension = name.includes('.') ? name.split('.').pop()?.toLowerCase() : '';
    const lowerName = name.toLowerCase();

    if (extension === 'jsx' || extension === 'tsx') {
        return (
            <span className="inline-flex items-center justify-center w-4 h-4 text-cyan-400">
                <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <circle cx="12" cy="12" r="1.6" fill="currentColor" />
                    <ellipse cx="12" cy="12" rx="8.5" ry="3.6" />
                    <ellipse cx="12" cy="12" rx="8.5" ry="3.6" transform="rotate(60 12 12)" />
                    <ellipse cx="12" cy="12" rx="8.5" ry="3.6" transform="rotate(120 12 12)" />
                </svg>
            </span>
        );
    }

    if (lowerName === 'package.json') return <FileGlyph label="npm" accent="bg-emerald-400" />;
    if (lowerName.includes('config') || lowerName === 'tsconfig.json') return <FileGlyph label="cfg" accent="bg-zinc-400" />;
    if (extension === 'ts') return <FileGlyph label="ts" accent="bg-blue-400" />;
    if (extension === 'js') return <FileGlyph label="js" accent="bg-yellow-300" />;
    if (extension === 'css') return <FileGlyph label="css" accent="bg-sky-300" />;
    if (extension === 'html') return <FileGlyph label="html" accent="bg-orange-300" />;
    if (extension === 'json') return <FileGlyph label="{}" accent="bg-amber-300" />;
    if (extension === 'md') return <FileGlyph label="md" accent="bg-zinc-300" />;

    return <File className="w-4 h-4 text-zinc-500" />;
};

const FileGlyph = ({ label, accent }: { label: string; accent: string }) => (
    <span className="relative inline-flex w-4 h-4 items-center justify-center rounded-sm border border-zinc-700 bg-zinc-900 text-[7px] font-semibold uppercase text-zinc-200 leading-none">
        <span className={`absolute left-0 top-0 h-full w-[2px] rounded-l-sm ${accent}`} />
        {label}
    </span>
);
