import { getPool, Tx } from '../config/db';
import { MessageRole, MessageRow, MessageStatus } from './types';

const q = (tx: Tx | undefined) => tx ?? getPool();

/**
 * Allocate the next per-thread `seq`. MUST be called inside a transaction
 * that holds the per-thread advisory lock (see withThreadLock).
 */
export const nextSeq = async (threadId: string, tx: Tx): Promise<number> => {
    const result = await tx.query<{ next: string }>(
        `SELECT COALESCE(MAX(seq), 0) + 1 AS next
         FROM public.messages
         WHERE thread_id = $1`,
        [threadId],
    );
    return Number(result.rows[0].next);
};

export interface InsertMessageInput {
    threadId: string;
    userId: string;
    role: MessageRole;
    seq: number;
    content?: string;
    rawContent?: string | null;
    model?: string | null;
    status?: MessageStatus;
}

export const insert = async (input: InsertMessageInput, tx: Tx): Promise<MessageRow> => {
    const result = await tx.query<MessageRow>(
        `INSERT INTO public.messages
            (thread_id, user_id, role, seq, content, raw_content, model, status,
             completed_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8,
             CASE WHEN $8 = 'complete' THEN now() ELSE NULL END)
         RETURNING *`,
        [
            input.threadId,
            input.userId,
            input.role,
            input.seq,
            input.content ?? '',
            input.rawContent ?? null,
            input.model ?? null,
            input.status ?? 'complete',
        ],
    );
    return result.rows[0];
};

export interface FinalizeMessageInput {
    id: string;
    content: string;
    rawContent: string;
    status: Extract<MessageStatus, 'complete' | 'error' | 'aborted'>;
    error?: string | null;
}

export const finalize = async (input: FinalizeMessageInput, tx: Tx): Promise<void> => {
    await tx.query(
        `UPDATE public.messages
         SET content = $2,
             raw_content = $3,
             status = $4,
             error = $5,
             completed_at = now()
         WHERE id = $1`,
        [input.id, input.content, input.rawContent, input.status, input.error ?? null],
    );
};

export const markAborted = async (id: string, error: string | null, tx?: Tx): Promise<void> => {
    await q(tx).query(
        `UPDATE public.messages
         SET status = 'aborted', error = $2, completed_at = now()
         WHERE id = $1 AND status = 'streaming'`,
        [id, error],
    );
};

export const listForThread = async (threadId: string, tx?: Tx): Promise<MessageRow[]> => {
    const result = await q(tx).query<MessageRow>(
        `SELECT * FROM public.messages
         WHERE thread_id = $1
         ORDER BY seq ASC`,
        [threadId],
    );
    return result.rows;
};

/**
 * Fetch the most recent N messages in chronological order. Used to build the
 * conversational tail injected into the AI prompt.
 */
export const recentForThread = async (
    threadId: string,
    limit: number,
    tx?: Tx,
): Promise<MessageRow[]> => {
    const result = await q(tx).query<MessageRow>(
        `SELECT *
         FROM (
            SELECT * FROM public.messages
            WHERE thread_id = $1 AND status = 'complete'
            ORDER BY seq DESC
            LIMIT $2
         ) t
         ORDER BY seq ASC`,
        [threadId, limit],
    );
    return result.rows;
};

/**
 * Mark every leftover streaming message as aborted. Run on boot to clean up
 * messages whose request was killed mid-stream by a server restart/crash.
 */
export const abortOrphanStreaming = async (): Promise<number> => {
    const result = await getPool().query(
        `UPDATE public.messages
         SET status = 'aborted',
             error = 'server restarted before stream completed',
             completed_at = now()
         WHERE status = 'streaming'`,
    );
    return result.rowCount ?? 0;
};
