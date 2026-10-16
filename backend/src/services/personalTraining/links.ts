// No-install clients and the secret links that open their portal
// (coach-platform handoff §2.6, §4 phase 0).
//
// A client who will not install the app is still a User — one with no way to
// sign in — and an athlete member of the practice. So every check-in,
// weigh-in, photo and message they submit lands in the same tables an app
// client's does, and the trainer's briefing, timeline and reports read them
// with no fork (§2.4). Their only key is a link the trainer sends them:
//
//  - 32 random bytes, base64url. Only a SHA-256 of it is looked up.
//  - Also kept AES-256-GCM encrypted, so the trainer can copy the same link
//    again instead of minting a new one each time.
//  - One live link per client. Issuing a new one revokes the old; revoking
//    ends portal access at once.
//  - A link opens only that client's portal routes. It is never a session
//    for anything else in the API.
//
// Any client can have a link — app clients use it for booking and payments
// later — but for a link client it is the only door.

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import { audit } from './drafts.js';
import { prisma } from './db.js';
import { isMailConfigured, sendEmail } from '../mailService.js';

const FRONTEND_URL = process.env.FRONTEND_URL || 'https://axiomtraining.io';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^\+?[0-9 ()-]{7,20}$/;

export class LinkError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'LinkError';
    this.status = status;
    this.code = code;
  }
}

function key(): Buffer {
  const secret = process.env.PT_LINK_SECRET || process.env.JWT_SECRET;
  if (!secret) throw new Error('PT_LINK_SECRET or JWT_SECRET must be set to issue client links');
  return createHash('sha256').update(`pt-link:${secret}`).digest();
}

export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

export function encryptToken(token: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const body = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), body].map((b) => b.toString('base64url')).join('.');
}

export function decryptToken(cipherText: string): string | null {
  try {
    const [iv, tag, body] = cipherText.split('.').map((p) => Buffer.from(p, 'base64url'));
    const decipher = createDecipheriv('aes-256-gcm', key(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

export const portalUrl = (token: string, path = '') => `${FRONTEND_URL}/c/${token}${path}`;

const TOKEN_RE = /^[A-Za-z0-9_-]{40,60}$/;

export interface LinkInfo {
  url: string;
  createdAt: string;
  lastUsedAt?: string;
}

/** Issue a fresh link for a client, revoking any earlier one. */
export async function issueLink(practiceId: string, clientId: string, trainerId: string): Promise<LinkInfo> {
  const now = new Date();
  const token = randomBytes(32).toString('base64url');
  await prisma.ptClientLink.updateMany({ where: { practiceId, clientId, revokedAt: null }, data: { revokedAt: now } });
  const row = await prisma.ptClientLink.create({
    data: { practiceId, clientId, tokenHash: hashToken(token), tokenCipher: encryptToken(token), createdById: trainerId },
  });
  await audit({ practiceId, trainerId, clientId, action: 'link_issued', itemType: 'client_link', itemId: row.id });
  return { url: portalUrl(token), createdAt: row.createdAt.toISOString() };
}

export async function currentLink(practiceId: string, clientId: string): Promise<LinkInfo | null> {
  const row = await prisma.ptClientLink.findFirst({ where: { practiceId, clientId, revokedAt: null }, orderBy: { createdAt: 'desc' } });
  if (!row) return null;
  const token = decryptToken(row.tokenCipher);
  if (!token) return null;
  return { url: portalUrl(token), createdAt: row.createdAt.toISOString(), ...(row.lastUsedAt ? { lastUsedAt: row.lastUsedAt.toISOString() } : {}) };
}

/** The portal URL for a client (with an optional deep path), or null when they have no live link. */
export async function portalUrlFor(practiceId: string, clientId: string, path = ''): Promise<string | null> {
  const link = await currentLink(practiceId, clientId);
  return link ? `${link.url}${path}` : null;
}

export async function revokeLinks(practiceId: string, clientId: string, trainerId: string): Promise<number> {
  const done = await prisma.ptClientLink.updateMany({ where: { practiceId, clientId, revokedAt: null }, data: { revokedAt: new Date() } });
  if (done.count) await audit({ practiceId, trainerId, clientId, action: 'link_revoked', itemType: 'client_link', itemId: clientId });
  return done.count;
}

export interface LinkSession {
  linkId: string;
  practiceId: string;
  clientId: string;
}

/**
 * Who a token belongs to, or null. A link stops working when it is revoked,
 * when the client leaves or is archived, or when the practice is closed.
 */
export async function resolveToken(token: string, now: Date = new Date()): Promise<LinkSession | null> {
  if (!TOKEN_RE.test(token)) return null;
  const row = await prisma.ptClientLink.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!row || row.revokedAt) return null;
  const [member, profile] = await Promise.all([
    prisma.institutionMember.findUnique({
      where: { institutionId_userId: { institutionId: row.practiceId, userId: row.clientId } },
      select: { active: true, role: true, institution: { select: { active: true } } },
    }),
    prisma.ptClientProfile.findUnique({ where: { practiceId_clientId: { practiceId: row.practiceId, clientId: row.clientId } }, select: { state: true } }),
  ]);
  if (!member?.active || member.role !== 'athlete' || !member.institution.active) return null;
  if (profile?.state === 'archived') return null;
  // Recording every request would be a write per page view; once a minute is enough to show "last opened".
  if (!row.lastUsedAt || now.getTime() - row.lastUsedAt.getTime() > 60_000) {
    await prisma.ptClientLink.update({ where: { id: row.id }, data: { lastUsedAt: now } }).catch(() => {});
  }
  return { linkId: row.id, practiceId: row.practiceId, clientId: row.clientId };
}

// ── Link clients ─────────────────────────────────────────────────────────────

export interface NewLinkClient {
  name?: unknown;
  email?: unknown;
  phone?: unknown;
  tags?: unknown;
}

export function cleanContact(input: { email?: unknown; phone?: unknown }) {
  const email = input.email === undefined || input.email === null || input.email === '' ? null
    : typeof input.email === 'string' && EMAIL_RE.test(input.email.trim()) && input.email.length <= 255 ? input.email.trim().toLowerCase()
    : (() => { throw new LinkError('Email must be a valid address', 400); })();
  const phone = input.phone === undefined || input.phone === null || input.phone === '' ? null
    : typeof input.phone === 'string' && PHONE_RE.test(input.phone.trim()) ? input.phone.trim()
    : (() => { throw new LinkError('Phone must be a phone number', 400); })();
  return { email, phone };
}

export function cleanTags(v: unknown): string[] | undefined {
  if (v === undefined) return undefined;
  if (!Array.isArray(v)) throw new LinkError('tags must be a list', 400);
  const tags = [...new Set(v.filter((t): t is string => typeof t === 'string').map((t) => t.trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 30)).filter(Boolean))];
  if (tags.length > 12) throw new LinkError('At most 12 tags per client', 400);
  return tags;
}

/**
 * Add a client who will use the web link instead of the app. Their account
 * has no email, password or social login, so it cannot be signed in to; the
 * contact details the trainer typed live on the practice's profile row, never
 * on the User (an email there could collide with, or claim, someone's real
 * account).
 */
export async function createLinkClient(practiceId: string, trainerId: string, input: NewLinkClient) {
  const name = typeof input.name === 'string' ? input.name.trim().replace(/\s+/g, ' ') : '';
  if (name.length < 1 || name.length > 80) throw new LinkError('Name must be between 1 and 80 characters', 400);
  const { email, phone } = cleanContact(input);
  const tags = cleanTags(input.tags) ?? [];
  const trainer = await prisma.user.findUnique({ where: { id: trainerId }, select: { unitPreference: true } });

  const user = await prisma.user.create({
    data: {
      name,
      unitPreference: trainer?.unitPreference ?? 'imperial',
      // A link client is reached by their trainer only, never by Axiom's own lifecycle mail.
      reengagementOptOut: true,
      marketingEmailsOptOut: true,
      welcomeEmailSentAt: new Date(),
    },
    select: { id: true },
  });
  await prisma.institutionMember.create({ data: { institutionId: practiceId, userId: user.id, role: 'athlete', active: true } });
  await prisma.ptClientProfile.create({
    data: { practiceId, clientId: user.id, channel: 'webLink', contactEmail: email, contactPhone: phone, tagsJson: JSON.stringify(tags) },
  });
  await audit({ practiceId, trainerId, clientId: user.id, action: 'client_created', itemType: 'client', itemId: user.id, meta: { channel: 'webLink' } });
  const link = await issueLink(practiceId, user.id, trainerId);
  return { clientId: user.id, link };
}

/** True for an account that exists only to hold a link client's data. */
export async function isLinkClient(practiceId: string, clientId: string): Promise<boolean> {
  const p = await prisma.ptClientProfile.findUnique({ where: { practiceId_clientId: { practiceId, clientId } }, select: { channel: true } });
  return p?.channel === 'webLink';
}

/**
 * Tell a link client something arrived, by email, when the trainer gave one.
 * Best-effort: the message is already in their portal either way.
 */
export async function notifyLinkClient(practiceId: string, clientId: string, input: { subject: string; preview: string; path?: string }) {
  try {
    const profile = await prisma.ptClientProfile.findUnique({ where: { practiceId_clientId: { practiceId, clientId } } });
    if (profile?.channel !== 'webLink' || !profile.contactEmail || profile.state !== 'active' || !isMailConfigured()) return false;
    const url = await portalUrlFor(practiceId, clientId, input.path ?? '');
    if (!url) return false;
    const practice = await prisma.institution.findUnique({ where: { id: practiceId }, select: { name: true } });
    const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]!));
    const result = await sendEmail({
      to: profile.contactEmail,
      subject: input.subject,
      text: `${input.preview}\n\nOpen: ${url}\n\nThis link is personal to you. Do not forward it.\n— ${practice?.name ?? 'Your trainer'}`,
      html: `<p>${esc(input.preview)}</p><p><a href="${esc(url)}">Open your page</a></p><p style="color:#71717a;font-size:12px">This link is personal to you. Do not forward it. — ${esc(practice?.name ?? 'Your trainer')}</p>`,
    });
    return result.sent;
  } catch (err) {
    console.warn('[personal-training] link client email failed', (err as Error)?.message);
    return false;
  }
}

/**
 * Give a "Not joined" client from a spreadsheet a portal instead of waiting
 * for them to install the app. They become a link client; their imported
 * history and everything the trainer recorded follows them, exactly as it
 * would if they had joined through an invite.
 */
export async function convertProspectToLinkClient(practiceId: string, trainerId: string, prospectId: string) {
  const p = await prisma.ptProspect.findUnique({ where: { id: prospectId } });
  if (!p || p.practiceId !== practiceId || p.userId) throw new LinkError('Client not found', 404);
  const { clientId, link } = await createLinkClient(practiceId, trainerId, { name: p.name, email: p.email ?? undefined, phone: p.phone ?? undefined });
  await prisma.ptProspect.update({ where: { id: p.id }, data: { userId: clientId, joinedAt: new Date() } });
  await moveClientRecords(practiceId, `prospect:${p.id}`, clientId);
  return { clientId, link };
}

/** Re-key the practice's records about one client from an old id to a new one. */
export async function moveClientRecords(practiceId: string, fromId: string, toId: string) {
  const where = { practiceId, clientId: fromId };
  const data = { clientId: toId };
  await Promise.all([
    prisma.ptNote.updateMany({ where, data }),
    prisma.ptContraindication.updateMany({ where, data }),
    prisma.ptGoal.updateMany({ where, data }),
    prisma.ptMeasurement.updateMany({ where, data }),
    prisma.ptProgressPhoto.updateMany({ where, data }),
    prisma.ptNutritionTarget.updateMany({ where, data }),
    prisma.ptIntake.updateMany({ where, data }),
  ]);
  // The profile row is unique per client; merge rather than collide.
  const old = await prisma.ptClientProfile.findUnique({ where: { practiceId_clientId: { practiceId, clientId: fromId } } });
  if (old) {
    const exists = await prisma.ptClientProfile.findUnique({ where: { practiceId_clientId: { practiceId, clientId: toId } } });
    if (exists) {
      const tags = [...new Set([...JSON.parse(exists.tagsJson || '[]'), ...JSON.parse(old.tagsJson || '[]')])];
      await prisma.ptClientProfile.update({ where: { id: exists.id }, data: { tagsJson: JSON.stringify(tags), contactEmail: exists.contactEmail ?? old.contactEmail, contactPhone: exists.contactPhone ?? old.contactPhone } });
      await prisma.ptClientProfile.delete({ where: { id: old.id } });
    } else {
      await prisma.ptClientProfile.update({ where: { id: old.id }, data: { clientId: toId } });
    }
  }
}

/** Where a check-in is answered: the portal for a link client, the app's page for everyone else. */
export async function checkInUrlFor(practiceId: string, clientId: string, checkInId: string, appUrl: string): Promise<string> {
  if (!(await isLinkClient(practiceId, clientId))) return appUrl;
  return (await portalUrlFor(practiceId, clientId, `?checkin=${encodeURIComponent(checkInId)}`)) ?? appUrl;
}
