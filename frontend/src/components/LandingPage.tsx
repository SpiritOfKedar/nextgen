import React from 'react';
import { Navbar } from './Navbar';
import { Hero } from './Hero';
import { InputArea } from './Chat/InputArea';
import { Footer } from './Footer';
import { BackgroundGrid } from './Layout/BackgroundGrid';

export const LandingPage: React.FC = () => {
    return (
        <div className="min-h-screen bg-zinc-950 text-white selection:bg-cyan-500/30 font-sans relative">
            <BackgroundGrid />
            <div className="relative z-10">
                <Navbar />

                <main className="flex flex-col items-center justify-center min-h-[calc(100vh-80px)] pt-24 px-4 relative overflow-hidden">
                    <div className="z-10 w-full flex flex-col items-center gap-8">
                        <Hero />
                        <InputArea />
                    </div>
                    <Footer />
                </main>
            </div>
        </div>
    );
};
