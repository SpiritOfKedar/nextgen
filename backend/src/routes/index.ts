import { Router } from 'express';
import { chatController } from '../controllers/chatController';
import { sandboxController } from '../controllers/sandboxController';
import { terminalController } from '../controllers/terminalController';
import { figmaController } from '../controllers/figmaController';
import * as collaboratorsController from '../controllers/collaboratorsController';
import { authMiddleware } from '../middlewares/authMiddleware';

const router = Router();

// Sync user to MongoDB on login
// @ts-ignore
router.post('/auth/sync', authMiddleware, (req, res) => {
    res.json({ user: req.user });
});

// @ts-ignore
router.post('/chat', authMiddleware, chatController.sendMessage);
// @ts-ignore
router.get('/chat/history', authMiddleware, chatController.getHistory);
// @ts-ignore
router.get('/chat/:threadId', authMiddleware, chatController.getThread);
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
router.post('/terminal/:threadId/events', authMiddleware, terminalController.appendEvents);
// @ts-ignore
router.post('/terminal/:threadId/recovery-audits', authMiddleware, terminalController.appendRecoveryAudit);

// Figma MCP design-context endpoints
// @ts-ignore
router.get('/figma/status', authMiddleware, figmaController.getStatus);
// @ts-ignore
router.post('/figma/inspect', authMiddleware, figmaController.inspect);
// @ts-ignore
router.post('/figma/connect', authMiddleware, figmaController.connect);
// @ts-ignore
router.delete('/figma/disconnect', authMiddleware, figmaController.disconnect);

// Sandbox cache/snapshot architecture endpoints
// @ts-ignore
router.get('/sandbox/dependencies/:fingerprint', authMiddleware, sandboxController.getDependencyPlan);
// @ts-ignore
router.put('/sandbox/dependencies/:fingerprint', authMiddleware, sandboxController.putDependencyPlan);
// @ts-ignore
router.get('/sandbox/snapshots/:fingerprint', authMiddleware, sandboxController.getDependencySnapshot);
// @ts-ignore
router.put('/sandbox/snapshots/:fingerprint', authMiddleware, sandboxController.putDependencySnapshot);
// @ts-ignore
router.get('/sandbox/templates/:templateId', authMiddleware, sandboxController.getTemplateSnapshot);
// @ts-ignore
router.put('/sandbox/templates/:templateId', authMiddleware, sandboxController.putTemplateSnapshot);

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
