type DependencyCacheRecord = {
    fingerprint: string;
    packageManager: 'npm';
    installedAt: string;
    ttlSeconds: number;
    toolchainVersion: string;
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
    private readonly templateSnapshots = new Map<string, TemplateSnapshotRecord>();
    private readonly redisUrl = (process.env.UPSTASH_REDIS_REST_URL || '').replace(/\/$/, '');
    private readonly redisToken = process.env.UPSTASH_REDIS_REST_TOKEN || '';
    private readonly depTtlSeconds = 7 * 24 * 60 * 60;
    private readonly defaultToolchainVersion = process.env.SANDBOX_TOOLCHAIN_VERSION || 'webcontainer-npm-v1';

    private get redisEnabled(): boolean {
        return !!this.redisUrl && !!this.redisToken;
    }

    private getDepKey(fingerprint: string): string {
        return `sandbox:dep:${fingerprint}`;
    }

    private async redisGet(key: string): Promise<string | null> {
        if (!this.redisEnabled) return null;
        const res = await fetch(`${this.redisUrl}/get/${encodeURIComponent(key)}`, {
            method: 'GET',
            headers: {
                Authorization: `Bearer ${this.redisToken}`,
            },
        });
        if (!res.ok) return null;
        const data = await res.json() as { result: string | null };
        return data.result ?? null;
    }

    private async redisSetWithTtl(key: string, value: string, ttlSeconds: number): Promise<void> {
        if (!this.redisEnabled) return;
        await fetch(
            `${this.redisUrl}/set/${encodeURIComponent(key)}/${encodeURIComponent(value)}?EX=${ttlSeconds}`,
            {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${this.redisToken}`,
                },
            },
        );
    }

    async getDependencyPlan(fingerprint: string): Promise<DependencyCacheRecord | null> {
        const raw = await this.redisGet(this.getDepKey(fingerprint));
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
    }): Promise<DependencyCacheRecord> {
        const record: DependencyCacheRecord = {
            fingerprint: input.fingerprint,
            packageManager: input.packageManager,
            installedAt: new Date().toISOString(),
            ttlSeconds: this.depTtlSeconds,
            toolchainVersion: input.toolchainVersion || this.defaultToolchainVersion,
            lockfileSha: input.lockfileSha,
            notes: input.notes,
        };
        await this.redisSetWithTtl(this.getDepKey(input.fingerprint), JSON.stringify(record), this.depTtlSeconds);
        return record;
    }

    getTemplateSnapshot(templateId: string): TemplateSnapshotRecord | null {
        return this.templateSnapshots.get(templateId) ?? null;
    }

    putTemplateSnapshot(input: Omit<TemplateSnapshotRecord, 'createdAt'>): TemplateSnapshotRecord {
        const record: TemplateSnapshotRecord = {
            ...input,
            createdAt: new Date().toISOString(),
        };
        this.templateSnapshots.set(input.templateId, record);
        return record;
    }
}

export const sandboxCacheService = new SandboxCacheService();
