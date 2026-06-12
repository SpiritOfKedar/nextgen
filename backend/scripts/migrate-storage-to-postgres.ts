/**
 * One-time migration: download Supabase Storage objects into Neon Postgres.
 *
 * Requires (from backend/.env):
 *   DATABASE_URL          — Neon target
 *   SUPABASE_URL          — source project URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   SUPABASE_STORAGE_BUCKET (default: code-files)
 *   SUPABASE_SNAPSHOT_BUCKET (default: snapshots)
 *
 * Usage: npx ts-node scripts/migrate-storage-to-postgres.ts
 */
import dotenv from 'dotenv';
import { Pool } from 'pg';
import path from 'path';

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const codeBucket = process.env.SUPABASE_STORAGE_BUCKET || 'code-files';
const snapshotBucket = process.env.SUPABASE_SNAPSHOT_BUCKET || 'snapshots';
const databaseUrl = process.env.DATABASE_URL ?? process.env.SUPABASE_DB_URL;

if (!supabaseUrl || !serviceKey || !databaseUrl) {
    console.error('Missing SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, or DATABASE_URL');
    process.exit(1);
}

const sanitizeUrl = (connectionString: string): string => {
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

const pool = new Pool({
    connectionString: sanitizeUrl(databaseUrl),
    ssl: { rejectUnauthorized: false },
});

const downloadObject = async (bucket: string, objectPath: string): Promise<Buffer> => {
    const encoded = objectPath.split('/').map(encodeURIComponent).join('/');
    const url = `${supabaseUrl}/storage/v1/object/${bucket}/${encoded}`;
    const res = await fetch(url, {
        headers: {
            Authorization: `Bearer ${serviceKey}`,
            apikey: serviceKey,
        },
    });
    if (!res.ok) {
        throw new Error(`Download failed ${bucket}/${objectPath}: ${res.status} ${await res.text()}`);
    }
    return Buffer.from(await res.arrayBuffer());
};

const listBucket = async (bucket: string, prefix = ''): Promise<string[]> => {
    const url = `${supabaseUrl}/storage/v1/object/list/${bucket}`;
    const res = await fetch(url, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${serviceKey}`,
            apikey: serviceKey,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ prefix, limit: 1000, offset: 0 }),
    });
    if (!res.ok) {
        throw new Error(`List failed for ${bucket}: ${res.status} ${await res.text()}`);
    }
    const items = await res.json() as Array<{ name: string; id?: string | null }>;
    const paths: string[] = [];
    for (const item of items) {
        const fullPath = prefix ? `${prefix}/${item.name}` : item.name;
        if (item.id) {
            paths.push(fullPath);
        } else {
            const nested = await listBucket(bucket, fullPath);
            paths.push(...nested);
        }
    }
    return paths;
};

const migrateCodeBlobs = async (): Promise<void> => {
    const { rows } = await pool.query<{ sha256: string; storage_path: string }>(
        `SELECT sha256, storage_path
         FROM public.code_blobs
         WHERE storage_path IS NOT NULL AND content IS NULL`,
    );
    console.log(`Hydrating ${rows.length} code blobs from Supabase Storage...`);
    for (const row of rows) {
        const bytes = await downloadObject(codeBucket, row.storage_path);
        const content = bytes.toString('utf8');
        await pool.query(
            `UPDATE public.code_blobs
             SET content = $1, storage_path = NULL
             WHERE sha256 = $2`,
            [content, row.sha256],
        );
        console.log(`  blob ${row.sha256.slice(0, 12)}... (${bytes.byteLength} bytes)`);
    }
};

const migrateSnapshots = async (): Promise<void> => {
    let paths: string[] = [];
    try {
        paths = await listBucket(snapshotBucket);
    } catch (err) {
        console.warn(`Could not list snapshot bucket (${snapshotBucket}):`, err);
        return;
    }
    const tgzPaths = paths.filter((p) => p.endsWith('.tgz'));
    console.log(`Hydrating ${tgzPaths.length} sandbox snapshots...`);
    for (const objectPath of tgzPaths) {
        const fingerprint = objectPath.replace(/\.tgz$/, '');
        const payload = await downloadObject(snapshotBucket, objectPath);
        await pool.query(
            `INSERT INTO public.sandbox_snapshots (fingerprint, payload)
             VALUES ($1, $2)
             ON CONFLICT (fingerprint) DO UPDATE
               SET payload = EXCLUDED.payload,
                   created_at = NOW()`,
            [fingerprint, payload],
        );
        console.log(`  snapshot ${fingerprint} (${payload.byteLength} bytes)`);
    }
};

const main = async (): Promise<void> => {
    await migrateCodeBlobs();
    await migrateSnapshots();

    const verify = await pool.query<{ storage_left: string }>(
        `SELECT count(*)::text AS storage_left
         FROM public.code_blobs
         WHERE storage_path IS NOT NULL AND content IS NULL`,
    );
    console.log(`Remaining storage-backed blobs: ${verify.rows[0].storage_left}`);

    const snapCount = await pool.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM public.sandbox_snapshots`,
    );
    console.log(`sandbox_snapshots rows: ${snapCount.rows[0].n}`);
};

main()
    .then(() => pool.end())
    .catch((err) => {
        console.error(err);
        pool.end().finally(() => process.exit(1));
    });
