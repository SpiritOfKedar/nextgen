import { Resend } from 'resend';
import { log } from '../lib/logger';

const resend = new Resend(process.env.RESEND_API_KEY || 're_dummy');

export const sendThreadInviteEmail = async (
    toEmail: string,
    inviterName: string,
    threadTitle: string,
    threadUrl: string,
) => {
    if (!process.env.RESEND_API_KEY) {
        log.warn('RESEND_API_KEY not set. Skipping email send for invite', { toEmail });
        return;
    }
    
    try {
        const { data, error } = await resend.emails.send({
            from: 'NextGen <onboarding@resend.dev>', // Use Resend's testing domain
            to: [toEmail],
            subject: `${inviterName} invited you to collaborate on "${threadTitle}"`,
            html: `
                <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
                    <h2>You've been invited to collaborate!</h2>
                    <p><strong>${inviterName}</strong> has invited you to edit the project <strong>${threadTitle}</strong> on NextGen.</p>
                    <p>Click the link below to open the project:</p>
                    <a href="${threadUrl}" style="display: inline-block; padding: 10px 20px; background-color: #2563eb; color: #fff; text-decoration: none; border-radius: 5px;">Open Project</a>
                </div>
            `,
        });

        if (error) {
            log.error('Failed to send invite email', { error, toEmail });
        } else {
            log.info('Invite email sent', { toEmail, id: data?.id });
        }
    } catch (err) {
        log.error('Error sending invite email', { error: err });
    }
};
