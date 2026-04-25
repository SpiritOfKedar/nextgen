import { getPool, Tx } from '../config/db';

const q = (tx: Tx | undefined) => tx ?? getPool();

export const insertBatch = async (
    threadId: string,
    messageId: string,
    commands: string[],
    tx: Tx,
): Promise<void> => {
    if (commands.length === 0) return;
    const values: string[] = [];
    const params: unknown[] = [];
    commands.forEach((command, i) => {
        const offset = i * 4;
        values.push(`($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4})`);
        params.push(threadId, messageId, i, command);
    });
    await tx.query(
        `INSERT INTO public.shell_commands (thread_id, message_id, idx, command)
         VALUES ${values.join(', ')}`,
        params,
    );
};

export const listForMessage = async (
    messageId: string,
    tx?: Tx,
): Promise<{ idx: number; command: string }[]> => {
    const result = await q(tx).query<{ idx: number; command: string }>(
        `SELECT idx, command FROM public.shell_commands
         WHERE message_id = $1
         ORDER BY idx ASC`,
        [messageId],
    );
    return result.rows;
};
