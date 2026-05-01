import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Figma, X, Loader2, CheckCircle2, ExternalLink, Link2, AlertCircle } from 'lucide-react';
import { useAuth } from '@clerk/clerk-react';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';

interface FigmaStatus {
    enabled: boolean;
    endpoint: string;
    authConfigured: boolean;
    userConnected: boolean;
}

interface FigmaPanelProps {
    anchorRef: React.RefObject<HTMLButtonElement | null>;
    isOpen: boolean;
    onClose: () => void;
    figmaLinks: { url: string }[];
    onAddLink: (url: string) => void;
    onRemoveLink: (url: string) => void;
    manualFigmaLinks: string[];
}

export const FigmaPanel: React.FC<FigmaPanelProps> = ({
    anchorRef,
    isOpen,
    onClose,
    figmaLinks,
    onAddLink,
    onRemoveLink,
    manualFigmaLinks,
}) => {
    const { getToken } = useAuth();
    const [status, setStatus] = useState<FigmaStatus | null>(null);
    const [loading, setLoading] = useState(false);
    const [connecting, setConnecting] = useState(false);
    const [tokenInput, setTokenInput] = useState('');
    const [linkInput, setLinkInput] = useState('');
    const [error, setError] = useState('');
    const [showTokenInput, setShowTokenInput] = useState(false);
    const panelRef = useRef<HTMLDivElement>(null);
    const tokenInputRef = useRef<HTMLInputElement>(null);
    const linkInputRef = useRef<HTMLInputElement>(null);
    const [position, setPosition] = useState({ top: 0, left: 0 });

    // Fetch status
    const fetchStatus = useCallback(async () => {
        setLoading(true);
        try {
            const token = await getToken();
            const res = await fetch(`${API_URL}/figma/status`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            if (res.ok) {
                const data = await res.json();
                setStatus(data);
            }
        } catch {
            // silent
        } finally {
            setLoading(false);
        }
    }, [getToken]);

    useEffect(() => {
        if (isOpen) fetchStatus();
    }, [isOpen, fetchStatus]);

    // Position the panel above the anchor button
    useEffect(() => {
        if (!isOpen || !anchorRef.current) return;
        const rect = anchorRef.current.getBoundingClientRect();
        setPosition({
            top: rect.top - 8,
            left: Math.max(8, rect.left - 4),
        });
    }, [isOpen, anchorRef]);

    // Close on outside click
    useEffect(() => {
        if (!isOpen) return;
        const handler = (e: MouseEvent) => {
            if (panelRef.current && !panelRef.current.contains(e.target as Node) &&
                anchorRef.current && !anchorRef.current.contains(e.target as Node)) {
                onClose();
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [isOpen, onClose, anchorRef]);

    // Auto-focus
    useEffect(() => {
        if (showTokenInput && tokenInputRef.current) tokenInputRef.current.focus();
    }, [showTokenInput]);

    useEffect(() => {
        if (isOpen && status?.userConnected && linkInputRef.current) linkInputRef.current.focus();
    }, [isOpen, status?.userConnected]);

    const handleConnect = async () => {
        if (!tokenInput.trim()) return;
        setConnecting(true);
        setError('');
        try {
            const token = await getToken();
            const res = await fetch(`${API_URL}/figma/connect`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({ accessToken: tokenInput.trim() }),
            });
            const data = await res.json();
            if (!res.ok) {
                setError(data.error || 'Failed to connect');
                return;
            }
            setTokenInput('');
            setShowTokenInput(false);
            await fetchStatus();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Connection failed');
        } finally {
            setConnecting(false);
        }
    };

    const handleDisconnect = async () => {
        try {
            const token = await getToken();
            await fetch(`${API_URL}/figma/disconnect`, {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${token}` },
            });
            await fetchStatus();
        } catch {
            // silent
        }
    };

    const handleAddLink = () => {
        const trimmed = linkInput.trim();
        if (!trimmed) return;
        const testRegex = /https:\/\/(?:www\.)?figma\.com\/(?:design|file|proto|board)\/[^\s"'<>]+/i;
        if (!testRegex.test(trimmed)) {
            setError('Please enter a valid Figma design URL');
            return;
        }
        setError('');
        onAddLink(trimmed);
        setLinkInput('');
    };

    if (!isOpen) return null;

    const panel = (
        <AnimatePresence>
            <motion.div
                ref={panelRef}
                initial={{ opacity: 0, y: 8, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 8, scale: 0.96 }}
                transition={{ duration: 0.15 }}
                className="fixed z-[9999] w-[340px] rounded-xl border border-zinc-700/80 bg-zinc-900/98 backdrop-blur-2xl shadow-2xl"
                style={{ bottom: `calc(100vh - ${position.top}px)`, left: position.left }}
            >
                {/* Header */}
                <div className="flex items-center justify-between px-4 pt-3.5 pb-2">
                    <div className="flex items-center gap-2">
                        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-purple-500/15">
                            <Figma className="h-3.5 w-3.5 text-purple-400" />
                        </div>
                        <span className="text-sm font-semibold text-zinc-100">Figma MCP</span>
                    </div>
                    <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300 transition-colors p-0.5">
                        <X className="h-3.5 w-3.5" />
                    </button>
                </div>

                <div className="px-4 pb-3.5">
                    {loading ? (
                        <div className="flex items-center justify-center py-6">
                            <Loader2 className="h-5 w-5 text-purple-400 animate-spin" />
                        </div>
                    ) : status?.userConnected ? (
                        /* ── Connected state ── */
                        <div className="space-y-3">
                            <div className="flex items-center gap-2 rounded-lg bg-emerald-950/30 border border-emerald-500/20 px-3 py-2">
                                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                                <span className="text-[11px] text-emerald-200 font-medium">Connected to Figma</span>
                                <button
                                    onClick={handleDisconnect}
                                    className="ml-auto text-[10px] text-zinc-500 hover:text-red-400 transition-colors"
                                >
                                    Disconnect
                                </button>
                            </div>

                            {/* Design link input */}
                            <div>
                                <p className="text-[10px] text-zinc-500 mb-1.5">
                                    Paste a Figma design URL to import context:
                                </p>
                                <div className="flex gap-1.5">
                                    <input
                                        ref={linkInputRef}
                                        type="url"
                                        value={linkInput}
                                        onChange={(e) => { setLinkInput(e.target.value); setError(''); }}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter') { e.preventDefault(); handleAddLink(); }
                                            if (e.key === 'Escape') onClose();
                                        }}
                                        placeholder="https://figma.com/design/..."
                                        className="flex-1 h-8 rounded-md border border-zinc-700/80 bg-zinc-800/60 px-2.5 text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/20 transition-colors"
                                    />
                                    <button
                                        type="button"
                                        onClick={handleAddLink}
                                        disabled={!linkInput.trim() || figmaLinks.length >= 3}
                                        className="h-8 px-3 rounded-md border border-purple-500/50 bg-purple-600/80 text-white text-[10px] font-semibold uppercase tracking-wide hover:bg-purple-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                                    >
                                        Add
                                    </button>
                                </div>
                            </div>

                            {/* Attached links */}
                            {figmaLinks.length > 0 && (
                                <div className="flex flex-col gap-1.5">
                                    {figmaLinks.map((link, i) => (
                                        <div key={link.url} className="flex items-center gap-1.5 rounded-md bg-purple-950/25 border border-purple-500/15 px-2 py-1.5 text-[10px] text-purple-200">
                                            <Link2 className="h-3 w-3 shrink-0 text-purple-400" />
                                            <span className="truncate flex-1" title={link.url}>Design {i + 1}</span>
                                            {manualFigmaLinks.includes(link.url) && (
                                                <button onClick={() => onRemoveLink(link.url)} className="text-purple-500 hover:text-purple-200 transition-colors">
                                                    <X className="h-3 w-3" />
                                                </button>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            )}
                            {figmaLinks.length >= 3 && (
                                <p className="text-[9px] text-amber-400/80">Max 3 links reached.</p>
                            )}
                        </div>
                    ) : (
                        /* ── Disconnected state ── */
                        <div className="space-y-3">
                            <p className="text-[11px] text-zinc-400 leading-relaxed">
                                Connect your Figma account to import design context directly into your prompts.
                            </p>

                            {!showTokenInput ? (
                                <button
                                    onClick={() => setShowTokenInput(true)}
                                    className="w-full h-9 rounded-lg border border-purple-500/40 bg-purple-600/20 text-purple-200 text-xs font-semibold hover:bg-purple-600/30 hover:border-purple-500/60 transition-colors flex items-center justify-center gap-2"
                                >
                                    <Figma className="h-3.5 w-3.5" />
                                    Connect with Personal Access Token
                                </button>
                            ) : (
                                <div className="space-y-2">
                                    <input
                                        ref={tokenInputRef}
                                        type="password"
                                        value={tokenInput}
                                        onChange={(e) => { setTokenInput(e.target.value); setError(''); }}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter') { e.preventDefault(); handleConnect(); }
                                            if (e.key === 'Escape') { setShowTokenInput(false); setError(''); }
                                        }}
                                        placeholder="figd_xxxxxxxxxxxxxxxx"
                                        className="w-full h-8 rounded-md border border-zinc-700/80 bg-zinc-800/60 px-2.5 text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/20 transition-colors font-mono"
                                    />
                                    <div className="flex gap-1.5">
                                        <button
                                            onClick={() => { setShowTokenInput(false); setTokenInput(''); setError(''); }}
                                            className="flex-1 h-8 rounded-md border border-zinc-700/80 bg-zinc-800 text-zinc-400 text-[10px] font-semibold uppercase tracking-wide hover:text-zinc-200 transition-colors"
                                        >
                                            Cancel
                                        </button>
                                        <button
                                            onClick={handleConnect}
                                            disabled={!tokenInput.trim() || connecting}
                                            className="flex-1 h-8 rounded-md border border-purple-500/50 bg-purple-600/80 text-white text-[10px] font-semibold uppercase tracking-wide hover:bg-purple-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-1.5"
                                        >
                                            {connecting && <Loader2 className="h-3 w-3 animate-spin" />}
                                            {connecting ? 'Connecting...' : 'Connect'}
                                        </button>
                                    </div>
                                </div>
                            )}

                            <a
                                href="https://www.figma.com/developers/api#access-tokens"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-1.5 text-[10px] text-zinc-500 hover:text-purple-300 transition-colors"
                            >
                                <ExternalLink className="h-3 w-3" />
                                Get a Personal Access Token from Figma
                            </a>
                        </div>
                    )}

                    {/* Error */}
                    {error && (
                        <div className="flex items-start gap-1.5 mt-2 rounded-md bg-red-950/30 border border-red-500/20 px-2.5 py-2 text-[10px] text-red-300">
                            <AlertCircle className="h-3 w-3 shrink-0 mt-0.5 text-red-400" />
                            <span>{error}</span>
                        </div>
                    )}
                </div>
            </motion.div>
        </AnimatePresence>
    );

    return createPortal(panel, document.body);
};
