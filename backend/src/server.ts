import dotenv from 'dotenv';
dotenv.config();

import app from './app';
import { connectDB } from './config/db';
import { abortOrphanStreaming } from './repositories/messages';
import { log, errorFields } from './lib/logger';

const PORT = process.env.PORT || 3001;

const main = async () => {
    await connectDB();

    const aborted = await abortOrphanStreaming();
    if (aborted > 0) {
        log.info('boot.orphan_streaming_aborted', { count: aborted });
    }

    app.listen(PORT, () => {
        log.info('boot.server_listening', { port: PORT });
    });
};

main().catch((error) => {
    log.error('boot.server_failed', errorFields(error));
    process.exit(1);
});
