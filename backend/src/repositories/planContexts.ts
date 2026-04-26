import { getPool, Tx } from '../config/db';

export interface UpsertPlanContextInput {
    threadId: string;
    userId: string;
    planContext: string;
    sourceMessageId: string;
}

let schemaEnsured = false;

const ensureSchema = async (): Promise<void> => {
    if (schemaEnsured) return;
    const pool = getPool();
    await pool.query(`
        CREATE TABLE IF NOT EXISTS public.thread_plan_contexts (
            thread_id UUID PRIMARY KEY REFERENCES public.threads(id) ON DELETE CASCADE,
            user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
            plan_context TEXT NOT NULL,
            source_message_id UUID NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);
    await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_thread_plan_contexts_user_updated
            ON public.thread_plan_contexts(user_id, updated_at DESC)
    `);
    schemaEnsured = true;
};

export const upsertPlanContext = async (
    input: UpsertPlanContextInput,
    tx: Tx,
): Promise<void> => {
    await ensureSchema();
    await tx.query(
        `INSERT INTO public.thread_plan_contexts
            (thread_id, user_id, plan_context, source_message_id, updated_at)
         VALUES ($1, $2, $3, $4, now())
         ON CONFLICT (thread_id)
         DO UPDATE SET
            user_id = EXCLUDED.user_id,
            plan_context = EXCLUDED.plan_context,
            source_message_id = EXCLUDED.source_message_id,
            updated_at = now()`,
        [input.threadId, input.userId, input.planContext, input.sourceMessageId],
    );
};

export const getPlanContext = async (
    threadId: string,
    userId: string,
    tx?: Tx,
): Promise<{ planContext: string; sourceMessageId: string; updatedAt: string } | null> => {
    await ensureSchema();
    const pool = tx ?? getPool();
    const result = await pool.query<{
        plan_context: string;
        source_message_id: string;
        updated_at: string;
    }>(
        `SELECT plan_context, source_message_id, updated_at
         FROM public.thread_plan_contexts
         WHERE thread_id = $1 AND user_id = $2`,
        [threadId, userId],
    );
    if (result.rows.length === 0) return null;
    return {
        planContext: result.rows[0].plan_context,
        sourceMessageId: result.rows[0].source_message_id,
        updatedAt: result.rows[0].updated_at,
    };
};
