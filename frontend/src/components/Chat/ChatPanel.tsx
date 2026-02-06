import React, { useState } from 'react';
import { InputArea } from './InputArea';
import { MessageList } from './MessageList';
import { ThreadList } from './ThreadList';
import { PanelLeft, Plus } from 'lucide-react';
import logo from '../../assets/nextgen-logo.png';

export const ChatPanel: React.FC = () => {
    const [isThreadListOpen, setIsThreadListOpen] = useState(false);

    return (
        <div className="flex h-full bg-zinc-950 border-r border-zinc-800 overflow-hidden relative">
            {/* Thread List Sidebar */}
            <ThreadList
                isOpen={isThreadListOpen}
                onClose={() => setIsThreadListOpen(false)}
            />

            {/* Main Chat Area */}
            <div className="flex-1 flex flex-col h-full min-w-0 bg-zinc-950">
                {/* Header */}
                <div className="p-4 border-b border-zinc-800 flex justify-between items-center bg-zinc-950/50 backdrop-blur-sm z-10">
                    <div className="flex items-center gap-3">
                        <button
                            onClick={() => setIsThreadListOpen(!isThreadListOpen)}
                            className="p-2 hover:bg-zinc-800 rounded-lg text-zinc-400 hover:text-white transition-colors"
                            title={isThreadListOpen ? "Close history" : "Open history"}
                        >
                            <PanelLeft className="w-5 h-5" />
                        </button>
                        <img src={logo} alt="NextGen" className="h-6 w-auto" />
                    </div>

                    <button className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-zinc-400 hover:text-white hover:bg-zinc-800 rounded-lg transition-all">
                        <Plus className="w-4 h-4" />
                        <span className="hidden sm:inline">New Chat</span>
                    </button>
                </div>

                {/* Messages */}
                <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
                    <MessageList />
                </div>

                {/* Input Area */}
                <div className="p-4 bg-zinc-950">
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
