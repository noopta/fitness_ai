// Personal-training dashboard API — the human trainer's view of their
// clients. Mounted at /api/personal-training so it can never be confused with
// /api/coach/*, which is the AI coach every user talks to.
//
// A practice is an Institution and a client is an 'athlete' member of it, so
// the trainer↔client link, invites and messaging reuse what institutions
// already had. Phase 1 is read-only over client data: roster, client header
// and timeline. Nothing here writes to a client's account.

import { randomBytes } from 'crypto';
import { Router, type RequestHandler } from 'express';
import { PrismaClient } from '@prisma/client';
import { requireAuth } from '../middleware/requireAuth.js';
import { socialWriteLimiter } from '../middleware/rateLimiter.js';
import { findPractice, requirePersonalTraining, requireTrainer } from '../middleware/requireTrainer.js';
import { claimInvite, findUsableInvite, InviteError } from '../services/institutionInvites.js';
import { bodyWeightKg, normalizePreference } from '../services/weightUnits.js';
import { countStatuses, displayNameOf, initialsOf, loadClients } from '../services/personalTraining/roster.js';
import {
  TIMELINE_PAGE_SIZE, checkInEvent, decodeCursor, detectPrs, measurementEvent, messageEvent, noteEvent, pageEvents,
  parseKinds, programEvent, workoutEvent,
} from '../services/personalTraining/timeline.js';
import type { ClientStatus, TimelineEvent } from '../services/personalTraining/types.js';
import { PROSPECT_PREFIX, linkProspectsOnJoin } from '../services/personalTraining/imports.js';
import surfaces from './personalTrainingSurfaces.js';

const router = Router();

// "Not joined" is a status added with spreadsheet import. A client that has not
// said it understands it (an app bundle published before the import existed)
// is given those clients as "new" instead — a status it can already draw —
// so a newer server never hands an older app something it cannot render.
// The web sends `?caps=not-joined`; non-browser clients may send `X-PT-Caps`.
export const downgradeNotJoined = (text: string) => text.split('"status":"notJoined"').join('"status":"new"');
router.use((req, res, next) => {
  const caps = `${req.query.caps ?? ''},${req.get('x-pt-caps') ?? ''}`.split(',');
  if (caps.includes('not-joined')) return next();
  const json = res.json.bind(res);
  res.json = (body: unknown) => json(body === undefined ? body : JSON.parse(downgradeNotJoined(JSON.stringify(body))));
  // Streamed answers (Ask Anakin) are written as `data:` frames rather than through res.json.
  const write = res.write.bind(res) as (...args: any[]) => boolean;
  res.write = ((chunk: any, ...rest: any[]) => write(typeof chunk === 'string' ? downgradeNotJoined(chunk) : chunk, ...rest)) as typeof res.write;
  next();
});
const prisma = new PrismaClient();

const FRONTEND_URL = process.env.FRONTEND_URL || 'https://axiomtraining.io';
const INVITE_TTL_HOURS = 7 * 24;
const STATUSES: ClientStatus[] = ['support', 'new', 'onPlan', 'paused', 'notJoined'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const trainer: RequestHandler[] = [requireAuth, requirePersonalTraining, requireTrainer];

// ─── Client side: accepting an invite ────────────────────────────────────────
// Not behind the trainer flag — the person accepting is a client. The invite
// can only have been minted by a trainer who is.

// GET /personal-training/invites/:token — what the client is about to join
router.get('/invites/:token', requireAuth, async (req, res) => {
  try {
    const invite = await findUsableInvite(req.params.token);
    // Trainer practices only hand out client invites through this surface.
    if (invite.role !== 'athlete') return res.status(404).json({ error: 'Invite not found' });
    const inviter = await prisma.user.findUnique({
      where: { id: invite.invitedByUserId },
      select: { name: true },
    });
    return res.json({
      practice: invite.institution,
      // Name only — the trainer's email is not the client's to see before joining.
      trainerName: inviter?.name?.trim() || 'Your trainer',
      email: invite.email,
      expiresAt: invite.expiresAt,
    });
  } catch (err) {
    if (err instanceof InviteError) return res.status(err.status).json({ error: err.message });
    console.error('[personal-training] GET /invites/:token', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /personal-training/invites/:token/accept — share training data with the trainer
router.post('/invites/:token/accept', requireAuth, socialWriteLimiter, async (req, res) => {
  try {
    const invite = await findUsableInvite(req.params.token);
    if (invite.role !== 'athlete') return res.status(404).json({ error: 'Invite not found' });
    const { institution } = await claimInvite(req.params.token, req.user!.id);
    // If the trainer imported this person from a spreadsheet, their record now belongs to this account.
    await linkProspectsOnJoin(institution.id, req.user!.id, req.params.token).catch((err) => console.error('[personal-training] link prospect', err));
    return res.json({
      practice: { id: institution.id, name: institution.name, slug: institution.slug, logoUrl: institution.logoUrl },
    });
  } catch (err) {
    if (err instanceof InviteError) return res.status(err.status).json({ error: err.message });
    console.error('[personal-training] POST /invites/:token/accept', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Trainer side ────────────────────────────────────────────────────────────

// GET /personal-training/me — who the trainer is and the practice they run
router.get('/me', requireAuth, requirePersonalTraining, async (req, res) => {
  try {
    const [user, practice] = await Promise.all([
      prisma.user.findUnique({ where: { id: req.user!.id }, select: { id: true, name: true, email: true } }),
      findPractice(req.user!.id, typeof req.query.practice === 'string' ? req.query.practice : undefined),
    ]);
    if (!user) return res.status(404).json({ error: 'User not found' });
    return res.json({
      trainer: { id: user.id, name: displayNameOf(user.name, user.email), initials: initialsOf(user.name, user.email) },
      practice,
    });
  } catch (err) {
    console.error('[personal-training] GET /me', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

function practiceSlug(name: string): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'practice';
  return `pt-${base}-${randomBytes(3).toString('hex')}`;
}

// POST /personal-training/practice — a trainer sets up their own practice
router.post('/practice', requireAuth, requirePersonalTraining, socialWriteLimiter, async (req, res) => {
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  if (name.length < 2 || name.length > 80) {
    return res.status(400).json({ error: 'Practice name must be between 2 and 80 characters' });
  }
  try {
    // One practice per trainer through this door. Idempotent on a double
    // submit: the second call gets the practice the first one made.
    const existing = await findPractice(req.user!.id);
    if (existing) return res.status(200).json({ practice: existing });

    const institution = await prisma.institution.create({
      data: {
        name,
        slug: practiceSlug(name),
        members: { create: { userId: req.user!.id, role: 'coach', active: true } },
      },
      select: { id: true, name: true, slug: true, logoUrl: true },
    });
    return res.status(201).json({ practice: institution });
  } catch (err) {
    console.error('[personal-training] POST /practice', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /personal-training/clients?status=&q=&ids= — roster with counts per status
router.get('/clients', ...trainer, async (req, res) => {
  try {
    const ids = typeof req.query.ids === 'string' && req.query.ids
      ? req.query.ids.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 500)
      : undefined;
    let clients = await loadClients(req.practice!.id, { ids, includeProspects: true });

    const q = typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase() : '';
    if (q) {
      clients = clients.filter(
        (c) => c.name.toLowerCase().includes(q) || (c.email ?? '').toLowerCase().includes(q),
      );
    }
    // Counts describe the searched roster before the status chip narrows it,
    // so every chip keeps showing how many it would reveal.
    const counts = countStatuses(clients);
    const status = STATUSES.find((s) => s === req.query.status);
    if (status) clients = clients.filter((c) => c.status === status);

    return res.json({ clients, counts });
  } catch (err) {
    console.error('[personal-training] GET /clients', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /personal-training/clients/invite — {mode:'app', email?} → invite link
router.post('/clients/invite', ...trainer, socialWriteLimiter, async (req, res) => {
  const { mode = 'app', email } = req.body ?? {};
  if (mode === 'link') {
    return res.status(400).json({ error: 'No-install links are not available yet', code: 'mode_unavailable' });
  }
  if (mode !== 'app') return res.status(400).json({ error: 'mode must be "app"' });
  if (email !== undefined && (typeof email !== 'string' || email.length > 255 || !EMAIL_RE.test(email.trim()))) {
    return res.status(400).json({ error: 'email must be a valid address' });
  }
  try {
    const invite = await prisma.institutionInvite.create({
      data: {
        institutionId: req.practice!.id,
        invitedByUserId: req.user!.id,
        email: email ? email.trim().toLowerCase() : null,
        // Always a client. A trainer cannot mint a co-trainer from here.
        role: 'athlete',
        expiresAt: new Date(Date.now() + INVITE_TTL_HOURS * 60 * 60 * 1000),
      },
    });
    return res.status(201).json({
      token: invite.token,
      link: `${FRONTEND_URL}/personal-training/join/${invite.token}`,
      email: invite.email,
      expiresAt: invite.expiresAt,
    });
  } catch (err) {
    console.error('[personal-training] POST /clients/invite', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /personal-training/clients/:id — one client (timeline header)
router.get('/clients/:id', ...trainer, async (req, res) => {
  try {
    const [client] = await loadClients(req.practice!.id, { ids: [req.params.id], includeProspects: true });
    if (!client) return res.status(404).json({ error: 'Client not found' });
    return res.json({ client });
  } catch (err) {
    console.error('[personal-training] GET /clients/:id', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/** Mark an event as coming from a spreadsheet import, unless it already carries a flag (a PR). */
const importedFlag = (e: TimelineEvent): TimelineEvent => (e.flag ? e : { ...e, flag: { label: 'Imported', tone: 'zinc' } });

// GET /personal-training/clients/:id/timeline?kind=&cursor= — paginated events, newest first
router.get('/clients/:id/timeline', ...trainer, async (req, res) => {
  const clientId = req.params.id;
  const trainerId = req.user!.id;
  try {
    // The membership check is the authorisation: a trainer can only read
    // someone who is an active client of the practice they run.
    // A "Not joined" client has no account: their timeline is what was imported for them, plus the trainer's notes.
    if (clientId.startsWith(PROSPECT_PREFIX)) {
      const prospect = await prisma.ptProspect.findUnique({ where: { id: clientId.slice(PROSPECT_PREFIX.length) } });
      if (!prospect || prospect.practiceId !== req.practice!.id || prospect.userId) return res.status(404).json({ error: 'Client not found' });
      const kinds = parseKinds(req.query.kind);
      const pref = normalizePreference((await prisma.user.findUnique({ where: { id: trainerId }, select: { unitPreference: true } }))?.unitPreference);
      const [sessions, weighIns, notes] = await Promise.all([
        kinds.includes('workout') ? prisma.ptImportedWorkout.findMany({ where: { prospectId: prospect.id }, orderBy: { at: 'asc' } }) : [],
        kinds.includes('measurement') ? prisma.ptImportedWeight.findMany({ where: { prospectId: prospect.id }, orderBy: { at: 'asc' } }) : [],
        kinds.includes('note') ? prisma.ptNote.findMany({ where: { practiceId: req.practice!.id, clientId }, orderBy: { createdAt: 'desc' } }) : [],
      ]);
      const rows = sessions.map((s) => ({ id: `imp:${s.id}`, createdAt: s.at, title: s.title, exercises: s.exercises, notes: s.notes, duration: null }));
      const prs = detectPrs(rows);
      const authors = notes.length ? await prisma.user.findMany({ where: { id: { in: [...new Set(notes.map((n) => n.trainerId))] } }, select: { id: true, name: true } }) : [];
      const nameOf = new Map(authors.map((a) => [a.id, a.name?.trim() || 'Trainer']));
      const events: TimelineEvent[] = [
        ...rows.map((w) => importedFlag(workoutEvent(w, clientId, pref, prs.get(w.id)))),
        ...weighIns.map((w) => measurementEvent({ id: `imp:${w.id}`, createdAt: w.at, weightKg: w.weightKg, notes: null }, clientId, pref)).filter((e): e is TimelineEvent => e !== null).map(importedFlag),
        ...notes.map((n) => noteEvent({ id: n.id, createdAt: n.createdAt, body: n.body, authorName: nameOf.get(n.trainerId) ?? 'Trainer' }, clientId)),
      ];
      return res.json(pageEvents(events, decodeCursor(req.query.cursor)));
    }

    const member = await prisma.institutionMember.findUnique({
      where: { institutionId_userId: { institutionId: req.practice!.id, userId: clientId } },
      select: { active: true, role: true, user: { select: { name: true, email: true } } },
    });
    if (!member || !member.active || member.role !== 'athlete') {
      return res.status(404).json({ error: 'Client not found' });
    }

    const kinds = parseKinds(req.query.kind);
    const cursor = decodeCursor(req.query.cursor);
    const before = cursor ? { createdAt: { lte: new Date(cursor.at) } } : {};
    // One row past the page per source is enough to know whether more exist.
    const take = TIMELINE_PAGE_SIZE + 1;
    const want = (k: TimelineEvent['kind']) => kinds.includes(k);

    const [a, b] = trainerId < clientId ? [trainerId, clientId] : [clientId, trainerId];

    const [viewer, workouts, checkIns, weights, proposals, conversation, notes] = await Promise.all([
      prisma.user.findUnique({ where: { id: trainerId }, select: { unitPreference: true } }),
      // PR detection needs every session, oldest first, not just this page.
      want('workout')
        ? prisma.workoutLog.findMany({
            where: { userId: clientId },
            orderBy: { createdAt: 'asc' },
            select: { id: true, createdAt: true, title: true, exercises: true, notes: true, duration: true },
          })
        : [],
      want('checkin')
        ? prisma.wellnessCheckin.findMany({ where: { userId: clientId, ...before }, orderBy: { createdAt: 'desc' }, take })
        : [],
      want('measurement')
        ? prisma.bodyWeightLog.findMany({ where: { userId: clientId, ...before }, orderBy: { createdAt: 'desc' }, take })
        : [],
      want('program')
        ? prisma.adaptationProposal.findMany({
            where: { userId: clientId, status: { not: 'superseded' }, ...before },
            orderBy: { createdAt: 'desc' },
            take,
            select: { id: true, createdAt: true, title: true, reasoning: true, status: true },
          })
        : [],
      want('message')
        ? prisma.directConversation.findUnique({
            where: { participantAId_participantBId: { participantAId: a, participantBId: b } },
            select: { id: true },
          })
        : null,
      // Private to the practice: scoped by practiceId, so another practice's notes on the same person never appear.
      want('note')
        ? prisma.ptNote.findMany({ where: { practiceId: req.practice!.id, clientId, ...before }, orderBy: { createdAt: 'desc' }, take })
        : [],
    ]);
    const authors = notes.length
      ? await prisma.user.findMany({ where: { id: { in: [...new Set(notes.map((n) => n.trainerId))] } }, select: { id: true, name: true } })
      : [];
    const authorName = new Map(authors.map((a) => [a.id, a.name?.trim() || 'Trainer']));

    const messages = conversation
      ? await prisma.message.findMany({
          where: { conversationId: conversation.id, ...before },
          orderBy: { createdAt: 'desc' },
          take,
          select: { id: true, createdAt: true, senderId: true, body: true },
        })
      : [];
    const latestMessage = conversation
      ? await prisma.message.findFirst({
          where: { conversationId: conversation.id },
          orderBy: { createdAt: 'desc' },
          select: { id: true },
        })
      : null;

    const pref = normalizePreference(viewer?.unitPreference);
    const clientName = displayNameOf(member.user.name, member.user.email);
    // What the trainer had on file for this client from before they joined sits beside what they log.
    const linked = want('workout') || want('measurement')
      ? await prisma.ptProspect.findMany({ where: { practiceId: req.practice!.id, userId: clientId }, select: { id: true } })
      : [];
    const [importedSessions, importedWeighIns] = linked.length
      ? await Promise.all([
          want('workout') ? prisma.ptImportedWorkout.findMany({ where: { prospectId: { in: linked.map((p) => p.id) } }, orderBy: { at: 'asc' } }) : [],
          want('measurement') ? prisma.ptImportedWeight.findMany({ where: { prospectId: { in: linked.map((p) => p.id) }, ...(cursor ? { at: { lte: new Date(cursor.at) } } : {}) }, orderBy: { at: 'desc' }, take }) : [],
        ])
      : [[], []];
    const allWorkouts = [
      ...workouts,
      ...importedSessions.map((s) => ({ id: `imp:${s.id}`, createdAt: s.at, title: s.title, exercises: s.exercises, notes: s.notes, duration: null })),
    ].sort((x, y) => x.createdAt.getTime() - y.createdAt.getTime());
    const prs = detectPrs(allWorkouts);

    const events: TimelineEvent[] = [
      ...allWorkouts.map((w) => (w.id.startsWith('imp:') ? importedFlag(workoutEvent(w, clientId, pref, prs.get(w.id))) : workoutEvent(w, clientId, pref, prs.get(w.id)))),
      ...importedWeighIns.map((w) => measurementEvent({ id: `imp:${w.id}`, createdAt: w.at, weightKg: w.weightKg, notes: null }, clientId, pref)).filter((e): e is TimelineEvent => e !== null).map(importedFlag),
      ...checkIns.map((c) => checkInEvent(c, clientId)),
      ...weights
        .map((w) => measurementEvent({ id: w.id, createdAt: w.createdAt, weightKg: bodyWeightKg(w), notes: w.notes }, clientId, pref))
        .filter((e): e is TimelineEvent => e !== null),
      ...proposals.map((p) => programEvent(p, clientId)),
      ...messages.map((m) => messageEvent(m, clientId, clientName, latestMessage?.id ?? null)),
      ...notes.map((n) => noteEvent({ id: n.id, createdAt: n.createdAt, body: n.body, authorName: authorName.get(n.trainerId) ?? 'Trainer' }, clientId)),
    ];

    return res.json(pageEvents(events, cursor));
  } catch (err) {
    console.error('[personal-training] GET /clients/:id/timeline', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Briefing, drafts, check-ins, progress, reports, Ask Anakin and notifications.
router.use(surfaces);

export default router;
