import { getPool, Tx } from '../config/db';

const q = (tx: Tx | undefined) => tx ?? getPool();

/**
 * Persist a batch of streamed chunks for `messageId` starting at `startIdx`.
 * Used by the streaming flush path; race-safe via the (message_id, idx) unique
 * index.
 */
export const insertBatch = async (
    messageId: string,
    startIdx: number,
    deltas: string[],
    tx?: Tx,
): Promise<void> => {
    if (deltas.length === 0) return;
    const values: string[] = [];
    const params: unknown[] = [];
    deltas.forEach((delta, i) => {
        const offset = i * 3;
        values.push(`($${offset + 1}, $${offset + 2}, $${offset + 3})`);
        params.push(messageId, startIdx + i, delta);
    });
    await q(tx).query(
        `INSERT INTO public.message_chunks (message_id, idx, delta)
         VALUES ${values.join(', ')}
         ON CONFLICT (message_id, idx) DO NOTHING`,
        params,
    );
};

export const concatenate = async (messageId: string, tx?: Tx): Promise<string> => {
    const result = await q(tx).query<{ delta: string }>(
        `SELECT delta FROM public.message_chunks
         WHERE message_id = $1
         ORDER BY idx ASC`,
        [messageId],
    );
    return result.rows.map((r) => r.delta).join('');
};
