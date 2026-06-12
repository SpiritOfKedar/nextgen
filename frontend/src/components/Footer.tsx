import React from 'react';
import { Twitter, Disc, Linkedin } from 'lucide-react';
import logo from '../assets/nextgen-logo.png';

const COLUMNS: { heading: string; links: string[] }[] = [
    { heading: 'Product', links: ['Chat-to-Build', 'Live Preview', 'Plan & Build', 'Version History'] },
    { heading: 'Platform', links: ['Sandbox', 'Multi-Model AI', 'Figma Import', 'Collaboration'] },
    { heading: 'Resources', links: ['Documentation', 'Changelog', 'Community', 'Support'] },
    { heading: 'Company', links: ['About', 'Careers', 'Legal', 'Privacy'] },
];

export const Footer: React.FC = () => {
    return (
        <footer className="w-full border-t border-zinc-900 bg-zinc-950">
            <div className="max-w-7xl mx-auto px-6 py-16">
                <div className="grid grid-cols-2 md:grid-cols-5 gap-10 mb-14">
                    <div className="col-span-2 md:col-span-1">
                        <img src={logo} alt="NextGen" className="h-8 w-auto mb-4" />
                        <div className="flex items-center gap-4 text-zinc-500">
                            <a href="#" aria-label="Discord" className="hover:text-white transition-colors"><Disc className="w-4 h-4" /></a>
                            <a href="#" aria-label="LinkedIn" className="hover:text-white transition-colors"><Linkedin className="w-4 h-4" /></a>
                            <a href="#" aria-label="Twitter" className="hover:text-white transition-colors"><Twitter className="w-4 h-4" /></a>
                        </div>
                    </div>
                    {COLUMNS.map((col) => (
                        <div key={col.heading}>
                            <h4 className="font-mono text-[10px] tracking-[0.2em] uppercase text-zinc-600 mb-4">{col.heading}</h4>
                            <ul className="space-y-2.5">
                                {col.links.map((link) => (
                                    <li key={link}>
                                        <a href="#" className="text-sm text-zinc-400 hover:text-white transition-colors">{link}</a>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    ))}
                </div>

                <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-8 border-t border-zinc-900">
                    <p className="font-mono text-[10px] tracking-widest text-zinc-600">
                        © {new Date().getFullYear()} NEXTGEN — BUILD WITHOUT CODE
                    </p>
                    <p className="font-mono text-[10px] tracking-widest text-zinc-700">
                        [ ALL SYSTEMS OPERATIONAL ]
                    </p>
                </div>
            </div>
        </footer>
    );
};
