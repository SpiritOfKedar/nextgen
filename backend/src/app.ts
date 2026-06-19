import express from 'express';
import cors from 'cors';
import compression from 'compression';
import { log, errorFields } from './lib/logger';
import { requestContextMiddleware, httpRequestLoggerMiddleware } from './middlewares/requestContext';
import { getBootError, getPool, isAppReady } from './config/db';
import apiRouter from './routes';

const app = express();

// Middleware
app.use(compression({ threshold: 1024 }));
app.use(
    cors({
        origin: (origin, callback) => {
            if (!origin) return callback(null, true);
            if (/^https?:\/\/localhost(:\d+)?$/.test(origin)) {
                return callback(null, origin);
            }
            const allowed = process.env.FRONTEND_URL || 'http://localhost:5173';
            if (origin === allowed) return callback(null, origin);
            callback(new Error(`CORS: origin ${origin} not allowed`));
        },
        credentials: true,
        exposedHeaders: ['X-Thread-Id', 'X-Request-Id'],
    }),
);
app.use(requestContextMiddleware);
app.use(httpRequestLoggerMiddleware);

// Liveness — always cheap; does not require DB.
app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Readiness — DB connected and boot-time schema migration finished.
app.get('/ready', async (_req, res) => {
    if (!isAppReady()) {
        res.status(503).json({
            status: 'not_ready',
            error: getBootError()?.message ?? 'starting',
        });
        return;
    }
    try {
        await getPool().query('SELECT 1');
        res.status(200).json({ status: 'ready', timestamp: new Date().toISOString() });
    } catch (err) {
        res.status(503).json({
            status: 'not_ready',
            error: err instanceof Error ? err.message : 'db_unreachable',
        });
    }
});

const apiReadinessMiddleware: express.RequestHandler = (_req, res, next) => {
    if (!isAppReady()) {
        res.status(503).json({
            error: 'Service is starting. Please retry shortly.',
            detail: getBootError()?.message,
        });
        return;
    }
    next();
};

// Routes — JSON body limits are applied per-route in routes/index.ts
app.use('/api', apiReadinessMiddleware, apiRouter);

// 404 for unknown paths
app.use((req, res) => {
    log.warn('http.route_not_found', {
        requestId: req.requestId,
        method: req.method,
        path: req.originalUrl,
    });
    res.status(404).json({ error: 'Not Found' });
});

// Global error handler (Express 4-arg)
app.use((err: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const message = err instanceof Error ? err.message : String(err);
    if (message === 'Unauthenticated') {
        res.status(401).json({ error: 'Unauthenticated' });
        return;
    }

    log.error('http.unhandled_error', {
        requestId: req.requestId,
        method: req.method,
        path: req.originalUrl,
        ...errorFields(err),
    });

    if (!res.headersSent) {
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

export default app;
