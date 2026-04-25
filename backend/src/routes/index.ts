import { Router } from 'express';
import { chatController } from '../controllers/chatController';
import { sandboxController } from '../controllers/sandboxController';
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

router.get('/', (req, res) => {
    res.json({ message: 'Welcome to NextGen API' });
});

export default router;
