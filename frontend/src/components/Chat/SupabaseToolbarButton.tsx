import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Database } from 'lucide-react';
import { useAtom } from 'jotai';
import { useAuth } from '@clerk/clerk-react';
import { supabaseContextAtom } from '../../store/mcpAttachments';
import { fetchSupabaseStatus, type SupabaseConnectionMode } from '../../lib/supabaseSandboxEnv';
import { SupabasePanel } from './SupabasePanel';

type SupabaseToolbarButtonProps = {
    iconBtnClass: string;
    activeClass: string;
    idleClass: string;
};

const DOT_BY_MODE: Record<SupabaseConnectionMode, string> = {
    none: 'bg-zinc-500',
    client: 'bg-amber-400',
    database: 'bg-emerald-400',
};

const readOAuthReturn = (): { status: 'success' | 'error' | null; detail: string | null } => {
    const params = new URLSearchParams(window.location.search);
    const value = params.get('supabase_oauth');
    if (value === 'success') {
        return { status: 'success', detail: null };
    }
    if (value === 'error') {
        return { status: 'error', detail: params.get('supabase_oauth_detail') };
    }
    return { status: null, detail: null };
};

const clearOAuthQueryParams = (): void => {
    const url = new URL(window.location.href);
    url.searchParams.delete('supabase_oauth');
    url.searchParams.delete('supabase_oauth_detail');
    window.history.replaceState({}, '', url.pathname + url.search + url.hash);
};

export const SupabaseToolbarButton: React.FC<SupabaseToolbarButtonProps> = ({
    iconBtnClass,
    activeClass,
    idleClass,
}) => {
    const { getToken } = useAuth();
    const [supabaseContext, setSupabaseContext] = useAtom(supabaseContextAtom);
    const [showSupabasePanel, setShowSupabasePanel] = useState(false);
    const [connectionMode, setConnectionMode] = useState<SupabaseConnectionMode>('none');
    const [oauthReturn, setOauthReturn] = useState<'success' | 'error' | null>(null);
    const [oauthErrorDetail, setOauthErrorDetail] = useState<string | null>(null);
    const supabaseButtonRef = useRef<HTMLButtonElement>(null);
    const isActive = showSupabasePanel || !!supabaseContext;

    const refreshStatus = useCallback(async () => {
        try {
            const token = await getToken();
            if (!token) return;
            const status = await fetchSupabaseStatus(token);
            setConnectionMode(status.connectionMode ?? (status.connected ? 'client' : 'none'));
        } catch {
            // non-blocking — leave indicator as-is
        }
    }, [getToken]);

    useEffect(() => {
        void refreshStatus();
    }, [refreshStatus]);

    useEffect(() => {
        const { status, detail } = readOAuthReturn();
        if (!status) return;
        setOauthReturn(status);
        setOauthErrorDetail(detail);
        setShowSupabasePanel(true);
    }, []);

    useEffect(() => {
        if (!showSupabasePanel) void refreshStatus();
    }, [showSupabasePanel, refreshStatus]);

    const handleOAuthReturnHandled = useCallback(() => {
        setOauthReturn(null);
        setOauthErrorDetail(null);
        clearOAuthQueryParams();
    }, []);

    const dotTitle = connectionMode === 'database'
        ? 'Supabase connected (database + client)'
        : connectionMode === 'client'
            ? 'Supabase connected (client only) — add a database URL for migrations'
            : 'Supabase not connected';

    return (
        <>
            <button
                ref={supabaseButtonRef}
                type="button"
                onClick={() => setShowSupabasePanel((v) => !v)}
                className={`relative ${iconBtnClass} ${isActive ? activeClass : idleClass}`}
                title={`Supabase backend — ${dotTitle}`}
                aria-label="Supabase backend"
            >
                <Database className="w-3.5 h-3.5" />
                <span
                    className={`absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full ring-2 ring-zinc-900 ${DOT_BY_MODE[connectionMode]}`}
                    aria-hidden="true"
                />
            </button>
            <SupabasePanel
                anchorRef={supabaseButtonRef}
                isOpen={showSupabasePanel}
                onClose={() => setShowSupabasePanel(false)}
                supabaseContext={supabaseContext}
                onSupabaseContextChange={setSupabaseContext}
                oauthReturn={oauthReturn}
                oauthErrorDetail={oauthErrorDetail}
                onOAuthReturnHandled={handleOAuthReturnHandled}
            />
        </>
    );
};
