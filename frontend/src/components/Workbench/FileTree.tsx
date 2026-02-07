
import React from 'react';
import { useAtom, useAtomValue } from 'jotai';
import { File, Folder, FileJson, FileCode, ChevronRight, ChevronDown } from 'lucide-react';
import { fileSystemAtom, activeFileAtom } from '../../store/fileSystem';
import type { FileSystemItem, FolderNode } from '../../store/fileSystem';

export const FileTree: React.FC = () => {
    const fileSystem = useAtomValue(fileSystemAtom);

    return (
        <div className="h-full flex flex-col">
            <div className="h-10 border-b border-zinc-800 flex items-center px-4 shrink-0">
                <span className="text-xs font-bold text-zinc-400 tracking-wider">FILES</span>
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
    if (name.endsWith('.tsx') || name.endsWith('.ts')) return <FileCode className="w-4 h-4 text-blue-400" />;
    if (name.endsWith('.css')) return <File className="w-4 h-4 text-sky-300" />;
    if (name.endsWith('.json')) return <FileJson className="w-4 h-4 text-yellow-400" />;
    if (name.endsWith('.html')) return <File className="w-4 h-4 text-orange-400" />;
    return <File className="w-4 h-4 text-zinc-500" />;
};
