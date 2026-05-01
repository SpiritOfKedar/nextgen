import React, { useState, useEffect } from 'react';
import { X, Users, Mail, Loader2, Trash2 } from 'lucide-react';
import { useChat } from '../../hooks/useChat';
import { useAtomValue } from 'jotai';
import { currentThreadIdAtom } from '../../store/atoms';

interface Collaborator {
    user_id: string;
    email: string;
    role: string;
    created_at: string;
}

interface ShareThreadModalProps {
    isOpen: boolean;
    onClose: () => void;
}

export const ShareThreadModal: React.FC<ShareThreadModalProps> = ({ isOpen, onClose }) => {
    const [email, setEmail] = useState('');
    const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);
    
    const threadId = useAtomValue(currentThreadIdAtom);
    const { getCollaborators, addCollaborator, removeCollaborator } = useChat();

    useEffect(() => {
        if (isOpen && threadId) {
            loadCollaborators();
        }
    }, [isOpen, threadId]);

    const loadCollaborators = async () => {
        if (!threadId) return;
        setLoading(true);
        setError(null);
        try {
            const data = await getCollaborators(threadId);
            setCollaborators(data);
        } catch (err: any) {
            setError(err.message || 'Failed to load collaborators');
        } finally {
            setLoading(false);
        }
    };

    const handleInvite = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!email.trim() || !threadId) return;

        setLoading(true);
        setError(null);
        setSuccess(null);

        try {
            await addCollaborator(threadId, email, 'editor');
            setSuccess('Invitation sent successfully!');
            setEmail('');
            await loadCollaborators();
        } catch (err: any) {
            setError(err.message || 'Failed to send invitation');
        } finally {
            setLoading(false);
        }
    };

    const handleRemove = async (userId: string) => {
        if (!threadId) return;
        setLoading(true);
        setError(null);
        setSuccess(null);

        try {
            await removeCollaborator(threadId, userId);
            setSuccess('Collaborator removed');
            await loadCollaborators();
        } catch (err: any) {
            setError(err.message || 'Failed to remove collaborator');
        } finally {
            setLoading(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl w-full max-w-md overflow-hidden flex flex-col shadow-2xl">
                <div className="flex items-center justify-between p-4 border-b border-zinc-800 bg-zinc-950">
                    <div className="flex items-center gap-2">
                        <Users className="w-5 h-5 text-zinc-400" />
                        <h2 className="text-lg font-medium text-zinc-100">Share Project</h2>
                    </div>
                    <button
                        onClick={onClose}
                        className="text-zinc-500 hover:text-zinc-300 transition-colors"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <div className="p-4 space-y-4">
                    <p className="text-sm text-zinc-400">
                        Invite others to collaborate on this project. They will get editor access.
                    </p>

                    <form onSubmit={handleInvite} className="space-y-3">
                        <div className="relative">
                            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                            <input
                                type="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                placeholder="Enter email address..."
                                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg pl-9 pr-24 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/50"
                                required
                            />
                            <button
                                type="submit"
                                disabled={loading || !email.trim()}
                                className="absolute right-1 top-1/2 -translate-y-1/2 px-3 py-1 bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
                            >
                                {loading && <Loader2 className="w-3 h-3 animate-spin" />}
                                Invite
                            </button>
                        </div>
                        {error && <p className="text-xs text-red-400">{error}</p>}
                        {success && <p className="text-xs text-green-400">{success}</p>}
                    </form>

                    <div className="pt-2 border-t border-zinc-800">
                        <h3 className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-3">
                            Collaborators
                        </h3>
                        <div className="space-y-2 max-h-48 overflow-y-auto custom-scrollbar">
                            {collaborators.length === 0 && !loading ? (
                                <p className="text-sm text-zinc-500 text-center py-4">No collaborators yet</p>
                            ) : (
                                collaborators.map((collab) => (
                                    <div key={collab.user_id} className="flex items-center justify-between p-2 rounded-lg bg-zinc-950/50 border border-zinc-800/50">
                                        <div className="flex flex-col">
                                            <span className="text-sm text-zinc-200">{collab.email}</span>
                                            <span className="text-xs text-zinc-500 capitalize">{collab.role}</span>
                                        </div>
                                        <button
                                            onClick={() => handleRemove(collab.user_id)}
                                            className="p-1.5 text-zinc-500 hover:text-red-400 hover:bg-red-400/10 rounded-md transition-colors"
                                            title="Remove collaborator"
                                        >
                                            <Trash2 className="w-4 h-4" />
                                        </button>
                                    </div>
                                ))
                            )}
                            {loading && collaborators.length === 0 && (
                                <div className="flex justify-center py-4">
                                    <Loader2 className="w-5 h-5 text-zinc-500 animate-spin" />
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};
