import express from 'express';
import cors from 'cors';

const app = express();

import apiRouter from './routes';

// Middleware
app.use(cors({
    origin: process.env.FRONTEND_URL || 'http://localhost:5173',
    credentials: true,
    exposedHeaders: ['X-Thread-Id'],
}));
app.use(express.json());

// Routes
app.use('/api', apiRouter);

// Global Error Handler
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (err.message === 'Unauthenticated') {
        // Suppress log for expected auth failures
        res.status(401).json({ error: 'Unauthenticated' });
    } else {
        console.error('SERVER ERROR:', err.message);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// Health Check
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

export default app;
