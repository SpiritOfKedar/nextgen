import { Request, Response } from 'express';
import * as collaboratorsRepo from '../repositories/collaborators';
import * as usersRepo from '../repositories/users';
import * as threadsRepo from '../repositories/threads';
import { sendThreadInviteEmail } from '../services/emailService';
import { log } from '../lib/logger';

export const getCollaborators = async (req: Request, res: Response) => {
    try {
        const threadId = req.params.id as string;
        const userId = req.user?.id;
        if (!userId) return res.status(401).json({ error: 'Unauthorized' });

        const thread = await threadsRepo.findByIdForUser(threadId, userId);
        if (!thread) {
            return res.status(404).json({ error: 'Thread not found or unauthorized' });
        }

        const collaborators = await collaboratorsRepo.getCollaborators(threadId);
        res.json(collaborators);
    } catch (err) {
        log.error('Error fetching collaborators', { error: err });
        res.status(500).json({ error: 'Internal Server Error' });
    }
};

export const addCollaborator = async (req: Request, res: Response) => {
    try {
        const threadId = req.params.id as string;
        const { email, role } = req.body;
        const userId = req.user?.id;
        
        if (!userId) return res.status(401).json({ error: 'Unauthorized' });
        if (!email) return res.status(400).json({ error: 'Email is required' });

        const thread = await threadsRepo.findByIdForUser(threadId, userId);
        if (!thread) {
            return res.status(404).json({ error: 'Thread not found or unauthorized' });
        }
        
        // Only thread owner can add collaborators (or perhaps existing editors, but we'll restrict to owner for simplicity)
        if (thread.user_id !== userId) {
            return res.status(403).json({ error: 'Only the thread owner can invite collaborators' });
        }

        const targetUser = await usersRepo.findByEmail(email);
        if (!targetUser) {
            return res.status(404).json({ error: 'User with this email is not registered on NextGen. They must sign up first.' });
        }

        if (targetUser.id === thread.user_id) {
            return res.status(400).json({ error: 'Cannot add the thread owner as a collaborator' });
        }

        await collaboratorsRepo.addCollaborator(threadId, targetUser.id, role || 'editor');

        // Fetch inviter's email to show in the email
        const inviter = await usersRepo.findByClerkId(req.user!.clerkId);
        const inviterName = inviter?.email || 'A user';

        // Assuming frontend runs on same domain or we have an env var for it.
        const origin = req.headers.origin || process.env.FRONTEND_URL || 'http://localhost:5173';
        const threadUrl = `${origin}/?threadId=${threadId}`;

        await sendThreadInviteEmail(email, inviterName, thread.title || 'Untitled Project', threadUrl);

        res.json({ success: true, message: 'Collaborator added successfully' });
    } catch (err) {
        log.error('Error adding collaborator', { error: err });
        res.status(500).json({ error: 'Internal Server Error' });
    }
};

export const removeCollaborator = async (req: Request, res: Response) => {
    try {
        const threadId = req.params.id as string;
        const targetUserId = req.params.userId as string;
        const userId = req.user?.id;
        
        if (!userId) return res.status(401).json({ error: 'Unauthorized' });

        const thread = await threadsRepo.findByIdForUser(threadId, userId);
        if (!thread) {
            return res.status(404).json({ error: 'Thread not found or unauthorized' });
        }

        // Only thread owner can remove collaborators
        if (thread.user_id !== userId) {
            return res.status(403).json({ error: 'Only the thread owner can remove collaborators' });
        }

        await collaboratorsRepo.removeCollaborator(threadId, targetUserId);
        res.json({ success: true, message: 'Collaborator removed successfully' });
    } catch (err) {
        log.error('Error removing collaborator', { error: err });
        res.status(500).json({ error: 'Internal Server Error' });
    }
};
