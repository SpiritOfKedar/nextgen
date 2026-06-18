import type { WebContainer } from '@webcontainer/api';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';

export interface SupabaseClientEnv {
    url: string;
    anonKey: string;
}

export interface SupabaseMigrationInput {
    migrationId: string;
    sql: string;
}

export interface SupabaseMigrationResult {
    migrationId: string;
    status: 'applied' | 'skipped' | 'blocked' | 'failed';
    detail?: string;
}

/** Fetch the browser-safe Supabase client env for the signed-in user, or null if not connected. */
export const fetchSupabaseEnv = async (authToken: string): Promise<SupabaseClientEnv | null> => {
    try {
        const res = await fetch(`${API_URL}/supabase/env`, {
            headers: { Authorization: `Bearer ${authToken}` },
        });
        if (!res.ok) return null;
        const data = await res.json();
        if (!data?.connected || !data.url || !data.anonKey) return null;
        return { url: data.url, anonKey: data.anonKey };
    } catch {
        return null;
    }
};

/**
 * Write `.env.local` with the Supabase client env so Vite inside the sandbox exposes
 * VITE_SUPABASE_*. No-op when the user has no connected project. Only the anon key is
 * ever written here — the service role key and database URL stay on the platform.
 */
export const injectSupabaseEnv = async (wc: WebContainer, authToken: string): Promise<boolean> => {
    const creds = await fetchSupabaseEnv(authToken);
    if (!creds) return false;
    const content = `VITE_SUPABASE_URL=${creds.url}\nVITE_SUPABASE_ANON_KEY=${creds.anonKey}\n`;
    try {
        await wc.fs.writeFile('.env.local', content);
        return true;
    } catch {
        return false;
    }
};

/** Apply migrations server-side against the user's Supabase database. */
export const applySupabaseMigrations = async (
    authToken: string,
    migrations: SupabaseMigrationInput[],
): Promise<SupabaseMigrationResult[]> => {
    const res = await fetch(`${API_URL}/supabase/migrations/apply`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({ migrations }),
    });
    const data = await res.json();
    if (!res.ok) {
        throw new Error(data?.error || 'Failed to apply migrations');
    }
    return data.results ?? [];
};
