import React from 'react';

export const Footer: React.FC = () => {
    return (
        <footer className="w-full mt-auto py-8 text-center text-sm text-zinc-600">
            <div className="flex items-center justify-center gap-6 mb-4">
                <a href="#" className="hover:text-zinc-400 transition-colors">Resources</a>
                <a href="#" className="hover:text-zinc-400 transition-colors">Company</a>
                <a href="#" className="hover:text-zinc-400 transition-colors">Legal</a>
            </div>
            <p>&copy; 2024 Bolt.new Clone. Open source.</p>
        </footer>
    );
};
