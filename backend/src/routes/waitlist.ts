// POST /api/waitlist — legacy waitlist signup (no DB record; notifies the
// founder and sends the signer a confirmation).
//
// Compliance (2026-10):
// - name/phone are length-capped and HTML-escaped before they go into any
//   email or SMS body (they were interpolated raw into HTML before).
// - The confirmation no longer enrols anyone in "discounts and promotions".
//   Promotional wording appears only when the form sends
//   `marketingConsent: true`; otherwise it promises a single launch email.
// - Every confirmation carries an unsubscribe line and the postal address
//   (emailTemplates.layout). Mail goes through the shared mailService.
import { Router } from 'express';
import { outboundNotifyLimiter } from '../middleware/rateLimiter.js';
import { z } from 'zod';
import twilio from 'twilio';
import { sendEmail } from '../services/mailService.js';
import { escapeHtml, waitlistConfirmationEmail, SUPPORT_EMAIL } from '../services/emailTemplates.js';

const router = Router();

export const NAME_MAX = 80;
export const PHONE_MAX = 32;

/** Strip control characters (incl. CR/LF, so nothing can smuggle header-like lines) and trim. */
function clean(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
}

export const joinWaitlistSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  name: z.string().max(500).optional().transform((v) => (v ? clean(v).slice(0, NAME_MAX) : undefined)),
  phone: z.string().max(200).optional()
    .transform((v) => (v ? clean(v).replace(/[^0-9+()\-.\s]/g, '').slice(0, PHONE_MAX).trim() : undefined)),
  /** Explicit opt-in to promotional email. Anything but `true` means no. */
  marketingConsent: z.boolean().optional().default(false),
});

const FOUNDER_EMAIL = process.env.WAITLIST_NOTIFY_EMAIL || 'anuptaislam33@gmail.com';

let twilioClient: ReturnType<typeof twilio> | null = null;
if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_ACCOUNT_SID.startsWith('AC')) {
  try {
    twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  } catch {
    console.warn('⚠ Twilio initialization failed, SMS notifications disabled');
  }
}

/** Internal notification to the founder. Exported for tests. */
export function founderNotificationHtml(d: { email: string; name?: string; phone?: string; marketingConsent: boolean }, at = new Date()): string {
  return `
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
  <h2 style="color: #2563eb;">New Axiom waitlist signup</h2>
  <div style="background: #f3f4f6; padding: 20px; border-radius: 8px; margin: 20px 0;">
    <p><strong>Email:</strong> ${escapeHtml(d.email)}</p>
    ${d.name ? `<p><strong>Name:</strong> ${escapeHtml(d.name)}</p>` : ''}
    ${d.phone ? `<p><strong>Phone:</strong> ${escapeHtml(d.phone)}</p>` : ''}
    <p><strong>Marketing consent:</strong> ${d.marketingConsent ? `yes (${escapeHtml(at.toISOString())})` : 'no'}</p>
    <p><strong>Time:</strong> ${escapeHtml(at.toISOString())}</p>
  </div>
</div>`;
}

router.post('/waitlist', outboundNotifyLimiter, async (req, res) => {
  const parsed = joinWaitlistSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: 'Invalid request data' });
  const data = parsed.data;
  console.log('[waitlist] new signup', { domain: data.email.split('@')[1], marketingConsent: data.marketingConsent });

  if (twilioClient && process.env.TWILIO_PHONE_NUMBER && process.env.NOTIFICATION_PHONE) {
    try {
      await twilioClient.messages.create({
        body: `New Axiom waitlist signup: ${data.email}`,
        from: process.env.TWILIO_PHONE_NUMBER,
        to: process.env.NOTIFICATION_PHONE,
      });
    } catch (smsError: any) {
      console.error('[waitlist] SMS failed:', smsError?.message || smsError);
    }
  }

  try {
    await sendEmail({
      to: FOUNDER_EMAIL,
      subject: `${data.email} joined the waitlist`,
      html: founderNotificationHtml(data),
    });
  } catch (err: any) {
    console.error('[waitlist] founder notification failed:', err?.message || err);
  }

  try {
    const msg = waitlistConfirmationEmail({ name: data.name, marketing: data.marketingConsent });
    await sendEmail({
      to: data.email,
      subject: msg.subject,
      html: msg.html,
      text: msg.text,
      replyTo: SUPPORT_EMAIL,
      headers: { 'List-Unsubscribe': `<mailto:${SUPPORT_EMAIL}?subject=unsubscribe>` },
    });
  } catch (err: any) {
    console.error('[waitlist] confirmation email failed:', err?.message || err);
  }

  res.json({ success: true, message: 'Successfully joined waitlist! Check your email for confirmation.' });
});

export default router;
