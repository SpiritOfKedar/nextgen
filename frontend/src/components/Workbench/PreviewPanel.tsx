import React, { useRef } from 'react';
import { useAtomValue } from 'jotai';
import { serverUrlAtom } from '../../store/webContainer';

export const PreviewPanel: React.FC = () => {
    const url = useAtomValue(serverUrlAtom);
    const iframeRef = useRef<HTMLIFrameElement>(null);

    // No need for local effect anymore, as it's handled globally in the hook

    if (!url) {
        return (
            <div className="h-full w-full bg-zinc-950 flex flex-col items-center justify-center text-zinc-400">
                <p className="mb-2">Waiting for server...</p>
                <p className="text-xs text-zinc-600">Run 'npm run dev' in terminal</p>
            </div>
        );
    }

    return (
        <div className="h-full w-full bg-white flex flex-col">
            <div className="h-8 bg-zinc-100 border-b border-zinc-200 flex items-center px-4 overflow-hidden">
                <span className="text-xs text-zinc-500 truncate">{url}</span>
            </div>
            <iframe
                ref={iframeRef}
                src={url}
                className="flex-1 w-full border-0"
                title="Preview"
                allow="clipboard-read; clipboard-write; cross-origin-isolated"
            />
        </div>
    );
};
