import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { useAuth } from '@clerk/clerk-react';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';

export type StitchContextPayload = {
    projectId?: string;
    prompt?: string;
    screenId?: string;
};

interface StitchStatus {
    enabled: boolean;
    endpoint: string;
    authConfigured: boolean;
    userConnected: boolean;
    defaultProjectId?: string | null;
}

interface StitchPanelProps {
    anchorRef: React.RefObject<HTMLButtonElement | null>;
    isOpen: boolean;
    onClose: () => void;
    stitchContext: StitchContextPayload | null;
    onStitchContextChange: (ctx: StitchContextPayload | null) => void;
}

const StitchIcon: React.FC<{ className?: string }> = ({ className }) => (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
        <path d="M12 2L2 7l10 5 10-5-10-5zm0 7.5L4.5 6.75 12 10.5l7.5-3.75L12 9.5zm-8 3.25L12 17.5l8-4.75v2.5L12 20l-8-4.75v-2.5z" />
    </svg>
);

export const StitchPanel: React.FC<StitchPanelProps> = ({
    anchorRef,
    isOpen,
    onClose,
    stitchContext,
    onStitchContextChange,
}) => {
    const { getToken } = useAuth();
    const [status, setStatus] = useState<StitchStatus | null>(null);
    const [loading, setLoading] = useState(false);
    const [connecting, setConnecting] = useState(false);
    const [testing, setTesting] = useState(false);
    const [apiKeyInput, setApiKeyInput] = useState('');
    const [defaultProjectInput, setDefaultProjectInput] = useState('');
    const [projectIdInput, setProjectIdInput] = useState('');
    const [promptInput, setPromptInput] = useState('');
    const [screenIdInput, setScreenIdInput] = useState('');
    const [error, setError] = useState('');
    const [testResult, setTestResult] = useState('');
    const [showApiKeyInput, setShowApiKeyInput] = useState(false);
    const panelRef = useRef<HTMLDivElement>(null);
    const apiKeyInputRef = useRef<HTMLInputElement>(null);
    const [position, setPosition] = useState({ top: 0, left: 0 });

    const fetchStatus = useCallback(async () => {
        setLoading(true);
        try {
            const token = await getToken();
            const res = await fetch(`${API_URL}/stitch/status`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            if (res.ok) {
                const data = await res.json();
                setStatus(data);
                if (data.defaultProjectId && !projectIdInput) {
                    setProjectIdInput(data.defaultProjectId);
                }
            }
        } catch {
            // silent
        } finally {
            setLoading(false);
        }
    }, [getToken, projectIdInput]);

    useEffect(() => {
        if (isOpen) fetchStatus();
    }, [isOpen, fetchStatus]);

    useEffect(() => {
        if (!isOpen || !anchorRef.current) return;
        const rect = anchorRef.current.getBoundingClientRect();
        setPosition({
            top: rect.top - 8,
            left: Math.max(8, rect.left - 4),
        });
    }, [isOpen, anchorRef]);

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

    useEffect(() => {
        if (showApiKeyInput && apiKeyInputRef.current) apiKeyInputRef.current.focus();
    }, [showApiKeyInput]);

    const handleConnect = async () => {
        if (!apiKeyInput.trim()) return;
        setConnecting(true);
        setError('');
        try {
            const token = await getToken();
            const res = await fetch(`${API_URL}/stitch/connect`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                    apiKey: apiKeyInput.trim(),
                    defaultProjectId: defaultProjectInput.trim() || undefined,
                }),
            });
            const data = await res.json();
            if (!res.ok) {
                setError(data.error || data.detail || 'Failed to connect');
                return;
            }
            setApiKeyInput('');
            setShowApiKeyInput(false);
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
            await fetch(`${API_URL}/stitch/disconnect`, {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${token}` },
            });
            onStitchContextChange(null);
            await fetchStatus();
        } catch {
            // silent
        }
    };

    const handleAttachContext = () => {
        const projectId = projectIdInput.trim() || undefined;
        const prompt = promptInput.trim() || undefined;
        const screenId = screenIdInput.trim() || undefined;
        if (!projectId && !prompt && !screenId) {
            setError('Enter a project ID, prompt, or screen ID to attach context.');
            return;
        }
        setError('');
        onStitchContextChange({ projectId, prompt, screenId });
        onClose();
    };

    const handleTestConnection = async () => {
        setTesting(true);
        setError('');
        setTestResult('');
        try {
            const token = await getToken();
            const res = await fetch(`${API_URL}/stitch/inspect`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                    projectId: projectIdInput.trim() || undefined,
                    prompt: promptInput.trim() || undefined,
                    screenId: screenIdInput.trim() || undefined,
                }),
            });
            const data = await res.json();
            if (!res.ok) {
                setError(data.error || 'Inspect failed');
                return;
            }
            const toolCount = data.context?.toolContexts?.length ?? 0;
            const warnings = data.context?.warnings?.join('; ') || '';
            setTestResult(
                toolCount > 0
                    ? `Fetched ${toolCount} tool context block${toolCount === 1 ? '' : 's'}.${warnings ? ` Warnings: ${warnings}` : ''}`
                    : warnings || 'No context returned. Check project ID or prompt.',
            );
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Test failed');
        } finally {
            setTesting(false);
        }
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
                <div className="flex items-center justify-between px-4 pt-3.5 pb-2">
                    <div className="flex items-center gap-2">
                        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-500/15">
                            <StitchIcon className="h-3.5 w-3.5 text-blue-400" />
                        </div>
                        <span className="text-sm font-semibold text-zinc-100">Google Stitch</span>
                    </div>
                    <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300 transition-colors p-0.5">
                        <X className="h-3.5 w-3.5" />
                    </button>
                </div>

                <div className="px-4 pb-3.5">
                    {loading ? (
                        <div className="flex items-center justify-center py-6">
                            <Loader2 className="h-5 w-5 text-blue-400 animate-spin" />
                        </div>
                    ) : status?.userConnected ? (
                        <div className="space-y-3">
                            <div className="flex items-center gap-2 rounded-lg bg-emerald-950/30 border border-emerald-500/20 px-3 py-2">
                                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                                <span className="text-[11px] text-emerald-200 font-medium">Connected to Stitch</span>
                                <button
                                    onClick={handleDisconnect}
                                    className="ml-auto text-[10px] text-zinc-500 hover:text-red-400 transition-colors"
                                >
                                    Disconnect
                                </button>
                            </div>

                            {stitchContext && (
                                <div className="rounded-lg border border-blue-500/30 bg-blue-950/20 px-3 py-2 text-[11px] text-blue-100">
                                    Context attached for next message.
                                    <button
                                        type="button"
                                        className="ml-2 text-blue-300 hover:text-white underline"
                                        onClick={() => onStitchContextChange(null)}
                                    >
                                        Remove
                                    </button>
                                </div>
                            )}

                            <div className="space-y-2">
                                <label className="block text-[10px] uppercase tracking-wider text-zinc-500">Project ID</label>
                                <input
                                    type="text"
                                    value={projectIdInput}
                                    onChange={(e) => setProjectIdInput(e.target.value)}
                                    placeholder={status.defaultProjectId || 'Optional if default set'}
                                    className="w-full rounded-lg border border-zinc-700 bg-zinc-950/60 px-3 py-2 text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-blue-500/50 focus:outline-none"
                                />
                            </div>
                            <div className="space-y-2">
                                <label className="block text-[10px] uppercase tracking-wider text-zinc-500">Prompt (optional)</label>
                                <textarea
                                    value={promptInput}
                                    onChange={(e) => setPromptInput(e.target.value)}
                                    placeholder="Describe the screen or design to fetch"
                                    rows={2}
                                    className="w-full rounded-lg border border-zinc-700 bg-zinc-950/60 px-3 py-2 text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-blue-500/50 focus:outline-none resize-none"
                                />
                            </div>
                            <div className="space-y-2">
                                <label className="block text-[10px] uppercase tracking-wider text-zinc-500">Screen ID (optional)</label>
                                <input
                                    type="text"
                                    value={screenIdInput}
                                    onChange={(e) => setScreenIdInput(e.target.value)}
                                    placeholder="Specific screen to inspect"
                                    className="w-full rounded-lg border border-zinc-700 bg-zinc-950/60 px-3 py-2 text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-blue-500/50 focus:outline-none"
                                />
                            </div>

                            {error && (
                                <div className="flex items-start gap-2 rounded-lg bg-red-950/30 border border-red-500/20 px-3 py-2">
                                    <AlertCircle className="h-3.5 w-3.5 text-red-400 shrink-0 mt-0.5" />
                                    <span className="text-[11px] text-red-200">{error}</span>
                                </div>
                            )}

                            {testResult && (
                                <p className="text-[11px] text-zinc-400">{testResult}</p>
                            )}

                            <div className="flex gap-2">
                                <button
                                    type="button"
                                    onClick={handleTestConnection}
                                    disabled={testing}
                                    className="flex-1 rounded-lg border border-zinc-600 px-3 py-2 text-[11px] font-medium text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
                                >
                                    {testing ? 'Testing...' : 'Test connection'}
                                </button>
                                <button
                                    type="button"
                                    onClick={handleAttachContext}
                                    className="flex-1 rounded-lg bg-blue-600 px-3 py-2 text-[11px] font-medium text-white hover:bg-blue-500"
                                >
                                    Attach context
                                </button>
                            </div>
                        </div>
                    ) : (
                        <div className="space-y-3">
                            <p className="text-[11px] text-zinc-400 leading-relaxed">
                                Connect your Google Stitch API key to inject design context into prompts.
                            </p>
                            {!showApiKeyInput ? (
                                <button
                                    onClick={() => setShowApiKeyInput(true)}
                                    className="w-full rounded-lg bg-blue-600 px-3 py-2.5 text-xs font-medium text-white hover:bg-blue-500 transition-colors"
                                >
                                    Connect API key
                                </button>
                            ) : (
                                <div className="space-y-2">
                                    <input
                                        ref={apiKeyInputRef}
                                        type="password"
                                        value={apiKeyInput}
                                        onChange={(e) => setApiKeyInput(e.target.value)}
                                        placeholder="Stitch API key"
                                        className="w-full rounded-lg border border-zinc-700 bg-zinc-950/60 px-3 py-2 text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-blue-500/50 focus:outline-none"
                                    />
                                    <input
                                        type="text"
                                        value={defaultProjectInput}
                                        onChange={(e) => setDefaultProjectInput(e.target.value)}
                                        placeholder="Default project ID (optional)"
                                        className="w-full rounded-lg border border-zinc-700 bg-zinc-950/60 px-3 py-2 text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-blue-500/50 focus:outline-none"
                                    />
                                    {error && (
                                        <div className="flex items-start gap-2 rounded-lg bg-red-950/30 border border-red-500/20 px-3 py-2">
                                            <AlertCircle className="h-3.5 w-3.5 text-red-400 shrink-0 mt-0.5" />
                                            <span className="text-[11px] text-red-200">{error}</span>
                                        </div>
                                    )}
                                    <button
                                        onClick={handleConnect}
                                        disabled={connecting || !apiKeyInput.trim()}
                                        className="w-full rounded-lg bg-blue-600 px-3 py-2.5 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
                                    >
                                        {connecting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                                        {connecting ? 'Connecting...' : 'Save connection'}
                                    </button>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </motion.div>
        </AnimatePresence>
    );

    return createPortal(panel, document.body);
};
