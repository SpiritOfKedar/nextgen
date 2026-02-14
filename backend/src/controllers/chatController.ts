import { Request, Response } from 'express';
import { ChatService } from '../services/chatService';

const chatService = new ChatService();

export const chatController = {
    async sendMessage(req: Request, res: Response) {
        const { message, threadId, model } = req.body;

        if (!message) {
            return res.status(400).json({ error: 'Message is required' });
        }

        try {
            if (!req.user) {
                return res.status(401).json({ error: 'Unauthorized' });
            }
            const userId = req.user.id;
            const { stream, threadId: newThreadId } = await chatService.generateResponse(message, threadId, userId, model);

            // Set headers for SSE/Streaming only after we have a valid stream
            res.setHeader('Content-Type', 'text/plain');
            res.setHeader('Transfer-Encoding', 'chunked');
            // Send new or existing threadId to client
            res.setHeader('X-Thread-Id', newThreadId);

            for await (const chunk of stream) {
                res.write(chunk);
            }

            res.end();
        } catch (error) {
            console.error('Chat Error:', error);
            // Only send error JSON if headers haven't been sent yet
            if (!res.headersSent) {
                res.status(500).json({ error: error instanceof Error ? error.message : 'Internal Server Error' });
            } else {
                res.end();
            }
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
    },

    async getThreadFiles(req: Request, res: Response) {
        try {
            if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
            const { threadId } = req.params;
            const files = await chatService.getThreadFiles(threadId as string, req.user.id);
            res.json(files);
        } catch (error) {
            console.error('Thread Files Error:', error);
            res.status(500).json({ error: 'Failed to fetch thread files' });
        }
    }
};
