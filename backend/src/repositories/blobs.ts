import { createHash } from 'crypto';
import { LRUCache } from 'lru-cache';
import { getPool, Tx } from '../config/db';
import { B2_BLOB_INLINE_MAX_BYTES, isB2Enabled } from '../config/b2';
import { isRedisEnabled, redisGet, redisMGet, redisSet } from '../lib/redis';
import { blobKey, getObject, putObject } from '../services/b2StorageService';
import { CodeBlobRow } from './types';

const q = (tx: Tx | undefined) => tx ?? getPool();

// L1: in-process LRU keyed by sha256 -> file content.
const blobCache = new LRUCache<string, string>({
    max: 4096,
    maxSize: 64 * 1024 * 1024,
    sizeCalculation: (value) => Buffer.byteLength(value, 'utf8'),
});

/** L2: Redis cache for blobs up to this size (content-addressed, immutable). */
const REDIS_BLOB_MAX_BYTES = 512 * 1024;
const REDIS_BLOB_TTL_SECONDS = 7 * 24 * 60 * 60;

const DEFAULT_BLOB_MATERIALIZE_CONCURRENCY = 10;
const MAX_BLOB_MATERIALIZE_CONCURRENCY = 32;

const blobMaterializeConcurrency = (): number => {
    const parsed = Number(process.env.BLOB_MATERIALIZE_CONCURRENCY);
    if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_BLOB_MATERIALIZE_CONCURRENCY;
    return Math.min(Math.floor(parsed), MAX_BLOB_MATERIALIZE_CONCURRENCY);
};

/** Run async work over `items` with at most `concurrency` in flight. */
const mapWithConcurrency = async <T, R>(
    items: readonly T[],
    concurrency: number,
    fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> => {
    if (items.length === 0) return [];
    const results = new Array<R>(items.length);
    let nextIndex = 0;

    const worker = async (): Promise<void> => {
        while (true) {
            const index = nextIndex;
            nextIndex += 1;
            if (index >= items.length) return;
            results[index] = await fn(items[index], index);
        }
    };

    const workers = Array.from(
        { length: Math.min(concurrency, items.length) },
        () => worker(),
    );
    await Promise.all(workers);
    return results;
};

const blobRedisKey = (sha: string): string => `blob:${sha}`;

const canCacheInRedis = (content: string): boolean =>
    Buffer.byteLength(content, 'utf8') <= REDIS_BLOB_MAX_BYTES;

const cacheBlob = async (sha: string, content: string): Promise<void> => {
    blobCache.set(sha, content);
    if (canCacheInRedis(content)) {
        await redisSet(blobRedisKey(sha), content, REDIS_BLOB_TTL_SECONDS);
    }
};

export const sha256Hex = (content: string): string =>
    createHash('sha256').update(content, 'utf8').digest('hex');

const shouldOffloadToB2 = (sizeBytes: number): boolean =>
    isB2Enabled() && sizeBytes > B2_BLOB_INLINE_MAX_BYTES;

/**
 * Idempotently store a file's content and return the sha256.
 * Large blobs go to B2; small blobs stay inline in Postgres.
 */
export const putBlob = async (content: string, tx?: Tx): Promise<string> => {
    const sha = sha256Hex(content);
    const sizeBytes = Buffer.byteLength(content, 'utf8');

    const existing = await q(tx).query<{ sha256: string }>(
        `SELECT sha256 FROM public.code_blobs WHERE sha256 = $1`,
        [sha],
    );
    if (existing.rows.length > 0) {
        await cacheBlob(sha, content);
        return sha;
    }

    if (shouldOffloadToB2(sizeBytes)) {
        const storagePath = blobKey(sha);
        await putObject(storagePath, Buffer.from(content, 'utf8'), 'text/plain; charset=utf-8');
        await q(tx).query(
            `INSERT INTO public.code_blobs (sha256, size_bytes, storage_path, mime_type, content)
             VALUES ($1, $2, $3, 'text/plain', NULL)
             ON CONFLICT (sha256) DO NOTHING`,
            [sha, sizeBytes, storagePath],
        );
    } else {
        await q(tx).query(
            `INSERT INTO public.code_blobs (sha256, size_bytes, storage_path, mime_type, content)
             VALUES ($1, $2, NULL, 'text/plain', $3)
             ON CONFLICT (sha256) DO NOTHING`,
            [sha, sizeBytes, content],
        );
    }

    await cacheBlob(sha, content);
    return sha;
};

/** Hash + store many blobs concurrently (content-addressed, idempotent). */
export const putBlobs = async (contents: readonly string[]): Promise<string[]> =>
    mapWithConcurrency(contents, blobMaterializeConcurrency(), (content) => putBlob(content));

type MaterializeBlobOptions = {
    /** Caller already batch-checked Redis (e.g. getBlobs MGET). */
    skipRedis?: boolean;
};

const materializeBlob = async (row: CodeBlobRow, options?: MaterializeBlobOptions): Promise<string> => {
    const sha = row.sha256;
    const cached = blobCache.get(sha);
    if (cached !== undefined) return cached;

    if (!options?.skipRedis && isRedisEnabled()) {
        const fromRedis = await redisGet(blobRedisKey(sha));
        if (fromRedis !== null) {
            blobCache.set(sha, fromRedis);
            return fromRedis;
        }
    }

    if (row.content !== null) {
        await cacheBlob(sha, row.content);
        return row.content;
    }

    if (row.storage_path) {
        const bytes = await getObject(row.storage_path);
        if (bytes) {
            const content = bytes.toString('utf8');
            await cacheBlob(sha, content);
            return content;
        }
    }

    throw new Error(`Blob ${sha} has no inline content or B2 object`);
};

/**
 * Resolve a sha256 to its content: L1 LRU -> L2 Redis -> Postgres inline -> B2.
 */
export const getBlob = async (sha: string, tx?: Tx): Promise<string> => {
    const cached = blobCache.get(sha);
    if (cached !== undefined) return cached;

    if (isRedisEnabled()) {
        const fromRedis = await redisGet(blobRedisKey(sha));
        if (fromRedis !== null) {
            blobCache.set(sha, fromRedis);
            return fromRedis;
        }
    }

    const result = await q(tx).query<CodeBlobRow>(
        `SELECT * FROM public.code_blobs WHERE sha256 = $1`,
        [sha],
    );
    const row = result.rows[0];
    if (!row) throw new Error(`Blob not found: ${sha}`);
    return materializeBlob(row);
};

/** Resolve many shas with batched Redis MGET then one DB round-trip for misses. */
export const getBlobs = async (shas: string[], tx?: Tx): Promise<Map<string, string>> => {
    const out = new Map<string, string>();
    const unique = Array.from(new Set(shas));
    const needRedis: string[] = [];

    for (const sha of unique) {
        const cached = blobCache.get(sha);
        if (cached !== undefined) out.set(sha, cached);
        else needRedis.push(sha);
    }

    if (needRedis.length > 0 && isRedisEnabled()) {
        const keys = needRedis.map(blobRedisKey);
        const values = await redisMGet(keys);
        const stillNeedDb: string[] = [];
        for (let i = 0; i < needRedis.length; i += 1) {
            const sha = needRedis[i];
            const value = values[i];
            if (value !== null) {
                blobCache.set(sha, value);
                out.set(sha, value);
            } else {
                stillNeedDb.push(sha);
            }
        }
        needRedis.length = 0;
        needRedis.push(...stillNeedDb);
    }

    if (needRedis.length === 0) return out;

    const result = await q(tx).query<CodeBlobRow>(
        `SELECT * FROM public.code_blobs WHERE sha256 = ANY($1::text[])`,
        [needRedis],
    );
    const bySha = new Map(result.rows.map((r) => [r.sha256, r]));

    const pairs = await mapWithConcurrency(
        needRedis,
        blobMaterializeConcurrency(),
        async (sha) => {
            const row = bySha.get(sha);
            if (!row) throw new Error(`Blob not found: ${sha}`);
            const content = await materializeBlob(row, { skipRedis: true });
            return [sha, content] as const;
        },
    );
    for (const [sha, content] of pairs) {
        out.set(sha, content);
    }
    return out;
};

export const getBlobCacheStats = (): { l1Size: number; redisEnabled: boolean } => ({
    l1Size: blobCache.size,
    redisEnabled: isRedisEnabled(),
});
