// One-click unsubscribe target linked from every broadcast email. GET so it
// works from a plain link and from mail clients' List-Unsubscribe handling;
// idempotent; renders a tiny confirmation page instead of JSON.
import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { verifyUnsubscribeToken, FRONTEND_URL } from '../services/emailUnsubscribe.js';

const router = Router();
const prisma = new PrismaClient();

function page(title: string, body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head>
<body style="margin:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0f0f0f;">
<div style="max-width:440px;margin:60px auto;background:#fff;border-radius:16px;padding:32px;text-align:center;">
<h1 style="font-size:20px;margin:0 0 10px;">${title}</h1><p style="margin:0 0 20px;color:#52525b;">${body}</p>
<a href="${FRONTEND_URL}" style="color:#09090b;font-weight:600;">Back to axiomtraining.io</a></div></body></html>`;
}

router.get('/email/unsubscribe', async (req, res) => {
  const userId = String(req.query.u ?? '');
  const token = String(req.query.t ?? '');
  if (!verifyUnsubscribeToken(userId, token)) {
    return res.status(400).type('html').send(page('This link isn’t valid', 'The unsubscribe link looks incomplete. Reply to the email instead and we’ll take care of it.'));
  }
  try {
    const r = await prisma.user.updateMany({ where: { id: userId }, data: { marketingEmailsOptOut: true } });
    if (r.count === 0) return res.status(404).type('html').send(page('Account not found', 'We couldn’t find that account, so there’s nothing to unsubscribe.'));
    res.type('html').send(page('You’re unsubscribed', 'You won’t get Axiom blog posts or updates by email anymore. Account emails like verification codes still arrive.'));
  } catch (err) {
    console.error('[email] unsubscribe error:', err);
    res.status(500).type('html').send(page('Something went wrong', 'Please try the link again in a minute, or reply to the email.'));
  }
});

// POST variant for RFC 8058 one-click (List-Unsubscribe-Post) clients.
router.post('/email/unsubscribe', async (req, res) => {
  const userId = String(req.query.u ?? '');
  const token = String(req.query.t ?? '');
  if (!verifyUnsubscribeToken(userId, token)) return res.status(400).json({ error: 'Invalid link' });
  await prisma.user.updateMany({ where: { id: userId }, data: { marketingEmailsOptOut: true } }).catch(() => {});
  res.json({ ok: true });
});

export default router;
