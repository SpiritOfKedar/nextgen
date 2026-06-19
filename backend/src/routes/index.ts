import { Router } from 'express';
import express from 'express';
import { chatController } from '../controllers/chatController';
import { sandboxController } from '../controllers/sandboxController';
import { terminalController } from '../controllers/terminalController';
import { figmaController } from '../controllers/figmaController';
import { stitchController } from '../controllers/stitchController';
import { githubController } from '../controllers/githubController';
import { supabaseController } from '../controllers/supabaseController';
import * as collaboratorsController from '../controllers/collaboratorsController';
import { previewController } from '../controllers/previewController';
import { authMiddleware } from '../middlewares/authMiddleware';

const router = Router();

const jsonDefault = express.json({ limit: '256kb' });
const jsonLarge = express.json({ limit: '10mb' });

// Routes that accept large JSON bodies (must declare parser before default)
// @ts-ignore
router.post('/chat', jsonLarge, authMiddleware, chatController.sendMessage);
// @ts-ignore
router.post('/chat/enhance-prompt', jsonDefault, authMiddleware, chatController.enhancePrompt);
// @ts-ignore
router.post('/terminal/:threadId/events', jsonLarge, authMiddleware, terminalController.appendEvents);
// @ts-ignore
router.put('/sandbox/dependencies/:fingerprint', jsonLarge, authMiddleware, sandboxController.putDependencyPlan);
// @ts-ignore
router.put('/sandbox/snapshots/:fingerprint', jsonLarge, authMiddleware, sandboxController.putDependencySnapshot);
// @ts-ignore
router.put('/sandbox/templates/:templateId', jsonLarge, authMiddleware, sandboxController.putTemplateSnapshot);

router.use(jsonDefault);

// Public endpoints (no auth required)
// @ts-ignore
router.get('/preview/:threadId', previewController.getPreview);

// Sync user on login
// @ts-ignore
router.post('/auth/sync', authMiddleware, (req, res) => {
    res.json({ user: req.user });
});

// @ts-ignore
router.get('/chat/history', authMiddleware, chatController.getHistory);
// @ts-ignore
router.get('/chat/:threadId', authMiddleware, chatController.getThread);
// @ts-ignore
router.delete('/chat/:threadId', authMiddleware, chatController.deleteThread);
// @ts-ignore
router.get('/chat/:threadId/files', authMiddleware, chatController.getThreadFiles);
// @ts-ignore
router.get('/chat/:threadId/files/delta', authMiddleware, chatController.getThreadFilesDelta);
// @ts-ignore
router.get('/chat/:threadId/versions', authMiddleware, chatController.getThreadVersions);
// @ts-ignore
router.post('/chat/:threadId/restore', authMiddleware, chatController.restoreThread);

// @ts-ignore
router.get('/terminal/:threadId/session', authMiddleware, terminalController.getSession);
// @ts-ignore
router.post('/terminal/:threadId/recovery-audits', authMiddleware, terminalController.appendRecoveryAudit);
// @ts-ignore
router.post('/terminal/:threadId/recover', authMiddleware, terminalController.recover);

// Figma MCP design-context endpoints
// @ts-ignore
router.get('/figma/status', authMiddleware, figmaController.getStatus);
// @ts-ignore
router.post('/figma/inspect', authMiddleware, figmaController.inspect);
// @ts-ignore
router.post('/figma/connect', authMiddleware, figmaController.connect);
// @ts-ignore
router.delete('/figma/disconnect', authMiddleware, figmaController.disconnect);

// Google Stitch MCP endpoints
// @ts-ignore
router.get('/stitch/status', authMiddleware, stitchController.getStatus);
// @ts-ignore
router.post('/stitch/connect', authMiddleware, stitchController.connect);
// @ts-ignore
router.delete('/stitch/disconnect', authMiddleware, stitchController.disconnect);
// @ts-ignore
router.post('/stitch/inspect', authMiddleware, stitchController.inspect);

// GitHub push endpoints
// @ts-ignore
router.get('/github/status', authMiddleware, githubController.getStatus);
// @ts-ignore
router.post('/github/connect', authMiddleware, githubController.connect);
// @ts-ignore
router.delete('/github/disconnect', authMiddleware, githubController.disconnect);
// @ts-ignore
router.get('/github/link/:threadId', authMiddleware, githubController.getThreadLink);
// @ts-ignore
router.post('/github/push', authMiddleware, githubController.push);

// Supabase backend integration endpoints
// @ts-ignore
router.get('/supabase/status', authMiddleware, supabaseController.getStatus);
// @ts-ignore
router.post('/supabase/connect', authMiddleware, supabaseController.connect);
// @ts-ignore
router.delete('/supabase/disconnect', authMiddleware, supabaseController.disconnect);
// @ts-ignore
router.get('/supabase/env', authMiddleware, supabaseController.getEnv);
// @ts-ignore
router.get('/supabase/schema', authMiddleware, supabaseController.getSchema);
// @ts-ignore
router.post('/supabase/migrations/apply', authMiddleware, supabaseController.applyMigrations);
// @ts-ignore
router.post('/supabase/inspect', authMiddleware, supabaseController.inspect);

// Sandbox cache/snapshot architecture endpoints
// @ts-ignore
router.get('/sandbox/dependencies/:fingerprint', authMiddleware, sandboxController.getDependencyPlan);
// @ts-ignore
router.get('/sandbox/snapshots/:fingerprint', authMiddleware, sandboxController.getDependencySnapshot);
// @ts-ignore
router.get('/sandbox/templates/:templateId', authMiddleware, sandboxController.getTemplateSnapshot);

// Collaborator endpoints
// @ts-ignore
router.get('/chat/:id/collaborators', authMiddleware, collaboratorsController.getCollaborators);
// @ts-ignore
router.post('/chat/:id/collaborators', authMiddleware, collaboratorsController.addCollaborator);
// @ts-ignore
router.delete('/chat/:id/collaborators/:userId', authMiddleware, collaboratorsController.removeCollaborator);

router.get('/', (req, res) => {
    res.json({ message: 'Welcome to NextGen API' });
});

export default router;
