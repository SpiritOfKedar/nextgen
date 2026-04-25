import { Request, Response, NextFunction } from 'express';
import { ClerkExpressRequireAuth, StrictAuthProp, clerkClient } from '@clerk/clerk-sdk-node';
import * as users from '../repositories/users';

declare global {
    namespace Express {
        interface Request extends StrictAuthProp {
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
                    console.error('[AuthMiddleware] Failed to fetch Clerk user, using fallback email:', clerkErr);
                }
                row = await users.upsertByClerkId(clerkId, email);
                console.log(`[AuthMiddleware] User upserted: ${row.email}`);
            }

            req.user = {
                id: row.id,
                clerkId: row.clerk_id,
                email: row.email,
            };

            next();
        } catch (error) {
            console.error('[AuthMiddleware] Error:', error);
            res.status(500).json({ error: 'Internal Server Error during Auth' });
        }
    },
];
