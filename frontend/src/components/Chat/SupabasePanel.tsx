import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Loader2, CheckCircle2, AlertCircle, Database } from 'lucide-react';
import { useAuth } from '@clerk/clerk-react';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';

export type SupabaseContextPayload = {
    fetchTables?: boolean;
    fetchAdvisors?: boolean;
    docsQuery?: string;
};

interface SupabaseStatus {
    connected: boolean;
    projectUrl?: string;
    projectRef?: string | null;
    migrationsEnabled?: boolean;
    hasServiceRole?: boolean;
    mcpConnected?: boolean;
    tableCount?: number;
}

interface SupabasePanelProps {
    anchorRef: React.RefObject<HTMLButtonElement | null>;
    isOpen: boolean;
    onClose: () => void;
    supabaseContext: SupabaseContextPayload | null;
    onSupabaseContextChange: (ctx: SupabaseContextPayload | null) => void;
}

const fieldClass =
    'w-full rounded-lg border border-zinc-700 bg-zinc-950/60 px-3 py-2 text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-emerald-500/50 focus:outline-none';

export const SupabasePanel: React.FC<SupabasePanelProps> = ({
    anchorRef,
    isOpen,
    onClose,
    supabaseContext,
    onSupabaseContextChange,
}) => {
    const { getToken } = useAuth();
    const [status, setStatus] = useState<SupabaseStatus | null>(null);
    const [loading, setLoading] = useState(false);
    const [connecting, setConnecting] = useState(false);
    const [testing, setTesting] = useState(false);
    const [error, setError] = useState('');
    const [testResult, setTestResult] = useState('');
    const [showForm, setShowForm] = useState(false);
    const [projectUrl, setProjectUrl] = useState('');
    const [anonKey, setAnonKey] = useState('');
    const [serviceRoleKey, setServiceRoleKey] = useState('');
    const [databaseUrl, setDatabaseUrl] = useState('');
    const [mcpAccessToken, setMcpAccessToken] = useState('');
    const [docsQueryInput, setDocsQueryInput] = useState('');
    const panelRef = useRef<HTMLDivElement>(null);
    const [position, setPosition] = useState({ top: 0, left: 0 });

    const fetchStatus = useCallback(async () => {
        setLoading(true);
        try {
            const token = await getToken();
            const res = await fetch(`${API_URL}/supabase/status`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            if (res.ok) setStatus(await res.json());
        } catch {
            // silent
        } finally {
            setLoading(false);
        }
    }, [getToken]);

    useEffect(() => {
        if (isOpen) fetchStatus();
    }, [isOpen, fetchStatus]);

    useEffect(() => {
        if (!isOpen || !anchorRef.current) return;
        const rect = anchorRef.current.getBoundingClientRect();
        setPosition({ top: rect.top - 8, left: Math.max(8, rect.left - 4) });
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

    const handleConnect = async () => {
        if (!projectUrl.trim() || !anonKey.trim()) {
            setError('Project URL and anon key are required.');
            return;
        }
        setConnecting(true);
        setError('');
        try {
            const token = await getToken();
            const res = await fetch(`${API_URL}/supabase/connect`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify({
                    projectUrl: projectUrl.trim(),
                    anonKey: anonKey.trim(),
                    serviceRoleKey: serviceRoleKey.trim() || undefined,
                    databaseUrl: databaseUrl.trim() || undefined,
                    mcpAccessToken: mcpAccessToken.trim() || undefined,
                }),
            });
            const data = await res.json();
            if (!res.ok) {
                setError(data.error || data.detail || 'Failed to connect');
                return;
            }
            setAnonKey('');
            setServiceRoleKey('');
            setDatabaseUrl('');
            setMcpAccessToken('');
            setShowForm(false);
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
            await fetch(`${API_URL}/supabase/disconnect`, {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${token}` },
            });
            onSupabaseContextChange(null);
            await fetchStatus();
        } catch {
            // silent
        }
    };

    const handleAttachContext = () => {
        setError('');
        onSupabaseContextChange({
            fetchTables: true,
            fetchAdvisors: true,
            docsQuery: docsQueryInput.trim() || undefined,
        });
        onClose();
    };

    const handleTestMcp = async () => {
        setTesting(true);
        setError('');
        setTestResult('');
        try {
            const token = await getToken();
            const res = await fetch(`${API_URL}/supabase/inspect`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                    fetchTables: true,
                    fetchAdvisors: true,
                    docsQuery: docsQueryInput.trim() || undefined,
                }),
            });
            const data = await res.json();
            if (!res.ok) {
                setError(data.error || 'MCP inspect failed');
                return;
            }
            const toolCount = data.context?.toolContexts?.length ?? 0;
            const warnings = data.context?.warnings?.join('; ') || '';
            setTestResult(
                toolCount > 0
                    ? `Fetched ${toolCount} MCP context block${toolCount === 1 ? '' : 's'}.${warnings ? ` Warnings: ${warnings}` : ''}`
                    : warnings || 'No MCP context returned. Add a personal access token.',
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
                        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-500/15">
                            <Database className="h-3.5 w-3.5 text-emerald-400" />
                        </div>
                        <span className="text-sm font-semibold text-zinc-100">Supabase backend</span>
                    </div>
                    <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300 transition-colors p-0.5">
                        <X className="h-3.5 w-3.5" />
                    </button>
                </div>

                <div className="px-4 pb-3.5">
                    {loading ? (
                        <div className="flex items-center justify-center py-6">
                            <Loader2 className="h-5 w-5 text-emerald-400 animate-spin" />
                        </div>
                    ) : status?.connected ? (
                        <div className="space-y-3">
                            <div className="flex items-center gap-2 rounded-lg bg-emerald-950/30 border border-emerald-500/20 px-3 py-2">
                                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                                <span className="text-[11px] text-emerald-200 font-medium truncate">
                                    {status.projectRef || 'Connected'}
                                </span>
                                <button
                                    onClick={handleDisconnect}
                                    className="ml-auto text-[10px] text-zinc-500 hover:text-red-400 transition-colors"
                                >
                                    Disconnect
                                </button>
                            </div>

                            <div className="space-y-1.5 text-[11px] text-zinc-400">
                                <div className="flex items-center justify-between">
                                    <span>Migrations</span>
                                    <span className={status.migrationsEnabled ? 'text-emerald-300' : 'text-amber-300'}>
                                        {status.migrationsEnabled ? 'Enabled' : 'Add database URL'}
                                    </span>
                                </div>
                                <div className="flex items-center justify-between">
                                    <span>Supabase MCP</span>
                                    <span className={status.mcpConnected ? 'text-emerald-300' : 'text-amber-300'}>
                                        {status.mcpConnected ? 'Connected' : 'Add access token'}
                                    </span>
                                </div>
                                <div className="flex items-center justify-between">
                                    <span>Tables in schema</span>
                                    <span className="text-zinc-200">{status.tableCount ?? 0}</span>
                                </div>
                            </div>

                            {supabaseContext && (
                                <div className="rounded-lg border border-emerald-500/30 bg-emerald-950/20 px-3 py-2 text-[11px] text-emerald-100">
                                    MCP context attached for next message.
                                    <button
                                        type="button"
                                        className="ml-2 text-emerald-300 hover:text-white underline"
                                        onClick={() => onSupabaseContextChange(null)}
                                    >
                                        Remove
                                    </button>
                                </div>
                            )}

                            {status.mcpConnected && (
                                <div className="space-y-2">
                                    <label className="block text-[10px] uppercase tracking-wider text-zinc-500">
                                        Docs search (optional)
                                    </label>
                                    <input
                                        type="text"
                                        value={docsQueryInput}
                                        onChange={(e) => setDocsQueryInput(e.target.value)}
                                        placeholder="e.g. row level security policies"
                                        className={fieldClass}
                                    />
                                </div>
                            )}

                            {error && (
                                <div className="flex items-start gap-2 rounded-lg bg-red-950/30 border border-red-500/20 px-3 py-2">
                                    <AlertCircle className="h-3.5 w-3.5 text-red-400 shrink-0 mt-0.5" />
                                    <span className="text-[11px] text-red-200">{error}</span>
                                </div>
                            )}

                            {testResult && (
                                <p className="text-[11px] text-zinc-400">{testResult}</p>
                            )}

                            {status.mcpConnected ? (
                                <div className="flex gap-2">
                                    <button
                                        type="button"
                                        onClick={handleTestMcp}
                                        disabled={testing}
                                        className="flex-1 rounded-lg border border-zinc-600 px-3 py-2 text-[11px] font-medium text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
                                    >
                                        {testing ? 'Testing…' : 'Test MCP'}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={handleAttachContext}
                                        className="flex-1 rounded-lg bg-emerald-600 px-3 py-2 text-[11px] font-medium text-white hover:bg-emerald-500"
                                    >
                                        Attach context
                                    </button>
                                </div>
                            ) : (
                                <p className="text-[11px] text-zinc-500 leading-relaxed">
                                    Add a Supabase personal access token (Account → Access Tokens) and reconnect to
                                    enable live schema, advisors, and docs via MCP.
                                </p>
                            )}

                            <p className="text-[11px] text-zinc-500 leading-relaxed">
                                Anon key is injected into the sandbox preview. Service role, database URL, and MCP token
                                stay on the server.
                            </p>
                        </div>
                    ) : (
                        <div className="space-y-3">
                            <p className="text-[11px] text-zinc-400 leading-relaxed">
                                Connect a Supabase project for database, auth, and storage. Values are in Project
                                Settings → API and Database. MCP uses a personal access token from Account → Access Tokens.
                            </p>
                            {!showForm ? (
                                <button
                                    onClick={() => setShowForm(true)}
                                    className="w-full rounded-lg bg-emerald-600 px-3 py-2.5 text-xs font-medium text-white hover:bg-emerald-500 transition-colors"
                                >
                                    Connect Supabase
                                </button>
                            ) : (
                                <div className="space-y-2">
                                    <div className="space-y-1">
                                        <label className="block text-[10px] uppercase tracking-wider text-zinc-500">Project URL</label>
                                        <input
                                            type="text"
                                            value={projectUrl}
                                            onChange={(e) => setProjectUrl(e.target.value)}
                                            placeholder="https://xxxx.supabase.co"
                                            className={fieldClass}
                                        />
                                    </div>
                                    <div className="space-y-1">
                                        <label className="block text-[10px] uppercase tracking-wider text-zinc-500">Anon / publishable key</label>
                                        <input
                                            type="password"
                                            value={anonKey}
                                            onChange={(e) => setAnonKey(e.target.value)}
                                            placeholder="eyJ..."
                                            className={fieldClass}
                                        />
                                    </div>
                                    <div className="space-y-1">
                                        <label className="block text-[10px] uppercase tracking-wider text-zinc-500">
                                            MCP access token (optional)
                                        </label>
                                        <input
                                            type="password"
                                            value={mcpAccessToken}
                                            onChange={(e) => setMcpAccessToken(e.target.value)}
                                            placeholder="sbp_... — enables live schema via MCP"
                                            className={fieldClass}
                                        />
                                    </div>
                                    <div className="space-y-1">
                                        <label className="block text-[10px] uppercase tracking-wider text-zinc-500">
                                            Service role key (optional)
                                        </label>
                                        <input
                                            type="password"
                                            value={serviceRoleKey}
                                            onChange={(e) => setServiceRoleKey(e.target.value)}
                                            placeholder="Stored on server only"
                                            className={fieldClass}
                                        />
                                    </div>
                                    <div className="space-y-1">
                                        <label className="block text-[10px] uppercase tracking-wider text-zinc-500">
                                            Database URL (enables migrations)
                                        </label>
                                        <input
                                            type="password"
                                            value={databaseUrl}
                                            onChange={(e) => setDatabaseUrl(e.target.value)}
                                            placeholder="postgresql://...pooler.supabase.com:5432/postgres"
                                            className={fieldClass}
                                        />
                                    </div>

                                    {error && (
                                        <div className="flex items-start gap-2 rounded-lg bg-red-950/30 border border-red-500/20 px-3 py-2">
                                            <AlertCircle className="h-3.5 w-3.5 text-red-400 shrink-0 mt-0.5" />
                                            <span className="text-[11px] text-red-200">{error}</span>
                                        </div>
                                    )}

                                    <button
                                        onClick={handleConnect}
                                        disabled={connecting || !projectUrl.trim() || !anonKey.trim()}
                                        className="w-full rounded-lg bg-emerald-600 px-3 py-2.5 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
                                    >
                                        {connecting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                                        {connecting ? 'Validating…' : 'Save connection'}
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
