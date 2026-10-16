// The no-install client portal (coach-platform handoff §2.6, gap #5). A
// client opens the link their trainer sent; every request carries it as
// `Authorization: PtLink <token>`. The link is the whole identity: it opens
// this one client's routes below and nothing else in the API — it is never
// accepted by requireAuth, and nothing here reads req.user.
//
// What a client does here lands where an app client's would (check-ins in
// PtCheckIn, weigh-ins in BodyWeightLog, messages as DMs with their trainer),
// so the trainer's briefing, timeline and reports read it with no fork.

import { Router, type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import { rateLimit } from '../middleware/rateLimiter.js';
import { moderateText } from '../services/moderationService.js';
import { sendPushToUser } from '../services/notificationService.js';
import { transcribeAudio } from '../services/llmService.js';
import { normalizePreference, unitLabel } from '../services/weightUnits.js';
import { CheckInError, getRequest, submitCheckIn } from '../services/personalTraining/checkins.js';
import { prisma } from '../services/personalTraining/db.js';
import { buildProgramView } from '../services/personalTraining/dossier.js';
import { resolveToken, type LinkSession } from '../services/personalTraining/links.js';
import { brandingFor } from '../services/personalTraining/practice.js';
import { RecordError, addMeasurement, addPhoto, deletePhoto, listGoals, listMeasurements, listPhotos } from '../services/personalTraining/records.js';
import type { PortalHome, PortalMessage } from '../services/personalTraining/types.js';

const router = Router();

declare global {
  namespace Express {
    interface Request {
      ptLink?: LinkSession;
    }
  }
}

// A token is 256 random bits, so guessing is hopeless; this only stops a script hammering the lookup.
const badTokenLimiter = rateLimit({ windowMs: 15 * 60_000, max: 30, keyFn: (req) => `ptlink-bad:${req.ip ?? 'unknown'}`, skipSuccessful: true, message: 'Too many attempts. Try again later.' });
const writeLimiter = rateLimit({ windowMs: 60_000, max: 20, keyFn: (req) => `ptlink:${req.ptLink?.linkId ?? req.ip}`, message: 'You are sending too quickly. Try again in a moment.' });
const aiLimiter = rateLimit({ windowMs: 60_000, max: 6, keyFn: (req) => `ptlink-ai:${req.ptLink?.linkId ?? req.ip}`, message: 'Give it a moment and try again.' });

export async function requireLink(req: Request, res: Response, next: NextFunction) {
  const header = req.get('authorization') ?? '';
  const m = /^PtLink\s+(\S+)$/i.exec(header);
  if (!m) return res.status(401).json({ error: 'This page needs the link your trainer sent you', code: 'no_link' });
  try {
    const session = await resolveToken(m[1]);
    // One answer for every failure: a revoked link looks exactly like one that never existed.
    if (!session) return res.status(404).json({ error: 'This link is no longer active. Ask your trainer for a new one.', code: 'link_inactive' });
    req.ptLink = session;
    next();
  } catch (err) {
    console.error('[pt-portal] resolve', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

type Handler = (req: Request, res: Response, s: LinkSession) => Promise<unknown>;
const handle = (name: string, fn: Handler): RequestHandler => async (req, res) => {
  try {
    await fn(req, res, req.ptLink!);
  } catch (err: any) {
    if (err instanceof CheckInError || err instanceof RecordError) return void (res.headersSent || res.status(err.status).json({ error: err.message }));
    console.error(`[pt-portal] ${name}`, err);
    if (!res.headersSent) res.status(500).json({ error: 'Something went wrong. Try again.' });
  }
};

router.use(badTokenLimiter, requireLink);

const clientPref = async (clientId: string) =>
  normalizePreference((await prisma.user.findUnique({ where: { id: clientId }, select: { unitPreference: true } }))?.unitPreference);

/** The practice trainer this client talks to: whoever last wrote to them, else the practice's first coach. */
async function trainerFor(s: LinkSession): Promise<string | null> {
  const coaches = await prisma.institutionMember.findMany({
    where: { institutionId: s.practiceId, role: 'coach', active: true }, orderBy: { joinedAt: 'asc' }, select: { userId: true },
  });
  if (coaches.length === 0) return null;
  const ids = coaches.map((c) => c.userId);
  const convo = await prisma.directConversation.findFirst({
    where: { OR: [{ participantAId: s.clientId, participantBId: { in: ids } }, { participantBId: s.clientId, participantAId: { in: ids } }] },
    orderBy: { updatedAt: 'desc' },
    select: { participantAId: true, participantBId: true },
  });
  if (convo) return convo.participantAId === s.clientId ? convo.participantBId : convo.participantAId;
  return ids[0];
}

async function conversationWith(clientId: string, trainerId: string) {
  const [a, b] = trainerId < clientId ? [trainerId, clientId] : [clientId, trainerId];
  return prisma.directConversation.findUnique({ where: { participantAId_participantBId: { participantAId: a, participantBId: b } } });
}

// ─── Home ────────────────────────────────────────────────────────────────────

router.get('/home', handle('GET home', async (_req, res, s) => {
  const [user, branding, checkIns, pref, trainerId, intake, reports] = await Promise.all([
    prisma.user.findUnique({ where: { id: s.clientId }, select: { name: true, savedProgram: true } }),
    brandingFor(s.practiceId),
    prisma.ptCheckIn.findMany({ where: { practiceId: s.practiceId, clientId: s.clientId, status: 'due' }, orderBy: { dueAt: 'asc' }, select: { id: true, dueAt: true, questionsJson: true } }),
    clientPref(s.clientId),
    trainerFor(s),
    prisma.ptIntake.findUnique({ where: { practiceId_clientId: { practiceId: s.practiceId, clientId: s.clientId } } }),
    prisma.ptReport.findMany({ where: { practiceId: s.practiceId, clientId: s.clientId, status: 'sent' }, orderBy: { month: 'desc' }, take: 12, select: { id: true, month: true, sentAt: true } }),
  ]);
  const convo = trainerId ? await conversationWith(s.clientId, trainerId) : null;
  const unread = convo ? await prisma.message.count({ where: { conversationId: convo.id, senderId: { not: s.clientId }, readAt: null } }) : 0;
  const name = user?.name?.trim() || 'there';
  const body: PortalHome = {
    client: { firstName: name.split(/\s+/)[0], name, unit: unitLabel(pref) === 'kg' ? 'kg' : 'lb' },
    branding,
    checkIns: checkIns.map((k) => ({ id: k.id, dueAt: k.dueAt.toISOString(), questionCount: (() => { try { return JSON.parse(k.questionsJson).length; } catch { return 0; } })() })),
    goals: await listGoals(s.practiceId, s.clientId, pref),
    unreadMessages: unread,
    hasProgram: !!user?.savedProgram,
    intake: intake ? { status: intake.status as 'in_progress' | 'complete', completeness: intake.completeness } : null,
    reports: reports.map((r) => ({ id: r.id, month: r.month, title: `Your ${r.month} report`, sentAt: (r.sentAt ?? new Date()).toISOString() })),
  };
  res.json(body);
}));

// ─── Check-ins ───────────────────────────────────────────────────────────────

router.get('/check-ins/:id', handle('GET check-in', async (req, res, s) => {
  res.json(await getRequest(req.params.id, s.clientId));
}));

router.post('/check-ins/:id', writeLimiter, handle('POST check-in', async (req, res, s) => {
  const row = await prisma.ptCheckIn.findUnique({ where: { id: req.params.id }, select: { practiceId: true } });
  if (!row || row.practiceId !== s.practiceId) throw new CheckInError('Check-in not found', 404);
  const result = await submitCheckIn(req.params.id, s.clientId, req.body?.answers);
  await prisma.ptCheckIn.update({ where: { id: req.params.id }, data: { channel: 'webLink' } }).catch(() => {});
  res.json(result);
}));

// Voice answers: the client speaks, Whisper writes it down, and they check the text before it is sent.
router.post('/transcribe', aiLimiter, handle('POST transcribe', async (req, res) => {
  const audio = req.body?.audioBase64;
  const mime = req.body?.mimeType;
  if (typeof audio !== 'string' || audio.length < 50 || typeof mime !== 'string' || mime.length > 60) return res.status(400).json({ error: 'Send a recording' });
  try {
    res.json({ text: await transcribeAudio(audio, mime) });
  } catch (err: any) {
    res.status(422).json({ error: err?.message ?? 'Could not make that out. Try again.' });
  }
}));

// ─── Measurements and photos ─────────────────────────────────────────────────

router.get('/measurements', handle('GET measurements', async (_req, res, s) => {
  res.json({ measurements: await listMeasurements(s.practiceId, s.clientId, await clientPref(s.clientId)) });
}));

router.post('/measurements', writeLimiter, handle('POST measurement', async (req, res, s) => {
  await addMeasurement({ practiceId: s.practiceId, clientId: s.clientId, actorId: s.clientId, source: 'client', ...(req.body ?? {}) });
  res.status(201).json({ measurements: await listMeasurements(s.practiceId, s.clientId, await clientPref(s.clientId)) });
}));

router.get('/photos', handle('GET photos', async (_req, res, s) => {
  res.json({ photos: await listPhotos(s.practiceId, s.clientId) });
}));

router.post('/photos', writeLimiter, handle('POST photo', async (req, res, s) => {
  await addPhoto({ practiceId: s.practiceId, clientId: s.clientId, actorId: s.clientId, source: 'client', ...(req.body ?? {}) });
  res.status(201).json({ photos: await listPhotos(s.practiceId, s.clientId) });
}));

router.delete('/photos/:pid', writeLimiter, handle('DELETE photo', async (req, res, s) => {
  await deletePhoto(s.practiceId, s.clientId, s.clientId, req.params.pid, 'client');
  res.json({ ok: true });
}));

// ─── Messages ────────────────────────────────────────────────────────────────

router.get('/messages', handle('GET messages', async (_req, res, s) => {
  const trainerId = await trainerFor(s);
  const convo = trainerId ? await conversationWith(s.clientId, trainerId) : null;
  if (!convo) return res.json({ messages: [] as PortalMessage[] });
  const rows = await prisma.message.findMany({ where: { conversationId: convo.id }, orderBy: { createdAt: 'desc' }, take: 100, select: { id: true, senderId: true, body: true, createdAt: true } });
  await prisma.message.updateMany({ where: { conversationId: convo.id, senderId: { not: s.clientId }, readAt: null }, data: { readAt: new Date() } });
  const messages: PortalMessage[] = rows.reverse().map((m) => ({ id: m.id, fromClient: m.senderId === s.clientId, body: m.body, at: m.createdAt.toISOString() }));
  res.json({ messages });
}));

router.post('/messages', writeLimiter, handle('POST message', async (req, res, s) => {
  const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
  if (!text) return res.status(400).json({ error: 'Message is empty' });
  if (text.length > 2000) return res.status(400).json({ error: 'Message is too long (2000 characters max)' });
  const trainerId = await trainerFor(s);
  if (!trainerId) return res.status(409).json({ error: 'Your trainer is not available right now' });
  const verdict = await moderateText(text, 'dm', s.clientId);
  if (!verdict.allowed) return res.status(400).json({ error: verdict.message ?? 'This message could not be sent' });
  const [a, b] = trainerId < s.clientId ? [trainerId, s.clientId] : [s.clientId, trainerId];
  const convo = await prisma.directConversation.upsert({
    where: { participantAId_participantBId: { participantAId: a, participantBId: b } },
    update: { updatedAt: new Date() },
    create: { participantAId: a, participantBId: b },
  });
  const m = await prisma.message.create({ data: { conversationId: convo.id, senderId: s.clientId, body: text } });
  const me = await prisma.user.findUnique({ where: { id: s.clientId }, select: { name: true } });
  sendPushToUser(trainerId, `Message from ${me?.name ?? 'a client'}`, text.slice(0, 80), { type: 'message', conversationId: convo.id }).catch(() => {});
  res.status(201).json({ message: { id: m.id, fromClient: true, body: m.body, at: m.createdAt.toISOString() } satisfies PortalMessage });
}));

// ─── Program and reports ─────────────────────────────────────────────────────

router.get('/program', handle('GET program', async (_req, res, s) => {
  const user = await prisma.user.findUnique({ where: { id: s.clientId }, select: { savedProgram: true, programStartDate: true, coachGoal: true } });
  res.json({ program: user ? buildProgramView(user, [], await clientPref(s.clientId), new Date()) : null });
}));

router.get('/reports/:id', handle('GET report', async (req, res, s) => {
  const r = await prisma.ptReport.findUnique({ where: { id: req.params.id } });
  // Only a report the trainer actually sent; a draft is still the trainer's.
  if (!r || r.practiceId !== s.practiceId || r.clientId !== s.clientId || r.status !== 'sent') return res.status(404).json({ error: 'Report not found' });
  let stats: unknown = null;
  try { stats = JSON.parse(r.statsJson); } catch { /* shown without stats */ }
  res.json({ report: { id: r.id, month: r.month, narrative: r.narrative, coachNote: r.coachNote, nextLine: r.nextLine, stats, sentAt: r.sentAt?.toISOString() ?? null } });
}));

export default router;
