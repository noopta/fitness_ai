// Fitbit via the Google Health API: connect (OAuth), callback, manual sync,
// and Google's webhook.

import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { requireAuth } from '../middleware/requireAuth.js';
import { wearablesAvailableFor } from '../services/featureFlags.js';
import { authUrl, completeConnection, googleHealthConfigured, handleNotifications, pullGoogleHealth, readState, webhookAuthorized } from '../services/wearables/googleHealth.js';
import { todayForTz } from '../services/localDate.js';

const router = Router();
const prisma = new PrismaClient();

const page = (title: string, line: string) => `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<body style="font-family:-apple-system,system-ui,sans-serif;max-width:420px;margin:15vh auto;padding:0 24px;color:#09090b">
<h1 style="font-size:24px">${title}</h1><p style="color:#52525b;line-height:1.5">${line}</p>
<p><a href="axiom://" style="color:#A51C30;font-weight:600">Back to Axiom</a></p></body>`;

// GET /api/wearables/google/connect → { url } to open in the browser.
router.get('/wearables/google/connect', requireAuth, async (req, res) => {
  if (!wearablesAvailableFor(req.user!.id, req.user!.email)) return res.status(404).json({ error: 'Not found' });
  if (!googleHealthConfigured()) return res.status(503).json({ error: 'Fitbit isn’t set up on the server yet.' });
  res.json({ url: authUrl(req.user!.id) });
});

// GET /api/wearables/google/callback — Google sends the user back here.
// No session cookie in the system browser, so the signed state says who it is.
router.get('/wearables/google/callback', async (req, res) => {
  const userId = readState(typeof req.query.state === 'string' ? req.query.state : undefined);
  if (!userId) return res.status(400).send(page('That link expired', 'Start connecting Fitbit again from the app.'));
  if (typeof req.query.error === 'string') return res.send(page('Fitbit not connected', 'You can connect it any time from You → Watch & health data.'));
  const code = typeof req.query.code === 'string' ? req.query.code : '';
  if (!code) return res.status(400).send(page('Something went wrong', 'Google didn’t send a code back. Try connecting again.'));
  try {
    const u = await prisma.user.findUnique({ where: { id: userId }, select: { timezone: true } });
    const r = await completeConnection(userId, code, todayForTz(u?.timezone));
    res.send(page('Fitbit connected', `${r.days} days synced. Anakin will read your sleep, heart rate and recovery from now on.`));
  } catch (e: any) {
    console.error('[wearables] google callback failed:', e?.message ?? e);
    res.status(502).send(page('Fitbit not connected', 'Google didn’t accept the connection. Try again in a minute.'));
  }
});

// POST /api/wearables/google/sync — pull the last week now.
router.post('/wearables/google/sync', requireAuth, async (req, res) => {
  if (!wearablesAvailableFor(req.user!.id, req.user!.email)) return res.status(404).json({ error: 'Not found' });
  try {
    const u = await prisma.user.findUnique({ where: { id: req.user!.id }, select: { timezone: true } });
    const today = todayForTz(u?.timezone);
    const from = new Date(`${today}T12:00:00Z`); from.setUTCDate(from.getUTCDate() - 6);
    res.json(await pullGoogleHealth(req.user!.id, from.toISOString().slice(0, 10), today));
  } catch (e: any) {
    res.status(409).json({ error: e?.message ?? 'Couldn’t sync Fitbit.' });
  }
});

// POST /api/wearables/google/webhook — Google Health API notifications.
// Verification: with our secret → 200, without → 401 (Google checks both).
// Notifications: acknowledge with 204 at once, then pull what changed.
router.post('/wearables/google/webhook', async (req, res) => {
  if (!webhookAuthorized(req.get('authorization'))) return res.status(401).end();
  if (req.body?.type === 'verification') return res.status(200).json({ ok: true });
  res.status(204).end();
  void handleNotifications(req.body).catch((e) => console.error('[wearables] webhook handling failed:', e?.message ?? e));
});

export default router;
