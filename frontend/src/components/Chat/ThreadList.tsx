import React, { useEffect, useState, useCallback } from 'react';
import { MessageSquare, Clock, ArrowLeft, Loader2, RefreshCw } from 'lucide-react';
import { motion } from 'framer-motion';
import { useAtomValue } from 'jotai';
import { threadsAtom, currentThreadIdAtom } from '../../store/atoms';
import { useChat } from '../../hooks/useChat';

interface ThreadListProps {
    isOpen: boolean;
    onClose: () => void;
}

const formatRelativeDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
};

export const ThreadList: React.FC<ThreadListProps> = ({ isOpen, onClose }) => {
    const { fetchThreads, loadThread } = useChat();
    const threads = useAtomValue(threadsAtom);
    const currentThreadId = useAtomValue(currentThreadIdAtom);
    const [isLoading, setIsLoading] = useState(false);
    const [hasError, setHasError] = useState(false);

    const doFetch = useCallback(async () => {
        setIsLoading(true);
        setHasError(false);
        try {
            await fetchThreads();
        } catch {
            setHasError(true);
        } finally {
            setIsLoading(false);
        }
    }, [fetchThreads]);

    useEffect(() => {
        if (isOpen) {
            doFetch();
        }
    }, [isOpen, doFetch]);

    return (
        <motion.div
            initial={{ x: -260, opacity: 0 }}
            animate={{ x: isOpen ? 0 : -260, opacity: isOpen ? 1 : 0 }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
            className={`fixed inset-y-0 left-0 z-50 w-64 bg-zinc-950 border-r border-zinc-800 transform ${isOpen ? 'translate-x-0' : '-translate-x-full'
                } md:relative md:translate-x-0 md:w-64 flex flex-col`}
            style={{ display: isOpen ? 'flex' : 'none' }}
        >

            <div className="p-4 border-b border-zinc-800 flex justify-between items-center">
                <h2 className="text-sm font-semibold text-zinc-200 flex items-center gap-2">
                    <Clock className="w-4 h-4" /> History
                </h2>
                <div className="flex items-center gap-1">
                    <button
                        onClick={doFetch}
                        className="p-1 hover:bg-zinc-800 rounded-md text-zinc-400 hover:text-white transition-colors"
                        title="Refresh"
                    >
                        <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
                    </button>
                    <button
                        onClick={onClose}
                        className="p-1 hover:bg-zinc-800 rounded-md text-zinc-400 hover:text-white transition-colors"
                    >
                        <ArrowLeft className="w-4 h-4" />
                    </button>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto p-2 space-y-1 custom-scrollbar">
                {isLoading && threads.length === 0 ? (
                    <div className="flex items-center justify-center gap-2 text-zinc-500 text-sm mt-8">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>Loading history...</span>
                    </div>
                ) : hasError ? (
                    <div className="text-center mt-8 px-4">
                        <p className="text-zinc-500 text-sm">Failed to load history</p>
                        <button
                            onClick={doFetch}
                            className="mt-2 text-xs text-blue-400 hover:text-blue-300 transition-colors"
                        >
                            Try again
                        </button>
                    </div>
                ) : threads.length === 0 ? (
                    <div className="text-center text-zinc-500 text-sm mt-8">No conversations yet</div>
                ) : (
                    threads.map((thread) => (
                        <button
                            key={thread._id}
                            onClick={() => {
                                loadThread(thread._id);
                                onClose();
                            }}
                            className={`w-full text-left p-3 rounded-lg text-sm transition-all group ${currentThreadId === thread._id
                                ? 'bg-zinc-800/50 text-white border border-zinc-700/50'
                                : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200 border border-transparent'
                                }`}
                        >
                            <div className="font-medium truncate">{thread.title}</div>
                            <div className="text-xs text-zinc-500 mt-1 flex items-center gap-1">
                                <MessageSquare className="w-3 h-3" />
                                {formatRelativeDate(thread.updatedAt)}
                            </div>
                        </button>
                    ))
                )}
            </div>
        </motion.div>
    );
};
