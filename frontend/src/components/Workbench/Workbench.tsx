
import React, { useState } from 'react';
import { Terminal, Code, Play } from 'lucide-react';
import { EditorPanel } from './EditorPanel';
import { TerminalPanel } from './TerminalPanel';
import { FileTree } from './FileTree';
import { useWebContainer } from '../../hooks/useWebContainer';
// import { motion } from 'framer-motion';

import { PreviewPanel } from './PreviewPanel';

export const Workbench: React.FC = () => {
    const [activeTab, setActiveTab] = useState<'code' | 'preview' | 'terminal'>('code');
    const { isLoading, error } = useWebContainer(); // Init WebContainer on mount

    if (error) {
        return (
            <div className="h-full flex flex-col items-center justify-center bg-zinc-950 text-red-400 p-4 text-center">
                <div className="text-xl font-bold mb-2">Failed to start WebContainer</div>
                <p>{error}</p>
                <button
                    onClick={() => window.location.reload()}
                    className="mt-4 px-4 py-2 bg-zinc-800 rounded hover:bg-zinc-700 text-white"
                >
                    Reload
                </button>
            </div>
        );
    }

    if (isLoading) {
        return (
            <div className="h-full flex flex-col items-center justify-center bg-zinc-950 text-white">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white mb-4"></div>
                <p className="text-zinc-400">Booting WebContainer...</p>
            </div>
        );
    }

    return (
        <div className="h-full flex flex-col bg-zinc-900 overflow-hidden">
            {/* Workbench Header */}
            <div className="h-10 border-b border-zinc-800 flex items-center justify-center bg-zinc-950 relative">
                {/* Tabs */}
                <div className="flex items-center p-1 bg-zinc-900 rounded-lg border border-zinc-800 scale-90">
                    <TabButton
                        active={activeTab === 'code'}
                        onClick={() => setActiveTab('code')}
                        icon={<Code className="w-3.5 h-3.5" />}
                        label="Code"
                    />
                    <TabButton
                        active={activeTab === 'preview'}
                        onClick={() => setActiveTab('preview')}
                        icon={<Play className="w-3.5 h-3.5" />}
                        label="Preview"
                    />
                    <TabButton
                        active={activeTab === 'terminal'}
                        onClick={() => setActiveTab('terminal')}
                        icon={<Terminal className="w-3.5 h-3.5" />}
                        label="Terminal"
                    />
                </div>
            </div>

            {/* Workbench Content */}
            <div className="flex-1 overflow-hidden relative">
                {activeTab === 'code' && <CodeView />}
                {activeTab === 'preview' && <PreviewPanel />}
                {activeTab === 'terminal' && <TerminalView />}
            </div>
        </div>
    );
};

const TabButton = ({ active, onClick, icon, label }: any) => (
    <button
        onClick={onClick}
        className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-all ${active
            ? 'bg-zinc-800 text-white shadow-sm ring-1 ring-zinc-700/50'
            : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/30'
            }`}
    >
        {icon}
        <span>{label}</span>
    </button>
);

const CodeView = () => (
    <div className="h-full flex">
        {/* File Tree */}
        <div className="w-56 border-r border-zinc-800 bg-zinc-950/50 flex flex-col">
            <FileTree />
        </div>

        {/* Editor */}
        <div className="flex-1 bg-zinc-950 flex flex-col overflow-hidden">
            <EditorPanel />
        </div>
    </div>
);






const TerminalView = () => (
    <TerminalPanel />
);
