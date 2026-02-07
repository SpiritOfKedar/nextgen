import { Request, Response, NextFunction } from 'express';
import { ClerkExpressRequireAuth, StrictAuthProp, clerkClient } from '@clerk/clerk-sdk-node';
import { User } from '../models/User';

// Extend Express Request to include user
declare global {
    namespace Express {
        interface Request extends StrictAuthProp {
            user?: {
                id: string; // MongoDB ObjectId
                clerkId: string;
                email?: string;
            };
        }
    }
}

export const authMiddleware = [
    // 1. Verify Clerk Token
    ClerkExpressRequireAuth(),

    // 2. Sync with MongoDB
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const clerkId = req.auth.userId;

            console.log(`[AuthMiddleware] Clerk ID: ${clerkId}`);

            let user = await User.findOne({ clerkId });

            if (!user) {
                // Fetch the real email from Clerk's API
                let email = `user_${clerkId}@example.com`;
                try {
                    const clerkUser = await clerkClient.users.getUser(clerkId);
                    email = clerkUser.emailAddresses?.[0]?.emailAddress || email;
                    console.log(`[AuthMiddleware] Fetched email from Clerk: ${email}`);
                } catch (clerkErr) {
                    console.error('[AuthMiddleware] Failed to fetch Clerk user, using fallback email:', clerkErr);
                }

                user = await User.create({
                    clerkId,
                    email,
                });
                console.log(`[AuthMiddleware] New user created: ${user.email}`);
            } else {
                console.log(`[AuthMiddleware] User found: ${user.email}`);
            }

            // Attach MongoDB user to request
            req.user = {
                id: user._id.toString(),
                clerkId: user.clerkId || clerkId,
                email: user.email
            };

            next();
        } catch (error) {
            console.error('[AuthMiddleware] Error:', error);
            res.status(500).json({ error: 'Internal Server Error during Auth' });
        }
    }
];
