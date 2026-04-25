import { Pool, PoolClient } from 'pg';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

let pool: Pool | null = null;
let supabase: SupabaseClient | null = null;

const createPgPool = (connectionString: string): Pool => {
    const nextPool = new Pool({
        connectionString,
        ssl: { rejectUnauthorized: false },
        max: 10,
        idleTimeoutMillis: 30_000,
    });
    nextPool.on('error', (err) => {
        console.error('[pg] Idle client error:', err.message);
    });
    return nextPool;
};

const isSupabasePoolerUrl = (connectionString: string): boolean => {
    try {
        return new URL(connectionString).hostname.endsWith('.pooler.supabase.com');
    } catch {
        return false;
    }
};

const deriveDirectSupabaseDbUrl = (poolerConnectionString: string): string | null => {
    try {
        const supabaseUrl = process.env.SUPABASE_URL;
        if (!supabaseUrl) return null;

        const projectRef = new URL(supabaseUrl).hostname.split('.')[0];
        if (!projectRef) return null;

        const direct = new URL(poolerConnectionString);
        if (!direct.hostname.endsWith('.pooler.supabase.com')) return null;

        direct.hostname = `db.${projectRef}.supabase.co`;
        direct.port = '5432';
        direct.username = 'postgres';
        if (!direct.pathname || direct.pathname === '/') {
            direct.pathname = '/postgres';
        }
        direct.searchParams.set('uselibpqcompat', 'true');
        direct.searchParams.set('sslmode', 'require');

        return direct.toString();
    } catch {
        return null;
    }
};

const isPoolerTenantError = (error: unknown): boolean => {
    return error instanceof Error && /tenant or user not found/i.test(error.message);
};

const pingPool = async (targetPool: Pool): Promise<void> => {
    const client = await targetPool.connect();
    try {
        await client.query('SELECT 1');
    } finally {
        client.release();
    }
};

export const STORAGE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET || 'code-files';

export const getPool = (): Pool => {
    if (pool) return pool;
    const connectionString = process.env.SUPABASE_DB_URL;
    if (!connectionString) {
        throw new Error('SUPABASE_DB_URL is not set');
    }
    pool = createPgPool(connectionString);
    return pool;
};

export const getSupabase = (): SupabaseClient => {
    if (supabase) return supabase;
    const url = process.env.SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !serviceKey) {
        throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
    }
    supabase = createClient(url, serviceKey, {
        auth: { persistSession: false, autoRefreshToken: false },
    });
    return supabase;
};

export const connectDB = async (): Promise<void> => {
    const connectionString = process.env.SUPABASE_DB_URL;
    let activePool = getPool();

    try {
        await pingPool(activePool);
        console.log('[db] Postgres connected');
    } catch (error) {
        const fallbackUrl = connectionString && isSupabasePoolerUrl(connectionString)
            ? deriveDirectSupabaseDbUrl(connectionString)
            : null;

        if (!fallbackUrl || !isPoolerTenantError(error)) {
            throw error;
        }

        console.warn('[db] Supabase pooler auth failed ("Tenant or user not found"). Retrying with direct DB host.');

        try {
            await activePool.end();
        } catch {
            // Ignore teardown errors and continue with fallback pool creation.
        }

        activePool = createPgPool(fallbackUrl);
        pool = activePool;

        try {
            await pingPool(activePool);
            console.log('[db] Postgres connected (direct host fallback)');
        } catch (fallbackError) {
            pool = null;
            throw fallbackError;
        }
    }

    getSupabase();
    console.log(`[db] Supabase Storage client ready (bucket: ${STORAGE_BUCKET})`);
};

export type Tx = PoolClient;

/**
 * Run `fn` inside a transaction. Rolls back on throw, commits on success.
 * The PoolClient is released in either case.
 */
export const withTransaction = async <T>(fn: (tx: Tx) => Promise<T>): Promise<T> => {
    const client = await getPool().connect();
    try {
        await client.query('BEGIN');
        const result = await fn(client);
        await client.query('COMMIT');
        return result;
    } catch (err) {
        try { await client.query('ROLLBACK'); } catch { /* ignore */ }
        throw err;
    } finally {
        client.release();
    }
};

/**
 * Run `fn` inside a transaction that holds a per-thread advisory lock.
 * Serializes concurrent submissions to the same thread so seq allocation
 * and file version numbering are race-free.
 */
export const withThreadLock = async <T>(threadId: string, fn: (tx: Tx) => Promise<T>): Promise<T> => {
    return withTransaction(async (tx) => {
        await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [threadId]);
        return fn(tx);
    });
};
