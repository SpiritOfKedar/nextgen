import { Pool, PoolClient } from 'pg';
import { log, errorFields } from '../lib/logger';
import { ensureRuntimeSchema } from './runtimeSchema';
import { checkB2Connectivity } from '../services/b2StorageService';
import { isB2Enabled } from './b2';

let pool: Pool | null = null;
let appReady = false;
let bootError: Error | null = null;

const DEFAULT_DB_CONNECT_TIMEOUT_MS = 10_000;
const DEFAULT_PG_POOL_MAX = 25;
const MAX_PG_POOL_MAX = 100;

const parseTimeoutMs = (raw: string | undefined, fallbackMs: number): number => {
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallbackMs;
    return Math.floor(parsed);
};

const DB_CONNECT_TIMEOUT_MS = parseTimeoutMs(process.env.DB_CONNECT_TIMEOUT_MS, DEFAULT_DB_CONNECT_TIMEOUT_MS);

/** Session statement_timeout (ms). Chat prep can include DDL-heavy first touches. */
const DB_STATEMENT_TIMEOUT_MS = parseTimeoutMs(process.env.DB_STATEMENT_TIMEOUT_MS, 120_000);

const parsePoolMax = (raw: string | undefined): number => {
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_PG_POOL_MAX;
    return Math.min(Math.floor(parsed), MAX_PG_POOL_MAX);
};

const PG_POOL_MAX = parsePoolMax(process.env.PG_POOL_MAX);

export const isAppReady = (): boolean => appReady;

export const getBootError = (): Error | null => bootError;

const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([
            promise,
            new Promise<T>((_, reject) => {
                timer = setTimeout(() => {
                    reject(new Error(`${label} timed out after ${timeoutMs}ms`));
                }, timeoutMs);
            }),
        ]);
    } finally {
        if (timer) clearTimeout(timer);
    }
};

/**
 * Remove SSL-related query params from the URI. Newer `pg` / `pg-connection-string`
 * can treat `sslmode=require` like strict verification, which fails on some hosts with
 * "self-signed certificate in certificate chain". TLS is still enabled via the Pool
 * `ssl` option below.
 */
const sanitizePgConnectionString = (connectionString: string): string => {
    try {
        const u = new URL(connectionString);
        for (const key of ['sslmode', 'sslrootcert', 'sslcert', 'sslkey', 'sslcrl', 'uselibpqcompat', 'channel_binding']) {
            u.searchParams.delete(key);
        }
        const out = u.toString();
        return out.endsWith('?') ? out.slice(0, -1) : out;
    } catch {
        return connectionString;
    }
};

const resolveDatabaseUrl = (): string => {
    const url = process.env.DATABASE_URL;
    if (!url) {
        throw new Error('DATABASE_URL must be set');
    }
    return url;
};

const createPgPool = (connectionString: string): Pool => {
    const nextPool = new Pool({
        connectionString: sanitizePgConnectionString(connectionString),
        ssl: { rejectUnauthorized: false },
        max: PG_POOL_MAX,
        idleTimeoutMillis: 30_000,
        connectionTimeoutMillis: DB_CONNECT_TIMEOUT_MS,
    });
    nextPool.on('connect', (client) => {
        client.query(`SET statement_timeout = ${DB_STATEMENT_TIMEOUT_MS}`).catch((err) => {
            log.warn('db.statement_timeout_set_failed', errorFields(err));
        });
    });
    nextPool.on('error', (err) => {
        log.error('db.pg_pool_idle_client_error', errorFields(err));
    });
    return nextPool;
};

const pingPool = async (targetPool: Pool): Promise<void> => {
    const client = await withTimeout(
        targetPool.connect(),
        DB_CONNECT_TIMEOUT_MS,
        'Postgres connect'
    );
    try {
        await withTimeout(
            client.query('SELECT 1'),
            DB_CONNECT_TIMEOUT_MS,
            'Postgres ping query'
        );
    } finally {
        client.release();
    }
};

export const getPool = (): Pool => {
    if (pool) return pool;
    pool = createPgPool(resolveDatabaseUrl());
    return pool;
};

export const connectDB = async (): Promise<void> => {
    try {
        const activePool = getPool();

        log.info('db.connect_start', { timeoutMs: DB_CONNECT_TIMEOUT_MS, poolMax: PG_POOL_MAX });
        await pingPool(activePool);
        log.info('db.postgres_connected');

        await ensureRuntimeSchema(getPool());

        if (isB2Enabled()) {
            void checkB2Connectivity();
        }

        appReady = true;
        bootError = null;
        log.info('db.app_ready');
    } catch (err) {
        bootError = err instanceof Error ? err : new Error(String(err));
        throw err;
    }
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
