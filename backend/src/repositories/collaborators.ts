import { getPool, Tx } from '../config/db';

export interface CollaboratorRow {
    thread_id: string;
    user_id: string;
    role: string;
    created_at: string;
    email?: string;
}

const q = (tx: Tx | undefined) => tx ?? getPool();

export const addCollaborator = async (
    threadId: string,
    userId: string,
    role: string = 'editor',
    tx?: Tx,
): Promise<void> => {
    await q(tx).query(
        `INSERT INTO public.thread_collaborators (thread_id, user_id, role)
         VALUES ($1, $2, $3)
         ON CONFLICT (thread_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
        [threadId, userId, role],
    );
};

export const removeCollaborator = async (
    threadId: string,
    userId: string,
    tx?: Tx,
): Promise<void> => {
    await q(tx).query(
        `DELETE FROM public.thread_collaborators
         WHERE thread_id = $1 AND user_id = $2`,
        [threadId, userId],
    );
};

export const getCollaborators = async (
    threadId: string,
    tx?: Tx,
): Promise<CollaboratorRow[]> => {
    const result = await q(tx).query<CollaboratorRow>(
        `SELECT tc.*, u.email 
         FROM public.thread_collaborators tc
         JOIN public.users u ON u.id = tc.user_id
         WHERE tc.thread_id = $1
         ORDER BY tc.created_at ASC`,
        [threadId],
    );
    return result.rows;
};
