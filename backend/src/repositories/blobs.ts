import { createHash } from 'crypto';
import { LRUCache } from 'lru-cache';
import { getPool, Tx } from '../config/db';
import { CodeBlobRow } from './types';

const q = (tx: Tx | undefined) => tx ?? getPool();

// In-process LRU keyed by sha256 -> file content. After the first chat turn
// most repeat reads come from here.
const blobCache = new LRUCache<string, string>({
    max: 4096,
    maxSize: 64 * 1024 * 1024,
    sizeCalculation: (value) => Buffer.byteLength(value, 'utf8'),
});

export const sha256Hex = (content: string): string =>
    createHash('sha256').update(content, 'utf8').digest('hex');

/**
 * Idempotently store a file's content inline in code_blobs and return the sha256.
 * Safe under concurrent callers uploading the same content.
 */
export const putBlob = async (content: string, tx?: Tx): Promise<string> => {
    const sha = sha256Hex(content);
    const sizeBytes = Buffer.byteLength(content, 'utf8');

    const existing = await q(tx).query<{ sha256: string }>(
        `SELECT sha256 FROM public.code_blobs WHERE sha256 = $1`,
        [sha],
    );
    if (existing.rows.length > 0) {
        blobCache.set(sha, content);
        return sha;
    }

    await q(tx).query(
        `INSERT INTO public.code_blobs (sha256, size_bytes, storage_path, mime_type, content)
         VALUES ($1, $2, NULL, 'text/plain', $3)
         ON CONFLICT (sha256) DO NOTHING`,
        [sha, sizeBytes, content],
    );

    blobCache.set(sha, content);
    return sha;
};

const materializeBlob = (row: CodeBlobRow): string => {
    const sha = row.sha256;
    const cached = blobCache.get(sha);
    if (cached !== undefined) return cached;

    if (row.content !== null) {
        blobCache.set(sha, row.content);
        return row.content;
    }
    throw new Error(`Blob ${sha} has no inline content`);
};

/**
 * Resolve a sha256 to its content, using the in-process LRU then the content column.
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

/** Resolve many shas with one DB round-trip for metadata. */
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

    for (const sha of needDb) {
        const row = bySha.get(sha);
        if (!row) throw new Error(`Blob not found: ${sha}`);
        out.set(sha, materializeBlob(row));
    }
    return out;
};
