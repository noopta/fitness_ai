// Personal-training dashboard API, part two: briefing, drafts, check-ins,
// progress, reports, Ask Anakin and notifications. Mounted by
// personalTraining.ts, which has already applied requireAuth; the trainer
// routes here add the flag and practice gates, and the two client-facing
// check-in routes deliberately do not.

import { Router, type Request, type RequestHandler, type Response } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { aiLimiter, socialWriteLimiter } from '../middleware/rateLimiter.js';
import { requirePersonalTraining, requireTrainer } from '../middleware/requireTrainer.js';
import { normalizePreference } from '../services/weightUnits.js';
import {
  AnakinError, addScheduled, ask, getFilter, getThread, listScheduled, listThreads, normaliseScope, removeScheduled, setScheduledActive,
} from '../services/personalTraining/anakin.js';
import {
  BriefingError, generateBriefing, getToday, resolveItem, syncItemsWithDraft, undoResolve,
} from '../services/personalTraining/briefingService.js';
import {
  CheckInError, deleteOverride, getRequest, inbox, listSchedules, markReviewed, requestCheckIns, saveSchedule, sendRoutineReplies,
  submitCheckIn, syncReviewedWithDraft,
} from '../services/personalTraining/checkins.js';
import { loadPracticeData } from '../services/personalTraining/data.js';
import { prisma } from '../services/personalTraining/db.js';
import { DraftError, deliverDueDrafts, redraft, requestSend, undoSend } from '../services/personalTraining/drafts.js';
import { isLiftKey } from '../services/personalTraining/lifts.js';
import {
  SettingsError, applyPatch, describeSettings, loadSettings, markRead, notificationFeed, saveSettings, sweepNotifications,
} from '../services/personalTraining/notifications.js';
import { buildProgress } from '../services/personalTraining/progress.js';
import { ReportError, defaultMonth, getReport, isMonth, patchReport, sendReport, undoReport } from '../services/personalTraining/reports.js';
import { loadClients } from '../services/personalTraining/roster.js';

const router = Router();
const trainer: RequestHandler[] = [requireAuth, requirePersonalTraining, requireTrainer];

type Handler = (req: Request, res: Response) => Promise<unknown>;

/** Maps the services' typed errors to their status; anything else is a logged 500. */
const handle = (name: string, fn: Handler): RequestHandler => async (req, res) => {
  try {
    await fn(req, res);
  } catch (err: any) {
    const known = err instanceof DraftError || err instanceof BriefingError || err instanceof CheckInError || err instanceof ReportError || err instanceof AnakinError;
    if (known) return void (res.headersSent || res.status(err.status).json({ error: err.message }));
    if (err instanceof SettingsError) return void res.status(400).json({ error: err.message });
    console.error(`[personal-training] ${name}`, err);
    if (!res.headersSent) res.status(500).json({ error: 'Internal server error' });
  }
};

const ids = (req: Request) => ({ practiceId: req.practice!.id, trainerId: req.user!.id });
const unitPref = async (userId: string) =>
  normalizePreference((await prisma.user.findUnique({ where: { id: userId }, select: { unitPreference: true } }))?.unitPreference);

/** Server-sent events over a fetch stream (the web client cannot set auth headers on EventSource). */
function openStream(res: Response) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();
  return (event: unknown) => { res.write(`data: ${JSON.stringify(event)}\n\n`); };
}

// ─── Client side: answering a check-in ───────────────────────────────────────
// Not behind the trainer flag: the person answering is a client.

router.get('/check-in-requests/:id', requireAuth, handle('GET check-in-request', async (req, res) => {
  res.json(await getRequest(req.params.id, req.user!.id));
}));

router.post('/check-in-requests/:id', requireAuth, socialWriteLimiter, handle('POST check-in-request', async (req, res) => {
  res.json(await submitCheckIn(req.params.id, req.user!.id, req.body?.answers));
}));

// ─── Briefing ────────────────────────────────────────────────────────────────

router.get('/briefing/today', ...trainer, handle('GET briefing', async (req, res) => {
  const { practiceId, trainerId } = ids(req);
  res.json(await getToday(practiceId, trainerId));
}));

// Generates today's briefing if it does not exist yet, emitting each card as
// it is ready; replays the stored one if it does.
router.get('/briefing/today/stream', ...trainer, aiLimiter, handle('GET briefing stream', async (req, res) => {
  const { practiceId, trainerId } = ids(req);
  const send = openStream(res);
  let emitted = false;
  try {
    const briefing = await generateBriefing(practiceId, trainerId, { emit: (e) => { emitted = true; send(e); } });
    // A stored or already-running briefing emits nothing through this caller's callback.
    if (!emitted) {
      for (const item of briefing.items) send({ type: 'item', item });
      send({ type: 'done', briefing });
    }
  } catch (err) {
    console.error('[personal-training] briefing stream', err);
    if (!emitted) send({ type: 'error', message: 'The briefing could not be generated' });
  }
  res.end();
}));

router.post('/briefing/items/:id/resolve', ...trainer, socialWriteLimiter, handle('POST resolve', async (req, res) => {
  const action = req.body?.action;
  if (!['messaged', 'dismissed', 'reviewed'].includes(action)) return res.status(400).json({ error: 'action must be messaged, dismissed or reviewed' });
  const editedText = typeof req.body?.editedText === 'string' ? req.body.editedText : undefined;
  res.json({ item: await resolveItem({ itemId: req.params.id, ...ids(req), action, editedText }) });
}));

router.delete('/briefing/items/:id/resolve', ...trainer, handle('DELETE resolve', async (req, res) => {
  res.json({ item: await undoResolve({ itemId: req.params.id, ...ids(req) }) });
}));

// ─── Drafts ──────────────────────────────────────────────────────────────────

router.post('/drafts/:id/send', ...trainer, socialWriteLimiter, handle('POST draft send', async (req, res) => {
  const editedText = typeof req.body?.text === 'string' ? req.body.text : undefined;
  const draft = await requestSend({ draftId: req.params.id, ...ids(req), editedText });
  await syncReviewedWithDraft(draft.id, true);
  await syncItemsWithDraft(draft.id, { undoUntil: new Date(draft.undoUntil!) });
  res.json({ draft });
}));

router.delete('/drafts/:id/send', ...trainer, handle('DELETE draft send', async (req, res) => {
  const draft = await undoSend({ draftId: req.params.id, ...ids(req) });
  await syncReviewedWithDraft(draft.id, false);
  await syncItemsWithDraft(draft.id, null);
  res.json({ draft });
}));

router.post('/drafts/:id/redraft', ...trainer, aiLimiter, handle('POST redraft', async (req, res) => {
  if (req.body?.style !== 'shorter') return res.status(400).json({ error: 'style must be "shorter"' });
  const currentText = typeof req.body?.text === 'string' ? req.body.text : undefined;
  res.json({ draft: await redraft({ draftId: req.params.id, practiceId: req.practice!.id, style: 'shorter', currentText }) });
}));

// ─── Check-ins ───────────────────────────────────────────────────────────────

router.get('/check-ins', ...trainer, handle('GET check-ins', async (req, res) => {
  // Reading the inbox is also when a just-expired undo window gets delivered.
  await deliverDueDrafts();
  const since = typeof req.query.since === 'string' && !Number.isNaN(Date.parse(req.query.since)) ? new Date(req.query.since) : undefined;
  res.json(await inbox(req.practice!.id, await loadClients(req.practice!.id), { since }));
}));

router.post('/check-ins/request', ...trainer, socialWriteLimiter, handle('POST check-ins request', async (req, res) => {
  const wanted = Array.isArray(req.body?.clientIds) ? req.body.clientIds.filter((x: unknown) => typeof x === 'string').slice(0, 200) : [];
  if (wanted.length === 0) return res.status(400).json({ error: 'clientIds is required' });
  // loadClients with ids is the membership check: non-clients simply are not returned.
  const clients = await loadClients(req.practice!.id, { ids: wanted });
  res.json({ requested: await requestCheckIns(req.practice!.id, req.user!.id, clients) });
}));

router.post('/check-ins/send-routine', ...trainer, socialWriteLimiter, handle('POST send-routine', async (req, res) => {
  res.json({ sent: await sendRoutineReplies(req.practice!.id, req.user!.id) });
}));

router.post('/check-ins/:id/read', ...trainer, handle('POST check-in read', async (req, res) => {
  await markReviewed(req.params.id, req.practice!.id, req.user!.id);
  res.json({ ok: true });
}));

router.get('/check-in-schedules', ...trainer, handle('GET schedules', async (req, res) => {
  res.json({ schedules: await listSchedules(req.practice!.id, await loadClients(req.practice!.id)) });
}));

router.put('/check-in-schedules', ...trainer, socialWriteLimiter, handle('PUT schedules', async (req, res) => {
  const clients = await loadClients(req.practice!.id);
  res.json({ schedule: await saveSchedule(req.practice!.id, req.user!.id, req.body, new Set(clients.map((c) => c.id))) });
}));

router.delete('/check-in-schedules/:clientId', ...trainer, handle('DELETE schedule', async (req, res) => {
  await deleteOverride(req.practice!.id, req.user!.id, req.params.clientId);
  res.json({ ok: true });
}));

// ─── Progress and reports ────────────────────────────────────────────────────

router.get('/progress', ...trainer, handle('GET progress', async (req, res) => {
  const { practiceId, trainerId } = ids(req);
  const lift = isLiftKey(req.query.lift) ? req.query.lift : 'squat';
  const weeks = Math.min(12, Math.max(4, parseInt(String(req.query.weeks ?? '6'), 10) || 6));
  res.json(buildProgress(await loadPracticeData(practiceId, trainerId), lift, weeks, await unitPref(trainerId)));
}));

async function reportFor(req: Request, clientId: string, month: string) {
  const { practiceId, trainerId } = ids(req);
  const data = await loadPracticeData(practiceId, trainerId, { clientIds: [clientId] });
  const client = data.clients[0];
  if (!client) throw new ReportError('Client not found', 404);
  const me = await prisma.user.findUnique({ where: { id: trainerId }, select: { name: true, unitPreference: true } });
  return getReport({
    practiceId, trainerId, client, data: data.byClient.get(client.id)!, month, pref: normalizePreference(me?.unitPreference),
    who: { trainerName: me?.name?.trim() || 'Your trainer', practiceName: req.practice!.name },
  });
}

router.get('/reports', ...trainer, handle('GET report', async (req, res) => {
  const clientId = typeof req.query.clientId === 'string' ? req.query.clientId : '';
  if (!clientId) return res.status(400).json({ error: 'clientId is required' });
  const month = isMonth(req.query.month) ? req.query.month : defaultMonth(new Date());
  res.json({ report: await reportFor(req, clientId, month) });
}));

router.patch('/reports/:id', ...trainer, handle('PATCH report', async (req, res) => {
  await patchReport(req.params.id, req.practice!.id, req.body);
  const row = await prisma.ptReport.findUnique({ where: { id: req.params.id } });
  res.json({ report: await reportFor(req, row!.clientId, row!.month) });
}));

router.post('/reports/:id/send', ...trainer, socialWriteLimiter, handle('POST report send', async (req, res) => {
  const row = await prisma.ptReport.findUnique({ where: { id: req.params.id } });
  if (!row || row.practiceId !== req.practice!.id) return res.status(404).json({ error: 'Report not found' });
  const report = await reportFor(req, row.clientId, row.month);
  await sendReport({ report, ...ids(req) });
  res.json({ report: await reportFor(req, row.clientId, row.month) });
}));

router.delete('/reports/:id/send', ...trainer, handle('DELETE report send', async (req, res) => {
  await undoReport(req.params.id, req.practice!.id, req.user!.id);
  const row = await prisma.ptReport.findUnique({ where: { id: req.params.id } });
  res.json({ report: await reportFor(req, row!.clientId, row!.month) });
}));

// ─── Ask Anakin ──────────────────────────────────────────────────────────────

router.get('/anakin/threads', ...trainer, handle('GET threads', async (req, res) => {
  const { practiceId, trainerId } = ids(req);
  res.json({ threads: await listThreads(practiceId, trainerId), scheduled: await listScheduled(practiceId, trainerId) });
}));

router.get('/anakin/threads/:id', ...trainer, handle('GET thread', async (req, res) => {
  const { practiceId, trainerId } = ids(req);
  res.json(await getThread(req.params.id, practiceId, trainerId));
}));

router.get('/anakin/threads/:id/messages/:messageId/filter', ...trainer, handle('GET filter', async (req, res) => {
  const { practiceId, trainerId } = ids(req);
  res.json(await getFilter(req.params.id, req.params.messageId, practiceId, trainerId));
}));

// Body {text, scope, clarifyChoice?}; `:id` is a thread id or "new". Streams AnakinEvents.
router.post('/anakin/threads/:id/messages', ...trainer, aiLimiter, handle('POST anakin message', async (req, res) => {
  const { practiceId, trainerId } = ids(req);
  const text = typeof req.body?.text === 'string' ? req.body.text : '';
  if (!text.trim()) return res.status(400).json({ error: 'text is required' });
  const pref = await unitPref(trainerId);
  const send = openStream(res);
  try {
    await ask({
      practiceId, trainerId, threadId: req.params.id === 'new' ? null : req.params.id, text,
      scope: normaliseScope(req.body?.scope), clarifyChoice: typeof req.body?.clarifyChoice === 'string' ? req.body.clarifyChoice : undefined,
      pref, emit: send,
    });
  } catch (err) {
    if (!(err instanceof AnakinError)) console.error('[personal-training] anakin', err);
    send({ type: 'error', message: err instanceof AnakinError ? err.message : 'Something went wrong answering that' });
    send({ type: 'done' });
  }
  res.end();
}));

router.post('/anakin/scheduled', ...trainer, handle('POST scheduled', async (req, res) => {
  const { practiceId, trainerId } = ids(req);
  const text = typeof req.body?.text === 'string' ? req.body.text : '';
  if (!text.trim()) return res.status(400).json({ error: 'text is required' });
  await addScheduled(practiceId, trainerId, text, normaliseScope(req.body?.scope));
  res.status(201).json({ scheduled: await listScheduled(practiceId, trainerId) });
}));

router.patch('/anakin/scheduled/:id', ...trainer, handle('PATCH scheduled', async (req, res) => {
  const { practiceId, trainerId } = ids(req);
  if (typeof req.body?.active !== 'boolean') return res.status(400).json({ error: 'active must be true or false' });
  await setScheduledActive(req.params.id, practiceId, trainerId, req.body.active);
  res.json({ scheduled: await listScheduled(practiceId, trainerId) });
}));

router.delete('/anakin/scheduled/:id', ...trainer, handle('DELETE scheduled', async (req, res) => {
  const { practiceId, trainerId } = ids(req);
  await removeScheduled(req.params.id, practiceId, trainerId);
  res.json({ scheduled: await listScheduled(practiceId, trainerId) });
}));

// ─── Notifications ───────────────────────────────────────────────────────────

router.get('/notifications', ...trainer, handle('GET notifications', async (req, res) => {
  const { practiceId, trainerId } = ids(req);
  // Opening the bell catches up on anything since the last background sweep.
  await sweepNotifications(practiceId, trainerId).catch((err) => console.error('[personal-training] sweep on read', err));
  res.json(await notificationFeed(practiceId, trainerId));
}));

router.patch('/notifications/read', ...trainer, handle('PATCH notifications read', async (req, res) => {
  const { practiceId, trainerId } = ids(req);
  const only = Array.isArray(req.body?.ids) ? req.body.ids.filter((x: unknown) => typeof x === 'string').slice(0, 200) : undefined;
  await markRead(practiceId, trainerId, only);
  res.json(await notificationFeed(practiceId, trainerId));
}));

router.get('/notification-settings', ...trainer, handle('GET settings', async (req, res) => {
  const { practiceId, trainerId } = ids(req);
  const [settings, data, pref] = await Promise.all([loadSettings(practiceId, trainerId), loadPracticeData(practiceId, trainerId), unitPref(trainerId)]);
  res.json(describeSettings(settings, data, pref));
}));

router.put('/notification-settings', ...trainer, handle('PUT settings', async (req, res) => {
  const { practiceId, trainerId } = ids(req);
  const [current, data, pref] = await Promise.all([loadSettings(practiceId, trainerId), loadPracticeData(practiceId, trainerId), unitPref(trainerId)]);
  const next = applyPatch(current, req.body ?? {}, new Set(data.clients.map((c) => c.id)));
  await saveSettings(practiceId, trainerId, next);
  res.json(describeSettings(next, data, pref));
}));

export default router;
