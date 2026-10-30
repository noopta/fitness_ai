// Proactive coach routes (design v3): Working on (C), check-in preferences
// (F1/B9), photos in chat (E/F2), the screen follow-ups (D/G3), in-session
// flags (D2), and a self-serve dry run for the silent test.
//
// Everything is under /coach/agent so the agent master flag and allowlist in
// routes/agent.ts apply; the per-user proactive flag is checked here.

import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { requireAuth } from '../middleware/requireAuth.js';
import { aiLimiter } from '../middleware/rateLimiter.js';
import { chatPhotosEnabled, proactiveAvailableFor } from '../services/featureFlags.js';
import { track } from '../services/productEvents.js';
import { mergeBlobKeys } from '../agent/profile/coachProfile.js';
import { todayForTz } from '../services/localDate.js';
import { getProactivePrefs, setProactivePrefs, muteTopic, unmuteTopic, muteLabel, FREQUENCY_LABEL, inferSessionTime } from '../proactive/prefs.js';
import { listThreads, getThread, threadRows, resolveThread, markWrong, updateThread, appendHistory, parseList, exerciseTouches, KIND_LABEL, STATUS_WORD, shortDate, type ThreadKind, type ThreadStatus } from '../proactive/threads.js';
import { storeChatPhoto, listPhotos, photoUrl, deletePhoto, deleteAllPhotos, MAX_PHOTO_BYTES } from '../proactive/photos.js';
import { loadScreens } from '../proactive/screens.js';
import { evaluateUser } from '../proactive/sweep.js';
import '../proactive/index.js';

const router = Router();
const prisma = new PrismaClient();

function fail(res: any, e: any, what: string) {
  const status = typeof e?.status === 'number' ? e.status : 500;
  if (status >= 500) console.error(`[proactive] ${what}:`, e?.message ?? e);
  res.status(status).json({ error: status >= 500 ? `Couldn’t ${what}.` : (e?.message ?? `Couldn’t ${what}.`) });
}

async function access(req: any, res: any, next: any) {
  if (!proactiveAvailableFor(req.user!.id, req.user!.email)) return res.status(404).json({ error: 'Not found' });
  next();
}

// ── Working on (C) ──────────────────────────────────────────────────────────

router.get('/coach/agent/threads', requireAuth, access, async (req, res) => {
  try {
    const u = await prisma.user.findUnique({ where: { id: req.user!.id }, select: { timezone: true } });
    const today = todayForTz(u?.timezone || 'UTC');
    const rows = threadRows(await listThreads(req.user!.id), today);
    res.json({ ...rows, today });
  } catch (e) { fail(res, e, 'load what Anakin is working on'); }
});

router.get('/coach/agent/threads/:id', requireAuth, access, async (req, res) => {
  try {
    const t = await getThread(req.user!.id, req.params.id);
    if (!t || t.status === 'wrong') return res.status(404).json({ error: 'Not found' });
    let history: { at: string; text: string }[] = [];
    try { history = JSON.parse(t.historyJson); } catch { history = []; }
    res.json({
      id: t.id, kind: t.kind, kindLabel: KIND_LABEL[t.kind as ThreadKind] ?? t.kind, title: t.title, status: t.status, statusWord: STATUS_WORD[t.status as ThreadStatus] ?? t.status,
      read: t.read, sourceQuote: t.sourceQuote, sourceAt: t.sourceAt?.toISOString() ?? null, sourceRole: t.sourceRole, sourceLabel: t.sourceAt ? `${t.sourceRole === 'assistant' ? 'Anakin' : 'You'} · chat · ${shortDate(t.sourceAt.toISOString().slice(0, 10))}` : null,
      checkBackAt: t.checkBackAt, checkBackLabel: t.checkBackAt ? shortDate(t.checkBackAt) : null, eventDate: t.eventDate, affects: parseList(t.affectsJson),
      history: history.slice().reverse().map((h) => ({ at: h.at, label: shortDate(h.at.slice(0, 10)), text: h.text })),
      resolution: t.resolution, openedLabel: `Opened ${shortDate(t.createdAt.toISOString().slice(0, 10))}`,
    });
  } catch (e) { fail(res, e, 'load that thread'); }
});

const editSchema = z.object({ title: z.string().min(2).max(80).optional(), checkBackAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(), eventDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(), affects: z.array(z.string().max(60)).max(8).optional(), read: z.string().max(200).nullable().optional() });
router.patch('/coach/agent/threads/:id', requireAuth, access, async (req, res) => {
  try {
    const patch = editSchema.parse(req.body);
    const t = await updateThread(req.user!.id, req.params.id, patch);
    if (!t) return res.status(404).json({ error: 'Not found' });
    await appendHistory(t.id, 'Edited by you');
    res.json({ ok: true });
  } catch (e) { fail(res, e, 'save that'); }
});

router.post('/coach/agent/threads/:id/resolve', requireAuth, access, async (req, res) => {
  try {
    const t = await resolveThread(req.user!.id, req.params.id, String(req.body?.resolution ?? 'Marked resolved').slice(0, 120));
    if (!t) return res.status(404).json({ error: 'Not found' });
    track(req.user!.id, 'proactive_thread_resolved', { kind: t.kind });
    res.json({ ok: true });
  } catch (e) { fail(res, e, 'mark that resolved'); }
});

router.post('/coach/agent/threads/:id/wrong', requireAuth, access, async (req, res) => {
  try {
    const ok = await markWrong(req.user!.id, req.params.id);
    if (!ok) return res.status(404).json({ error: 'Not found' });
    track(req.user!.id, 'proactive_thread_wrong', {});
    res.json({ ok: true });
  } catch (e) { fail(res, e, 'remove that'); }
});

/** D2 inline answers: "Got it" notes it; "It's fine now" resolves. */
router.post('/coach/agent/threads/:id/ack', requireAuth, access, async (req, res) => {
  try {
    const fine = req.body?.answer === 'fine' || /fine/i.test(String(req.body?.answer ?? ''));
    const t = fine ? await resolveThread(req.user!.id, req.params.id, 'Resolved · fine now') : await getThread(req.user!.id, req.params.id);
    if (!t) return res.status(404).json({ error: 'Not found' });
    if (!fine) await appendHistory(t.id, 'Seen before a session');
    res.json({ ok: true, resolved: fine });
  } catch (e) { fail(res, e, 'note that'); }
});

// ── In-session flag (D2 "stop and flag it") ─────────────────────────────────

const flagSchema = z.object({ exercise: z.string().min(1).max(80), setIndex: z.number().int().min(0).max(50).optional(), note: z.string().max(200).optional(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), workoutLogId: z.string().optional() });
router.post('/workouts/flag', requireAuth, async (req, res) => {
  try {
    const b = flagSchema.parse(req.body);
    const u = await prisma.user.findUnique({ where: { id: req.user!.id }, select: { timezone: true } });
    const date = b.date ?? todayForTz(u?.timezone || 'UTC');
    // Attach to the thread that touches this exercise, when there is one.
    const threads = await listThreads(req.user!.id);
    const thread = threads.find((t) => ['open', 'watching', 'running'].includes(t.status) && exerciseTouches(parseList(t.affectsJson), b.exercise)) ?? null;
    const row = await prisma.sessionFlag.create({ data: { userId: req.user!.id, date, exercise: b.exercise, setIndex: b.setIndex ?? null, note: b.note ?? null, threadId: thread?.id ?? null, workoutLogId: b.workoutLogId ?? null } });
    if (thread) { await appendHistory(thread.id, `Flagged · ${b.exercise}${b.setIndex != null ? ` · set ${b.setIndex + 1}` : ''}`); await updateThread(req.user!.id, thread.id, { status: 'watching' }); }
    track(req.user!.id, 'session_flag', { exercise: b.exercise, thread: !!thread });
    res.json({ id: row.id, threadId: thread?.id ?? null });
  } catch (e) { fail(res, e, 'flag that'); }
});

// ── Check-ins (F1) and who runs the program (B9) ────────────────────────────

router.get('/coach/agent/checkins', requireAuth, access, async (req, res) => {
  try {
    const prefs = await getProactivePrefs(req.user!.id);
    let inferred: string | null = null;
    if (!prefs.sessionTime) {
      const u = await prisma.user.findUnique({ where: { id: req.user!.id }, select: { timezone: true } });
      const logs = await prisma.workoutLog.findMany({ where: { userId: req.user!.id }, orderBy: { createdAt: 'desc' }, take: 20, select: { createdAt: true } });
      const hours = logs.map((l) => Number(new Intl.DateTimeFormat('en-US', { timeZone: u?.timezone || 'UTC', hour: 'numeric', hourCycle: 'h23' }).format(l.createdAt)));
      inferred = inferSessionTime(hours);
    }
    res.json({ prefs, frequencyLabel: FREQUENCY_LABEL[prefs.frequency], muted: prefs.mutedTopics.map((m) => ({ ...m, label: muteLabel(m) })), sessionTimeInferred: inferred });
  } catch (e) { fail(res, e, 'load check-in settings'); }
});

const prefsSchema = z.object({
  frequency: z.enum(['rarely', 'normal', 'often']).optional(), pushTimeSensitive: z.boolean().optional(),
  quietStart: z.number().int().min(0).max(23).optional(), quietEnd: z.number().int().min(0).max(23).optional(),
  outcomeReports: z.boolean().optional(), allCheckins: z.boolean().optional(),
  programOwner: z.enum(['me', 'coach_offline', 'coach_axiom']).optional(), photoRetentionDays: z.number().int().min(1).max(365).optional(),
  sessionTime: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
});
router.patch('/coach/agent/checkins', requireAuth, access, async (req, res) => {
  try {
    const patch = prefsSchema.parse(req.body);
    const prefs = await setProactivePrefs(req.user!.id, patch as any);
    track(req.user!.id, 'proactive_prefs_changed', { keys: Object.keys(patch) });
    res.json({ prefs });
  } catch (e) { fail(res, e, 'save that'); }
});
router.post('/coach/agent/checkins/mute', requireAuth, access, async (req, res) => {
  try {
    const topic = String(req.body?.topic ?? '').trim().slice(0, 40);
    if (!topic) return res.status(400).json({ error: 'Which topic?' });
    const days = req.body?.days == null ? null : Number(req.body.days);
    const prefs = await setProactivePrefs(req.user!.id, muteTopic(await getProactivePrefs(req.user!.id), topic, Number.isFinite(days as number) ? days : null));
    res.json({ prefs });
  } catch (e) { fail(res, e, 'mute that'); }
});
router.post('/coach/agent/checkins/unmute', requireAuth, access, async (req, res) => {
  try {
    const topic = String(req.body?.topic ?? '').trim();
    const prefs = await setProactivePrefs(req.user!.id, unmuteTopic(await getProactivePrefs(req.user!.id), topic));
    res.json({ prefs });
  } catch (e) { fail(res, e, 'unmute that'); }
});

// ── Photos in chat (E) and the Photos tab (F2) ──────────────────────────────

const photoSchema = z.object({ image: z.string().min(16).max(Math.ceil(MAX_PHOTO_BYTES * 1.4)), mimeType: z.string().max(40).optional() });
router.post('/coach/agent/photos', requireAuth, aiLimiter, async (req, res) => {
  try {
    if (!chatPhotosEnabled()) return res.status(404).json({ error: 'Not found' });
    const b = photoSchema.parse(req.body);
    const photo = await storeChatPhoto(req.user!.id, b.image, b.mimeType);
    track(req.user!.id, 'chat_photo_sent', { kind: photo.kind, private: photo.private });
    res.json({ photo });
  } catch (e: any) {
    if (e?.name === 'ZodError') return res.status(400).json({ error: 'That photo couldn’t be read.' });
    fail(res, { ...e, status: e?.status ?? 400, message: e?.message }, 'save that photo');
  }
});
router.get('/coach/agent/photos', requireAuth, async (req, res) => {
  try {
    const photos = await listPhotos(req.user!.id);
    const prefs = await getProactivePrefs(req.user!.id);
    res.json({ photos, retentionDays: prefs.photoRetentionDays });
  } catch (e) { fail(res, e, 'load your photos'); }
});
router.get('/coach/agent/photos/:id/url', requireAuth, async (req, res) => {
  try {
    const url = await photoUrl(req.user!.id, req.params.id);
    if (!url) return res.status(404).json({ error: 'That photo is gone.' });
    res.json({ url });
  } catch (e) { fail(res, e, 'open that photo'); }
});
router.delete('/coach/agent/photos/:id', requireAuth, async (req, res) => {
  try { res.json({ ok: await deletePhoto(req.user!.id, req.params.id) }); } catch (e) { fail(res, e, 'delete that photo'); }
});
router.delete('/coach/agent/photos', requireAuth, async (req, res) => {
  try { res.json({ deleted: await deleteAllPhotos(req.user!.id) }); } catch (e) { fail(res, e, 'delete your photos'); }
});

// ── Screens (D1/D2/D3/G2/G3) ────────────────────────────────────────────────

router.get('/coach/agent/screens', requireAuth, async (req, res) => {
  try {
    const ex = String(req.query.exercises ?? '').split('|').map((s) => s.trim()).filter(Boolean).slice(0, 20);
    const s = await loadScreens(req.user!.id, { sessionExercises: ex });
    if (s.sparse) await mergeBlobKeys(req.user!.id, { sparseNoteShown: true }).catch(() => {});
    res.json(s);
  } catch (e) { fail(res, e, 'load follow-ups'); }
});

/** D3 Apply: today's carb target, one day only. Goes through the change log so Undo works. */
router.post('/coach/agent/screens/carb-day', requireAuth, access, async (req, res) => {
  try {
    const carbsG = Number(req.body?.carbsG);
    const { executeOp } = await import('../agent/ops.js');
    const u = await prisma.user.findUnique({ where: { id: req.user!.id }, select: { timezone: true } });
    const change = await executeOp(req.user!.id, 'proactive.carb_day', { carbsG, date: todayForTz(u?.timezone || 'UTC') });
    track(req.user!.id, 'proactive_insight_applied', { pair: 'carbs_prev_day_reps', carbsG });
    res.json({ changeId: change.changeId, summary: change.summary });
  } catch (e) { fail(res, e, 'set that'); }
});

// ── The silent test: run the reasoner for yourself, send nothing ────────────

router.post('/coach/agent/proactive/dry-run', requireAuth, access, aiLimiter, async (req, res) => {
  try {
    const r = await evaluateUser(req.user!.id, { dryRun: true });
    res.json(r ?? { delivered: null, outcomes: 0, gated: [], dryRun: true });
  } catch (e) { fail(res, e, 'run the check'); }
});

export default router;
