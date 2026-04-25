import { Request, Response } from 'express';
import { sandboxCacheService } from '../services/sandboxCacheService';
import { sandboxSnapshotService } from '../services/sandboxSnapshotService';

export const sandboxController = {
    async getDependencyPlan(req: Request, res: Response) {
        const fingerprint = Array.isArray(req.params.fingerprint) ? req.params.fingerprint[0] : req.params.fingerprint;
        if (!fingerprint) return res.status(400).json({ error: 'fingerprint is required' });
        const plan = await sandboxCacheService.getDependencyPlan(fingerprint);
        if (!plan) return res.status(404).json({ error: 'No cached dependency plan found' });
        return res.json(plan);
    },

    async putDependencyPlan(req: Request, res: Response) {
        const fingerprint = Array.isArray(req.params.fingerprint) ? req.params.fingerprint[0] : req.params.fingerprint;
        if (!fingerprint) return res.status(400).json({ error: 'fingerprint is required' });
        const lockfileSha = typeof req.body?.lockfileSha === 'string' ? req.body.lockfileSha : undefined;
        const notes = typeof req.body?.notes === 'string' ? req.body.notes : undefined;
        const toolchainVersion = typeof req.body?.toolchainVersion === 'string' ? req.body.toolchainVersion : undefined;
        const record = await sandboxCacheService.putDependencyPlan({
            fingerprint,
            packageManager: 'npm',
            lockfileSha,
            notes,
            toolchainVersion,
        });
        return res.json(record);
    },

    async getDependencySnapshot(req: Request, res: Response) {
        const fingerprint = Array.isArray(req.params.fingerprint) ? req.params.fingerprint[0] : req.params.fingerprint;
        if (!fingerprint) return res.status(400).json({ error: 'fingerprint is required' });
        const plan = await sandboxCacheService.getDependencyPlan(fingerprint);
        if (!plan) return res.status(404).json({ error: 'No snapshot metadata found' });
        const snapshot = await sandboxSnapshotService.getSnapshot(fingerprint);
        if (!snapshot) return res.status(404).json({ error: 'Snapshot not found' });
        res.setHeader('Content-Type', 'application/gzip');
        return res.send(snapshot);
    },

    async putDependencySnapshot(req: Request, res: Response) {
        const fingerprint = Array.isArray(req.params.fingerprint) ? req.params.fingerprint[0] : req.params.fingerprint;
        if (!fingerprint) return res.status(400).json({ error: 'fingerprint is required' });
        const chunks: Buffer[] = [];
        req.on('data', (chunk) => {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
        await new Promise<void>((resolve, reject) => {
            req.on('end', () => resolve());
            req.on('error', reject);
        });
        const payload = Buffer.concat(chunks);
        if (!payload.length) return res.status(400).json({ error: 'Snapshot payload is required' });
        await sandboxSnapshotService.putSnapshot(fingerprint, payload);
        const lockfileSha = typeof req.query.lockfileSha === 'string' ? req.query.lockfileSha : undefined;
        const toolchainVersion = typeof req.query.toolchainVersion === 'string' ? req.query.toolchainVersion : undefined;
        const record = await sandboxCacheService.putDependencyPlan({
            fingerprint,
            packageManager: 'npm',
            lockfileSha,
            notes: 'snapshot_uploaded',
            toolchainVersion,
        });
        return res.json({ ok: true, metadata: record });
    },

    getTemplateSnapshot(req: Request, res: Response) {
        const templateId = Array.isArray(req.params.templateId) ? req.params.templateId[0] : req.params.templateId;
        if (!templateId) return res.status(400).json({ error: 'templateId is required' });
        const snapshot = sandboxCacheService.getTemplateSnapshot(templateId);
        if (!snapshot) return res.status(404).json({ error: 'Template snapshot not found' });
        return res.json(snapshot);
    },

    putTemplateSnapshot(req: Request, res: Response) {
        const templateId = Array.isArray(req.params.templateId) ? req.params.templateId[0] : req.params.templateId;
        if (!templateId) return res.status(400).json({ error: 'templateId is required' });
        const fingerprint = typeof req.body?.fingerprint === 'string' ? req.body.fingerprint : '';
        if (!fingerprint) return res.status(400).json({ error: 'fingerprint is required' });
        const metadata = typeof req.body?.metadata === 'object' && req.body.metadata ? req.body.metadata : undefined;
        const snapshot = sandboxCacheService.putTemplateSnapshot({
            templateId,
            fingerprint,
            metadata,
        });
        return res.json(snapshot);
    },
};
