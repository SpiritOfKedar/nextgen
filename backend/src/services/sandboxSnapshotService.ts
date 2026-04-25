import { getSupabase } from '../config/db';

const SNAPSHOT_BUCKET = process.env.SUPABASE_SNAPSHOT_BUCKET || 'snapshots';

class SandboxSnapshotService {
    private snapshotPath(fingerprint: string): string {
        return `${fingerprint}.tgz`;
    }

    async getSnapshot(fingerprint: string): Promise<Buffer | null> {
        const { data, error } = await getSupabase()
            .storage
            .from(SNAPSHOT_BUCKET)
            .download(this.snapshotPath(fingerprint));
        if (error || !data) return null;
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
            throw new Error(`Failed to upload dependency snapshot: ${error.message}`);
        }
    }
}

export const sandboxSnapshotService = new SandboxSnapshotService();

