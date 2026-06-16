import { Request, Response } from 'express';
import * as threadsRepo from '../repositories/threads';
import * as fileVersionsRepo from '../repositories/fileVersions';
import * as blobsRepo from '../repositories/blobs';
import { log, errorFields } from '../lib/logger';

export const previewController = {
    async getPreview(req: Request, res: Response) {
        try {
            const { threadId } = req.params;

            const thread = await threadsRepo.findById(threadId as string);
            if (!thread) {
                return res.status(404).json({ error: 'Thread not found' });
            }

            const snap = await fileVersionsRepo.currentSnapshot(threadId as string);

            const files: Record<string, { content: string }> = {};

            if (snap.length > 0) {
                const blobs = await blobsRepo.getBlobs(snap.map((s) => s.current_blob_sha256));
                for (const s of snap) {
                    files[s.file_path] = { content: blobs.get(s.current_blob_sha256) ?? '' };
                }
            }

            res.json({
                threadId: thread.id,
                title: thread.title,
                files,
            });
        } catch (error) {
            log.error('preview.get_preview_failed', {
                requestId: req.requestId,
                threadId: req.params.threadId,
                ...errorFields(error),
            });
            res.status(500).json({ error: 'Failed to fetch preview' });
        }
    },
};
