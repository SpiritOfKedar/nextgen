import React, { useState, useRef, useEffect } from 'react';
import { InputArea } from './InputArea';
import { MessageList } from './MessageList';
import { ThreadList } from './ThreadList';
import { PanelLeft, Plus } from 'lucide-react';
import logo from '../../assets/nextgen-logo.png';
import { UserButton, useAuth } from '@clerk/clerk-react';
import { useSetAtom, useAtom, useAtomValue } from 'jotai';
import { messagesAtom, currentThreadIdAtom } from '../../store/atoms';
import { useNavigate } from 'react-router-dom';
import { fileSystemAtom, activeFileAtom } from '../../store/fileSystem';
import { webContainerAtom, serverUrlAtom } from '../../store/webContainer';
import { useChat } from '../../hooks/useChat';

export const ChatPanel: React.FC = () => {
    const [isThreadListOpen, setIsThreadListOpen] = useState(false);
    const navigate = useNavigate();
    const [messages, setMessages] = useAtom(messagesAtom);
    const [currentThreadId, setCurrentThreadId] = useAtom(currentThreadIdAtom);
    const setFileSystem = useSetAtom(fileSystemAtom);
    const setActiveFile = useSetAtom(activeFileAtom);
    const setServerUrl = useSetAtom(serverUrlAtom);
    const webContainer = useAtomValue(webContainerAtom);

    const { fetchThreads, loadThread } = useChat();
    const { isLoaded, isSignedIn } = useAuth();
    const hasRestoredSession = useRef(false);

    // Pre-fetch thread list as soon as auth is ready
    useEffect(() => {
        if (isLoaded && isSignedIn) {
            fetchThreads();
        }
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
        loadThread(currentThreadId);
    }, [isLoaded, isSignedIn, webContainer, currentThreadId, loadThread, messages.length]);

    const handleNewChat = () => {
        setMessages([]);
        setCurrentThreadId(null);
        setFileSystem([]);
        setActiveFile(null);
        setServerUrl(null);
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
                            className="p-2 hover:bg-zinc-800 rounded-lg text-zinc-400 hover:text-white transition-colors"
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
                            className="p-2 text-zinc-400 hover:text-white hover:bg-zinc-800 rounded-lg transition-all"
                            title="New Chat"
                        >
                            <Plus className="w-5 h-5" />
                        </button>
                        <UserButton afterSignOutUrl="/" />
                    </div>
                </div>

                {/* Messages */}
                <div className="flex-1 overflow-y-auto p-4 pb-48 custom-scrollbar">
                    <MessageList />
                </div>

                {/* Input Area */}
                <div className="sticky bottom-0 left-0 w-full px-4 pb-6 pt-10 bg-linear-to-t from-zinc-950 via-zinc-950/95 to-transparent z-20">
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
