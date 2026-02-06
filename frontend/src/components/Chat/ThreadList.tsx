import React from 'react';
import { MessageSquare, Clock, ArrowLeft } from 'lucide-react';
import { motion } from 'framer-motion';

interface Thread {
    id: string;
    title: string;
    date: string;
    active?: boolean;
}

const MOCK_THREADS: Thread[] = [
    { id: '1', title: 'To-do List App Implementation', date: 'Just now', active: true },
    { id: '2', title: 'React Performance Optimization', date: '2 hours ago' },
    { id: '3', title: 'Database Schema Design', date: 'Yesterday' },
    { id: '4', title: 'Authentication Flow Setup', date: '2 days ago' },
    { id: '5', title: 'Landing Page UI Fixes', date: '3 days ago' },
];

interface ThreadListProps {
    isOpen: boolean;
    onClose: () => void;
}

export const ThreadList: React.FC<ThreadListProps> = ({ isOpen, onClose }) => {
    return (
        <motion.div
            initial={{ x: -300, opacity: 0 }}
            animate={{ x: isOpen ? 0 : -300, opacity: isOpen ? 1 : 0 }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
            className={`fixed inset-y-0 left-0 z-50 w-64 bg-zinc-950 border-r border-zinc-800 transform ${isOpen ? 'translate-x-0' : '-translate-x-full'
                } md:relative md:translate-x-0 md:w-64 flex flex-col`}
            style={{ display: isOpen ? 'flex' : 'none' }} // Ensure it doesn't take space when "closed" unless we want a persistent sidebar
        >
            {/* We might want a different strategy for "closing" in desktop view if it's meant to be collapsible. 
            For now, let's treat "isOpen" as "show this panel". 
        */}
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
                {MOCK_THREADS.map((thread) => (
                    <button
                        key={thread.id}
                        className={`w-full text-left p-3 rounded-lg text-sm transition-all group ${thread.active
                                ? 'bg-zinc-800/50 text-white border border-zinc-700/50'
                                : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200 border border-transparent'
                            }`}
                    >
                        <div className="font-medium truncate">{thread.title}</div>
                        <div className="text-xs text-zinc-500 mt-1 flex items-center gap-1">
                            <MessageSquare className="w-3 h-3" />
                            {thread.date}
                        </div>
                    </button>
                ))}
            </div>
        </motion.div>
    );
};
