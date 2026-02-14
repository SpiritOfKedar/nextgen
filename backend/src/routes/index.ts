import { Router } from 'express';
import { chatController } from '../controllers/chatController';
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

router.get('/', (req, res) => {
    res.json({ message: 'Welcome to NextGen API' });
});

export default router;
