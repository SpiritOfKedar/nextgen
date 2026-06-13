import React, { useState, useEffect, useCallback } from 'react';
import { X, Github, Loader2, CheckCircle2, ExternalLink, AlertCircle } from 'lucide-react';
import { useAuth } from '@clerk/clerk-react';
import { useAtomValue } from 'jotai';
import { currentThreadIdAtom } from '../../store/atoms';
import { webContainerAtom } from '../../store/webContainer';
import { collectProjectFilesFromWebContainer } from '../../lib/projectDownload';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';

interface PushToGitHubModalProps {
    isOpen: boolean;
    onClose: () => void;
}

type PushMode = 'create' | 'existing';
type Step = 'connect' | 'configure' | 'pushing' | 'done';

interface GitHubLink {
    owner: string;
    repo: string;
    default_branch: string;
}

export const PushToGitHubModal: React.FC<PushToGitHubModalProps> = ({ isOpen, onClose }) => {
    const { getToken } = useAuth();
    const threadId = useAtomValue(currentThreadIdAtom);
    const webContainer = useAtomValue(webContainerAtom);

    const [step, setStep] = useState<Step>('connect');
    const [userConnected, setUserConnected] = useState(false);
    const [githubLogin, setGithubLogin] = useState<string | null>(null);
    const [tokenInput, setTokenInput] = useState('');
    const [connecting, setConnecting] = useState(false);
    const [mode, setMode] = useState<PushMode>('create');
    const [owner, setOwner] = useState('');
    const [repo, setRepo] = useState('');
    const [branch, setBranch] = useState('main');
    const [commitMessage, setCommitMessage] = useState('Update from NextGen');
    const [isPrivate, setIsPrivate] = useState(false);
    const [error, setError] = useState('');
    const [result, setResult] = useState<{ htmlUrl: string; fileCount: number; commitSha: string } | null>(null);

    const fetchStatus = useCallback(async () => {
        try {
            const token = await getToken();
            const res = await fetch(`${API_URL}/github/status`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            if (res.ok) {
                const data = await res.json();
                setUserConnected(!!data.userConnected);
                setGithubLogin(data.githubLogin ?? null);
                if (data.userConnected) {
                    setStep('configure');
                    if (data.githubLogin && !owner) setOwner(data.githubLogin);
                }
            }
        } catch {
            // silent
        }
    }, [getToken, owner]);

    const fetchThreadLink = useCallback(async () => {
        if (!threadId) return;
        try {
            const token = await getToken();
            const res = await fetch(`${API_URL}/github/link/${encodeURIComponent(threadId)}`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            if (res.ok) {
                const data = await res.json();
                const link = data.link as GitHubLink | null;
                if (link) {
                    setMode('existing');
                    setOwner(link.owner);
                    setRepo(link.repo);
                    setBranch(link.default_branch || 'main');
                }
            }
        } catch {
            // silent
        }
    }, [getToken, threadId]);

    useEffect(() => {
        if (!isOpen) return;
        setError('');
        setResult(null);
        setStep('connect');
        fetchStatus().then(() => fetchThreadLink());
    }, [isOpen, fetchStatus, fetchThreadLink]);

    const handleConnect = async () => {
        if (!tokenInput.trim()) return;
        setConnecting(true);
        setError('');
        try {
            const token = await getToken();
            const res = await fetch(`${API_URL}/github/connect`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({ accessToken: tokenInput.trim() }),
            });
            const data = await res.json();
            if (!res.ok) {
                setError(data.error || data.detail || 'Failed to connect');
                return;
            }
            setTokenInput('');
            setGithubLogin(data.githubLogin ?? null);
            if (data.githubLogin) setOwner(data.githubLogin);
            setUserConnected(true);
            setStep('configure');
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Connection failed');
        } finally {
            setConnecting(false);
        }
    };

    const handlePush = async () => {
        if (!threadId) {
            setError('No active project thread. Send a message first.');
            return;
        }
        if (!webContainer) {
            setError('WebContainer is not ready yet.');
            return;
        }
        if (!repo.trim()) {
            setError('Repository name is required.');
            return;
        }
        if (mode === 'existing' && !owner.trim()) {
            setError('Repository owner is required for existing repos.');
            return;
        }

        setStep('pushing');
        setError('');
        try {
            const files = await collectProjectFilesFromWebContainer(webContainer);
            if (files.length === 0) {
                throw new Error('No project files found to push.');
            }

            const token = await getToken();
            const res = await fetch(`${API_URL}/github/push`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                    threadId,
                    mode,
                    owner: owner.trim() || undefined,
                    repo: repo.trim(),
                    branch: branch.trim() || 'main',
                    commitMessage: commitMessage.trim() || 'Update from NextGen',
                    isPrivate,
                    files,
                }),
            });
            const data = await res.json();
            if (!res.ok) {
                throw new Error(data.error || 'Push failed');
            }
            setResult({
                htmlUrl: data.htmlUrl,
                fileCount: data.fileCount,
                commitSha: data.commitSha,
            });
            setStep('done');
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Push failed');
            setStep('configure');
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <div className="w-full max-w-md rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl">
                <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
                    <div className="flex items-center gap-2">
                        <Github className="h-4 w-4 text-zinc-300" />
                        <span className="text-sm font-semibold text-zinc-100">Push to GitHub</span>
                    </div>
                    <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300 p-1">
                        <X className="h-4 w-4" />
                    </button>
                </div>

                <div className="px-4 py-4 space-y-4">
                    {step === 'connect' && !userConnected && (
                        <>
                            <p className="text-xs text-zinc-400">
                                Connect a GitHub Personal Access Token with <code className="text-zinc-300">repo</code> scope.
                                Your token is stored securely and never returned to the browser.
                            </p>
                            <input
                                type="password"
                                value={tokenInput}
                                onChange={(e) => setTokenInput(e.target.value)}
                                placeholder="ghp_..."
                                className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-zinc-500 focus:outline-none"
                            />
                            {error && <ErrorBanner message={error} />}
                            <button
                                type="button"
                                onClick={handleConnect}
                                disabled={connecting || !tokenInput.trim()}
                                className="w-full rounded-lg bg-zinc-100 px-3 py-2 text-xs font-medium text-zinc-900 hover:bg-white disabled:opacity-50 flex items-center justify-center gap-2"
                            >
                                {connecting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                                {connecting ? 'Connecting...' : 'Connect GitHub'}
                            </button>
                        </>
                    )}

                    {(step === 'configure' || step === 'pushing') && userConnected && (
                        <>
                            <div className="flex items-center gap-2 rounded-lg bg-emerald-950/30 border border-emerald-500/20 px-3 py-2">
                                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                                <span className="text-[11px] text-emerald-200">
                                    Connected as {githubLogin || 'GitHub user'}
                                </span>
                            </div>

                            <div className="flex gap-2">
                                <button
                                    type="button"
                                    onClick={() => setMode('create')}
                                    className={`flex-1 rounded-lg border px-2 py-1.5 text-[11px] font-medium transition-colors ${
                                        mode === 'create'
                                            ? 'border-zinc-500 bg-zinc-800 text-white'
                                            : 'border-zinc-700 text-zinc-400 hover:text-zinc-200'
                                    }`}
                                >
                                    Create new repo
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setMode('existing')}
                                    className={`flex-1 rounded-lg border px-2 py-1.5 text-[11px] font-medium transition-colors ${
                                        mode === 'existing'
                                            ? 'border-zinc-500 bg-zinc-800 text-white'
                                            : 'border-zinc-700 text-zinc-400 hover:text-zinc-200'
                                    }`}
                                >
                                    Existing repo
                                </button>
                            </div>

                            {mode === 'existing' && (
                                <div className="space-y-1">
                                    <label className="text-[10px] uppercase tracking-wider text-zinc-500">Owner</label>
                                    <input
                                        type="text"
                                        value={owner}
                                        onChange={(e) => setOwner(e.target.value)}
                                        placeholder="github-username or org"
                                        className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 focus:border-zinc-500 focus:outline-none"
                                    />
                                </div>
                            )}

                            <div className="space-y-1">
                                <label className="text-[10px] uppercase tracking-wider text-zinc-500">Repository name</label>
                                <input
                                    type="text"
                                    value={repo}
                                    onChange={(e) => setRepo(e.target.value)}
                                    placeholder="my-app"
                                    className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 focus:border-zinc-500 focus:outline-none"
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <div className="space-y-1">
                                    <label className="text-[10px] uppercase tracking-wider text-zinc-500">Branch</label>
                                    <input
                                        type="text"
                                        value={branch}
                                        onChange={(e) => setBranch(e.target.value)}
                                        className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 focus:border-zinc-500 focus:outline-none"
                                    />
                                </div>
                                {mode === 'create' && (
                                    <div className="space-y-1 flex flex-col justify-end">
                                        <label className="flex items-center gap-2 text-[11px] text-zinc-300 cursor-pointer">
                                            <input
                                                type="checkbox"
                                                checked={isPrivate}
                                                onChange={(e) => setIsPrivate(e.target.checked)}
                                                className="rounded border-zinc-600"
                                            />
                                            Private repository
                                        </label>
                                    </div>
                                )}
                            </div>

                            <div className="space-y-1">
                                <label className="text-[10px] uppercase tracking-wider text-zinc-500">Commit message</label>
                                <input
                                    type="text"
                                    value={commitMessage}
                                    onChange={(e) => setCommitMessage(e.target.value)}
                                    className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 focus:border-zinc-500 focus:outline-none"
                                />
                            </div>

                            {error && <ErrorBanner message={error} />}

                            <button
                                type="button"
                                onClick={handlePush}
                                disabled={step === 'pushing'}
                                className="w-full rounded-lg bg-zinc-100 px-3 py-2 text-xs font-medium text-zinc-900 hover:bg-white disabled:opacity-50 flex items-center justify-center gap-2"
                            >
                                {step === 'pushing' ? (
                                    <>
                                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                        Pushing files...
                                    </>
                                ) : (
                                    'Push to GitHub'
                                )}
                            </button>
                        </>
                    )}

                    {step === 'done' && result && (
                        <div className="space-y-3 text-center">
                            <CheckCircle2 className="h-10 w-10 text-emerald-400 mx-auto" />
                            <p className="text-sm text-zinc-200">
                                Pushed {result.fileCount} file{result.fileCount === 1 ? '' : 's'} successfully.
                            </p>
                            <a
                                href={result.htmlUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1.5 text-xs text-blue-400 hover:text-blue-300"
                            >
                                View on GitHub
                                <ExternalLink className="h-3 w-3" />
                            </a>
                            <button
                                type="button"
                                onClick={onClose}
                                className="w-full rounded-lg border border-zinc-600 px-3 py-2 text-xs text-zinc-300 hover:bg-zinc-800"
                            >
                                Close
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

const ErrorBanner: React.FC<{ message: string }> = ({ message }) => (
    <div className="flex items-start gap-2 rounded-lg bg-red-950/30 border border-red-500/20 px-3 py-2">
        <AlertCircle className="h-3.5 w-3.5 text-red-400 shrink-0 mt-0.5" />
        <span className="text-[11px] text-red-200">{message}</span>
    </div>
);
