// One-time welcome email, sent the first time a NEW account gets a session —
// email+password (after OTP verification), Google, or Apple. Idempotent via
// User.welcomeEmailSentAt, claimed atomically so two concurrent sign-ins can't
// both send. Accounts created before the feature shipped are skipped (marked
// as sent) so long-standing users don't get a "welcome" on their next login.
import { PrismaClient } from '@prisma/client';
import { sendEmail } from './mailService.js';
import { welcomeEmail, SUPPORT_EMAIL } from './emailTemplates.js';
import { unsubscribeUrl } from './emailUnsubscribe.js';

const prisma = new PrismaClient();

/** Accounts created before this instant never get the welcome mail. */
export const WELCOME_EMAIL_SINCE = new Date(process.env.WELCOME_EMAIL_SINCE || '2026-09-10T00:00:00Z');

export type WelcomeOutcome = 'sent' | 'already_sent' | 'no_email' | 'legacy_account' | 'send_failed' | 'disabled';

export async function maybeSendWelcomeEmail(userId: string): Promise<WelcomeOutcome> {
  if (process.env.WELCOME_EMAIL_ENABLED === '0') return 'disabled';

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, email: true, createdAt: true, welcomeEmailSentAt: true },
  });
  if (!user || user.welcomeEmailSentAt) return 'already_sent';
  if (!user.email) return 'no_email';

  // Claim first: only the request that flips null → now sends.
  const claimed = await prisma.user.updateMany({
    where: { id: user.id, welcomeEmailSentAt: null },
    data: { welcomeEmailSentAt: new Date() },
  });
  if (claimed.count !== 1) return 'already_sent';

  if (user.createdAt < WELCOME_EMAIL_SINCE) return 'legacy_account';

  const msg = welcomeEmail(user.name, unsubscribeUrl(user.id));
  const res = await sendEmail({
    to: user.email,
    subject: msg.subject,
    html: msg.html,
    text: msg.text,
    replyTo: SUPPORT_EMAIL,
  });
  if (!res.sent) {
    // Release the claim so the next sign-in retries instead of losing the mail.
    await prisma.user.updateMany({ where: { id: user.id }, data: { welcomeEmailSentAt: null } }).catch(() => {});
    console.error('[welcome] send failed for', user.id, res.reason);
    return 'send_failed';
  }
  console.log('[welcome] sent to', user.id);
  return 'sent';
}

/** Fire-and-forget wrapper for auth routes: never throws, never blocks the response. */
export function scheduleWelcomeEmail(userId: string): void {
  setImmediate(() => {
    Promise.resolve()
      .then(() => maybeSendWelcomeEmail(userId))
      .catch(err => console.error('[welcome] unexpected error:', err?.message ?? err));
  });
}
