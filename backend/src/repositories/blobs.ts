import { createHash } from 'crypto';
import { LRUCache } from 'lru-cache';
import { getPool, getSupabase, STORAGE_BUCKET, Tx } from '../config/db';
import { CodeBlobRow } from './types';

const q = (tx: Tx | undefined) => tx ?? getPool();

// Files smaller than this live inline in code_blobs.content (skip the Storage
// round trip on read).
const INLINE_THRESHOLD_BYTES = 2048;

// In-process LRU keyed by sha256 -> file content. After the first chat turn
// most repeat reads come from here.
const blobCache = new LRUCache<string, string>({
    max: 4096,                  // up to ~4k unique file versions cached
    maxSize: 64 * 1024 * 1024,  // ~64MB total
    sizeCalculation: (value) => Buffer.byteLength(value, 'utf8'),
});

export const sha256Hex = (content: string): string =>
    createHash('sha256').update(content, 'utf8').digest('hex');

const storagePathFor = (sha: string): string =>
    `${sha.slice(0, 2)}/${sha.slice(2, 4)}/${sha}`;

/**
 * Idempotently store a file's content in Supabase Storage (or inline) and
 * insert the corresponding code_blobs row. Safe under concurrent callers
 * uploading the same content.
 *
 * Returns the sha256.
 */
export const putBlob = async (content: string, tx?: Tx): Promise<string> => {
    const sha = sha256Hex(content);
    const sizeBytes = Buffer.byteLength(content, 'utf8');

    // Already in DB? skip Storage upload entirely.
    const existing = await q(tx).query<{ sha256: string }>(
        `SELECT sha256 FROM public.code_blobs WHERE sha256 = $1`,
        [sha],
    );
    if (existing.rows.length > 0) {
        blobCache.set(sha, content);
        return sha;
    }

    let storagePath: string | null = null;
    let inlineContent: string | null = null;

    if (sizeBytes <= INLINE_THRESHOLD_BYTES) {
        inlineContent = content;
    } else {
        storagePath = storagePathFor(sha);
        const { error } = await getSupabase()
            .storage
            .from(STORAGE_BUCKET)
            .upload(storagePath, Buffer.from(content, 'utf8'), {
                contentType: 'text/plain; charset=utf-8',
                upsert: true,
            });
        if (error) {
            throw new Error(`Storage upload failed for ${sha}: ${error.message}`);
        }
    }

    await q(tx).query(
        `INSERT INTO public.code_blobs (sha256, size_bytes, storage_path, mime_type, content)
         VALUES ($1, $2, $3, 'text/plain', $4)
         ON CONFLICT (sha256) DO NOTHING`,
        [sha, sizeBytes, storagePath, inlineContent],
    );

    blobCache.set(sha, content);
    return sha;
};

/** Load bytes for a row returned from code_blobs (LRU → inline column → Storage). */
const materializeBlob = async (row: CodeBlobRow): Promise<string> => {
    const sha = row.sha256;
    const cached = blobCache.get(sha);
    if (cached !== undefined) return cached;

    if (row.content !== null) {
        blobCache.set(sha, row.content);
        return row.content;
    }
    if (!row.storage_path) {
        throw new Error(`Blob ${sha} has no storage_path and no inline content`);
    }
    const { data, error } = await getSupabase()
        .storage
        .from(STORAGE_BUCKET)
        .download(row.storage_path);
    if (error || !data) {
        throw new Error(`Storage download failed for ${sha}: ${error?.message}`);
    }
    const content = Buffer.from(await data.arrayBuffer()).toString('utf8');
    blobCache.set(sha, content);
    return content;
};

/**
 * Resolve a sha256 to its content, using (1) the in-process LRU,
 * (2) the inlined content column, (3) Supabase Storage — in that order.
 */
export const getBlob = async (sha: string, tx?: Tx): Promise<string> => {
    const cached = blobCache.get(sha);
    if (cached !== undefined) return cached;

    const result = await q(tx).query<CodeBlobRow>(
        `SELECT * FROM public.code_blobs WHERE sha256 = $1`,
        [sha],
    );
    const row = result.rows[0];
    if (!row) throw new Error(`Blob not found: ${sha}`);
    return materializeBlob(row);
};

/**
 * Resolve many shas in parallel. Uses one DB round-trip for metadata, then
 * parallel Storage downloads — avoids N sequential SELECTs on large snapshots.
 */
export const getBlobs = async (shas: string[], tx?: Tx): Promise<Map<string, string>> => {
    const out = new Map<string, string>();
    const unique = Array.from(new Set(shas));
    const needDb: string[] = [];
    for (const sha of unique) {
        const cached = blobCache.get(sha);
        if (cached !== undefined) out.set(sha, cached);
        else needDb.push(sha);
    }
    if (needDb.length === 0) return out;

    const result = await q(tx).query<CodeBlobRow>(
        `SELECT * FROM public.code_blobs WHERE sha256 = ANY($1::text[])`,
        [needDb],
    );
    const bySha = new Map(result.rows.map((r) => [r.sha256, r]));

    await Promise.all(
        needDb.map(async (sha) => {
            const row = bySha.get(sha);
            if (!row) throw new Error(`Blob not found: ${sha}`);
            out.set(sha, await materializeBlob(row));
        }),
    );
    return out;
};
