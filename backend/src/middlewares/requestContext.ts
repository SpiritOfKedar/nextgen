import { randomUUID } from 'crypto';
import type { Request, Response, NextFunction } from 'express';
import { log } from '../lib/logger';

/**
 * Assign a stable request id for log correlation. Echoes client `X-Request-Id` when present.
 */
export const requestContextMiddleware = (req: Request, res: Response, next: NextFunction): void => {
    const incoming = req.headers['x-request-id'];
    const requestId =
        typeof incoming === 'string' && incoming.trim().length > 0 ? incoming.trim() : randomUUID();
    req.requestId = requestId;
    res.setHeader('X-Request-Id', requestId);
    next();
};

/**
 * One line per finished HTTP response (duration + status). Skips noisy health checks at debug only — log all at info.
 */
export const httpRequestLoggerMiddleware = (req: Request, res: Response, next: NextFunction): void => {
    const start = Date.now();
    res.on('finish', () => {
        const durationMs = Date.now() - start;
        const path = req.originalUrl?.split('?')[0] || req.url;
        if (path === '/health' && process.env.LOG_HTTP_HEALTH !== 'true') return;

        log.info('http.request.complete', {
            requestId: req.requestId,
            method: req.method,
            path,
            statusCode: res.statusCode,
            durationMs,
        });
    });
    next();
};
