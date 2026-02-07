import { useEffect, useState } from 'react';
import { WebContainer } from '@webcontainer/api';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { webContainerAtom, serverUrlAtom } from '../store/webContainer';
import { fileSystemAtom } from '../store/fileSystem';
import type { FileSystemItem, FolderNode, FileNode } from '../store/fileSystem';
import type { FileSystemTree } from '@webcontainer/api';

// Singleton promise to prevent double-booting
let bootPromise: Promise<WebContainer> | null = null;

export const useWebContainer = () => {
    const [webContainer, setWebContainer] = useAtom(webContainerAtom);
    const setServerUrl = useSetAtom(serverUrlAtom);
    const fileSystem = useAtomValue(fileSystemAtom);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const bootWebContainer = async () => {
            // If already exists in atom, we are done
            if (webContainer) {
                setIsLoading(false);
                return;
            }

            try {
                // If no boot promise exists, start one
                if (!bootPromise) {
                    console.log('Booting WebContainer...');
                    bootPromise = WebContainer.boot();
                }

                // Wait for the shared promise
                const instance = await bootPromise;
                setWebContainer(instance);

                // Setup global listener for server-ready
                instance.on('server-ready', (_, url) => {
                    console.log('Global Server Ready Listener:', url);
                    setServerUrl(url);
                });

                // Mount files if there are any in the file system
                if (fileSystem.length > 0) {
                    console.log('Mounting files...');
                    const tree = convertToWebContainerTree(fileSystem);
                    await instance.mount(tree);
                }

                setIsLoading(false);
            } catch (err) {
                console.error('Failed to boot WebContainer:', err);
                setError(err instanceof Error ? err.message : 'Unknown error');
                setIsLoading(false);
            }
        };

        bootWebContainer();
    }, []); // Run once on mount

    return { webContainer, isLoading, error };
};

// Helper to convert our recursive atom structure to WebContainer's expected object structure

const convertToWebContainerTree = (nodes: FileSystemItem[]): FileSystemTree => {
    const tree: FileSystemTree = {};

    nodes.forEach(node => {
        if (node.type === 'file') {
            tree[node.name] = {
                file: {
                    contents: (node as FileNode).content
                }
            };
        } else if (node.type === 'folder') {
            tree[node.name] = {
                directory: convertToWebContainerTree((node as FolderNode).children)
            };
        }
    });

    return tree;
};
