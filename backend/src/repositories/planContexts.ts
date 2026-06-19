import { getPool, Tx } from '../config/db';

export interface UpsertPlanContextInput {
    threadId: string;
    userId: string;
    planContext: string;
    supabasePlanExcerpt?: string | null;
    sourceMessageId: string;
}

/** DDL runs once at boot — see config/runtimeSchema.ts */
const ensureSchema = async (): Promise<void> => {};

export const upsertPlanContext = async (
    input: UpsertPlanContextInput,
    tx: Tx,
): Promise<void> => {
    await ensureSchema();
    await tx.query(
        `INSERT INTO public.thread_plan_contexts
            (thread_id, user_id, plan_context, supabase_plan_excerpt, source_message_id, updated_at)
         VALUES ($1, $2, $3, $4, $5, now())
         ON CONFLICT (thread_id)
         DO UPDATE SET
            user_id = EXCLUDED.user_id,
            plan_context = EXCLUDED.plan_context,
            supabase_plan_excerpt = EXCLUDED.supabase_plan_excerpt,
            source_message_id = EXCLUDED.source_message_id,
            updated_at = now()`,
        [
            input.threadId,
            input.userId,
            input.planContext,
            input.supabasePlanExcerpt ?? null,
            input.sourceMessageId,
        ],
    );
};

export const getPlanContext = async (
    threadId: string,
    userId: string,
    tx?: Tx,
): Promise<{
    planContext: string;
    supabasePlanExcerpt: string | null;
    sourceMessageId: string;
    updatedAt: string;
} | null> => {
    await ensureSchema();
    const pool = tx ?? getPool();
    const result = await pool.query<{
        plan_context: string;
        supabase_plan_excerpt: string | null;
        source_message_id: string;
        updated_at: string;
    }>(
        `SELECT plan_context, supabase_plan_excerpt, source_message_id, updated_at
         FROM public.thread_plan_contexts
         WHERE thread_id = $1 AND user_id = $2`,
        [threadId, userId],
    );
    if (result.rows.length === 0) return null;
    return {
        planContext: result.rows[0].plan_context,
        supabasePlanExcerpt: result.rows[0].supabase_plan_excerpt,
        sourceMessageId: result.rows[0].source_message_id,
        updatedAt: result.rows[0].updated_at,
    };
};
