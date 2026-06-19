import { LRUCache } from 'lru-cache';
import { getPool, Tx } from '../config/db';
import { ThreadRow } from './types';

const q = (tx: Tx | undefined) => tx ?? getPool();

const DEFAULT_THREAD_ACCESS_CACHE_TTL_MS = 30_000;

const parseThreadAccessCacheTtlMs = (raw: string | undefined): number => {
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < 1_000) return DEFAULT_THREAD_ACCESS_CACHE_TTL_MS;
    return Math.min(Math.floor(parsed), 120_000);
};

const threadAccessCache = new LRUCache<string, { v: ThreadRow | null }>({
    max: 20_000,
    ttl: parseThreadAccessCacheTtlMs(process.env.THREAD_ACCESS_CACHE_TTL_MS),
});

const threadAccessCacheKey = (threadId: string, userId: string): string => `${threadId}:${userId}`;

/** DDL runs once at boot — see config/runtimeSchema.ts */
const ensureSchema = async (): Promise<void> => {};

export const create = async (
    userId: string,
    title: string,
    tx?: Tx,
): Promise<ThreadRow> => {
    await ensureSchema();
    const result = await q(tx).query<ThreadRow>(
        `INSERT INTO public.threads (user_id, title) VALUES ($1, $2) RETURNING *`,
        [userId, title],
    );
    return result.rows[0];
};

export const findById = async (
    threadId: string,
    tx?: Tx,
): Promise<ThreadRow | null> => {
    await ensureSchema();
    const result = await q(tx).query<ThreadRow>(
        `SELECT * FROM public.threads WHERE id = $1`,
        [threadId],
    );
    return result.rows[0] ?? null;
};

export const findByIdForUser = async (
    threadId: string,
    userId: string,
    tx?: Tx,
): Promise<ThreadRow | null> => {
    await ensureSchema();
    if (!tx) {
        const cacheKey = threadAccessCacheKey(threadId, userId);
        const cached = threadAccessCache.get(cacheKey);
        if (cached !== undefined) {
            return cached.v;
        }
    }
    const result = await q(tx).query<ThreadRow>(
        `SELECT t.* FROM public.threads t
         LEFT JOIN public.thread_collaborators tc ON tc.thread_id = t.id AND tc.user_id = $2
         WHERE t.id = $1 AND (t.user_id = $2 OR tc.user_id IS NOT NULL)`,
        [threadId, userId],
    );
    const row = result.rows[0] ?? null;
    if (!tx) {
        threadAccessCache.set(threadAccessCacheKey(threadId, userId), { v: row });
    }
    return row;
};

export const listForUser = async (userId: string, tx?: Tx): Promise<ThreadRow[]> => {
    await ensureSchema();
    const result = await q(tx).query<ThreadRow>(
        `SELECT t.* FROM public.threads t
         LEFT JOIN public.thread_collaborators tc ON tc.thread_id = t.id AND tc.user_id = $1
         WHERE t.user_id = $1 OR tc.user_id IS NOT NULL
         ORDER BY t.updated_at DESC
         LIMIT 200`,
        [userId],
    );
    return result.rows;
};

export const touch = async (
    threadId: string,
    tx?: Tx,
    meta?: { lastMode?: 'plan' | 'build' | null; planContextUpdated?: boolean },
): Promise<void> => {
    await ensureSchema();
    const hasMode = typeof meta?.lastMode !== 'undefined';
    const shouldMarkPlanUpdate = !!meta?.planContextUpdated;
    if (!hasMode && !shouldMarkPlanUpdate) {
        await q(tx).query(
            `UPDATE public.threads SET updated_at = now() WHERE id = $1`,
            [threadId],
        );
        return;
    }
    await q(tx).query(
        `UPDATE public.threads
         SET updated_at = now(),
             last_mode = COALESCE($2, last_mode),
             plan_context_updated_at = CASE WHEN $3 THEN now() ELSE plan_context_updated_at END
         WHERE id = $1`,
        [threadId, meta?.lastMode ?? null, shouldMarkPlanUpdate],
    );
};

export const deleteForOwner = async (
    threadId: string,
    userId: string,
    tx?: Tx,
): Promise<boolean> => {
    await ensureSchema();
    const result = await q(tx).query(
        `DELETE FROM public.threads WHERE id = $1 AND user_id = $2`,
        [threadId, userId],
    );
    return (result.rowCount ?? 0) > 0;
};
