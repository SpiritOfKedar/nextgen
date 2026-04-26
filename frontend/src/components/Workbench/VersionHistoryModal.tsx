import React, { useEffect, useMemo, useState } from 'react';
import { X, RotateCcw, Search } from 'lucide-react';
import { useChat } from '../../hooks/useChat';

type VersionItem = {
    seq: number;
    messageId: string;
    createdAt: string;
    model: string | null;
    changedFileCount: number;
};

interface VersionHistoryModalProps {
    threadId: string;
    isOpen: boolean;
    onClose: () => void;
}

export const VersionHistoryModal: React.FC<VersionHistoryModalProps> = ({
    threadId,
    isOpen,
    onClose,
}) => {
    const { fetchThreadVersions, restoreThreadToSeq } = useChat();
    const [versions, setVersions] = useState<VersionItem[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [isRestoring, setIsRestoring] = useState(false);
    const [search, setSearch] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);

    const loadVersions = React.useCallback(async (silent = false) => {
        if (!silent) {
            setIsLoading(true);
            setError(null);
        }
        setSuccess(null);
        const items = await fetchThreadVersions(threadId);
        setVersions(items as VersionItem[]);
        if (!silent) setIsLoading(false);
    }, [fetchThreadVersions, threadId]);

    useEffect(() => {
        if (!isOpen) return;
        let cancelled = false;

        const run = async () => {
            try {
                await loadVersions(false);
            } catch (err) {
                if (!cancelled) {
                    setIsLoading(false);
                    setError(err instanceof Error ? err.message : 'Failed to load versions');
                }
            }
        };

        void run();

        // Realtime refresh while modal is open
        const interval = setInterval(() => {
            if (cancelled) return;
            void loadVersions(true).catch(() => {
                // keep polling resilient; surface hard failures only on explicit actions
            });
        }, 2500);

        return () => {
            cancelled = true;
            clearInterval(interval);
        };
    }, [isOpen, loadVersions]);

    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase();
        if (!q) return versions;
        return versions.filter((v) =>
            String(v.seq).includes(q) ||
            String(v.model || 'unknown').toLowerCase().includes(q),
        );
    }, [search, versions]);

    const handleRestore = async (seq: number) => {
        const confirmed = window.confirm(
            `Restore project to seq #${seq}? This will hard-rollback current code state.`,
        );
        if (!confirmed) return;
        setIsRestoring(true);
        setError(null);
        setSuccess(null);
        try {
            const result = await restoreThreadToSeq(threadId, seq);
            setSuccess(
                `Restored to seq #${result.restoredToSeq}. Files: ${result.fileCount}, deleted: ${result.deletedCount}.`,
            );
            // Force immediate refresh so new rollback entry appears in timeline right away
            await loadVersions(true);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Restore failed');
        } finally {
            setIsRestoring(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 p-4">
            <div className="w-full max-w-3xl overflow-hidden rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl">
                <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
                    <div>
                        <h2 className="text-sm font-semibold text-zinc-100">Thread Versions</h2>
                        <p className="text-xs text-zinc-500">
                            Project versions per model generation. Auto-refreshes while open.
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
                        aria-label="Close versions modal"
                    >
                        <X className="h-4 w-4" />
                    </button>
                </div>

                <div className="border-b border-zinc-800 px-4 py-3">
                    <div className="relative">
                        <Search className="pointer-events-none absolute left-2 top-2.5 h-3.5 w-3.5 text-zinc-500" />
                        <input
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="Filter by seq or model..."
                            className="h-8 w-full rounded-md border border-zinc-700 bg-zinc-950 pl-7 pr-2 text-xs text-zinc-200 outline-none focus:border-zinc-500"
                        />
                    </div>
                </div>

                <div className="max-h-[60vh] overflow-y-auto p-2">
                    {isLoading && (
                        <div className="px-3 py-8 text-center text-sm text-zinc-400">Loading versions...</div>
                    )}
                    {!isLoading && filtered.length === 0 && (
                        <div className="px-3 py-8 text-center text-sm text-zinc-500">No matching versions</div>
                    )}
                    {!isLoading && filtered.map((item, idx) => (
                        <div
                            key={item.messageId}
                            className="mb-2 rounded-lg border border-zinc-800 bg-zinc-950/60 px-3 py-2"
                        >
                            <div className="flex items-center justify-between gap-3">
                                <div className="min-w-0">
                                    <div className="truncate text-xs font-medium text-zinc-200">
                                        Version #{versions.length - idx}
                                    </div>
                                    <div className="mt-0.5 text-[11px] text-zinc-500">
                                        seq #{item.seq} | {new Date(item.createdAt).toLocaleString()} | {item.model || 'unknown model'} | {item.changedFileCount} file change{item.changedFileCount === 1 ? '' : 's'}
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => void handleRestore(item.seq)}
                                    disabled={isRestoring}
                                    className="inline-flex shrink-0 items-center gap-1 rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-[11px] text-zinc-200 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                    <RotateCcw className="h-3 w-3" />
                                    Restore
                                </button>
                            </div>
                        </div>
                    ))}
                </div>

                {(error || success) && (
                    <div className="border-t border-zinc-800 px-4 py-2 text-xs">
                        {error && <p className="text-red-400">{error}</p>}
                        {success && <p className="text-emerald-400">{success}</p>}
                    </div>
                )}
            </div>
        </div>
    );
};

