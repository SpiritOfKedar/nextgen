import dotenv from 'dotenv';
dotenv.config();

import { Pool } from 'pg';
import { B2_BLOB_INLINE_MAX_BYTES, isB2Enabled } from '../config/b2';
import { blobKey, headObject, putObject, snapshotKey } from '../services/b2StorageService';
import { log, errorFields } from '../lib/logger';

const SNAPSHOT_BATCH_SIZE = 5;
const BLOB_BATCH_SIZE = 50;

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

const createPool = (): Pool => {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL must be set');
    return new Pool({
        connectionString: sanitizePgConnectionString(url),
        ssl: { rejectUnauthorized: false },
        max: 3,
        connectionTimeoutMillis: 30_000,
    });
};

const migrateSnapshots = async (pool: Pool): Promise<number> => {
    let migrated = 0;
    for (;;) {
        const result = await pool.query<{
            fingerprint: string;
            payload: Buffer;
            storage_path: string | null;
        }>(
            `SELECT fingerprint, payload, storage_path
             FROM public.sandbox_snapshots
             WHERE payload IS NOT NULL
             ORDER BY octet_length(payload) DESC
             LIMIT $1`,
            [SNAPSHOT_BATCH_SIZE],
        );
        if (result.rows.length === 0) break;

        for (const row of result.rows) {
            const key = row.storage_path || snapshotKey(row.fingerprint);
            try {
                if (row.storage_path && (await headObject(key))) {
                    await pool.query(
                        `UPDATE public.sandbox_snapshots
                         SET payload = NULL, byte_size = COALESCE(byte_size, $2)
                         WHERE fingerprint = $1`,
                        [row.fingerprint, row.payload.byteLength],
                    );
                    migrated += 1;
                    continue;
                }

                await putObject(key, row.payload, 'application/gzip');
                await pool.query(
                    `UPDATE public.sandbox_snapshots
                     SET storage_path = $2, byte_size = $3, payload = NULL
                     WHERE fingerprint = $1`,
                    [row.fingerprint, key, row.payload.byteLength],
                );
                migrated += 1;
                log.info('migrate.b2.snapshot', { fingerprint: row.fingerprint, bytes: row.payload.byteLength });
            } catch (error) {
                log.error('migrate.b2.snapshot_failed', {
                    fingerprint: row.fingerprint,
                    ...errorFields(error),
                });
                throw error;
            }
        }
    }
    return migrated;
};

const migrateBlobs = async (pool: Pool): Promise<number> => {
    let migrated = 0;
    for (;;) {
        const result = await pool.query<{
            sha256: string;
            content: string;
            size_bytes: number;
            storage_path: string | null;
        }>(
            `SELECT sha256, content, size_bytes, storage_path
             FROM public.code_blobs
             WHERE content IS NOT NULL
               AND size_bytes > $1
             ORDER BY size_bytes DESC
             LIMIT $2`,
            [B2_BLOB_INLINE_MAX_BYTES, BLOB_BATCH_SIZE],
        );
        if (result.rows.length === 0) break;

        for (const row of result.rows) {
            const key = row.storage_path || blobKey(row.sha256);
            try {
                if (row.storage_path && (await headObject(key))) {
                    await pool.query(
                        `UPDATE public.code_blobs SET content = NULL WHERE sha256 = $1`,
                        [row.sha256],
                    );
                    migrated += 1;
                    continue;
                }

                const body = Buffer.from(row.content, 'utf8');
                await putObject(key, body, 'text/plain; charset=utf-8');
                await pool.query(
                    `UPDATE public.code_blobs
                     SET storage_path = $2, content = NULL
                     WHERE sha256 = $1`,
                    [row.sha256, key],
                );
                migrated += 1;
                log.info('migrate.b2.blob', { sha256: row.sha256, bytes: row.size_bytes });
            } catch (error) {
                log.error('migrate.b2.blob_failed', {
                    sha256: row.sha256,
                    ...errorFields(error),
                });
                throw error;
            }
        }
    }
    return migrated;
};

const printStats = async (pool: Pool): Promise<void> => {
    const stats = await pool.query<{
        snapshots_inline: string;
        snapshots_b2: string;
        blobs_inline_large: string;
        blobs_b2: string;
    }>(`
        SELECT
            (SELECT COUNT(*)::text FROM public.sandbox_snapshots WHERE payload IS NOT NULL) AS snapshots_inline,
            (SELECT COUNT(*)::text FROM public.sandbox_snapshots WHERE storage_path IS NOT NULL) AS snapshots_b2,
            (SELECT COUNT(*)::text FROM public.code_blobs WHERE content IS NOT NULL AND size_bytes > $1) AS blobs_inline_large,
            (SELECT COUNT(*)::text FROM public.code_blobs WHERE storage_path IS NOT NULL) AS blobs_b2
    `, [B2_BLOB_INLINE_MAX_BYTES]);
    const row = stats.rows[0];
    log.info('migrate.b2.stats', {
        snapshotsInlineRemaining: row?.snapshots_inline,
        snapshotsOnB2: row?.snapshots_b2,
        largeBlobsInlineRemaining: row?.blobs_inline_large,
        blobsOnB2: row?.blobs_b2,
    });
};

const main = async (): Promise<void> => {
    if (!isB2Enabled()) {
        throw new Error('B2 is not configured. Set B2_KEY_ID, B2_APPLICATION_KEY, B2_BUCKET, and B2_ENDPOINT.');
    }

    const pool = createPool();
    try {
        await pool.query(`SET statement_timeout = 600000`);
        log.info('migrate.b2.start', { inlineMaxBytes: B2_BLOB_INLINE_MAX_BYTES });

        const snapshotsMigrated = await migrateSnapshots(pool);
        const blobsMigrated = await migrateBlobs(pool);

        await printStats(pool);
        log.info('migrate.b2.complete', { snapshotsMigrated, blobsMigrated });
    } finally {
        await pool.end();
    }
};

main().catch((error) => {
    log.error('migrate.b2.failed', errorFields(error));
    process.exit(1);
});
