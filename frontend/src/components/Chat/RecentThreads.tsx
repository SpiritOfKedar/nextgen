import React, { useEffect } from 'react';
import { motion } from 'framer-motion';
import { MessageSquare, Clock, ArrowRight } from 'lucide-react';
import { useAtomValue } from 'jotai';
import { threadsAtom } from '../../store/atoms';
import { useChat } from '../../hooks/useChat';
import { useAuth } from '@clerk/clerk-react';

export const RecentThreads: React.FC = () => {
    const { fetchThreads, loadThread } = useChat();
    const threads = useAtomValue(threadsAtom);
    const { isSignedIn, isLoaded } = useAuth();

    useEffect(() => {
        if (isLoaded && isSignedIn) {
            fetchThreads();
        }
    }, [isLoaded, isSignedIn, fetchThreads]);

    if (!isLoaded || !isSignedIn || threads.length === 0) {
        return null;
    }

    // Show up to 6 most recent threads
    const recentThreads = threads.slice(0, 6);

    const formatDate = (dateStr: string) => {
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

    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.3 }}
            className="w-full max-w-2xl mx-auto mt-10 mb-8"
        >
            <div className="flex items-center gap-2 mb-4 px-1">
                <Clock className="w-4 h-4 text-zinc-500" />
                <h3 className="text-sm font-medium text-zinc-400">Recent Projects</h3>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {recentThreads.map((thread) => (
                    <button
                        key={thread._id}
                        onClick={() => loadThread(thread._id)}
                        className="group flex items-center justify-between gap-3 px-4 py-3 rounded-xl bg-zinc-900/50 border border-zinc-800/50 hover:border-zinc-700 hover:bg-zinc-800/50 transition-all text-left"
                    >
                        <div className="flex items-center gap-3 min-w-0">
                            <MessageSquare className="w-4 h-4 text-zinc-600 group-hover:text-zinc-400 transition-colors shrink-0" />
                            <div className="min-w-0">
                                <p className="text-sm text-zinc-300 group-hover:text-white transition-colors truncate">
                                    {thread.title}
                                </p>
                                <p className="text-xs text-zinc-600 mt-0.5">
                                    {formatDate(thread.updatedAt)}
                                </p>
                            </div>
                        </div>
                        <ArrowRight className="w-3.5 h-3.5 text-zinc-700 group-hover:text-zinc-400 transition-colors shrink-0 opacity-0 group-hover:opacity-100" />
                    </button>
                ))}
            </div>
        </motion.div>
    );
};
