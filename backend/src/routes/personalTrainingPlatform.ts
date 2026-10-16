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

const router = Router();
const trainer: RequestHandler[] = [requireAuth, requirePersonalTraining, requireTrainer];

type Handler = (req: Request, res: Response) => Promise<unknown>;
const KNOWN = [ContraindicationError, LinkError, PracticeError, RecordError];

export const handle = (name: string, fn: Handler): RequestHandler => async (req, res) => {
  try {
    await fn(req, res);
  } catch (err: any) {
    if (KNOWN.some((E) => err instanceof E)) {
      if (!res.headersSent) res.status(err.status).json({ error: err.message, ...(err.code ? { code: err.code } : {}) });
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

export default router;
