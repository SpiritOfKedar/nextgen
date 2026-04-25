import { Request, Response, NextFunction } from 'express';
import { ClerkExpressRequireAuth, StrictAuthProp, clerkClient } from '@clerk/clerk-sdk-node';
import * as users from '../repositories/users';
import { log, errorFields } from '../lib/logger';

declare global {
    namespace Express {
        interface Request extends StrictAuthProp {
            /** Set by `requestContextMiddleware` when the request reaches the app stack */
            requestId?: string;
            user?: {
                id: string;       // Postgres uuid
                clerkId: string;
                email?: string;
            };
        }
    }
}

export const authMiddleware = [
    ClerkExpressRequireAuth(),

    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const clerkId = req.auth.userId;

            const existing = await users.findByClerkId(clerkId);
            let row = existing;

            if (!row) {
                let email = `user_${clerkId}@example.com`;
                try {
                    const clerkUser = await clerkClient.users.getUser(clerkId);
                    email = clerkUser.emailAddresses?.[0]?.emailAddress || email;
                } catch (clerkErr) {
                    log.warn('auth.clerk_profile_fetch_failed', {
                        requestId: req.requestId,
                        clerkId,
                        ...errorFields(clerkErr),
                    });
                }
                row = await users.upsertByClerkId(clerkId, email);
                log.info('auth.user_upserted', { requestId: req.requestId, clerkId, email: row.email });
            }

            req.user = {
                id: row.id,
                clerkId: row.clerk_id,
                email: row.email,
            };

            next();
        } catch (error) {
            log.error('auth.middleware_failed', {
                requestId: req.requestId,
                clerkId: req.auth?.userId,
                ...errorFields(error),
            });
            res.status(500).json({ error: 'Internal Server Error during Auth' });
        }
    },
];
