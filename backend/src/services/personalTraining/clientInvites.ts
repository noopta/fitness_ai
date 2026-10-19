// A client joining a trainer's practice: one implementation for every door.
//
// The web join page (POST /invites/:token/accept), the Coach page under You,
// the chat's coach_invite card and a code redeemed in chat all accept through
// acceptClientInvite, so membership creation and the email lock live in one
// place (claimInvite underneath). Also here: the short codes a trainer can
// read out ("K7QM-3XPA"), resolving a pasted link or code, the client's own
// view of who coaches them, and leaving a practice.
//
// shortCode is newer than the generated Prisma client in some environments
// (worktrees share prod's node_modules/.prisma), so it is read and written
// with parameterised raw SQL against fixed column names — never from input.

import { randomBytes } from 'crypto';
import { prisma } from './db.js';
import { claimInvite, InviteError } from '../institutionInvites.js';
import { linkProspectsOnJoin } from './imports.js';

export { InviteError };

const FRONTEND_URL = process.env.FRONTEND_URL || 'https://axiomtraining.io';

// ── Short codes ──────────────────────────────────────────────────────────────

/** 32 symbols with nothing that reads as another: no 0/O, no 1/I. */
export const SHORT_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_SET = new Set(SHORT_CODE_ALPHABET);

/** "K7QM-3XPA": eight symbols, 40 bits. 256 is a multiple of 32, so the mask is unbiased. */
export function generateShortCode(): string {
  const bytes = randomBytes(8);
  let s = '';
  for (let i = 0; i < 8; i++) s += SHORT_CODE_ALPHABET[bytes[i] & 31];
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}

/** A typed code in canonical form, or null. Case-insensitive; the dash and spaces are optional. */
export function normalizeShortCode(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const s = input.toUpperCase().replace(/[\s-]/g, '');
  if (s.length !== 8 || ![...s].every((c) => CODE_SET.has(c))) return null;
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const JOIN_LINK = new RegExp(`personal-training/join/(${UUID})`, 'i');
const CODE_LINK = /coach\/join\/([A-Za-z0-9-]{8,9})(?![A-Za-z0-9])/;
const BARE_UUID = new RegExp(`^\\s*(${UUID})\\s*$`, 'i');

export type InviteRef = { token: string } | { code: string };

/**
 * What a pasted string points at: a join link (web or axiom://), an
 * axiom://coach/join/<code> link, a bare token, or a bare code. Null when it
 * is none of those — a sentence is not searched for something code-shaped.
 */
export function parseInviteRef(input: unknown): InviteRef | null {
  if (typeof input !== 'string' || !input.trim() || input.length > 500) return null;
  const link = JOIN_LINK.exec(input);
  if (link) return { token: link[1].toLowerCase() };
  const codeLink = CODE_LINK.exec(input);
  if (codeLink) { const code = normalizeShortCode(codeLink[1]); if (code) return { code }; }
  const bare = BARE_UUID.exec(input);
  if (bare) return { token: bare[1].toLowerCase() };
  const code = normalizeShortCode(input.trim());
  return code ? { code } : null;
}

/** The link a trainer hands out, for a token. */
export const joinLink = (token: string) => `${FRONTEND_URL}/personal-training/join/${token}`;

const isUnique = (err: any) => /UNIQUE constraint failed|Unique constraint/i.test(String(err?.message ?? err)) || err?.code === 'P2002';

/** Give an invite a short code (no-op when it has one). Returns its code, or null if storage refused. */
export async function assignShortCode(inviteId: string): Promise<string | null> {
  for (let attempt = 0; attempt < 6; attempt++) {
    const code = generateShortCode();
    try {
      const n = Number(await prisma.$executeRawUnsafe('UPDATE "InstitutionInvite" SET "shortCode" = ? WHERE "id" = ? AND "shortCode" IS NULL', code, inviteId));
      if (n > 0) return code;
      const rows = (await prisma.$queryRawUnsafe('SELECT "shortCode" FROM "InstitutionInvite" WHERE "id" = ?', inviteId)) as { shortCode: string | null }[];
      return rows[0]?.shortCode ?? null;
    } catch (err) {
      if (isUnique(err)) continue; // collided with another invite's code: draw again
      throw err;
    }
  }
  return null;
}

/** Codes for these invites, giving one to any that has none yet (invites older than codes). */
export async function shortCodesFor(inviteIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!inviteIds.length) return out;
  const rows = (await prisma.$queryRawUnsafe(
    `SELECT "id", "shortCode" FROM "InstitutionInvite" WHERE "id" IN (${inviteIds.map(() => '?').join(', ')})`,
    ...inviteIds,
  )) as { id: string; shortCode: string | null }[];
  for (const r of rows) {
    const code = r.shortCode ?? (await assignShortCode(r.id));
    if (code) out.set(r.id, code);
  }
  return out;
}

/** The token behind a code, or null. */
export async function tokenForCode(code: string): Promise<string | null> {
  const norm = normalizeShortCode(code);
  if (!norm) return null;
  const rows = (await prisma.$queryRawUnsafe('SELECT "token" FROM "InstitutionInvite" WHERE "shortCode" = ?', norm)) as { token: string }[];
  return rows[0]?.token ?? null;
}

export async function tokenForRef(ref: InviteRef): Promise<string | null> {
  return 'token' in ref ? ref.token : tokenForCode(ref.code);
}

/**
 * Every new client invite goes through here after it is created: it gets its
 * code, and if its email belongs to someone already on Axiom they get a push
 * that opens chat (where the invite card is waiting). Never throws — the
 * trainer still gets their link if either step fails.
 */
export async function finishClientInvite(invite: { id: string; email: string | null; invitedByUserId: string }): Promise<string | null> {
  const code = await assignShortCode(invite.id).catch((err) => { console.error('[personal-training] short code', err?.message ?? err); return null; });
  void notifyInvitee(invite).catch(() => {});
  return code;
}

async function notifyInvitee(invite: { email: string | null; invitedByUserId: string }) {
  if (!invite.email) return;
  const email = invite.email.trim().toLowerCase();
  const user = await prisma.user.findFirst({ where: { email: { in: [...new Set([email, invite.email.trim()])] } }, select: { id: true } });
  if (!user || user.id === invite.invitedByUserId) return;
  const trainer = await prisma.user.findUnique({ where: { id: invite.invitedByUserId }, select: { name: true } });
  const { sendPushToUser } = await import('../notificationService.js');
  // 'coach_invite' falls under the Social switch; `screen: 'coach'` opens chat.
  await sendPushToUser(user.id, `${cleanName(trainer?.name, 'Your trainer')} invited you to train with them`, 'Open Axiom to see what they’d see and say yes.', { type: 'coach_invite', screen: 'coach' }, 'social');
}

// ── What the invitee sees ────────────────────────────────────────────────────

/**
 * A name another person wrote (trainer, practice), safe to put in Anakin's
 * words and on a card: one line, no markup, bounded.
 */
export function cleanName(v: unknown, fallback: string): string {
  const s = String(v ?? '').replace(/[\u0000-\u001f\u007f<>`]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
  return s || fallback;
}

export type InviteState = 'open' | 'expired' | 'used' | 'joined' | 'revoked';

export interface InviteView {
  inviteId: string;
  token: string;
  practice: { id: string; name: string; slug: string; logoUrl: string | null };
  trainerName: string;
  expiresAt: string;
  state: InviteState;
  /** Only one account can use it. */
  emailLocked: boolean;
  /** For the viewer: false when it is locked to another address. Null with no viewer. */
  forViewer: boolean | null;
}

/** The invite behind a token, from the invitee's side. Null when it does not exist or is not a client invite. */
export async function describeInvite(token: string, viewer?: { id: string; email?: string | null }): Promise<InviteView | null> {
  const invite = await prisma.institutionInvite.findUnique({
    where: { token },
    include: { institution: { select: { id: true, name: true, slug: true, logoUrl: true, active: true } } },
  });
  if (!invite || invite.role !== 'athlete') return null;
  const inviter = await prisma.user.findUnique({ where: { id: invite.invitedByUserId }, select: { name: true } });
  const { active, ...practice } = invite.institution as typeof invite.institution & { active?: boolean };
  let state: InviteState = 'open';
  if (active === false) state = 'revoked';
  else if (invite.usedAt) state = viewer && invite.usedByUserId === viewer.id ? 'joined' : 'used';
  else if (invite.expiresAt.getTime() < Date.now()) state = 'expired';
  const viewerEmail = viewer?.email?.trim().toLowerCase();
  return {
    inviteId: invite.id,
    token: invite.token,
    practice: { ...practice, name: cleanName(practice.name, 'their practice') },
    trainerName: cleanName(inviter?.name, 'Your trainer'),
    expiresAt: invite.expiresAt.toISOString(),
    state,
    emailLocked: !!invite.email,
    forViewer: viewer ? (!invite.email || (!!viewerEmail && viewerEmail === invite.email.trim().toLowerCase())) : null,
  };
}

/** Open client invites addressed to this email, newest first. */
export async function openInvitesForEmail(email: string | null | undefined): Promise<{ id: string; token: string }[]> {
  const e = email?.trim();
  if (!e) return [];
  return prisma.institutionInvite.findMany({
    where: { email: { in: [...new Set([e.toLowerCase(), e])] }, role: 'athlete', usedAt: null, expiresAt: { gt: new Date() }, institution: { active: true } },
    orderBy: { createdAt: 'desc' },
    take: 10,
    select: { id: true, token: true },
  });
}

// ── Accepting ────────────────────────────────────────────────────────────────

export interface AcceptResult {
  practice: { id: string; name: string; slug: string; logoUrl: string | null };
  inviteId: string;
  trainerId: string;
  /** This account had already accepted this invite: nothing changed. */
  alreadyMember: boolean;
}

/**
 * Accept a client invite for this user. The single way a client joins a
 * practice: the email lock, expiry and "a trainer can't demote themselves"
 * are claimInvite's; this adds the client-invite rule (role athlete), makes a
 * repeat by the same person a no-op, links an imported record, and closes any
 * chat card still offering this invite. Throws InviteError.
 */
export async function acceptClientInvite(token: string, userId: string): Promise<AcceptResult> {
  const invite = await prisma.institutionInvite.findUnique({
    where: { token },
    include: { institution: { select: { id: true, name: true, slug: true, logoUrl: true } } },
  });
  if (!invite || invite.role !== 'athlete') throw new InviteError('Invite not found', 404);
  const practice = invite.institution;
  const base = { practice, inviteId: invite.id, trainerId: invite.invitedByUserId };

  const replay = async (): Promise<AcceptResult | null> => {
    const m = await prisma.institutionMember.findUnique({ where: { institutionId_userId: { institutionId: invite.institutionId, userId } } });
    return m?.active && m.role === 'athlete' ? { ...base, alreadyMember: true } : null;
  };
  if (invite.usedAt) {
    // A second tap (or the web page after the card) by the person who used it.
    if (invite.usedByUserId === userId) { const r = await replay(); if (r) return r; }
    throw new InviteError('Invite already used', 400);
  }
  if (invite.expiresAt < new Date()) throw new InviteError('Invite expired', 400);

  try {
    await claimInvite(token, userId);
  } catch (err) {
    // Two taps at once: the other one won. Same person → same outcome.
    if (err instanceof InviteError && err.message === 'Invite already used') {
      const again = await prisma.institutionInvite.findUnique({ where: { token }, select: { usedByUserId: true } });
      if (again?.usedByUserId === userId) { const r = await replay(); if (r) return r; }
    }
    throw err;
  }
  // If the trainer imported this person from a spreadsheet, their record now belongs to this account.
  await linkProspectsOnJoin(invite.institutionId, userId, token).catch((err) => console.error('[personal-training] link prospect', err));
  await settleInviteCards(userId, invite.id, async () => ({ status: 'applied', line: `You’re coached by ${await trainerNameFor(invite.invitedByUserId)} now.` }));
  return { ...base, alreadyMember: false };
}

async function trainerNameFor(userId: string): Promise<string> {
  try {
    const u = await prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
    return cleanName(u?.name, 'Your trainer');
  } catch { return 'Your trainer'; }
}

/** Close live chat cards that offer this invite (accepted on the web, say). Best effort. */
export async function settleInviteCards(userId: string, inviteId: string, state: () => Promise<{ status: 'applied' | 'expired'; line: string }>): Promise<void> {
  try {
    const { settleLiveCards } = await import('../../agent/cards/store.js');
    await settleLiveCards(userId, [COACH_INVITE_FN], (p: any) => p?.actions?.accept?.args?.inviteId === inviteId, await state());
  } catch { /* chat is optional here */ }
}

export const COACH_INVITE_FN = 'coach_invite';

// ── The client's side: who coaches me, and leaving ──────────────────────────

export interface Coaching {
  practice: { id: string; name: string; slug: string; logoUrl: string | null };
  trainerName: string;
  joinedAt: string;
}

/** Practices this user is an active client of, with the trainer they work with. */
export async function myCoaching(userId: string): Promise<Coaching[]> {
  const rows = await prisma.institutionMember.findMany({
    where: { userId, role: 'athlete', active: true, institution: { active: true } },
    orderBy: { joinedAt: 'asc' },
    select: { joinedAt: true, institution: { select: { id: true, name: true, slug: true, logoUrl: true } } },
  });
  const out: Coaching[] = [];
  for (const r of rows) {
    const practiceId = r.institution.id;
    // The trainer they were assigned, else whoever invited them, else the practice owner.
    const profile = await prisma.ptClientProfile.findUnique({ where: { practiceId_clientId: { practiceId, clientId: userId } }, select: { assignedTrainerId: true } }).catch(() => null);
    let trainerId = profile?.assignedTrainerId ?? null;
    if (!trainerId) {
      const used = await prisma.institutionInvite.findFirst({ where: { institutionId: practiceId, usedByUserId: userId }, orderBy: { usedAt: 'desc' }, select: { invitedByUserId: true } });
      trainerId = used?.invitedByUserId ?? null;
    }
    if (!trainerId) {
      const owner = await prisma.institutionMember.findFirst({ where: { institutionId: practiceId, role: 'coach', active: true }, orderBy: { joinedAt: 'asc' }, select: { userId: true } });
      trainerId = owner?.userId ?? null;
    }
    out.push({
      practice: { ...r.institution, name: cleanName(r.institution.name, 'Your practice') },
      trainerName: trainerId ? await trainerNameFor(trainerId) : 'Your trainer',
      joinedAt: r.joinedAt.toISOString(),
    });
  }
  return out;
}

/**
 * Stop sharing with a practice: the caller's own client membership goes
 * inactive (the trainer's roster and timeline check `active`). Nothing is
 * deleted — not their logs, not the trainer's notes — and a new invite
 * reactivates it. The practice's trainers get a note in their bell.
 */
export async function leavePractice(userId: string, practiceId: string): Promise<{ practiceId: string }> {
  const m = await prisma.institutionMember.findUnique({ where: { institutionId_userId: { institutionId: practiceId, userId } } });
  if (!m || !m.active || m.role !== 'athlete') throw new InviteError('You are not a client of this practice', 404);
  await prisma.institutionMember.updateMany({ where: { id: m.id, userId, role: 'athlete' }, data: { active: false } });
  void notifyTrainersOfLeave(userId, practiceId).catch((err) => console.error('[personal-training] leave notice', err?.message ?? err));
  return { practiceId };
}

async function notifyTrainersOfLeave(userId: string, practiceId: string) {
  const [client, coaches] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { name: true, email: true } }),
    prisma.institutionMember.findMany({ where: { institutionId: practiceId, role: 'coach', active: true }, select: { userId: true } }),
  ]);
  const name = cleanName(client?.name || client?.email?.split('@')[0], 'A client');
  const now = new Date();
  for (const c of coaches) {
    await prisma.ptNotification.create({
      data: {
        practiceId, trainerId: c.userId, clientId: userId, eventType: 'clientLeft', tier: 'briefing',
        title: `${name} stopped sharing with you`, body: 'You no longer see their training. Their history with you is kept; a new invite reconnects them.',
        sourceKey: `left:${userId}:${now.getTime()}`, at: now,
      },
    }).catch(() => {});
  }
}

// ── Chat: the coach_invite card and the follow-up ────────────────────────────

const fmtDay = (iso: string, tz: string) => {
  try { return new Date(iso).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: tz }).replace(',', ''); }
  catch { return new Date(iso).toDateString(); }
};

export const consentText = (trainer: string) =>
  `If you accept, ${trainer} will see your workouts, check-ins, body weight, program and the injuries you've listed, and can message you.`;

const DISABLED_LINE: Record<Exclude<InviteState, 'open'>, string> = {
  expired: 'This invite has expired — ask your trainer for a new one.',
  used: 'This invite has already been used.',
  joined: 'You’ve already joined this practice.',
  revoked: 'This invite is no longer active.',
};

/**
 * The coach_invite card. Accept runs coach.accept_invite with the token held
 * in the card's server-side pending ops (never sent to the phone); Not now
 * keeps it. An invite that can't be used renders already settled, no buttons.
 */
export function coachInviteCard(view: InviteView, tz: string): import('../../agent/cards/types.js').CardDraft {
  const trainer = view.trainerName;
  const practice = view.practice.name;
  const base = {
    fn: COACH_INVITE_FN, pattern: 'proposal' as const, rule: 'propose' as const,
    meta: { label: `Coach invite · ${practice}` },
    invite: { trainer, practice, logoUrl: view.practice.logoUrl, expiresAt: view.expiresAt },
    why: consentText(trainer),
    entity: `${COACH_INVITE_FN}:${view.inviteId}`,
  };
  const wrongAccount = view.forViewer === false;
  if (view.state !== 'open' || wrongAccount) {
    const status = view.state === 'joined' ? 'applied' as const : 'expired' as const;
    const line = view.state === 'joined' ? `You’re coached by ${trainer} now.` : view.state === 'open' ? 'This invite was sent to a different email address.' : DISABLED_LINE[view.state];
    return { ...base, state: { status, line } };
  }
  return {
    ...base,
    actions: [{ id: 'accept', label: 'Accept', kind: 'primary' }, { id: 'later', label: 'Not now', kind: 'secondary' }],
    pending: {
      idempotent: true,
      actions: {
        accept: { op: 'coach.accept_invite', args: { token: view.token, inviteId: view.inviteId }, status: 'applied', line: `You’re coached by ${trainer} now.` },
        later: { kind: 'keep', line: `Invite kept — it's open until ${fmtDay(view.expiresAt, tz)}. Find it under You → Coach.` },
      },
    },
  };
}

const WEEKDAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** What Anakin says after they join: their check-in day if the practice has a schedule. */
export async function joinedFollowUp(userId: string, practiceId: string, trainer: string): Promise<string> {
  const schedules = await prisma.ptCheckInSchedule.findMany({
    where: { practiceId, active: true, OR: [{ clientId: userId }, { clientId: null }] },
    select: { clientId: true, frequency: true, dayOfWeek: true },
  }).catch(() => [] as { clientId: string | null; frequency: string; dayOfWeek: number }[]);
  const s = schedules.find((x) => x.clientId === userId) ?? schedules.find((x) => x.clientId === null);
  if (s && WEEKDAY[s.dayOfWeek]) {
    return `You're in. Check-ins with ${trainer} come ${s.frequency === 'biweekly' ? 'every other' : 'every'} ${WEEKDAY[s.dayOfWeek]} — I'll put each one here when it's due.`;
  }
  return `You're in. ${trainer} will send your first check-in — I'll put it here when it arrives.`;
}
