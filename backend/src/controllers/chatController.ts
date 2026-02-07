import { Request, Response } from 'express';
import { ChatService } from '../services/chatService';

const chatService = new ChatService();

export const chatController = {
    async sendMessage(req: Request, res: Response) {
        const { message, threadId, model } = req.body;

        if (!message) {
            return res.status(400).json({ error: 'Message is required' });
        }

        // Set headers for SSE/Streaming
        res.setHeader('Content-Type', 'text/plain');
        res.setHeader('Transfer-Encoding', 'chunked');

        try {
            if (!req.user) {
                return res.status(401).json({ error: 'Unauthorized' });
            }
            const userId = req.user.id;
            const { stream, threadId: newThreadId } = await chatService.generateResponse(message, threadId, userId, model);

            // Send new or existing threadId to client
            res.setHeader('X-Thread-Id', newThreadId);

            for await (const chunk of stream) {
                res.write(chunk);
            }

            res.end();
        } catch (error) {
            console.error('Chat Error:', error);
            res.status(500).end();
        }
    },

    async getHistory(req: Request, res: Response) {
        try {
            if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
            const threads = await chatService.getUserThreads(req.user.id);
            res.json(threads);
        } catch (error) {
            console.error('History Error:', error);
            res.status(500).json({ error: 'Failed to fetch history' });
        }
    },

    async getThread(req: Request, res: Response) {
        try {
            if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
            const { threadId } = req.params;
            const messages = await chatService.getThreadMessages(threadId as string, req.user.id);
            res.json(messages);
        } catch (error) {
            console.error('Thread Error:', error);
            res.status(500).json({ error: 'Failed to fetch thread' });
        }
    }
};
