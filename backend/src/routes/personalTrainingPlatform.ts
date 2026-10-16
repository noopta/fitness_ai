// Personal-training API, part three: the coach-platform foundation (Oct 2026
// handoff). Practice profile and branding, link clients and their portal
// links, client tags / pause / archive, and the structured dossier —
// contraindications (with the rules engine), goals, measurements, photos.
// Mounted by personalTraining.ts; every route here is a trainer route.

import { Router, type Request, type RequestHandler, type Response } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { socialWriteLimiter } from '../middleware/rateLimiter.js';
import { requirePersonalTraining, requireTrainer } from '../middleware/requireTrainer.js';
import { normalizePreference } from '../services/weightUnits.js';
import { BODY_PARTS, BODY_PART_LABELS, BODY_PART_RULES, PATTERNS } from '../services/personalTraining/contraindicationRules.js';
import {
  ContraindicationError, archiveContraindication, contraindicationsFor, createContraindication, updateContraindication, validateForClient,
} from '../services/personalTraining/contraindications.js';
import { prisma } from '../services/personalTraining/db.js';
import { LinkError, convertProspectToLinkClient, createLinkClient, currentLink, issueLink, revokeLinks } from '../services/personalTraining/links.js';
import { PracticeError, getPracticeProfile, saveLogo, savePracticeProfile } from '../services/personalTraining/practice.js';
import { listTags, patchClient } from '../services/personalTraining/profiles.js';
import {
  RecordError, addMeasurement, addPhoto, createGoal, deleteMeasurement, deletePhoto, listGoals, listMeasurements, listPhotos, updateGoal,
} from '../services/personalTraining/records.js';
import { PROSPECT_PREFIX, loadClients } from '../services/personalTraining/roster.js';
import { IntakeError, getIntake, resetIntake } from '../services/personalTraining/intake.js';
import { InboxError, draftReply, listThreads, openThread } from '../services/personalTraining/inbox.js';
import { NutritionError, nutritionSummary, setTargets } from '../services/personalTraining/nutrition.js';
import { exportCsv, practiceExport, type CsvTable } from '../services/personalTraining/exportData.js';
import { EQUIPMENT, LibraryError, archiveExercise, createExercise, libraryFor, searchLibrary, updateExercise } from '../services/personalTraining/exerciseLibrary.js';
import {
  ProgramError, acknowledge, archiveProgram, copyProgram, createProgram, listPrograms, loadOwned, publishProgram, toProgram, updateProgram,
} from '../services/personalTraining/programs.js';
import { generateProgram } from '../services/personalTraining/programAi.js';
import { aiLimiter } from '../middleware/rateLimiter.js';

const router = Router();
const trainer: RequestHandler[] = [requireAuth, requirePersonalTraining, requireTrainer];

type Handler = (req: Request, res: Response) => Promise<unknown>;
const KNOWN = [ContraindicationError, LinkError, PracticeError, RecordError, IntakeError, InboxError, NutritionError, LibraryError, ProgramError];

export const handle = (name: string, fn: Handler): RequestHandler => async (req, res) => {
  try {
    await fn(req, res);
  } catch (err: any) {
    if (KNOWN.some((E) => err instanceof E)) {
      if (!res.headersSent) res.status(err.status).json({ error: err.message, ...(err.code ? { code: err.code } : {}), ...(err.check ? { check: err.check } : {}) });
      return;
    }
    console.error(`[personal-training] ${name}`, err);
    if (!res.headersSent) res.status(500).json({ error: 'Internal server error' });
  }
};

const pref = async (userId: string) =>
  normalizePreference((await prisma.user.findUnique({ where: { id: userId }, select: { unitPreference: true } }))?.unitPreference);

/** The client, or a 404. Loading by id is the membership check; archived clients still open. */
async function clientOf(req: Request) {
  const [client] = await loadClients(req.practice!.id, { ids: [req.params.id], includeProspects: true, includeArchived: true });
  if (!client) throw new RecordError('Client not found', 404);
  return client;
}

// ─── Practice profile and branding ───────────────────────────────────────────

router.get('/practice/profile', ...trainer, handle('GET practice profile', async (req, res) => {
  res.json({ profile: await getPracticeProfile(req.practice!.id) });
}));

router.put('/practice/profile', ...trainer, socialWriteLimiter, handle('PUT practice profile', async (req, res) => {
  res.json({ profile: await savePracticeProfile(req.practice!.id, req.body ?? {}) });
}));

router.post('/practice/logo', ...trainer, socialWriteLimiter, handle('POST practice logo', async (req, res) => {
  res.json({ profile: await saveLogo(req.practice!.id, req.body?.imageBase64) });
}));

router.get('/tags', ...trainer, handle('GET tags', async (req, res) => {
  res.json({ tags: await listTags(req.practice!.id) });
}));

// ─── Adding a no-install client ──────────────────────────────────────────────

// POST /personal-training/clients {name, email?, phone?, tags?} → a link client and their portal link
router.post('/clients', ...trainer, socialWriteLimiter, handle('POST client', async (req, res) => {
  const { clientId, link } = await createLinkClient(req.practice!.id, req.user!.id, req.body ?? {});
  const [client] = await loadClients(req.practice!.id, { ids: [clientId] });
  res.status(201).json({ client, link });
}));

router.patch('/clients/:id', ...trainer, socialWriteLimiter, handle('PATCH client', async (req, res) => {
  const client = await clientOf(req);
  if (client.id.startsWith(PROSPECT_PREFIX)) throw new LinkError('Give this client a link or invite them before editing their record here', 409);
  await patchClient(req.practice!.id, req.user!.id, client.id, req.body ?? {});
  const [updated] = await loadClients(req.practice!.id, { ids: [client.id], includeArchived: true });
  res.json({ client: updated });
}));

// ─── Portal links ────────────────────────────────────────────────────────────

router.get('/clients/:id/link', ...trainer, handle('GET link', async (req, res) => {
  const client = await clientOf(req);
  res.json({ link: client.id.startsWith(PROSPECT_PREFIX) ? null : await currentLink(req.practice!.id, client.id) });
}));

// Issues a link (revoking any earlier one). For a "Not joined" client this turns them into a link client.
router.post('/clients/:id/link', ...trainer, socialWriteLimiter, handle('POST link', async (req, res) => {
  const client = await clientOf(req);
  if (client.state === 'archived') throw new LinkError('Restore this client before giving them a link', 409);
  if (client.id.startsWith(PROSPECT_PREFIX)) {
    const { clientId, link } = await convertProspectToLinkClient(req.practice!.id, req.user!.id, client.id.slice(PROSPECT_PREFIX.length));
    const [converted] = await loadClients(req.practice!.id, { ids: [clientId] });
    return res.status(201).json({ link, client: converted });
  }
  res.status(201).json({ link: await issueLink(req.practice!.id, client.id, req.user!.id) });
}));

router.delete('/clients/:id/link', ...trainer, handle('DELETE link', async (req, res) => {
  const client = await clientOf(req);
  await revokeLinks(req.practice!.id, client.id, req.user!.id);
  res.json({ ok: true });
}));

// ─── Contraindications and the rules engine ──────────────────────────────────

// The vocabulary the editor offers, and what each body part refuses by default.
router.get('/contraindications/meta', ...trainer, handle('GET contraindication meta', async (_req, res) => {
  res.json({
    bodyParts: BODY_PARTS.map((key) => ({ key, label: BODY_PART_LABELS[key], primary: BODY_PART_RULES[key].primary, secondary: BODY_PART_RULES[key].secondary })),
    patterns: PATTERNS,
  });
}));

router.get('/clients/:id/contraindications', ...trainer, handle('GET contraindications', async (req, res) => {
  const client = await clientOf(req);
  res.json({ contraindications: await contraindicationsFor(req.practice!.id, client.id) });
}));

router.post('/clients/:id/contraindications', ...trainer, socialWriteLimiter, handle('POST contraindication', async (req, res) => {
  const client = await clientOf(req);
  res.status(201).json({ contraindication: await createContraindication(req.practice!.id, req.user!.id, client.id, req.body ?? {}) });
}));

router.patch('/clients/:id/contraindications/:cid', ...trainer, socialWriteLimiter, handle('PATCH contraindication', async (req, res) => {
  const client = await clientOf(req);
  res.json({ contraindication: await updateContraindication(req.practice!.id, req.user!.id, client.id, req.params.cid, req.body ?? {}) });
}));

router.delete('/clients/:id/contraindications/:cid', ...trainer, handle('DELETE contraindication', async (req, res) => {
  const client = await clientOf(req);
  await archiveContraindication(req.practice!.id, req.user!.id, client.id, req.params.cid);
  res.json({ ok: true });
}));

// POST /clients/:id/guardrails/check {exercises: string[]} — what the rules engine says, without saving anything.
router.post('/clients/:id/guardrails/check', ...trainer, handle('POST guardrail check', async (req, res) => {
  const client = await clientOf(req);
  const exercises = Array.isArray(req.body?.exercises) ? req.body.exercises.filter((x: unknown) => typeof x === 'string').slice(0, 300) : [];
  res.json({ report: await validateForClient(req.practice!.id, client.id, exercises) });
}));

// ─── Goals ───────────────────────────────────────────────────────────────────

router.get('/clients/:id/goals', ...trainer, handle('GET goals', async (req, res) => {
  const client = await clientOf(req);
  res.json({ goals: await listGoals(req.practice!.id, client.id, await pref(req.user!.id)) });
}));

router.post('/clients/:id/goals', ...trainer, socialWriteLimiter, handle('POST goal', async (req, res) => {
  const client = await clientOf(req);
  res.status(201).json({ goal: await createGoal(req.practice!.id, req.user!.id, client.id, req.body ?? {}, await pref(req.user!.id)) });
}));

router.patch('/clients/:id/goals/:gid', ...trainer, socialWriteLimiter, handle('PATCH goal', async (req, res) => {
  const client = await clientOf(req);
  res.json({ goal: await updateGoal(req.practice!.id, req.user!.id, client.id, req.params.gid, req.body ?? {}, await pref(req.user!.id)) });
}));

// ─── Measurements ────────────────────────────────────────────────────────────

router.get('/clients/:id/measurements', ...trainer, handle('GET measurements', async (req, res) => {
  const client = await clientOf(req);
  res.json({ measurements: await listMeasurements(req.practice!.id, client.id, await pref(req.user!.id)) });
}));

router.post('/clients/:id/measurements', ...trainer, socialWriteLimiter, handle('POST measurement', async (req, res) => {
  const client = await clientOf(req);
  await addMeasurement({ practiceId: req.practice!.id, clientId: client.id, actorId: req.user!.id, source: 'trainer', ...(req.body ?? {}) });
  res.status(201).json({ measurements: await listMeasurements(req.practice!.id, client.id, await pref(req.user!.id)) });
}));

router.delete('/clients/:id/measurements/:mid', ...trainer, handle('DELETE measurement', async (req, res) => {
  const client = await clientOf(req);
  await deleteMeasurement(req.practice!.id, req.user!.id, client.id, req.params.mid);
  res.json({ ok: true });
}));

// ─── Progress photos ─────────────────────────────────────────────────────────

router.get('/clients/:id/photos', ...trainer, handle('GET photos', async (req, res) => {
  const client = await clientOf(req);
  res.json({ photos: await listPhotos(req.practice!.id, client.id) });
}));

router.post('/clients/:id/photos', ...trainer, socialWriteLimiter, handle('POST photo', async (req, res) => {
  const client = await clientOf(req);
  await addPhoto({ practiceId: req.practice!.id, clientId: client.id, actorId: req.user!.id, source: 'trainer', ...(req.body ?? {}) });
  res.status(201).json({ photos: await listPhotos(req.practice!.id, client.id) });
}));

router.delete('/clients/:id/photos/:pid', ...trainer, handle('DELETE photo', async (req, res) => {
  const client = await clientOf(req);
  await deletePhoto(req.practice!.id, req.user!.id, client.id, req.params.pid, 'trainer');
  res.json({ ok: true });
}));

// ─── Intake ──────────────────────────────────────────────────────────────────

router.get('/clients/:id/intake', ...trainer, handle('GET intake', async (req, res) => {
  const client = await clientOf(req);
  res.json({ intake: await getIntake(req.practice!.id, client.id, { forTrainer: true }) });
}));

router.delete('/clients/:id/intake', ...trainer, handle('DELETE intake', async (req, res) => {
  const client = await clientOf(req);
  await resetIntake(req.practice!.id, req.user!.id, client.id);
  res.json({ intake: await getIntake(req.practice!.id, client.id, { forTrainer: true }) });
}));

// ─── Nutrition ───────────────────────────────────────────────────────────────

router.get('/clients/:id/nutrition', ...trainer, handle('GET nutrition', async (req, res) => {
  const client = await clientOf(req);
  res.json({ nutrition: await nutritionSummary(req.practice!.id, client.id) });
}));

router.put('/clients/:id/nutrition-targets', ...trainer, socialWriteLimiter, handle('PUT nutrition targets', async (req, res) => {
  const client = await clientOf(req);
  await setTargets(req.practice!.id, req.user!.id, client.id, req.body ?? {});
  res.json({ nutrition: await nutritionSummary(req.practice!.id, client.id) });
}));

// ─── Messaging inbox ─────────────────────────────────────────────────────────

router.get('/inbox', ...trainer, handle('GET inbox', async (req, res) => {
  res.json({ threads: await listThreads(req.practice!.id, req.user!.id) });
}));

router.get('/inbox/:clientId', ...trainer, handle('GET inbox thread', async (req, res) => {
  res.json(await openThread(req.practice!.id, req.user!.id, req.params.clientId));
}));

// A drafted reply to the client's latest message. Sent only through POST /drafts/:id/send.
router.post('/inbox/:clientId/draft', ...trainer, socialWriteLimiter, handle('POST inbox draft', async (req, res) => {
  res.status(201).json({ draft: await draftReply(req.practice!.id, req.user!.id, req.params.clientId) });
}));

// ─── Exercise library ────────────────────────────────────────────────────────

router.get('/exercises', ...trainer, handle('GET exercises', async (req, res) => {
  const all = await libraryFor(req.practice!.id);
  const q = { text: typeof req.query.q === 'string' ? req.query.q : undefined, pattern: typeof req.query.pattern === 'string' ? req.query.pattern : undefined, equipment: typeof req.query.equipment === 'string' ? req.query.equipment : undefined };
  res.json({ exercises: searchLibrary(all, q).slice(0, 400), equipment: EQUIPMENT });
}));

router.post('/exercises', ...trainer, socialWriteLimiter, handle('POST exercise', async (req, res) => {
  res.status(201).json({ exercise: await createExercise(req.practice!.id, req.user!.id, req.body ?? {}) });
}));

router.patch('/exercises/:eid', ...trainer, socialWriteLimiter, handle('PATCH exercise', async (req, res) => {
  res.json({ exercise: await updateExercise(req.practice!.id, req.user!.id, req.params.eid, req.body ?? {}) });
}));

router.delete('/exercises/:eid', ...trainer, handle('DELETE exercise', async (req, res) => {
  await archiveExercise(req.practice!.id, req.user!.id, req.params.eid);
  res.json({ ok: true });
}));

// ─── Programs ────────────────────────────────────────────────────────────────

router.get('/programs', ...trainer, handle('GET programs', async (req, res) => {
  const clientId = typeof req.query.clientId === 'string' ? req.query.clientId : undefined;
  res.json({ programs: await listPrograms(req.practice!.id, { clientId, templates: req.query.templates === '1' }) });
}));

router.post('/programs', ...trainer, socialWriteLimiter, handle('POST program', async (req, res) => {
  res.status(201).json({ program: await createProgram(req.practice!.id, req.user!.id, req.body ?? {}) });
}));

// The model drafts; the rules engine checks; the result is a draft on the canvas.
router.post('/programs/generate', ...trainer, aiLimiter, handle('POST program generate', async (req, res) => {
  const clientId = typeof req.body?.clientId === 'string' ? req.body.clientId : '';
  if (!clientId) return res.status(400).json({ error: 'clientId is required' });
  res.status(201).json({ program: await generateProgram(req.practice!.id, req.user!.id, clientId, req.body) });
}));

router.get('/programs/:pid', ...trainer, handle('GET program', async (req, res) => {
  res.json({ program: await toProgram(await loadOwned(req.practice!.id, req.params.pid)) });
}));

router.put('/programs/:pid', ...trainer, socialWriteLimiter, handle('PUT program', async (req, res) => {
  res.json({ program: await updateProgram(req.practice!.id, req.user!.id, req.params.pid, req.body ?? {}) });
}));

router.post('/programs/:pid/acknowledge', ...trainer, socialWriteLimiter, handle('POST acknowledge', async (req, res) => {
  res.json({ program: await acknowledge(req.practice!.id, req.user!.id, req.params.pid, req.body?.keys) });
}));

router.post('/programs/:pid/publish', ...trainer, socialWriteLimiter, handle('POST publish', async (req, res) => {
  res.json({ program: await publishProgram(req.practice!.id, req.user!.id, req.params.pid) });
}));

router.post('/programs/:pid/copy', ...trainer, socialWriteLimiter, handle('POST copy', async (req, res) => {
  res.status(201).json({ programs: await copyProgram(req.practice!.id, req.user!.id, req.params.pid, req.body ?? {}) });
}));

router.delete('/programs/:pid', ...trainer, handle('DELETE program', async (req, res) => {
  await archiveProgram(req.practice!.id, req.user!.id, req.params.pid);
  res.json({ ok: true });
}));

// ─── Export ──────────────────────────────────────────────────────────────────

// GET /export — everything about the practice's clients as one JSON document.
router.get('/export', ...trainer, handle('GET export', async (req, res) => {
  const data = await practiceExport(req.practice!.id);
  await prisma.ptAuditLog.create({ data: { practiceId: req.practice!.id, trainerId: req.user!.id, action: 'exported', itemType: 'practice', itemId: req.practice!.id, metaJson: JSON.stringify({ format: 'json', clients: data.clients.length }) } });
  res.setHeader('Content-Disposition', `attachment; filename="axiom-${req.practice!.slug}-${new Date().toISOString().slice(0, 10)}.json"`);
  res.json(data);
}));

// GET /export/clients.csv | workouts.csv | measurements.csv | contraindications.csv
router.get('/export/:table.csv', ...trainer, handle('GET export csv', async (req, res) => {
  const table = req.params.table as CsvTable;
  if (!['clients', 'workouts', 'measurements', 'contraindications'].includes(table)) return res.status(404).json({ error: 'Unknown table' });
  const data = await practiceExport(req.practice!.id);
  await prisma.ptAuditLog.create({ data: { practiceId: req.practice!.id, trainerId: req.user!.id, action: 'exported', itemType: 'practice', itemId: req.practice!.id, metaJson: JSON.stringify({ format: 'csv', table }) } });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="axiom-${table}-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send(exportCsv(data, table));
}));

export default router;
