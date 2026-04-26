import { Request, Response } from 'express';
import { ChatService, ThreadAccessError } from '../services/chatService';
import { log, errorFields } from '../lib/logger';

const chatService = new ChatService();
const VALID_MODES = new Set(['plan', 'build']);

export const chatController = {
    async sendMessage(req: Request, res: Response) {
        const { message, threadId, model, attachments, mode } = req.body;
        const conversationMode = VALID_MODES.has(mode) ? mode : 'build';

        if (!message) {
            return res.status(400).json({ error: 'Message is required' });
        }

        try {
            if (!req.user) {
                return res.status(401).json({ error: 'Unauthorized' });
            }
            const userId = req.user.id;
            const { stream, threadId: newThreadId } = await chatService.generateResponse(
                message,
                threadId,
                userId,
                model,
                conversationMode,
                Array.isArray(attachments) ? attachments : [],
                { requestId: req.requestId, internalUserId: userId },
            );

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
            log.error('chat.send_message_controller_failed', {
                requestId: req.requestId,
                internalUserId: req.user?.id,
                headersSent: res.headersSent,
                ...errorFields(error),
            });
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
            log.error('chat.history_failed', {
                requestId: req.requestId,
                internalUserId: req.user?.id,
                ...errorFields(error),
            });
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
            log.error('chat.thread_fetch_failed', {
                requestId: req.requestId,
                internalUserId: req.user?.id,
                threadId: req.params.threadId,
                ...errorFields(error),
            });
            if (error instanceof ThreadAccessError) {
                return res.status(404).json({ error: error.message });
            }
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
            log.error('chat.thread_files_failed', {
                requestId: req.requestId,
                internalUserId: req.user?.id,
                threadId: req.params.threadId,
                ...errorFields(error),
            });
            if (error instanceof ThreadAccessError) {
                return res.status(404).json({ error: error.message });
            }
            res.status(500).json({ error: 'Failed to fetch thread files' });
        }
    },

    async getThreadFilesDelta(req: Request, res: Response) {
        try {
            if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
            const { threadId } = req.params;
            const sinceSeqRaw = req.query.sinceSeq;
            const sinceSeq = Number(sinceSeqRaw);
            if (!Number.isFinite(sinceSeq) || sinceSeq < 0) {
                return res.status(400).json({ error: 'sinceSeq must be a non-negative number' });
            }
            const delta = await chatService.getThreadFilesDelta(threadId as string, req.user.id, sinceSeq);
            res.json(delta);
        } catch (error) {
            log.error('chat.thread_files_delta_failed', {
                requestId: req.requestId,
                internalUserId: req.user?.id,
                threadId: req.params.threadId,
                sinceSeq: req.query.sinceSeq,
                ...errorFields(error),
            });
            if (error instanceof ThreadAccessError) {
                return res.status(404).json({ error: error.message });
            }
            res.status(500).json({ error: 'Failed to fetch thread file delta' });
        }
    }
};
