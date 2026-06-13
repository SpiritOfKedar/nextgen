import { Request, Response } from 'express';
import { getPool } from '../config/db';
import { stitchMcpClient } from '../services/stitchMcpClient';
import { stitchContextService } from '../services/stitchContextService';
import { log, errorFields } from '../lib/logger';

const loadUserConnection = async (userId: string) => {
    const { rows } = await getPool().query(
        `SELECT api_key, default_project_id, enabled FROM public.user_stitch_connections WHERE user_id = $1`,
        [userId],
    );
    return rows[0] ?? null;
};

export const stitchController = {
    async getStatus(req: Request, res: Response) {
        try {
            const userId = req.user?.id;
            let userConnected = false;
            let defaultProjectId: string | null = null;

            if (userId) {
                const conn = await loadUserConnection(userId);
                if (conn?.api_key && conn.enabled) {
                    userConnected = true;
                    defaultProjectId = conn.default_project_id ?? null;
                    const status = stitchMcpClient.getStatus({ apiKey: conn.api_key, enabled: true });
                    return res.json({ ...status, userConnected: true, defaultProjectId });
                }
            }

            const status = stitchMcpClient.getStatus();
            return res.json({ ...status, userConnected, defaultProjectId });
        } catch (error) {
            log.error('stitch.status_failed', { requestId: req.requestId, ...errorFields(error) });
            const status = stitchMcpClient.getStatus();
            return res.json({ ...status, userConnected: false, defaultProjectId: null });
        }
    },

    async connect(req: Request, res: Response) {
        try {
            if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

            const apiKey = typeof req.body?.apiKey === 'string' ? req.body.apiKey.trim() : '';
            const defaultProjectId = typeof req.body?.defaultProjectId === 'string'
                ? req.body.defaultProjectId.trim()
                : null;

            if (!apiKey) {
                return res.status(400).json({ error: 'A Stitch API key is required.' });
            }

            let toolCount: number;
            try {
                const result = await stitchMcpClient.validateApiKey(apiKey);
                toolCount = result.toolCount;
            } catch (error) {
                return res.status(400).json({
                    error: 'Failed to connect to Stitch MCP with the provided API key.',
                    detail: error instanceof Error ? error.message : String(error),
                });
            }

            await getPool().query(
                `INSERT INTO public.user_stitch_connections (user_id, api_key, default_project_id, enabled, created_at, updated_at)
                 VALUES ($1, $2, $3, true, NOW(), NOW())
                 ON CONFLICT (user_id) DO UPDATE SET
                   api_key = EXCLUDED.api_key,
                   default_project_id = EXCLUDED.default_project_id,
                   enabled = true,
                   updated_at = NOW()`,
                [req.user.id, apiKey, defaultProjectId || null],
            );

            log.info('stitch.connected', {
                requestId: req.requestId,
                internalUserId: req.user.id,
                toolCount,
            });

            return res.json({ connected: true, toolCount, defaultProjectId });
        } catch (error) {
            log.error('stitch.connect_failed', { requestId: req.requestId, ...errorFields(error) });
            return res.status(500).json({ error: 'Failed to connect Stitch account' });
        }
    },

    async disconnect(req: Request, res: Response) {
        try {
            if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
            await getPool().query(
                `DELETE FROM public.user_stitch_connections WHERE user_id = $1`,
                [req.user.id],
            );
            return res.json({ connected: false });
        } catch (error) {
            log.error('stitch.disconnect_failed', { requestId: req.requestId, ...errorFields(error) });
            return res.status(500).json({ error: 'Failed to disconnect Stitch account' });
        }
    },

    async inspect(req: Request, res: Response) {
        try {
            if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

            const projectId = typeof req.body?.projectId === 'string' ? req.body.projectId.trim() : undefined;
            const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt.trim() : undefined;
            const screenId = typeof req.body?.screenId === 'string' ? req.body.screenId.trim() : undefined;

            const conn = await loadUserConnection(req.user.id);
            const mcpConfig = conn?.api_key && conn.enabled
                ? { apiKey: conn.api_key, enabled: true }
                : undefined;

            const context = await stitchContextService.inspect(
                { projectId, prompt, screenId },
                {
                    requestId: req.requestId,
                    userId: req.user.id,
                    mcpConfig,
                    defaultProjectId: conn?.default_project_id ?? null,
                },
            );

            return res.json({ context });
        } catch (error) {
            log.error('stitch.inspect_failed', { requestId: req.requestId, ...errorFields(error) });
            return res.status(500).json({ error: 'Failed to inspect Stitch context' });
        }
    },
};

export const getUserStitchMcpConfig = async (userId: string) => {
    const conn = await loadUserConnection(userId);
    if (!conn?.api_key || !conn.enabled) return undefined;
    return {
        apiKey: conn.api_key,
        enabled: true,
        defaultProjectId: conn.default_project_id ?? null,
    };
};
