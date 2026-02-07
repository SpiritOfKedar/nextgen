import React from 'react';
import { Panel, Group, Separator } from 'react-resizable-panels';
import { ChatPanel } from '../Chat/ChatPanel';
import { Workbench } from '../Workbench/Workbench';
export const MainLayout: React.FC = () => {

    return (
        <div className="h-screen w-full bg-zinc-950 text-white overflow-hidden font-sans">
            <Group orientation="horizontal" className="group h-full w-full">
                {/* Left Panel: Chat/Plan */}
                <Panel defaultSize="30" minSize="10" maxSize="80" className="flex flex-col">
                    <ChatPanel />
                </Panel>

                {/* Resizer Handle */}
                <Separator className="w-1 bg-zinc-800 hover:bg-blue-500 transition-colors" />

                {/* Right Panel: Workbench (Conditional or Panel) */}
                <Panel defaultSize="70" minSize="20">
                    <Workbench />
                </Panel>
            </Group>
        </div>
    );
};
