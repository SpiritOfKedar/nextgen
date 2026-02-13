import React, { useEffect } from 'react';
import { Navbar } from './Navbar';
import { Hero } from './Hero';
import { InputArea } from './Chat/InputArea';
import { RecentThreads } from './Chat/RecentThreads';
import { Footer } from './Footer';
import { BackgroundGrid } from './Layout/BackgroundGrid';
import { useSetAtom } from 'jotai';
import { messagesAtom, currentThreadIdAtom } from '../store/atoms';
import { fileSystemAtom, activeFileAtom } from '../store/fileSystem';

export const LandingPage: React.FC = () => {
    const setMessages = useSetAtom(messagesAtom);
    const setCurrentThreadId = useSetAtom(currentThreadIdAtom);
    const setFileSystem = useSetAtom(fileSystemAtom);
    const setActiveFile = useSetAtom(activeFileAtom);

    // Landing page = new conversation. Clear any stale thread state so the
    // next sendMessage creates a fresh thread instead of appending to the old one.
    useEffect(() => {
        setMessages([]);
        setCurrentThreadId(null);
        setFileSystem([]);
        setActiveFile(null);
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
                        <InputArea />
                        <RecentThreads />
                    </div>
                </main>
                <Footer />
            </div>
        </div>
    );
};
