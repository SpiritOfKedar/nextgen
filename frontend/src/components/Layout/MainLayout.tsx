import React from 'react';
import { Panel, Group, Separator } from 'react-resizable-panels';
import { ChatPanel } from '../Chat/ChatPanel';
import { Workbench } from '../Workbench/Workbench';
// import { useAtomValue } from 'jotai';
// import { isWorkbenchActiveAtom } from '../../store/atoms';

export const MainLayout: React.FC = () => {
    // const isWorkbenchActive = useAtomValue(isWorkbenchActiveAtom);

    return (
        <div className="h-screen w-full bg-zinc-950 text-white overflow-hidden font-sans">
            <Group className="group h-full w-full">
                {/* Left Panel: Chat/Plan */}
                <Panel defaultSize={50} minSize={20} className="flex flex-col">
                    <ChatPanel />
                </Panel>

                {/* Resizer Handle */}
                <Separator className="w-1 bg-zinc-800 hover:bg-blue-500 transition-colors" />

                {/* Right Panel: Workbench (Conditional or Panel) */}
                <Panel minSize={20}>
                    <Workbench />
                </Panel>
            </Group>
        </div>
    );
};
