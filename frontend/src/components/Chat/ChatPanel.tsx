import React, { useState, useRef, useEffect } from 'react';
import { InputArea } from './InputArea';
import { MessageList } from './MessageList';
import { ThreadList } from './ThreadList';
import { PanelLeft, Plus } from 'lucide-react';
import logo from '../../assets/nextgen-logo.png';
import { UserButton, useAuth } from '@clerk/clerk-react';
import { useSetAtom, useAtom, useAtomValue } from 'jotai';
import { messagesAtom, currentThreadIdAtom, threadSwitchStateAtom } from '../../store/atoms';
import { useNavigate } from 'react-router-dom';
import { fileSystemAtom, activeFileAtom } from '../../store/fileSystem';
import { previewStatusAtom, previewStatusMessageAtom, webContainerAtom, serverUrlAtom } from '../../store/webContainer';
import { useChat } from '../../hooks/useChat';

export const ChatPanel: React.FC = () => {
    const [isThreadListOpen, setIsThreadListOpen] = useState(false);
    const navigate = useNavigate();
    const [messages, setMessages] = useAtom(messagesAtom);
    const [currentThreadId, setCurrentThreadId] = useAtom(currentThreadIdAtom);
    const setFileSystem = useSetAtom(fileSystemAtom);
    const setActiveFile = useSetAtom(activeFileAtom);
    const setServerUrl = useSetAtom(serverUrlAtom);
    const setPreviewStatus = useSetAtom(previewStatusAtom);
    const setPreviewStatusMessage = useSetAtom(previewStatusMessageAtom);
    const setThreadSwitchState = useSetAtom(threadSwitchStateAtom);
    const webContainer = useAtomValue(webContainerAtom);

    const { fetchThreads, loadThread } = useChat();
    const { isLoaded, isSignedIn } = useAuth();
    const hasRestoredSession = useRef(false);
    const hasPrefetchedThreads = useRef(false);

    // Pre-fetch thread list as soon as auth is ready
    useEffect(() => {
        if (!isLoaded || !isSignedIn || hasPrefetchedThreads.current) return;
        hasPrefetchedThreads.current = true;
        fetchThreads();
    }, [isLoaded, isSignedIn, fetchThreads]);

    // Auto-restore saved thread — wait for BOTH auth AND WebContainer to be ready
    // so that loadThread can write files and spawn install/dev processes.
    // hasRestoredSession is set SYNCHRONOUSLY before the async call so
    // React re-renders (from loadThread changing atoms mid-flight) cannot
    // trigger the effect a second time.
    useEffect(() => {
        if (
            hasRestoredSession.current ||
            !isLoaded ||
            !isSignedIn ||
            !webContainer ||
            !currentThreadId ||
            messages.length !== 0
        ) return;

        hasRestoredSession.current = true;   // ← set immediately, before async work
        loadThread(currentThreadId).catch((err) =>
            console.error('[ChatPanel] Failed to restore thread:', currentThreadId, err),
        );
    }, [isLoaded, isSignedIn, webContainer, currentThreadId, loadThread, messages.length]);

    const handleNewChat = () => {
        setMessages([]);
        setCurrentThreadId(null);
        setFileSystem([]);
        setActiveFile(null);
        setServerUrl(null);
        setPreviewStatus('idle');
        setPreviewStatusMessage('Start a new prompt to generate and run a project.');
        setThreadSwitchState({ status: 'idle', targetThreadId: null, errorMessage: null });
        localStorage.removeItem('currentThreadId');
        hasRestoredSession.current = true; // prevent re-restore after manual clear
    };

    return (
        <div className="flex h-full bg-zinc-950 border-r border-zinc-800 overflow-hidden relative">
            {/* Thread List Sidebar */}
            <ThreadList
                isOpen={isThreadListOpen}
                onClose={() => setIsThreadListOpen(false)}
            />

            {/* Main Chat Area */}
            <div className="flex-1 flex flex-col h-full min-w-0 bg-zinc-950 relative">
                {/* Header */}
                <div className="p-4 border-b border-zinc-800 flex justify-between items-center bg-zinc-950 z-20 sticky top-0">
                    <div className="flex items-center gap-3">
                        <button
                            onClick={() => setIsThreadListOpen(!isThreadListOpen)}
                            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-900/70 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/90 transition-colors"
                            title={isThreadListOpen ? "Close history" : "Open history"}
                        >
                            <PanelLeft className="w-5 h-5" />
                        </button>
                        <button
                            onClick={() => navigate('/')}
                            className="hover:opacity-80 transition-opacity"
                        >
                            <img src={logo} alt="NextGen" className="h-6 w-auto" />
                        </button>
                    </div>

                    <div className="flex items-center gap-2">
                        <button
                            onClick={handleNewChat}
                            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-900/70 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/90 transition-colors"
                            title="New Chat"
                        >
                            <Plus className="w-5 h-5" />
                        </button>
                        <UserButton afterSignOutUrl="/" />
                    </div>
                </div>

                {/* Messages */}
                <div className="flex-1 overflow-y-auto px-4 pt-4 pb-8 md:pb-10 custom-scrollbar">
                    <MessageList />
                </div>

                {/* Input Area */}
                <div className="sticky bottom-0 left-0 w-full px-4 pb-3 pt-2 bg-linear-to-t from-zinc-950 via-zinc-950/96 to-transparent z-20">
                    <InputArea />
                </div>
            </div>

            {/* Overlay for mobile when sidebar is open */}
            {isThreadListOpen && (
                <div
                    className="fixed inset-0 bg-black/50 z-40 md:hidden"
                    onClick={() => setIsThreadListOpen(false)}
                />
            )}
        </div>
    );
};
