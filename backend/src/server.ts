import dotenv from 'dotenv';
dotenv.config();

import app from './app';
import { connectDB } from './config/db';
import { abortOrphanStreaming } from './repositories/messages';

const PORT = process.env.PORT || 3001;

const main = async () => {
    await connectDB();

    const aborted = await abortOrphanStreaming();
    if (aborted > 0) {
        console.log(`[boot] Marked ${aborted} orphan streaming message(s) as aborted`);
    }

    app.listen(PORT, () => {
        console.log(`Server is running on port ${PORT}`);
    });
};

main().catch((error) => {
    console.error('Failed to start server:', error instanceof Error ? error.message : error);
    process.exit(1);
});
