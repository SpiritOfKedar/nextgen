import React, { useState } from 'react';
import { Hammer, PencilLine, MessageSquarePlus, ArrowRight, X } from 'lucide-react';
import { useChat } from '../../hooks/useChat';

type PlanActionPanel = 'change' | 'comment' | null;

type PlanMessageActionsProps = {
    disabled?: boolean;
};

export const PlanMessageActions: React.FC<PlanMessageActionsProps> = ({ disabled = false }) => {
    const { executePlanAction, isLoading } = useChat();
    const [activePanel, setActivePanel] = useState<PlanActionPanel>(null);
    const [feedback, setFeedback] = useState('');
    const [error, setError] = useState<string | null>(null);

    const busy = disabled || isLoading;

    const closePanel = () => {
        setActivePanel(null);
        setFeedback('');
        setError(null);
    };

    const handleBuild = async () => {
        setError(null);
        const result = await executePlanAction('build');
        if (!result.ok) setError(result.error);
    };

    const handleSubmitFeedback = async (action: 'change' | 'comment') => {
        if (!feedback.trim()) {
            setError(action === 'change' ? 'Describe what to change.' : 'Enter your comments first.');
            return;
        }
        setError(null);
        const result = await executePlanAction(action, feedback.trim());
        if (!result.ok) {
            setError(result.error);
            return;
        }
        closePanel();
    };

    return (
        <div className="mt-4 rounded-lg border border-violet-500/25 bg-violet-950/20 overflow-hidden">
            <div className="flex flex-wrap items-center gap-2 px-3 py-2.5 border-b border-violet-500/15 bg-violet-950/30">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-violet-300/90 mr-1">
                    Plan actions
                </span>
                <button
                    type="button"
                    disabled={busy}
                    onClick={() => void handleBuild()}
                    className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-50 transition-colors"
                >
                    <Hammer className="w-3.5 h-3.5" />
                    Build
                </button>
                <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                        setActivePanel(activePanel === 'change' ? null : 'change');
                        setFeedback('');
                        setError(null);
                    }}
                    className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors disabled:opacity-50 ${
                        activePanel === 'change'
                            ? 'border-violet-400/50 bg-violet-500/20 text-violet-100'
                            : 'border-zinc-700 bg-zinc-900/60 text-zinc-300 hover:border-zinc-600 hover:text-white'
                    }`}
                >
                    <PencilLine className="w-3.5 h-3.5" />
                    Change plan
                </button>
                <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                        setActivePanel(activePanel === 'comment' ? null : 'comment');
                        setFeedback('');
                        setError(null);
                    }}
                    className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors disabled:opacity-50 ${
                        activePanel === 'comment'
                            ? 'border-violet-400/50 bg-violet-500/20 text-violet-100'
                            : 'border-zinc-700 bg-zinc-900/60 text-zinc-300 hover:border-zinc-600 hover:text-white'
                    }`}
                >
                    <MessageSquarePlus className="w-3.5 h-3.5" />
                    Add comments
                </button>
            </div>

            {activePanel && (
                <div className="p-3 space-y-2">
                    <label className="block text-xs text-zinc-400">
                        {activePanel === 'change'
                            ? 'What should change in this plan?'
                            : 'Add notes or feedback to refine the plan.'}
                    </label>
                    <textarea
                        value={feedback}
                        onChange={(e) => setFeedback(e.target.value)}
                        placeholder={
                            activePanel === 'change'
                                ? 'e.g. Use localStorage instead of context, add filter tabs, simplify the UI…'
                                : 'e.g. Prefer shadcn checkbox, support keyboard shortcuts, mobile-first layout…'
                        }
                        rows={3}
                        className="w-full rounded-md border border-zinc-700 bg-zinc-950/80 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-violet-500/50 resize-none"
                    />
                    <div className="flex items-center justify-end gap-2">
                        <button
                            type="button"
                            onClick={closePanel}
                            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-zinc-400 hover:text-zinc-200"
                        >
                            <X className="w-3 h-3" />
                            Cancel
                        </button>
                        <button
                            type="button"
                            disabled={busy || !feedback.trim()}
                            onClick={() => void handleSubmitFeedback(activePanel)}
                            className="inline-flex items-center gap-1 rounded-md bg-violet-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-violet-500 disabled:opacity-50"
                        >
                            {activePanel === 'change' ? 'Update plan' : 'Add to plan'}
                            <ArrowRight className="w-3 h-3" />
                        </button>
                    </div>
                </div>
            )}

            {error && (
                <p className="px-3 pb-2 text-xs text-red-400">{error}</p>
            )}
        </div>
    );
};
