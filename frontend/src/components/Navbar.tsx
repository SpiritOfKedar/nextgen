import React from 'react';
import { Twitter, Disc, Linkedin } from 'lucide-react';
import { SignInButton, SignedIn, SignedOut, UserButton } from '@clerk/clerk-react'
import logo from '../assets/nextgen-logo.png';

export const Navbar: React.FC = () => {
    return (
        <header className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-6 py-3.5 bg-zinc-950/80 backdrop-blur-md border-b border-zinc-900">
            <div className="flex items-center gap-8">
                <a href="/" className="block hover:opacity-80 transition-opacity">
                    <img src={logo} alt="NextGen" className="h-8 w-auto" />
                </a>
                <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-zinc-400">
                    <a href="#features" className="hover:text-white transition-colors">Product</a>
                    <a href="#sandbox" className="hover:text-white transition-colors">Sandbox</a>
                    <a href="#workflow" className="hover:text-white transition-colors">Workflow</a>
                    <a href="#platform" className="hover:text-white transition-colors">Platform</a>
                </nav>
            </div>

            <div className="flex items-center gap-4 text-zinc-400">
                <a href="#" aria-label="Discord" className="hidden sm:block hover:text-white transition-colors"><Disc className="w-4.5 h-4.5" /></a>
                <a href="#" aria-label="LinkedIn" className="hidden sm:block hover:text-white transition-colors"><Linkedin className="w-4.5 h-4.5" /></a>
                <a href="#" aria-label="Twitter" className="hidden sm:block hover:text-white transition-colors"><Twitter className="w-4.5 h-4.5" /></a>
                <SignedIn>
                    <UserButton />
                </SignedIn>
                <SignedOut>
                    <SignInButton mode="modal">
                        <button className="px-4 py-1.5 text-sm font-medium text-zinc-300 border border-zinc-700 rounded-full hover:border-zinc-500 hover:text-white transition-colors">
                            Log in
                        </button>
                    </SignInButton>
                    <SignInButton mode="modal">
                        <button className="px-4 py-1.5 text-sm font-semibold text-zinc-950 bg-white rounded-full hover:bg-zinc-200 transition-colors">
                            Get started
                        </button>
                    </SignInButton>
                </SignedOut>
            </div>
        </header>
    );
};
