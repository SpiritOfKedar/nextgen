
import React, { useEffect, useRef } from 'react';
import { FileCode, Terminal as TerminalIcon } from 'lucide-react';
import { useAtomValue } from 'jotai';
import { messagesAtom } from '../../store/atoms';

export const MessageList: React.FC = () => {
    const messages = useAtomValue(messagesAtom);
    const bottomRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (bottomRef.current) {
            bottomRef.current.scrollIntoView({ behavior: 'smooth' });
        }
    }, [messages]);

    if (messages.length === 0) {
        return (
            <div className="flex items-center justify-center h-full text-zinc-500 text-sm">
                Send a message to start building
            </div>
        );
    }

    return (
        <div className="space-y-4">
            {messages.map((msg) => (
                <div
                    key={msg.id}
                    className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                    <div
                        className={`max-w-[85%] rounded-xl text-sm leading-relaxed ${
                            msg.role === 'user'
                                ? 'bg-blue-600 text-white rounded-br-none p-3'
                                : 'text-zinc-300'
                        }`}
                    >
                        {msg.role === 'assistant' ? (
                            <AssistantMessage content={msg.content} />
                        ) : (
                            msg.content
                        )}
                    </div>
                </div>
            ))}
            <div ref={bottomRef} />
        </div>
    );
};

// Renders assistant messages with file/shell action indicators
const AssistantMessage: React.FC<{ content: string }> = ({ content }) => {
    if (!content) {
        return (
            <div className="flex items-center gap-2 text-zinc-500">
                <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-zinc-400" />
                <span className="text-xs">Generating...</span>
            </div>
        );
    }

    // Split content into lines and render
    const lines = content.split('\n').filter(l => l.trim());

    return (
        <div className="space-y-2">
            {lines.map((line, i) => {
                // Detect file creation lines like "- Creating src/App.tsx"
                const fileMatch = line.match(/(?:creating|writing|updating|adding)\s+[`']?([\w/.\-]+\.[\w]+)[`']?/i);
                const shellMatch = line.match(/(?:installing|running|executing)\s+/i);

                if (fileMatch) {
                    return (
                        <div key={i} className="flex items-center gap-2 px-3 py-1.5 bg-zinc-800/50 rounded-lg border border-zinc-700/50">
                            <FileCode className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                            <span className="text-xs text-zinc-300">{line.replace(/^[-•*]\s*/, '')}</span>
                        </div>
                    );
                }
                if (shellMatch) {
                    return (
                        <div key={i} className="flex items-center gap-2 px-3 py-1.5 bg-zinc-800/50 rounded-lg border border-zinc-700/50">
                            <TerminalIcon className="w-3.5 h-3.5 text-green-400 shrink-0" />
                            <span className="text-xs text-zinc-300">{line.replace(/^[-•*]\s*/, '')}</span>
                        </div>
                    );
                }

                return <p key={i} className="text-zinc-300 text-sm leading-relaxed">{line}</p>;
            })}
        </div>
    );
};
