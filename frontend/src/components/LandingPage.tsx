import React from 'react';
import { Navbar } from './Navbar';
import { Hero } from './Hero';
import { InputArea } from './Chat/InputArea';
import { Footer } from './Footer';

export const LandingPage: React.FC = () => {
    return (
        <div className="min-h-screen bg-zinc-950 text-white selection:bg-cyan-500/30 font-sans">
            <Navbar />

            <main className="flex flex-col items-center justify-center min-h-[calc(100vh-80px)] pt-24 px-4 relative overflow-hidden">
                <div className="z-10 w-full flex flex-col items-center gap-8">
                    <Hero />
                    <InputArea />
                </div>
                <Footer />

                {/* Background Grid/Glow Elements could go here if needed later */}
            </main>
        </div>
    );
};
