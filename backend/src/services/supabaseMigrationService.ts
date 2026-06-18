import { Client } from 'pg';
import { createHash } from 'crypto';
import { getPool } from '../config/db';
import { log, errorFields } from '../lib/logger';

/** Patterns we refuse to run without an explicit confirmation flag. */
const DESTRUCTIVE_PATTERNS = [
    /\bdrop\s+database\b/i,
    /\bdrop\s+schema\b/i,
    /\btruncate\b/i,
];

export interface MigrationInput {
    migrationId: string;
    sql: string;
}

export interface MigrationResult {
    migrationId: string;
    status: 'applied' | 'skipped' | 'blocked' | 'failed';
    detail?: string;
}

/** Parse the project ref (subdomain) from a Supabase project URL. */
export const parseProjectRef = (projectUrl: string): string | null => {
    try {
        const host = new URL(projectUrl).host;
        const ref = host.split('.')[0];
        return ref || null;
    } catch {
        return null;
    }
};

const hashSql = (sql: string): string => createHash('sha256').update(sql).digest('hex');

const isDestructive = (sql: string): boolean => DESTRUCTIVE_PATTERNS.some((p) => p.test(sql));

/**
 * Create a short-lived client to the user's Supabase Postgres. Supabase serves a
 * managed certificate, but pooler hosts can present a chain `pg` rejects by default,
 * so we relax verification like the platform pool does for Neon.
 */
const createUserDbClient = (databaseUrl: string): Client =>
    new Client({
        connectionString: databaseUrl,
        ssl: { rejectUnauthorized: false },
        statement_timeout: 30_000,
        connectionTimeoutMillis: 15_000,
    });

/** Run `SELECT 1` to confirm the database URL is reachable and writable-capable. */
export const validateDatabaseUrl = async (databaseUrl: string): Promise<void> => {
    const client = createUserDbClient(databaseUrl);
    await client.connect();
    try {
        await client.query('SELECT 1');
    } finally {
        await client.end();
    }
};

const recordMigration = async (userId: string, migrationId: string, sqlHash: string): Promise<void> => {
    await getPool().query(
        `INSERT INTO public.user_supabase_migrations (user_id, migration_id, sql_hash, applied_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (user_id, migration_id) DO UPDATE SET
           sql_hash = EXCLUDED.sql_hash,
           applied_at = NOW()`,
        [userId, migrationId, sqlHash],
    );
};

const alreadyApplied = async (userId: string, migrationId: string, sqlHash: string): Promise<boolean> => {
    const { rows } = await getPool().query(
        `SELECT sql_hash FROM public.user_supabase_migrations WHERE user_id = $1 AND migration_id = $2`,
        [userId, migrationId],
    );
    return rows[0]?.sql_hash === sqlHash;
};

/**
 * Apply a single SQL migration against the user's Supabase database. Idempotent by
 * (migrationId, sql hash): an unchanged migration that already ran is skipped.
 */
export const applyMigration = async (
    userId: string,
    databaseUrl: string,
    input: MigrationInput,
    options: { allowDestructive?: boolean; requestId?: string } = {},
): Promise<MigrationResult> => {
    const sql = input.sql.trim();
    const migrationId = input.migrationId.trim();

    if (!sql) return { migrationId, status: 'skipped', detail: 'Empty migration SQL.' };
    if (!migrationId) return { migrationId, status: 'failed', detail: 'Missing migration id.' };

    const sqlHash = hashSql(sql);

    if (await alreadyApplied(userId, migrationId, sqlHash)) {
        return { migrationId, status: 'skipped', detail: 'Already applied.' };
    }

    if (isDestructive(sql) && !options.allowDestructive) {
        return {
            migrationId,
            status: 'blocked',
            detail: 'Migration contains a destructive statement (DROP DATABASE/SCHEMA or TRUNCATE). Re-run with confirmation to apply.',
        };
    }

    const client = createUserDbClient(databaseUrl);
    try {
        await client.connect();
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('COMMIT');
    } catch (error) {
        try { await client.query('ROLLBACK'); } catch { /* ignore */ }
        log.error('supabase.migration_failed', { requestId: options.requestId, migrationId, ...errorFields(error) });
        return {
            migrationId,
            status: 'failed',
            detail: error instanceof Error ? error.message : String(error),
        };
    } finally {
        await client.end().catch(() => { /* ignore */ });
    }

    await recordMigration(userId, migrationId, sqlHash);
    log.info('supabase.migration_applied', { requestId: options.requestId, internalUserId: userId, migrationId });
    return { migrationId, status: 'applied' };
};

export const listAppliedMigrationIds = async (userId: string): Promise<string[]> => {
    const { rows } = await getPool().query(
        `SELECT migration_id FROM public.user_supabase_migrations WHERE user_id = $1 ORDER BY applied_at ASC`,
        [userId],
    );
    return rows.map((r) => r.migration_id as string);
};
