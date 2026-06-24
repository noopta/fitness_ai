import { Router } from 'express';
import crypto from 'crypto';

// Instagram (Meta) webhook endpoint for the Axiom Instagram API app.
//   GET  /api/webhooks/instagram  — Meta's subscription verification handshake
//   POST /api/webhooks/instagram  — event delivery (comments/mentions/messaging)
// Verify token + app secret live in env (INSTAGRAM_WEBHOOK_VERIFY_TOKEN,
// INSTAGRAM_APP_SECRET). The token is an arbitrary shared secret we also paste
// into the App Dashboard's webhook config; the app secret signs POST payloads.

const router = Router();

const VERIFY_TOKEN = process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN || '';
const APP_SECRET = process.env.INSTAGRAM_APP_SECRET || '';

// Verification: Meta GETs ?hub.mode=subscribe&hub.verify_token=...&hub.challenge=...
// Echo the challenge back as plaintext iff the token matches what we configured.
router.get('/webhooks/instagram', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && typeof token === 'string' && VERIFY_TOKEN && token === VERIFY_TOKEN) {
    console.log('[IG webhook] verification OK');
    return res.status(200).send(String(challenge ?? ''));
  }
  console.warn('[IG webhook] verification FAILED (mode/token mismatch)');
  return res.sendStatus(403);
});

// Event delivery: verify X-Hub-Signature-256 (HMAC-SHA256 of the raw body with
// the app secret) before trusting anything, then ack fast (Meta times out ~5s).
// req.rawBody is populated for this path by the express.json verify hook in index.ts.
router.post('/webhooks/instagram', (req: any, res) => {
  const sig = req.get('x-hub-signature-256') || '';
  const raw: Buffer | undefined = req.rawBody;
  if (APP_SECRET && raw) {
    const expected = 'sha256=' + crypto.createHmac('sha256', APP_SECRET).update(raw).digest('hex');
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      console.warn('[IG webhook] bad signature — rejecting');
      return res.sendStatus(403);
    }
  }
  // No consumer wired yet (creator-marketplace / comments flow TBD) — log + ack.
  try {
    console.log('[IG webhook] event:', JSON.stringify(req.body).slice(0, 800));
  } catch { /* ignore */ }
  return res.sendStatus(200);
});

export default router;
