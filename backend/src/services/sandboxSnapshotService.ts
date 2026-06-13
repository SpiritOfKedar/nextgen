import { getPool } from '../config/db';
import { isB2Enabled } from '../config/b2';
import { log } from '../lib/logger';
import { getObject, putObject, snapshotKey } from './b2StorageService';

type SnapshotRow = {
    storage_path: string | null;
    payload: Buffer | null;
    byte_size: string | number | null;
};

class SandboxSnapshotService {
    async getSnapshot(fingerprint: string): Promise<Buffer | null> {
        const result = await getPool().query<SnapshotRow>(
            `SELECT storage_path, payload, byte_size
             FROM public.sandbox_snapshots
             WHERE fingerprint = $1`,
            [fingerprint],
        );
        const row = result.rows[0];
        if (!row) {
            log.warn('sandbox.snapshot_download_miss', { fingerprint });
            return null;
        }

        if (row.storage_path) {
            const fromB2 = await getObject(row.storage_path);
            if (fromB2) return fromB2;
            log.warn('sandbox.snapshot_b2_miss', { fingerprint, storagePath: row.storage_path });
        }

        if (row.payload) {
            return row.payload;
        }

        log.warn('sandbox.snapshot_download_miss', { fingerprint, reason: 'no_payload_or_b2' });
        return null;
    }

    async putSnapshot(fingerprint: string, payload: Buffer): Promise<void> {
        if (isB2Enabled()) {
            const storagePath = snapshotKey(fingerprint);
            await putObject(storagePath, payload, 'application/gzip');
            await getPool().query(
                `INSERT INTO public.sandbox_snapshots (fingerprint, storage_path, byte_size, payload)
                 VALUES ($1, $2, $3, NULL)
                 ON CONFLICT (fingerprint) DO UPDATE
                   SET storage_path = EXCLUDED.storage_path,
                       byte_size = EXCLUDED.byte_size,
                       payload = NULL,
                       created_at = NOW()`,
                [fingerprint, storagePath, payload.byteLength],
            );
            log.info('sandbox.snapshot_uploaded', {
                fingerprint,
                bytes: payload.byteLength,
                storage: 'b2',
                storagePath,
            });
            return;
        }

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
            storage: 'postgres',
        });
    }
}

export const sandboxSnapshotService = new SandboxSnapshotService();
