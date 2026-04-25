import React, { useEffect, useRef } from 'react';
import { Navbar } from './Navbar';
import { Hero } from './Hero';
import { InputArea } from './Chat/InputArea';
import { RecentThreads } from './Chat/RecentThreads';
import { Footer } from './Footer';
import { BackgroundGrid } from './Layout/BackgroundGrid';
import { useSetAtom } from 'jotai';
import { messagesAtom, currentThreadIdAtom, threadSwitchStateAtom } from '../store/atoms';
import { fileSystemAtom, activeFileAtom } from '../store/fileSystem';
import { previewStatusAtom, previewStatusMessageAtom, serverUrlAtom } from '../store/webContainer';

export const LandingPage: React.FC = () => {
    const setMessages = useSetAtom(messagesAtom);
    const setCurrentThreadId = useSetAtom(currentThreadIdAtom);
    const setFileSystem = useSetAtom(fileSystemAtom);
    const setActiveFile = useSetAtom(activeFileAtom);
    const setServerUrl = useSetAtom(serverUrlAtom);
    const setPreviewStatus = useSetAtom(previewStatusAtom);
    const setPreviewStatusMessage = useSetAtom(previewStatusMessageAtom);
    const setThreadSwitchState = useSetAtom(threadSwitchStateAtom);
    const didClear = useRef(false);

    // Landing page = new conversation. Clear stale thread state ONCE so the
    // next sendMessage creates a fresh thread. The ref prevents re-clearing
    // if a loadThread navigates away and React re-runs the effect.
    useEffect(() => {
        if (didClear.current) return;
        didClear.current = true;
        setMessages([]);
        setCurrentThreadId(null);
        setFileSystem([]);
        setActiveFile(null);
        setServerUrl(null);
        setPreviewStatus('idle');
        setPreviewStatusMessage('Start a new prompt to generate and run a project.');
        setThreadSwitchState({ status: 'idle', targetThreadId: null, errorMessage: null });
        localStorage.removeItem('currentThreadId');
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    return (
        <div className="min-h-screen bg-zinc-950 text-white selection:bg-cyan-500/30 font-sans relative overflow-y-auto">
            <BackgroundGrid />
            <div className="relative z-10">
                <Navbar />

                <main className="flex flex-col items-center justify-center pt-24 px-4 relative">
                    <div className="z-10 w-full flex flex-col items-center gap-8">
                        <Hero />
                        <div className="relative z-10 w-full flex justify-center">
                            <InputArea />
                        </div>
                        <RecentThreads />
                    </div>
                </main>
                <Footer />
            </div>
        </div>
    );
};
