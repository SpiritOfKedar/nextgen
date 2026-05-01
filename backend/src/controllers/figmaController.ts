import { Request, Response } from 'express';
import { figmaMcpClient } from '../services/figmaMcpClient';
import { figmaDesignContextService, parseFigmaUrl } from '../services/figmaDesignContextService';
import { getPool } from '../config/db';
import { log, errorFields } from '../lib/logger';

/**
 * Load the user's stored Figma connection from the DB.
 * Returns null if no connection exists.
 */
const loadUserConnection = async (userId: string) => {
    const { rows } = await getPool().query(
        `SELECT access_token, enabled FROM public.user_figma_connections WHERE user_id = $1`,
        [userId],
    );
    return rows[0] ?? null;
};

export const figmaController = {
    /**
     * GET /figma/status — report Figma MCP status for the current user.
     * Checks both env-level config and user-level DB token.
     */
    async getStatus(req: Request, res: Response) {
        try {
            const userId = req.user?.id;
            let userConnected = false;

            if (userId) {
                const conn = await loadUserConnection(userId);
                if (conn?.access_token && conn.enabled) {
                    userConnected = true;
                    const status = figmaMcpClient.getStatus({ accessToken: conn.access_token, enabled: true });
                    return res.json({ ...status, userConnected: true });
                }
            }

            const status = figmaMcpClient.getStatus();
            return res.json({ ...status, userConnected });
        } catch (error) {
            log.error('figma.status_failed', { requestId: req.requestId, ...errorFields(error) });
            const status = figmaMcpClient.getStatus();
            return res.json({ ...status, userConnected: false });
        }
    },

    /**
     * POST /figma/connect — validate and store a Figma Personal Access Token.
     * Body: { accessToken: string }
     */
    async connect(req: Request, res: Response) {
        try {
            if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

            const accessToken = typeof req.body?.accessToken === 'string' ? req.body.accessToken.trim() : '';
            if (!accessToken) {
                return res.status(400).json({ error: 'A Figma Personal Access Token is required.' });
            }

            // Validate the token against Figma MCP
            let toolCount: number;
            try {
                const result = await figmaMcpClient.validateToken(accessToken);
                toolCount = result.toolCount;
            } catch (error) {
                log.warn('figma.connect_validation_failed', {
                    requestId: req.requestId,
                    internalUserId: req.user.id,
                    ...errorFields(error),
                });
                return res.status(400).json({
                    error: 'Failed to connect to Figma MCP with the provided token. Please verify your token is valid.',
                    detail: error instanceof Error ? error.message : String(error),
                });
            }

            // Upsert the connection in the DB
            await getPool().query(
                `INSERT INTO public.user_figma_connections (user_id, access_token, enabled, created_at, updated_at)
                 VALUES ($1, $2, true, NOW(), NOW())
                 ON CONFLICT (user_id) DO UPDATE SET access_token = $2, enabled = true, updated_at = NOW()`,
                [req.user.id, accessToken],
            );

            log.info('figma.connected', {
                requestId: req.requestId,
                internalUserId: req.user.id,
                toolCount,
            });

            return res.json({ connected: true, toolCount });
        } catch (error) {
            log.error('figma.connect_failed', {
                requestId: req.requestId,
                internalUserId: req.user?.id,
                ...errorFields(error),
            });
            return res.status(500).json({ error: 'Failed to connect Figma account' });
        }
    },

    /**
     * DELETE /figma/disconnect — remove the user's stored Figma token.
     */
    async disconnect(req: Request, res: Response) {
        try {
            if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

            await getPool().query(
                `DELETE FROM public.user_figma_connections WHERE user_id = $1`,
                [req.user.id],
            );

            log.info('figma.disconnected', {
                requestId: req.requestId,
                internalUserId: req.user.id,
            });

            return res.json({ connected: false });
        } catch (error) {
            log.error('figma.disconnect_failed', {
                requestId: req.requestId,
                internalUserId: req.user?.id,
                ...errorFields(error),
            });
            return res.status(500).json({ error: 'Failed to disconnect Figma account' });
        }
    },

    /**
     * POST /figma/inspect — fetch read-only design context for a Figma URL.
     * Uses the user's stored token if available.
     */
    async inspect(req: Request, res: Response) {
        try {
            if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
            const url = typeof req.body?.url === 'string' ? req.body.url : '';
            const parsed = parseFigmaUrl(url);
            if (!parsed) return res.status(400).json({ error: 'A valid Figma URL is required' });

            // Load user's token for MCP calls
            const conn = await loadUserConnection(req.user.id);
            const mcpConfig = conn?.access_token && conn.enabled
                ? { accessToken: conn.access_token, enabled: true }
                : undefined;

            const context = await figmaDesignContextService.inspectLink(parsed.url, {
                requestId: req.requestId,
                userId: req.user.id,
                mcpConfig,
            });
            return res.json({ context });
        } catch (error) {
            log.error('figma.inspect_failed', {
                requestId: req.requestId,
                internalUserId: req.user?.id,
                ...errorFields(error),
            });
            return res.status(500).json({ error: 'Failed to inspect Figma link' });
        }
    },
};

/**
 * Helper exported for chatService or other services that need the user's MCP config.
 */
export const getUserFigmaMcpConfig = async (userId: string) => {
    const conn = await loadUserConnection(userId);
    if (!conn?.access_token || !conn.enabled) return undefined;
    return { accessToken: conn.access_token, enabled: true };
};
