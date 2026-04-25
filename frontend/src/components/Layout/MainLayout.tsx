import React, { useState } from 'react';
import { Panel, Group, Separator } from 'react-resizable-panels';
import { MessageSquare, Wrench } from 'lucide-react';
import { ChatPanel } from '../Chat/ChatPanel';
import { Workbench } from '../Workbench/Workbench';
export const MainLayout: React.FC = () => {
    const [mobileView, setMobileView] = useState<'chat' | 'workbench'>('chat');

    return (
        <div className="h-[100dvh] w-full bg-zinc-950 text-white overflow-hidden font-sans">
            {/* Mobile: avoid cramped split layout by switching panes */}
            <div className="md:hidden flex h-full flex-col">
                <div className="border-b border-zinc-800 p-2 bg-zinc-950">
                    <div className="grid grid-cols-2 gap-2 rounded-lg border border-zinc-800 p-1 bg-zinc-900/70">
                        <button
                            onClick={() => setMobileView('chat')}
                            className={`flex items-center justify-center gap-2 rounded-md px-3 py-2 text-sm transition-colors ${mobileView === 'chat'
                                ? 'bg-zinc-800 text-white'
                                : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/50'
                                }`}
                        >
                            <MessageSquare className="h-4 w-4" />
                            Chat
                        </button>
                        <button
                            onClick={() => setMobileView('workbench')}
                            className={`flex items-center justify-center gap-2 rounded-md px-3 py-2 text-sm transition-colors ${mobileView === 'workbench'
                                ? 'bg-zinc-800 text-white'
                                : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/50'
                                }`}
                        >
                            <Wrench className="h-4 w-4" />
                            Workbench
                        </button>
                    </div>
                </div>
                <div className="min-h-0 flex-1">
                    {mobileView === 'chat' ? <ChatPanel /> : <Workbench />}
                </div>
            </div>

            {/* Desktop: split view with resizable panels */}
            <div className="hidden md:block h-full">
                <Group orientation="horizontal" className="group h-full w-full">
                    <Panel defaultSize="40" minSize="20" maxSize="65" className="flex min-w-0 flex-col">
                        <ChatPanel />
                    </Panel>

                    <Separator className="w-1 cursor-col-resize bg-zinc-800 hover:bg-blue-500 transition-colors" />

                    <Panel defaultSize="60" minSize="35" maxSize="80" className="min-w-0">
                        <Workbench />
                    </Panel>
                </Group>
            </div>
        </div>
    );
};
