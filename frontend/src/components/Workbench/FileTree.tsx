
import React, { useMemo } from 'react';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { ChevronRight, ChevronsDownUp, ChevronsUpDown } from 'lucide-react';
import {
    fileSystemAtom,
    activeEditorTabPathAtom,
    editorTabsAtom,
    openEditorTabAtom,
    type FileSystemItem,
    type FolderNode,
} from '../../store/fileSystem';

const INDENT = 14;

const countFiles = (nodes: FileSystemItem[]): number => {
    let count = 0;
    for (const node of nodes) {
        if (node.type === 'file') count += 1;
        else count += countFiles(node.children);
    }
    return count;
};

const collapseAll = (nodes: FileSystemItem[]): FileSystemItem[] =>
    nodes.map((node) =>
        node.type === 'folder'
            ? { ...node, isOpen: false, children: collapseAll(node.children) }
            : node,
    );

const expandAll = (nodes: FileSystemItem[]): FileSystemItem[] =>
    nodes.map((node) =>
        node.type === 'folder'
            ? { ...node, isOpen: true, children: expandAll(node.children) }
            : node,
    );

export const FileTree: React.FC = () => {
    const fileSystem = useAtomValue(fileSystemAtom);
    const fileCount = useMemo(() => countFiles(fileSystem), [fileSystem]);
    const [, setFileSystem] = useAtom(fileSystemAtom);

    return (
        <div className="flex h-full flex-col bg-[#0c0c0e]">
            <div className="flex shrink-0 items-center justify-between border-b border-zinc-800/60 px-3 py-2">
                <div className="min-w-0">
                    <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-zinc-500">
                        Explorer
                    </p>
                    <p className="truncate text-[11px] text-zinc-600">
                        {fileCount === 0 ? 'No files' : `${fileCount} file${fileCount === 1 ? '' : 's'}`}
                    </p>
                </div>
                {fileSystem.length > 0 && (
                    <div className="flex items-center gap-0.5">
                        <button
                            type="button"
                            onClick={() => setFileSystem(expandAll(fileSystem))}
                            className="rounded p-1 text-zinc-600 hover:bg-zinc-800/60 hover:text-zinc-400"
                            title="Expand all"
                            aria-label="Expand all folders"
                        >
                            <ChevronsUpDown className="h-3 w-3" />
                        </button>
                        <button
                            type="button"
                            onClick={() => setFileSystem(collapseAll(fileSystem))}
                            className="rounded p-1 text-zinc-600 hover:bg-zinc-800/60 hover:text-zinc-400"
                            title="Collapse all"
                            aria-label="Collapse all folders"
                        >
                            <ChevronsDownUp className="h-3 w-3" />
                        </button>
                    </div>
                )}
            </div>

            <div className="flex-1 overflow-y-auto overflow-x-hidden py-1.5 custom-scrollbar">
                {fileSystem.length === 0 ? (
                    <p className="px-3 py-4 text-[11px] leading-relaxed text-zinc-600">
                        Files will appear here as the agent builds your project.
                    </p>
                ) : (
                    fileSystem.map((item, index) => (
                        <FileTreeNode key={index} item={item} depth={0} parentPath="" />
                    ))
                )}
            </div>
        </div>
    );
};

const FileTreeNode: React.FC<{ item: FileSystemItem; depth: number; parentPath: string }> = ({
    item,
    depth,
    parentPath,
}) => {
    const [fileSystem, setFileSystem] = useAtom(fileSystemAtom);
    const openTabs = useAtomValue(editorTabsAtom);
    const activePath = useAtomValue(activeEditorTabPathAtom);
    const openTab = useSetAtom(openEditorTabAtom);

    const currentPath = parentPath ? `${parentPath}/${item.name}` : item.name;
    const isFolder = item.type === 'folder';
    const isOpen = isFolder ? (item as FolderNode).isOpen : false;
    const isActive = !isFolder && activePath === currentPath;
    const isOpenInEditor = !isFolder && openTabs.some((tab) => tab.path === currentPath);
    const paddingLeft = depth * INDENT + 10;

    const toggleFolder = () => {
        if (!isFolder) return;
        const toggleItem = (nodes: FileSystemItem[]): FileSystemItem[] =>
            nodes.map((node) => {
                if (node === item) {
                    return { ...node, isOpen: !node.isOpen } as FolderNode;
                }
                if (node.type === 'folder' && node.children) {
                    return { ...node, children: toggleItem(node.children) } as FolderNode;
                }
                return node;
            });
        setFileSystem(toggleItem(fileSystem));
    };

    const handleClick = () => {
        if (isFolder) {
            toggleFolder();
            return;
        }
        openTab({
            path: currentPath,
            name: item.name,
            content: item.content,
            focus: true,
        });
    };

    return (
        <div className="relative select-none">
            {depth > 0 && (
                <span
                    className="pointer-events-none absolute bottom-0 top-0 w-px bg-zinc-800/70"
                    style={{ left: paddingLeft - INDENT / 2 - 4 }}
                    aria-hidden
                />
            )}

            <button
                type="button"
                onClick={handleClick}
                className={`
                    group relative flex w-full min-w-0 items-center gap-1.5 pr-2 text-left
                    h-[26px] text-[12px] transition-colors
                    ${isActive
                        ? 'bg-zinc-800/95 text-zinc-100'
                        : 'text-zinc-500 hover:bg-zinc-800/50 hover:text-zinc-300'
                    }
                    ${isFolder && isOpen ? 'text-zinc-300' : ''}
                `}
                style={{ paddingLeft }}
            >
                {isActive && (
                    <span className="absolute left-0 top-0 h-full w-[2px] bg-blue-500" aria-hidden />
                )}

                {isFolder ? (
                    <ChevronRight
                        className={`h-3 w-3 shrink-0 text-zinc-600 transition-transform duration-150 ${isOpen ? 'rotate-90 text-zinc-500' : ''}`}
                    />
                ) : (
                    <FileTypeDot name={item.name} />
                )}

                <span className={`truncate ${isFolder ? 'font-medium' : 'font-normal'}`}>
                    {item.name}
                </span>

                {isOpenInEditor && !isActive && (
                    <span className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-zinc-500/80" title="Open in editor" />
                )}
            </button>

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

const FileTypeDot: React.FC<{ name: string }> = ({ name }) => {
    const ext = name.includes('.') ? name.split('.').pop()?.toLowerCase() : '';
    const color = getExtensionColor(ext, name.toLowerCase());
    return (
        <span
            className={`inline-block h-[6px] w-[6px] shrink-0 rounded-full ${color}`}
            aria-hidden
        />
    );
};

const getExtensionColor = (ext: string | undefined, lowerName: string): string => {
    if (lowerName === 'package.json') return 'bg-emerald-500/70';
    if (ext === 'tsx' || ext === 'ts') return 'bg-blue-400/80';
    if (ext === 'jsx' || ext === 'js') return 'bg-amber-400/70';
    if (ext === 'css') return 'bg-sky-400/70';
    if (ext === 'html') return 'bg-orange-400/70';
    if (ext === 'json') return 'bg-yellow-500/60';
    if (ext === 'md') return 'bg-zinc-500/70';
    return 'bg-zinc-600/60';
};
