import React from 'react';

export const Workbench: React.FC = () => {
    return (
        <div className="flex h-screen w-full bg-zinc-950 text-white overflow-hidden">
            {/* Left Pane: Chat/Terminal */}
            <div className="w-1/2 border-r border-zinc-800 p-4">
                <h2 className="text-xl font-bold">Workbench Chat</h2>
                <div className="mt-4 p-4 bg-zinc-900 rounded-lg">
                    Chat Interface Placeholder
                </div>
            </div>

            {/* Right Pane: Preview */}
            <div className="w-1/2 p-4 bg-zinc-900">
                <div className="h-full w-full bg-zinc-950 rounded-lg border border-zinc-800 flex items-center justify-center">
                    <span className="text-zinc-500">Preview Area</span>
                </div>
            </div>
        </div>
    );
};
