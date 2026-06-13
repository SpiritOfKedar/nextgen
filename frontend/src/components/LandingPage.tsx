import React, { useEffect, useRef } from 'react';
import { Navbar } from './Navbar';
import { Hero } from './Hero';
import { InputArea } from './Chat/InputArea';
import { Footer } from './Footer';
import { BackgroundGrid } from './Layout/BackgroundGrid';
import { FeatureStrip } from './Landing/FeatureStrip';
import { StatusTicker } from './Landing/StatusTicker';
import { StatementSections } from './Landing/StatementSections';
import { AgentSection } from './Landing/AgentSection';
import { useSetAtom } from 'jotai';
import { messagesAtom, currentThreadIdAtom, threadSwitchStateAtom } from '../store/atoms';
import { fileSystemAtom, clearEditorTabsAtom } from '../store/fileSystem';
import { previewStatusAtom, previewStatusMessageAtom, serverUrlAtom } from '../store/webContainer';

export const LandingPage: React.FC = () => {
    const setMessages = useSetAtom(messagesAtom);
    const setCurrentThreadId = useSetAtom(currentThreadIdAtom);
    const setFileSystem = useSetAtom(fileSystemAtom);
    const clearEditorTabs = useSetAtom(clearEditorTabsAtom);
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
        clearEditorTabs();
        setServerUrl(null);
        setPreviewStatus('idle');
        setPreviewStatusMessage('Start a new prompt to generate and run a project.');
        setThreadSwitchState({ status: 'idle', targetThreadId: null, errorMessage: null });
        localStorage.removeItem('currentThreadId');
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    return (
        <div className="min-h-screen bg-zinc-950 text-white selection:bg-neon/30 font-sans relative">
            <Navbar />

            {/* Hero zone with grid background */}
            <div className="relative overflow-hidden pb-8">
                <BackgroundGrid />
                <main className="relative z-10 flex flex-col items-center justify-center pt-20 px-4 pb-6">
                    <div className="w-full flex flex-col items-center gap-6">
                        <Hero />
                        <div className="relative z-10 w-full flex justify-center">
                            <InputArea variant="mac" />
                        </div>
                    </div>
                </main>

                <div className="relative z-10">
                    <FeatureStrip />
                </div>
            </div>

            {/* Marketing sections — solid black, Neon-style */}
            <StatusTicker />
            <StatementSections />
            <StatusTicker />
            <AgentSection />
            <Footer />
        </div>
    );
};
