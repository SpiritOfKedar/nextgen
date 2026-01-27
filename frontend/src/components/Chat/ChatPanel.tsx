
import React from 'react';
import { InputArea } from './InputArea';
import { MessageList } from './MessageList';

export const ChatPanel: React.FC = () => {
    return (
        <div className="flex flex-col h-full bg-zinc-950 border-r border-zinc-800">
            {/* Header */}
            <div className="p-4 border-b border-zinc-800 flex justify-between items-center">
                <h2 className="text-xl font-bold">bolt</h2>
                <button className="text-zinc-400 hover:text-white">...</button>
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
    );
};
