import React from 'react';
import { Twitter, Disc, Linkedin, User } from 'lucide-react';

export const Navbar: React.FC = () => {
    return (
        <header className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-6 py-4 bg-transparent backdrop-blur-sm">
            <div className="flex items-center gap-8">
                <a href="/" className="text-xl font-bold tracking-tight text-white hover:opacity-80 transition-opacity">
                    bolt.new
                </a>
                <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-zinc-400">
                    <a href="#" className="hover:text-white transition-colors">Community</a>
                    <a href="#" className="hover:text-white transition-colors">Enterprise</a>
                    <a href="#" className="hover:text-white transition-colors">Resources</a>
                    <a href="#" className="hover:text-white transition-colors">Careers</a>
                    <a href="#" className="hover:text-white transition-colors">Pricing</a>
                </nav>
            </div>

            <div className="flex items-center gap-4 text-zinc-400">
                <a href="#" className="hover:text-white transition-colors"><Disc className="w-5 h-5" /></a>
                <a href="#" className="hover:text-white transition-colors"><Linkedin className="w-5 h-5" /></a>
                <a href="#" className="hover:text-white transition-colors"><Twitter className="w-5 h-5" /></a>
                <button className="flex items-center justify-center w-8 h-8 rounded-full bg-zinc-800 hover:bg-zinc-700 text-white transition-colors">
                    <User className="w-4 h-4" />
                </button>
            </div>
        </header>
    );
};
