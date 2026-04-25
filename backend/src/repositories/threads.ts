import { getPool, Tx } from '../config/db';
import { ThreadRow } from './types';

const q = (tx: Tx | undefined) => tx ?? getPool();

export const create = async (
    userId: string,
    title: string,
    tx?: Tx,
): Promise<ThreadRow> => {
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
    const result = await q(tx).query<ThreadRow>(
        `SELECT * FROM public.threads WHERE id = $1 AND user_id = $2`,
        [threadId, userId],
    );
    return result.rows[0] ?? null;
};

export const listForUser = async (userId: string, tx?: Tx): Promise<ThreadRow[]> => {
    const result = await q(tx).query<ThreadRow>(
        `SELECT * FROM public.threads
         WHERE user_id = $1
         ORDER BY updated_at DESC
         LIMIT 200`,
        [userId],
    );
    return result.rows;
};

export const touch = async (threadId: string, tx?: Tx): Promise<void> => {
    await q(tx).query(
        `UPDATE public.threads SET updated_at = now() WHERE id = $1`,
        [threadId],
    );
};
