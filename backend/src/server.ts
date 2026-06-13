import dotenv from 'dotenv';
dotenv.config();

import app from './app';
import { connectDB } from './config/db';
import { abortOrphanStreaming } from './repositories/messages';
import { log, errorFields } from './lib/logger';

const PORT = process.env.PORT || 3001;

const main = async () => {
    log.info('boot.starting', { port: PORT, pid: process.pid });
    await connectDB();

    const aborted = await abortOrphanStreaming();
    if (aborted > 0) {
        log.info('boot.orphan_streaming_aborted', { count: aborted });
    }

    const server = app.listen(PORT, () => {
        log.info('boot.server_listening', { port: PORT });
    });

    server.on('error', (error: NodeJS.ErrnoException) => {
        if (error.code === 'EADDRINUSE') {
            log.error('boot.port_in_use', {
                port: PORT,
                hint: `Port ${PORT} is already in use. Set PORT in backend/.env to a free port and update VITE_API_URL in frontend/.env.`,
                ...errorFields(error),
            });
        } else {
            log.error('boot.server_listen_failed', errorFields(error));
        }
        process.exit(1);
    });
};

main().catch((error) => {
    log.error('boot.server_failed', {
        hint: 'Verify DATABASE_URL credentials and network reachability',
        ...errorFields(error),
    });
    process.exit(1);
});
