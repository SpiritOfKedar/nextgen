import { isRedisEnabled, redisGet, redisSet } from '../lib/redis';

export type SnapshotState = 'available' | 'upload_pending' | 'upload_failed';

export type DependencyCacheRecord = {
    fingerprint: string;
    packageManager: 'npm';
    installedAt: string;
    ttlSeconds: number;
    toolchainVersion: string;
    snapshotState: SnapshotState;
    uploadAttemptCount: number;
    lockfileSha?: string;
    notes?: string;
};

type TemplateSnapshotRecord = {
    templateId: string;
    fingerprint: string;
    createdAt: string;
    metadata?: Record<string, unknown>;
};

class SandboxCacheService {
    /** In-process fallback when Redis is unavailable. */
    private readonly templateSnapshotsLocal = new Map<string, TemplateSnapshotRecord>();
    private readonly depTtlSeconds = 7 * 24 * 60 * 60;
    private readonly templateTtlSeconds = 30 * 24 * 60 * 60;
    private readonly defaultToolchainVersion = process.env.SANDBOX_TOOLCHAIN_VERSION || 'webcontainer-npm-v1';

    private getDepKey(fingerprint: string): string {
        return `sandbox:dep:${fingerprint}`;
    }

    private getTemplateKey(templateId: string): string {
        return `sandbox:template:${templateId}`;
    }

    async getDependencyPlan(fingerprint: string): Promise<DependencyCacheRecord | null> {
        const raw = await redisGet(this.getDepKey(fingerprint));
        if (!raw) return null;
        try {
            return JSON.parse(raw) as DependencyCacheRecord;
        } catch {
            return null;
        }
    }

    async putDependencyPlan(input: {
        fingerprint: string;
        packageManager: 'npm';
        lockfileSha?: string;
        notes?: string;
        toolchainVersion?: string;
        snapshotState?: SnapshotState;
        uploadAttemptCount?: number;
    }): Promise<DependencyCacheRecord> {
        const record: DependencyCacheRecord = {
            fingerprint: input.fingerprint,
            packageManager: input.packageManager,
            installedAt: new Date().toISOString(),
            ttlSeconds: this.depTtlSeconds,
            toolchainVersion: input.toolchainVersion || this.defaultToolchainVersion,
            snapshotState: input.snapshotState || 'available',
            uploadAttemptCount: input.uploadAttemptCount ?? 0,
            lockfileSha: input.lockfileSha,
            notes: input.notes,
        };
        await redisSet(this.getDepKey(input.fingerprint), JSON.stringify(record), this.depTtlSeconds);
        return record;
    }

    async markSnapshotUploadFailure(input: {
        fingerprint: string;
        packageManager: 'npm';
        lockfileSha?: string;
        toolchainVersion?: string;
        notes?: string;
    }): Promise<DependencyCacheRecord> {
        const current = await this.getDependencyPlan(input.fingerprint);
        const attemptCount = (current?.uploadAttemptCount || 0) + 1;
        const nextState: SnapshotState = attemptCount >= 3 ? 'upload_failed' : 'upload_pending';
        return this.putDependencyPlan({
            ...input,
            snapshotState: nextState,
            uploadAttemptCount: attemptCount,
            notes: input.notes || `snapshot_upload_retry_attempt_${attemptCount}`,
        });
    }

    async getTemplateSnapshot(templateId: string): Promise<TemplateSnapshotRecord | null> {
        const raw = await redisGet(this.getTemplateKey(templateId));
        if (raw) {
            try {
                return JSON.parse(raw) as TemplateSnapshotRecord;
            } catch {
                // fall through to local
            }
        }
        return this.templateSnapshotsLocal.get(templateId) ?? null;
    }

    async putTemplateSnapshot(input: Omit<TemplateSnapshotRecord, 'createdAt'>): Promise<TemplateSnapshotRecord> {
        const record: TemplateSnapshotRecord = {
            ...input,
            createdAt: new Date().toISOString(),
        };
        await redisSet(this.getTemplateKey(input.templateId), JSON.stringify(record), this.templateTtlSeconds);
        this.templateSnapshotsLocal.set(input.templateId, record);
        return record;
    }

    getStatus(): { redisEnabled: boolean } {
        return { redisEnabled: isRedisEnabled() };
    }
}

export const sandboxCacheService = new SandboxCacheService();
