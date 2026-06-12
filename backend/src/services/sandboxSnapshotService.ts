import { getPool } from '../config/db';
import { log } from '../lib/logger';

class SandboxSnapshotService {
    async getSnapshot(fingerprint: string): Promise<Buffer | null> {
        const result = await getPool().query<{ payload: Buffer }>(
            `SELECT payload FROM public.sandbox_snapshots WHERE fingerprint = $1`,
            [fingerprint],
        );
        const row = result.rows[0];
        if (!row) {
            log.warn('sandbox.snapshot_download_miss', { fingerprint });
            return null;
        }
        return row.payload;
    }

    async putSnapshot(fingerprint: string, payload: Buffer): Promise<void> {
        await getPool().query(
            `INSERT INTO public.sandbox_snapshots (fingerprint, payload)
             VALUES ($1, $2)
             ON CONFLICT (fingerprint) DO UPDATE
               SET payload = EXCLUDED.payload,
                   created_at = NOW()`,
            [fingerprint, payload],
        );
        log.info('sandbox.snapshot_uploaded', {
            fingerprint,
            bytes: payload.byteLength,
        });
    }
}

export const sandboxSnapshotService = new SandboxSnapshotService();
