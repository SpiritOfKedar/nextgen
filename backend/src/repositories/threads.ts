import { getPool, Tx } from '../config/db';
import { ThreadRow } from './types';

const q = (tx: Tx | undefined) => tx ?? getPool();

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

export const findByIdForUser = async (
    threadId: string,
    userId: string,
    tx?: Tx,
): Promise<ThreadRow | null> => {
    await ensureSchema();
    const result = await q(tx).query<ThreadRow>(
        `SELECT * FROM public.threads WHERE id = $1 AND user_id = $2`,
        [threadId, userId],
    );
    return result.rows[0] ?? null;
};

export const listForUser = async (userId: string, tx?: Tx): Promise<ThreadRow[]> => {
    await ensureSchema();
    const result = await q(tx).query<ThreadRow>(
        `SELECT * FROM public.threads
         WHERE user_id = $1
         ORDER BY updated_at DESC
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
