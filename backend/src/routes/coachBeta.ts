// Coach beta / launch list (public /coaches page on the web).
//
// POST /api/coach-beta/signup            public, outboundNotifyLimiter
// GET  /api/coach-beta/signups           requireAuth + requireAdmin (JSON, newest first)
// GET  /api/coach-beta/signups.csv       same gate, CSV (formula-injection safe)
// GET  /api/coach-beta/unsubscribe?token= footer link (renders a page)
// POST /api/coach-beta/unsubscribe?token= RFC 8058 one-click
//
// Every stored row is an explicit opt-in: the form must send
// `marketingConsent: true`, which becomes marketingConsentAt. A honeypot field
// (`company`) that a person never sees must be empty; when it isn't we answer
// 200 and store nothing, so bots get no signal.
//
// New signup → confirmation email to the coach (emailTemplates.layout, with
// postal address + signed unsubscribe link), a founder email with every field
// (escaped, reply-to = the coach) and a Twilio SMS. All three are best-effort:
// a mail/SMS failure is logged and never fails the request.
//
// Repeat signup (same email) → fields are updated, `alreadyOnList: true`, and
// the confirmation is re-sent only when the last one went out over 24h ago.
//
// NOTE: `(prisma as any).coachBetaSignup` until the Prisma client is
// regenerated on deploy (the model is new on this branch).
import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import twilio from 'twilio';
import { outboundNotifyLimiter } from '../middleware/rateLimiter.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireAdmin } from '../middleware/requireAdmin.js';
import { sendEmail } from '../services/mailService.js';
import { escapeHtml, coachBetaConfirmationEmail, SUPPORT_EMAIL } from '../services/emailTemplates.js';
import { coachBetaUnsubscribeUrl, verifyCoachBetaUnsubscribeToken, FRONTEND_URL } from '../services/emailUnsubscribe.js';

const router = Router();

// Hidden until launch: every coach-beta endpoint 404s unless COACH_BETA_ENABLED=1.
router.use('/coach-beta', (_req, res, next) => {
  if (process.env.COACH_BETA_ENABLED === '1') return next();
  res.status(404).json({ error: 'Not found' });
});
const prisma = new PrismaClient();
const db = () => (prisma as any).coachBetaSignup;

const FOUNDER_EMAIL = process.env.WAITLIST_NOTIFY_EMAIL || 'anuptaislam33@gmail.com';
export const RESEND_WINDOW_MS = 24 * 60 * 60 * 1000;
export const SMS_MAX = 300;

export const SOCIAL_PLATFORMS = ['instagram', 'tiktok', 'youtube', 'x', 'other'] as const;
export const COACHING_TYPES = ['online', 'in_person', 'hybrid'] as const;
export const CLIENT_COUNTS = ['0', '1-10', '11-30', '31-100', '100+'] as const;

const PLATFORM_LABEL: Record<string, string> = { instagram: 'Instagram', tiktok: 'TikTok', youtube: 'YouTube', x: 'X', other: 'Other' };
const COACHING_LABEL: Record<string, string> = { online: 'online', in_person: 'in person', hybrid: 'hybrid' };

/** Strip control characters (incl. CR/LF) and collapse whitespace. */
function clean(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Optional free-text field: cleaned, capped, empty → undefined. */
const text = (max: number, inputMax = max * 4) =>
  z.string().max(inputMax).optional().nullable()
    .transform((v) => (v ? clean(v).slice(0, max) || undefined : undefined));

/**
 * Descriptive selects never gate a signup (a stale client or a new option
 * must not 400 the form): an unknown value becomes `fallback`.
 */
const choice = <T extends readonly string[]>(values: T, fallback?: T[number]) =>
  z.unknown().optional().transform((v): T[number] | undefined => {
    if (typeof v !== 'string' || !v.trim()) return undefined;
    const k = v.trim().toLowerCase();
    return (values as readonly string[]).includes(k) ? (k as T[number]) : fallback;
  });

export const coachBetaSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  name: text(80),
  socialPlatform: choice(SOCIAL_PLATFORMS, 'other'),
  socialHandle: z.string().max(400).optional().nullable()
    .transform((v) => (v ? clean(v).replace(/^@+/, '').slice(0, 100) || undefined : undefined)),
  coachingType: choice(COACHING_TYPES),
  clientCount: choice(CLIENT_COUNTS),
  website: text(200),
  platformToday: text(200),
  message: z.string().max(4000).optional().nullable()
    // Keep line breaks in the message; strip other control characters.
    // eslint-disable-next-line no-control-regex
    .transform((v) => (v ? v.replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, ' ').trim().slice(0, 1000) || undefined : undefined)),
  source: text(120),
  /** Required opt-in. Anything but `true` is a 400. */
  marketingConsent: z.literal(true),
});

export type CoachBetaInput = z.infer<typeof coachBetaSchema>;

let twilioClient: ReturnType<typeof twilio> | null | undefined;
function getTwilio(): ReturnType<typeof twilio> | null {
  if (twilioClient !== undefined) return twilioClient;
  twilioClient = null;
  const sid = process.env.TWILIO_ACCOUNT_SID;
  if (sid && process.env.TWILIO_AUTH_TOKEN && sid.startsWith('AC')) {
    try { twilioClient = twilio(sid, process.env.TWILIO_AUTH_TOKEN); } catch { console.warn('[coach-beta] Twilio init failed; SMS disabled'); }
  }
  return twilioClient;
}

function handleLine(d: Pick<CoachBetaInput, 'socialPlatform' | 'socialHandle'>): string {
  if (!d.socialHandle) return d.socialPlatform ? `${PLATFORM_LABEL[d.socialPlatform]} (no handle)` : 'no handle';
  return `${d.socialPlatform ? PLATFORM_LABEL[d.socialPlatform] : 'social'}@${d.socialHandle}`;
}

/** SMS body for the founder. Exported for tests. */
export function smsBody(d: CoachBetaInput): string {
  const who = d.name || d.email;
  const body = `🧑‍🏫 Coach beta: ${who} — ${handleLine(d)} — ${d.clientCount ?? '?'} clients — ${d.coachingType ? COACHING_LABEL[d.coachingType] : '?'}`;
  return Array.from(body).slice(0, SMS_MAX).join('');
}

/** One plain-text line for the confirmation email. Exported for tests. */
export function signupSummary(d: CoachBetaInput): string {
  const parts = [d.name || d.email];
  if (d.coachingType) parts.push(`${COACHING_LABEL[d.coachingType]} coach`);
  if (d.clientCount) parts.push(`${d.clientCount} clients`);
  if (d.socialHandle) parts.push(handleLine(d));
  if (d.platformToday) parts.push(`using ${d.platformToday} today`);
  return parts.join(' · ');
}

/** Founder notification: every field in a table, all escaped. Exported for tests. */
export function founderNotificationHtml(row: Record<string, any>, isNew: boolean): string {
  const fields: [string, unknown][] = [
    ['Email', row.email], ['Name', row.name], ['Social platform', row.socialPlatform], ['Handle', row.socialHandle],
    ['Coaching type', row.coachingType], ['Client count', row.clientCount], ['Website', row.website],
    ['Uses today', row.platformToday], ['Message', row.message], ['Source', row.source],
    ['Marketing consent', row.marketingConsentAt instanceof Date ? row.marketingConsentAt.toISOString() : row.marketingConsentAt],
    ['IP', row.ip], ['User agent', row.userAgent], ['Signup id', row.id],
    ['Created', row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt],
  ];
  const rows = fields.map(([k, v]) => `<tr><td style="padding:6px 10px;border-bottom:1px solid #e4e4e7;font-weight:600;vertical-align:top;white-space:nowrap;">${escapeHtml(k)}</td><td style="padding:6px 10px;border-bottom:1px solid #e4e4e7;white-space:pre-wrap;">${v == null || v === '' ? '<span style="color:#a1a1aa;">—</span>' : escapeHtml(String(v))}</td></tr>`).join('');
  return `<div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;">
  <h2 style="color:#09090b;">${isNew ? 'New coach beta signup' : 'Coach beta signup updated'}</h2>
  <p style="color:#52525b;">Reply to this email to answer the coach directly.</p>
  <table style="border-collapse:collapse;width:100%;font-size:14px;">${rows}</table>
</div>`;
}

// ─── CSV ─────────────────────────────────────────────────────────────────────

export const CSV_COLUMNS = ['createdAt', 'email', 'name', 'socialPlatform', 'socialHandle', 'coachingType', 'clientCount',
  'website', 'platformToday', 'message', 'source', 'marketingConsentAt', 'notifiedAt', 'invitedAt', 'unsubscribedAt', 'id'] as const;

/**
 * One CSV cell: always quoted, quotes doubled, and any value a spreadsheet
 * would evaluate (leading = + - @, or tab/CR) prefixed with ' so it stays text.
 */
export function csvCell(v: unknown): string {
  if (v == null) return '""';
  let s = v instanceof Date ? v.toISOString() : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

export function toCsv(rows: Record<string, unknown>[]): string {
  const lines = [CSV_COLUMNS.map(csvCell).join(',')];
  for (const r of rows) lines.push(CSV_COLUMNS.map((c) => csvCell(r[c])).join(','));
  return `${lines.join('\r\n')}\r\n`;
}

// ─── Routes ──────────────────────────────────────────────────────────────────

router.post('/coach-beta/signup', outboundNotifyLimiter, async (req, res) => {
  const body = req.body ?? {};
  // Honeypot: hidden from people, filled by bots. Look like success, do nothing.
  if (typeof body.company === 'string' ? body.company.trim() !== '' : body.company != null && body.company !== '') {
    console.warn('[coach-beta] honeypot tripped; ignored');
    return res.json({ ok: true, alreadyOnList: false });
  }
  const parsed = coachBetaSchema.safeParse(body);
  if (!parsed.success) {
    const consent = parsed.error.issues.some((i) => i.path[0] === 'marketingConsent');
    return res.status(400).json({ error: consent ? 'Please tick the box so we can email you about the beta.' : 'Please check the form and try again.' });
  }
  const d = parsed.data;
  const now = new Date();
  const fields = {
    name: d.name ?? null,
    socialPlatform: d.socialPlatform ?? null,
    socialHandle: d.socialHandle ?? null,
    coachingType: d.coachingType ?? null,
    clientCount: d.clientCount ?? null,
    website: d.website ?? null,
    platformToday: d.platformToday ?? null,
    message: d.message ?? null,
    marketingConsentAt: now,
    ip: req.ip ? String(req.ip).slice(0, 300) : null,
    userAgent: req.get('user-agent') ? String(req.get('user-agent')).slice(0, 300) : null,
  };

  let row: any;
  let existing: any;
  try {
    existing = await db().findUnique({ where: { email: d.email } });
    row = await db().upsert({
      where: { email: d.email },
      // A fresh tick of the consent box is a fresh opt-in, so it clears an
      // earlier unsubscribe. Source keeps the first attribution.
      update: { ...fields, unsubscribedAt: null, ...(existing?.source ? {} : { source: d.source ?? null }) },
      create: { email: d.email, ...fields, source: d.source ?? null },
    });
  } catch (err: any) {
    console.error('[coach-beta] store failed:', err?.message || err);
    return res.status(500).json({ error: 'Something went wrong. Please try again in a minute.' });
  }

  const alreadyOnList = !!existing;
  const last = existing?.notifiedAt ? new Date(existing.notifiedAt).getTime() : 0;
  const sendConfirmation = !alreadyOnList || now.getTime() - last >= RESEND_WINDOW_MS;
  console.log('[coach-beta] signup', { domain: d.email.split('@')[1], alreadyOnList, sendConfirmation });

  const tasks: Promise<unknown>[] = [];

  if (sendConfirmation) {
    tasks.push((async () => {
      const unsub = coachBetaUnsubscribeUrl(row.id);
      const msg = coachBetaConfirmationEmail({ name: d.name, summary: signupSummary(d), unsubscribeUrl: unsub });
      try {
        await sendEmail({
          to: d.email, subject: msg.subject, html: msg.html, text: msg.text, replyTo: SUPPORT_EMAIL,
          headers: { 'List-Unsubscribe': `<${unsub}>, <mailto:${SUPPORT_EMAIL}?subject=unsubscribe>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
        });
        await db().update({ where: { id: row.id }, data: { notifiedAt: new Date() } });
      } catch (err: any) {
        console.error('[coach-beta] confirmation email failed:', err?.message || err);
      }
    })());
  }

  if (!alreadyOnList) {
    tasks.push((async () => {
      try {
        await sendEmail({
          to: FOUNDER_EMAIL,
          subject: `Coach beta: ${d.name || d.email}`,
          html: founderNotificationHtml(row, true),
          replyTo: d.email,
        });
      } catch (err: any) {
        console.error('[coach-beta] founder email failed:', err?.message || err);
      }
    })());

    const sms = getTwilio();
    if (sms && process.env.TWILIO_PHONE_NUMBER && process.env.NOTIFICATION_PHONE) {
      tasks.push((async () => {
        try {
          await sms.messages.create({ body: smsBody(d), from: process.env.TWILIO_PHONE_NUMBER!, to: process.env.NOTIFICATION_PHONE! });
        } catch (err: any) {
          console.error('[coach-beta] SMS failed:', err?.message || err);
        }
      })());
    } else {
      console.warn('[coach-beta] SMS not configured; skipped');
    }
  }

  await Promise.allSettled(tasks);
  res.json({ ok: true, alreadyOnList });
});

async function listSignups() {
  return db().findMany({ orderBy: { createdAt: 'desc' }, take: 10_000 });
}

router.get('/coach-beta/signups', requireAuth, requireAdmin, async (_req, res) => {
  try {
    const signups = await listSignups();
    res.json({ signups, count: signups.length });
  } catch (err: any) {
    console.error('[coach-beta] list failed:', err?.message || err);
    res.status(500).json({ error: 'Failed to load signups' });
  }
});

router.get('/coach-beta/signups.csv', requireAuth, requireAdmin, async (_req, res) => {
  try {
    const signups = await listSignups();
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="coach-beta-signups-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(toCsv(signups));
  } catch (err: any) {
    console.error('[coach-beta] csv failed:', err?.message || err);
    res.status(500).json({ error: 'Failed to export signups' });
  }
});

// ─── Unsubscribe ─────────────────────────────────────────────────────────────

function page(title: string, body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title></head>
<body style="margin:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0f0f0f;">
<div style="max-width:440px;margin:60px auto;background:#fff;border-radius:16px;padding:32px;text-align:center;">
<h1 style="font-size:20px;margin:0 0 10px;">${escapeHtml(title)}</h1><p style="margin:0 0 20px;color:#52525b;">${escapeHtml(body)}</p>
<a href="${escapeHtml(FRONTEND_URL)}" style="color:#09090b;font-weight:600;">Back to axiomtraining.io</a></div></body></html>`;
}

/** Returns 'done' | 'missing'. Idempotent: an already-unsubscribed row is 'done'. */
async function optOut(id: string): Promise<'done' | 'missing'> {
  const r = await db().updateMany({ where: { id, unsubscribedAt: null }, data: { unsubscribedAt: new Date() } });
  if (r.count > 0) return 'done';
  return (await db().findUnique({ where: { id } })) ? 'done' : 'missing';
}

router.get('/coach-beta/unsubscribe', async (req, res) => {
  const id = verifyCoachBetaUnsubscribeToken(String(req.query.token ?? ''));
  if (!id) return res.status(400).type('html').send(page('This link isn’t valid', 'The unsubscribe link looks incomplete. Reply to the email instead and we’ll take care of it.'));
  try {
    if ((await optOut(id)) === 'missing') return res.status(404).type('html').send(page('Not found', 'We couldn’t find that signup, so there’s nothing to unsubscribe.'));
    res.type('html').send(page('You’re unsubscribed', 'You won’t get Axiom coaching beta or launch emails anymore. Changed your mind? Sign up again on the For coaches page.'));
  } catch (err) {
    console.error('[coach-beta] unsubscribe error:', err);
    res.status(500).type('html').send(page('Something went wrong', 'Please try the link again in a minute, or reply to the email.'));
  }
});

// RFC 8058 one-click: 200 for any valid token so the mail client doesn't retry.
router.post('/coach-beta/unsubscribe', async (req, res) => {
  const id = verifyCoachBetaUnsubscribeToken(String(req.query.token ?? ''));
  if (!id) return res.status(400).json({ error: 'Invalid link' });
  try {
    await optOut(id);
  } catch (err) {
    console.error('[coach-beta] one-click unsubscribe error:', err);
    return res.status(500).json({ error: 'Try again' });
  }
  res.json({ ok: true });
});

export default router;
