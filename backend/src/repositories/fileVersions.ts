import { getPool, Tx } from '../config/db';
import { FileVersionRow, ThreadFileStateRow } from './types';

const q = (tx: Tx | undefined) => tx ?? getPool();

export interface InsertFileVersionInput {
    threadId: string;
    messageId: string;
    filePath: string;
    blobSha256: string;
    isDeletion?: boolean;
}

/**
 * Append a new file version. Computes `version` as `max(version)+1` for the
 * (thread_id, file_path) pair within the same statement, so the per-thread
 * advisory lock is sufficient to keep versions monotonic.
 */
export const insert = async (
    input: InsertFileVersionInput,
    tx: Tx,
): Promise<FileVersionRow> => {
    const result = await tx.query<FileVersionRow>(
        `INSERT INTO public.file_versions
            (thread_id, message_id, file_path, version, blob_sha256, is_deletion)
         VALUES (
            $1, $2, $3,
            COALESCE((SELECT MAX(version) FROM public.file_versions WHERE thread_id = $1 AND file_path = $3), 0) + 1,
            $4, $5
         )
         RETURNING *`,
        [
            input.threadId,
            input.messageId,
            input.filePath,
            input.blobSha256,
            input.isDeletion ?? false,
        ],
    );
    return result.rows[0];
};

export const listForMessage = async (
    messageId: string,
    tx?: Tx,
): Promise<FileVersionRow[]> => {
    const result = await q(tx).query<FileVersionRow>(
        `SELECT * FROM public.file_versions
         WHERE message_id = $1
         ORDER BY file_path ASC`,
        [messageId],
    );
    return result.rows;
};

/**
 * Current consolidated snapshot for a thread (latest non-deleted version of
 * every file). Reads the maintained denormalized cache.
 */
export const currentSnapshot = async (
    threadId: string,
    tx?: Tx,
): Promise<ThreadFileStateRow[]> => {
    const result = await q(tx).query<ThreadFileStateRow>(
        `SELECT * FROM public.thread_file_state
         WHERE thread_id = $1 AND is_deleted = false`,
        [threadId],
    );
    return result.rows;
};

/**
 * Point-in-time snapshot: latest version of each file as of (and including)
 * the message identified by `seqInclusive`.
 */
export const snapshotAtSeq = async (
    threadId: string,
    seqInclusive: number,
    tx?: Tx,
): Promise<FileVersionRow[]> => {
    const result = await q(tx).query<FileVersionRow>(
        `SELECT DISTINCT ON (fv.file_path) fv.*
         FROM public.file_versions fv
         JOIN public.messages m ON m.id = fv.message_id
         WHERE fv.thread_id = $1 AND m.seq <= $2
         ORDER BY fv.file_path ASC, fv.version DESC`,
        [threadId, seqInclusive],
    );
    return result.rows.filter((r) => !r.is_deletion);
};
