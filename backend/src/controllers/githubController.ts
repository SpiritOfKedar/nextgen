import { Request, Response } from 'express';
import { getPool } from '../config/db';
import {
    getThreadGitHubLink,
    pushProjectToGitHub,
    validateGitHubToken,
} from '../services/githubPushService';
import { ThreadAccessError } from '../services/chatService';
import { log, errorFields } from '../lib/logger';

const loadUserConnection = async (userId: string) => {
    const { rows } = await getPool().query(
        `SELECT access_token, github_login, enabled FROM public.user_github_connections WHERE user_id = $1`,
        [userId],
    );
    return rows[0] ?? null;
};

export const githubController = {
    async getStatus(req: Request, res: Response) {
        try {
            if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
            const conn = await loadUserConnection(req.user.id);
            const userConnected = !!(conn?.access_token && conn.enabled);
            return res.json({
                userConnected,
                githubLogin: userConnected ? conn.github_login : null,
            });
        } catch (error) {
            log.error('github.status_failed', { requestId: req.requestId, ...errorFields(error) });
            return res.json({ userConnected: false, githubLogin: null });
        }
    },

    async connect(req: Request, res: Response) {
        try {
            if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
            const accessToken = typeof req.body?.accessToken === 'string' ? req.body.accessToken.trim() : '';
            if (!accessToken) {
                return res.status(400).json({ error: 'A GitHub Personal Access Token is required.' });
            }

            let login: string;
            try {
                const result = await validateGitHubToken(accessToken);
                login = result.login;
            } catch (error) {
                return res.status(400).json({
                    error: 'Failed to validate GitHub token. Ensure it has repo scope.',
                    detail: error instanceof Error ? error.message : String(error),
                });
            }

            await getPool().query(
                `INSERT INTO public.user_github_connections (user_id, access_token, github_login, enabled, created_at, updated_at)
                 VALUES ($1, $2, $3, true, NOW(), NOW())
                 ON CONFLICT (user_id) DO UPDATE SET
                   access_token = EXCLUDED.access_token,
                   github_login = EXCLUDED.github_login,
                   enabled = true,
                   updated_at = NOW()`,
                [req.user.id, accessToken, login],
            );

            log.info('github.connected', { requestId: req.requestId, internalUserId: req.user.id, login });
            return res.json({ connected: true, githubLogin: login });
        } catch (error) {
            log.error('github.connect_failed', { requestId: req.requestId, ...errorFields(error) });
            return res.status(500).json({ error: 'Failed to connect GitHub account' });
        }
    },

    async disconnect(req: Request, res: Response) {
        try {
            if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
            await getPool().query(
                `DELETE FROM public.user_github_connections WHERE user_id = $1`,
                [req.user.id],
            );
            return res.json({ connected: false });
        } catch (error) {
            log.error('github.disconnect_failed', { requestId: req.requestId, ...errorFields(error) });
            return res.status(500).json({ error: 'Failed to disconnect GitHub account' });
        }
    },

    async getThreadLink(req: Request, res: Response) {
        try {
            if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
            const threadId = Array.isArray(req.params.threadId) ? req.params.threadId[0] : req.params.threadId;
            if (!threadId) return res.status(400).json({ error: 'threadId is required' });
            const link = await getThreadGitHubLink(threadId, req.user.id);
            return res.json({ link });
        } catch (error) {
            if (error instanceof ThreadAccessError) {
                return res.status(404).json({ error: error.message });
            }
            return res.status(500).json({ error: 'Failed to load GitHub link' });
        }
    },

    async push(req: Request, res: Response) {
        try {
            if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
            const threadId = typeof req.body?.threadId === 'string' ? req.body.threadId : '';
            const mode = req.body?.mode === 'existing' ? 'existing' : 'create';
            const repo = typeof req.body?.repo === 'string' ? req.body.repo.trim() : '';
            const owner = typeof req.body?.owner === 'string' ? req.body.owner.trim() : undefined;
            const branch = typeof req.body?.branch === 'string' ? req.body.branch.trim() : 'main';
            const commitMessage = typeof req.body?.commitMessage === 'string' ? req.body.commitMessage.trim() : '';
            const isPrivate = !!req.body?.isPrivate;
            const files = Array.isArray(req.body?.files) ? req.body.files : [];

            if (!threadId || !repo) {
                return res.status(400).json({ error: 'threadId and repo are required' });
            }

            const result = await pushProjectToGitHub({
                userId: req.user.id,
                threadId,
                mode,
                owner,
                repo,
                branch,
                commitMessage,
                isPrivate,
                files,
            });

            return res.json(result);
        } catch (error) {
            log.error('github.push_failed', {
                requestId: req.requestId,
                internalUserId: req.user?.id,
                ...errorFields(error),
            });
            if (error instanceof ThreadAccessError) {
                return res.status(404).json({ error: error.message });
            }
            return res.status(500).json({
                error: error instanceof Error ? error.message : 'Failed to push to GitHub',
            });
        }
    },
};
