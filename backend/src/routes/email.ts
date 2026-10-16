// Public email-link endpoints.
//
// Unsubscribe: GET from the footer link (renders a page) and POST for RFC 8058
// one-click (List-Unsubscribe-Post: List-Unsubscribe=One-Click). Same signed
// token, idempotent. Unsubscribing clears User.marketingConsentAt (the opt-in
// record every marketing send checks) and sets the legacy opt-out flag.
//
// Confirm (double opt-in for BlogSubscriber): GET renders a page with a
// button; only the POST marks the row confirmed. Mail scanners and link
// prefetchers issue GETs, so a GET alone must never count as consent.
import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { verifyUnsubscribeToken, verifyConfirmToken, FRONTEND_URL } from '../services/emailUnsubscribe.js';
import { escapeHtml } from '../services/emailTemplates.js';

const router = Router();
const prisma = new PrismaClient();

function page(title: string, body: string, extra = ''): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head>
<body style="margin:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0f0f0f;">
<div style="max-width:440px;margin:60px auto;background:#fff;border-radius:16px;padding:32px;text-align:center;">
<h1 style="font-size:20px;margin:0 0 10px;">${title}</h1><p style="margin:0 0 20px;color:#52525b;">${body}</p>${extra}
<a href="${FRONTEND_URL}" style="color:#09090b;font-weight:600;">Back to axiomtraining.io</a></div></body></html>`;
}

/**
 * The id in an unsubscribe link is either a User id or a BlogSubscriber id
 * (both uuids; the HMAC covers whichever it is). Try the account first, then
 * the subscriber list. Returns how many rows were flipped (0 = unknown id).
 */
async function optOut(id: string): Promise<number> {
  const u = await prisma.user.updateMany({ where: { id }, data: { marketingEmailsOptOut: true, marketingConsentAt: null } });
  if (u.count > 0) return u.count;
  const s = await prisma.blogSubscriber.updateMany({ where: { id, unsubscribedAt: null }, data: { unsubscribedAt: new Date() } });
  return s.count;
}

/** Turn off only the weekly wins email. Returns false when the user is unknown. */
async function weeklyOff(userId: string): Promise<boolean> {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { notificationPrefsJson: true } });
  if (!u) return false;
  let prefs: Record<string, unknown> = {};
  try { prefs = JSON.parse(u.notificationPrefsJson ?? '{}') ?? {}; } catch { prefs = {}; }
  await prisma.user.update({ where: { id: userId }, data: { notificationPrefsJson: JSON.stringify({ ...prefs, weeklyEmail: false }) } });
  return true;
}

router.get('/email/unsubscribe', async (req, res) => {
  const userId = String(req.query.u ?? '');
  const token = String(req.query.t ?? '');
  if (!verifyUnsubscribeToken(userId, token)) {
    return res.status(400).type('html').send(page('This link isn’t valid', 'The unsubscribe link looks incomplete. Reply to the email instead and we’ll take care of it.'));
  }
  try {
    // Just the weekly wins email: flip that one switch, leave everything else on.
    if (req.query.c === 'weekly') {
      if (!(await weeklyOff(userId))) return res.status(404).type('html').send(page('Account not found', 'We couldn’t find that account, so there’s nothing to unsubscribe.'));
      return res.type('html').send(page('Weekly email off', 'You won’t get the Sunday weekly wins email anymore. Turn it back on any time in You › Notifications, or ask Anakin.'));
    }
    const r = await optOut(userId);
    if (r === 0) return res.status(404).type('html').send(page('Account not found', 'We couldn’t find that account, so there’s nothing to unsubscribe.'));
    res.type('html').send(page('You’re unsubscribed', 'You won’t get Axiom blog posts or updates by email anymore. Account emails like verification codes still arrive.'));
  } catch (err) {
    console.error('[email] unsubscribe error:', err);
    res.status(500).type('html').send(page('Something went wrong', 'Please try the link again in a minute, or reply to the email.'));
  }
});

// RFC 8058 one-click: mail clients POST `List-Unsubscribe=One-Click` to the
// exact URL from the List-Unsubscribe header (token in the query string). No
// cookies, no redirects, no confirmation step; answer 200 for any valid token
// (even if the row is already gone) so the client doesn't retry.
router.post('/email/unsubscribe', async (req, res) => {
  const userId = String(req.query.u ?? '');
  const token = String(req.query.t ?? '');
  if (!verifyUnsubscribeToken(userId, token)) return res.status(400).json({ error: 'Invalid link' });
  try {
    if (req.query.c === 'weekly') await weeklyOff(userId);
    else await optOut(userId);
  } catch (err) {
    console.error('[email] one-click unsubscribe error:', err);
    return res.status(500).json({ error: 'Try again' });
  }
  res.json({ ok: true });
});

// ─── Double opt-in confirmation ──────────────────────────────────────────────

router.get('/email/confirm', async (req, res) => {
  const id = String(req.query.s ?? '');
  const token = String(req.query.t ?? '');
  if (!verifyConfirmToken(id, token)) {
    return res.status(400).type('html').send(page('This link isn’t valid', 'The confirmation link looks incomplete. You haven’t been subscribed.'));
  }
  const form = `<form method="post" action="?s=${encodeURIComponent(id)}&amp;t=${encodeURIComponent(token)}" style="margin:0 0 20px;">
<button type="submit" style="background:#09090b;color:#fff;border:0;border-radius:10px;padding:12px 22px;font-weight:600;font-size:15px;cursor:pointer;">Yes, send me updates</button></form>`;
  res.type('html').send(page('Confirm your subscription', 'Tap the button to start receiving Axiom blog posts and product updates. You can unsubscribe from any email.', form));
});

router.post('/email/confirm', async (req, res) => {
  const id = String(req.query.s ?? '');
  const token = String(req.query.t ?? '');
  if (!verifyConfirmToken(id, token)) {
    return res.status(400).type('html').send(page('This link isn’t valid', 'The confirmation link looks incomplete. You haven’t been subscribed.'));
  }
  try {
    const sub = await prisma.blogSubscriber.findUnique({ where: { id } });
    if (!sub) return res.status(404).type('html').send(page('Subscription not found', 'We couldn’t find that request. It may have been removed.'));
    if (sub.unsubscribedAt) {
      return res.status(409).type('html').send(page('You unsubscribed earlier', `${escapeHtml(sub.email)} unsubscribed from Axiom updates, so we won’t email it. Reply to any Axiom email if you want back in.`));
    }
    if (!sub.confirmedAt) await prisma.blogSubscriber.update({ where: { id }, data: { confirmedAt: new Date() } });
    res.type('html').send(page('You’re subscribed', 'Thanks for confirming. You’ll get Axiom blog posts and updates by email; every one has an unsubscribe link.'));
  } catch (err) {
    console.error('[email] confirm error:', err);
    res.status(500).type('html').send(page('Something went wrong', 'Please try the link again in a minute.'));
  }
});

export default router;
