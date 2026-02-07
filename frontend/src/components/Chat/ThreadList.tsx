import React, { useEffect } from 'react';
import { MessageSquare, Clock, ArrowLeft } from 'lucide-react';
import { motion } from 'framer-motion';
import { useAtomValue } from 'jotai';
import { threadsAtom, currentThreadIdAtom } from '../../store/atoms';
import { useChat } from '../../hooks/useChat';

interface ThreadListProps {
    isOpen: boolean;
    onClose: () => void;
}

export const ThreadList: React.FC<ThreadListProps> = ({ isOpen, onClose }) => {
    const { fetchThreads, loadThread } = useChat();
    const threads = useAtomValue(threadsAtom);
    const currentThreadId = useAtomValue(currentThreadIdAtom);

    useEffect(() => {
        if (isOpen) {
            fetchThreads();
        }
    }, [isOpen, fetchThreads]);

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
                <button
                    onClick={onClose}
                    className="p-1 hover:bg-zinc-800 rounded-md text-zinc-400 hover:text-white transition-colors"
                >
                    <ArrowLeft className="w-4 h-4" />
                </button>
            </div>

            <div className="flex-1 overflow-y-auto p-2 space-y-1 custom-scrollbar">
                {threads.length === 0 ? (
                    <div className="text-center text-zinc-500 text-sm mt-4">No history yet</div>
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
                                {new Date(thread.updatedAt).toLocaleDateString()}
                            </div>
                        </button>
                    ))
                )}
            </div>
        </motion.div>
    );
};
