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

    app.listen(PORT, () => {
        log.info('boot.server_listening', { port: PORT });
    });
};

main().catch((error) => {
    log.error('boot.server_failed', {
        hint: 'Verify SUPABASE_DB_URL/SUPABASE_URL credentials and network reachability',
        ...errorFields(error),
    });
    process.exit(1);
});
