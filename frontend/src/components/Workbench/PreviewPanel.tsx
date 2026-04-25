import React, { useRef, useState } from 'react';
import { useAtomValue } from 'jotai';
import { previewStatusAtom, previewStatusMessageAtom, serverUrlAtom } from '../../store/webContainer';
import { RefreshCw } from 'lucide-react';

export const PreviewPanel: React.FC = () => {
    const url = useAtomValue(serverUrlAtom);
    const previewStatus = useAtomValue(previewStatusAtom);
    const previewStatusMessage = useAtomValue(previewStatusMessageAtom);
    const iframeRef = useRef<HTMLIFrameElement>(null);
    const [refreshNonce, setRefreshNonce] = useState(0);

    const handleRefresh = () => {
        setRefreshNonce((k) => k + 1);
    };

    if (!url) {
        return (
            <div className="h-full w-full bg-zinc-950 flex flex-col items-center justify-center text-zinc-400">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-zinc-500 mb-3"></div>
                <p className="mb-2">
                    {previewStatus === 'booting' ? 'Booting WebContainer...'
                        : previewStatus === 'error' ? 'Preview failed to start'
                            : 'Waiting for dev server...'}
                </p>
                <p className="text-xs text-zinc-600 text-center max-w-sm px-4">
                    {previewStatusMessage || 'The preview will appear once `npm run dev` starts.'}
                </p>
            </div>
        );
    }

    return (
        <div className="h-full w-full bg-white flex flex-col">
            <div className="h-8 bg-zinc-100 border-b border-zinc-200 flex items-center px-4 gap-2 overflow-hidden">
                <button
                    onClick={handleRefresh}
                    className="p-0.5 rounded hover:bg-zinc-200 transition-colors"
                    title="Refresh preview"
                >
                    <RefreshCw className="w-3.5 h-3.5 text-zinc-500" />
                </button>
                <span className="text-xs text-zinc-500 truncate flex-1">{url}</span>
            </div>
            <iframe
                key={`${url}-${refreshNonce}`}
                ref={iframeRef}
                src={url}
                className="flex-1 w-full border-0"
                title="Preview"
                allow="clipboard-read; clipboard-write; cross-origin-isolated"
            />
        </div>
    );
};
