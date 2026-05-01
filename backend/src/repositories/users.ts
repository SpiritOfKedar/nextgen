import { getPool, Tx } from '../config/db';
import { UserRow } from './types';

const q = (tx: Tx | undefined) => tx ?? getPool();

/**
 * Race-safe upsert of a Clerk user. Two simultaneous first-time logins for the
 * same clerk_id resolve to a single row.
 */
export const upsertByClerkId = async (
    clerkId: string,
    email: string,
    tx?: Tx,
): Promise<UserRow> => {
    const result = await q(tx).query<UserRow>(
        `INSERT INTO public.users (clerk_id, email)
         VALUES ($1, $2)
         ON CONFLICT (clerk_id) DO UPDATE SET email = EXCLUDED.email
         RETURNING *`,
        [clerkId, email],
    );
    return result.rows[0];
};

export const findByClerkId = async (clerkId: string, tx?: Tx): Promise<UserRow | null> => {
    const result = await q(tx).query<UserRow>(
        `SELECT * FROM public.users WHERE clerk_id = $1`,
        [clerkId],
    );
    return result.rows[0] ?? null;
};

export const findByEmail = async (email: string, tx?: Tx): Promise<UserRow | null> => {
    const result = await q(tx).query<UserRow>(
        `SELECT * FROM public.users WHERE email = $1`,
        [email],
    );
    return result.rows[0] ?? null;
};
