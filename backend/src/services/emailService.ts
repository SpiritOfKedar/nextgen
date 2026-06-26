import fs from 'fs';
import path from 'path';
import nodemailer from 'nodemailer';
import { log } from '../lib/logger';

const smtpHost = process.env.SMTP_HOST;
const smtpPort = Number(process.env.SMTP_PORT || 587);
const smtpUser = process.env.SMTP_USER;
const smtpPass = process.env.SMTP_PASS;
const fromEmail = process.env.SMTP_FROM_EMAIL || smtpUser;
const fromName = process.env.SMTP_FROM_NAME || 'NextGen';

const transporter = smtpHost && smtpUser && smtpPass
    ? nodemailer.createTransport({
        host: smtpHost,
        port: smtpPort,
        secure: smtpPort === 465,
        auth: { user: smtpUser, pass: smtpPass },
    })
    : null;

const LOGO_PATH = path.join(process.cwd(), 'assets', 'nextgen-logo.png');

const escapeHtml = (value: string): string => value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const formatInviterLabel = (inviterName: string): string => {
    const trimmed = inviterName.trim();
    if (!trimmed.includes('@')) return trimmed;
    const local = trimmed.split('@')[0] ?? trimmed;
    const readable = local.replace(/[._-]+/g, ' ').trim();
    if (!readable) return trimmed;
    return readable.replace(/\b\w/g, (c) => c.toUpperCase());
};

const buildInviteEmailHtml = (
    inviterName: string,
    threadTitle: string,
    threadUrl: string,
): string => {
    const inviter = escapeHtml(formatInviterLabel(inviterName));
    const title = escapeHtml(threadTitle);
    const url = escapeHtml(threadUrl);
    const year = new Date().getFullYear();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Collaboration invite</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:#f4f4f5;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background-color:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e4e4e7;box-shadow:0 4px 24px rgba(0,0,0,0.06);">
          <tr>
            <td style="background-color:#09090b;padding:28px 32px;text-align:center;">
              <img src="cid:nextgen-logo" alt="NextGen" width="160" style="display:block;margin:0 auto;max-width:160px;height:auto;border:0;" />
            </td>
          </tr>
          <tr>
            <td style="padding:36px 32px 28px;">
              <p style="margin:0 0 8px;font-size:12px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:#71717a;">Collaboration invite</p>
              <h1 style="margin:0 0 16px;font-size:24px;line-height:1.3;font-weight:700;color:#18181b;">You&rsquo;ve been invited to collaborate</h1>
              <p style="margin:0 0 20px;font-size:16px;line-height:1.6;color:#3f3f46;">
                <strong style="color:#18181b;">${inviter}</strong> has invited you to edit a project on NextGen.
              </p>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 28px;background-color:#fafafa;border:1px solid #e4e4e7;border-radius:8px;">
                <tr>
                  <td style="padding:16px 18px;">
                    <p style="margin:0 0 4px;font-size:11px;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;color:#71717a;">Project</p>
                    <p style="margin:0;font-size:17px;line-height:1.4;font-weight:600;color:#18181b;">${title}</p>
                  </td>
                </tr>
              </table>
              <table role="presentation" cellspacing="0" cellpadding="0" style="margin:0 auto 24px;">
                <tr>
                  <td style="border-radius:8px;background-color:#2563eb;">
                    <a href="${url}" style="display:inline-block;padding:14px 28px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px;">Open project</a>
                  </td>
                </tr>
              </table>
              <p style="margin:0;font-size:13px;line-height:1.6;color:#71717a;">
                Or copy this link into your browser:<br />
                <a href="${url}" style="color:#2563eb;word-break:break-all;">${url}</a>
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 32px 28px;border-top:1px solid #f4f4f5;background-color:#fafafa;text-align:center;">
              <p style="margin:0 0 6px;font-size:12px;line-height:1.5;color:#a1a1aa;">
                You received this email because someone added you as a collaborator on NextGen.
              </p>
              <p style="margin:0;font-size:12px;line-height:1.5;color:#a1a1aa;">
                &copy; ${year} NextGen. Build apps with AI.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
};

const buildInviteEmailText = (
    inviterName: string,
    threadTitle: string,
    threadUrl: string,
): string => {
    const inviter = formatInviterLabel(inviterName);
    return [
        "You've been invited to collaborate on NextGen",
        '',
        `${inviter} has invited you to edit the project "${threadTitle}".`,
        '',
        `Open the project: ${threadUrl}`,
        '',
        'You received this email because someone added you as a collaborator on NextGen.',
    ].join('\n');
};

export const sendThreadInviteEmail = async (
    toEmail: string,
    inviterName: string,
    threadTitle: string,
    threadUrl: string,
) => {
    if (!transporter || !fromEmail) {
        log.warn('SMTP not configured (SMTP_HOST, SMTP_USER, SMTP_PASS). Skipping invite email', { toEmail });
        return;
    }

    const attachments = fs.existsSync(LOGO_PATH)
        ? [{
            filename: 'nextgen-logo.png',
            path: LOGO_PATH,
            cid: 'nextgen-logo',
        }]
        : [];

    if (!fs.existsSync(LOGO_PATH)) {
        log.warn('NextGen logo not found for invite email', { path: LOGO_PATH });
    }

    try {
        const info = await transporter.sendMail({
            from: `"${fromName}" <${fromEmail}>`,
            to: toEmail,
            subject: `${formatInviterLabel(inviterName)} invited you to collaborate on "${threadTitle}"`,
            text: buildInviteEmailText(inviterName, threadTitle, threadUrl),
            html: buildInviteEmailHtml(inviterName, threadTitle, threadUrl),
            attachments,
        });

        log.info('Invite email sent', { toEmail, messageId: info.messageId });
    } catch (err) {
        log.error('Failed to send invite email', {
            error: err instanceof Error ? err.message : String(err),
            toEmail,
        });
    }
};
