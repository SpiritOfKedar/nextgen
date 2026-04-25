import express from 'express';
import cors from 'cors';
import { log, errorFields } from './lib/logger';
import { requestContextMiddleware, httpRequestLoggerMiddleware } from './middlewares/requestContext';
import apiRouter from './routes';

const app = express();

// Middleware
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
app.use(express.json());
app.use(requestContextMiddleware);
app.use(httpRequestLoggerMiddleware);

// Health (before API so it stays cheap and obvious in routing)
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Routes
app.use('/api', apiRouter);

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
