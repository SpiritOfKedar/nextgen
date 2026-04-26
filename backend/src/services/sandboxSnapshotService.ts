import { getSupabase } from '../config/db';
import { log } from '../lib/logger';

const SNAPSHOT_BUCKET = process.env.SUPABASE_SNAPSHOT_BUCKET || 'snapshots';

class SandboxSnapshotService {
    constructor() {
        if (!process.env.SUPABASE_SNAPSHOT_BUCKET) {
            log.warn('sandbox.snapshot_bucket_env_defaulted', {
                bucket: SNAPSHOT_BUCKET,
            });
        }
    }

    private snapshotPath(fingerprint: string): string {
        return `${fingerprint}.tgz`;
    }

    async getSnapshot(fingerprint: string): Promise<Buffer | null> {
        const { data, error } = await getSupabase()
            .storage
            .from(SNAPSHOT_BUCKET)
            .download(this.snapshotPath(fingerprint));
        if (error || !data) {
            log.warn('sandbox.snapshot_storage_download_failed', {
                fingerprint,
                bucket: SNAPSHOT_BUCKET,
                detail: error?.message || 'empty_data',
            });
            return null;
        }
        return Buffer.from(await data.arrayBuffer());
    }

    async putSnapshot(fingerprint: string, payload: Buffer): Promise<void> {
        const { error } = await getSupabase()
            .storage
            .from(SNAPSHOT_BUCKET)
            .upload(this.snapshotPath(fingerprint), payload, {
                contentType: 'application/gzip',
                upsert: true,
            });
        if (error) {
            log.warn('sandbox.snapshot_storage_upload_failed', {
                fingerprint,
                bucket: SNAPSHOT_BUCKET,
                detail: error.message,
            });
            throw new Error(`Failed to upload dependency snapshot: ${error.message}`);
        }
        log.info('sandbox.snapshot_storage_uploaded', {
            fingerprint,
            bucket: SNAPSHOT_BUCKET,
            bytes: payload.byteLength,
        });
    }
}

export const sandboxSnapshotService = new SandboxSnapshotService();

