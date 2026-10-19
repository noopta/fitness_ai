// Wearables: connections, the phone's Apple Health sync, recovery, and the
// simulator. Google Health (Fitbit) OAuth lives in wearablesGoogle.ts.

import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { requireAuth } from '../middleware/requireAuth.js';
import { wearablesAvailableFor, wearablesSimulatorFor } from '../services/featureFlags.js';
import { syncSchema, PROVIDERS, type Provider } from '../services/wearables/types.js';
import { ingest, disconnect } from '../services/wearables/ingest.js';
import { recoveryFor, watchDays } from '../services/wearables/recovery.js';
import { runSimulation, SCENARIOS, SCENARIO_LABEL } from '../services/wearables/simulator.js';
import { todayForTz } from '../services/localDate.js';

const router = Router();
const prisma = new PrismaClient();

/** 404 unless wearables are on for this user — the client hides the feature on the same predicate (/auth/me). */
function gate(req: any, res: any, next: any) {
  if (!wearablesAvailableFor(req.user!.id, req.user!.email)) return res.status(404).json({ error: 'Not found' });
  next();
}

// GET /api/wearables/status — what's connected and how much data there is.
router.get('/wearables/status', requireAuth, gate, async (req, res) => {
  const userId = req.user!.id;
  const [connections, latest, count] = await Promise.all([
    prisma.wearableConnection.findMany({ where: { userId }, select: { provider: true, status: true, lastSyncAt: true, lastError: true } }),
    prisma.wearableDay.findFirst({ where: { userId }, orderBy: { date: 'desc' }, select: { date: true } }),
    prisma.wearableDay.count({ where: { userId } }),
  ]);
  res.json({ connections, latestDay: latest?.date ?? null, days: count, simulator: wearablesSimulatorFor(userId, req.user!.email) });
});

// POST /api/wearables/apple/sync — the phone's batch from Apple Health
// (daily summaries + workouts since its last anchor).
router.post('/wearables/apple/sync', requireAuth, gate, async (req, res) => {
  const parsed = syncSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'That sync batch is malformed.' });
  const result = await ingest(req.user!.id, 'apple_health', parsed.data);
  res.json(result);
});

// POST /api/wearables/:provider/disconnect { deleteData? }
router.post('/wearables/:provider/disconnect', requireAuth, gate, async (req, res) => {
  const provider = req.params.provider as Provider;
  if (!PROVIDERS.includes(provider)) return res.status(404).json({ error: 'Unknown source.' });
  const deleteData = z.object({ deleteData: z.boolean().optional() }).parse(req.body ?? {}).deleteData === true;
  res.json(await disconnect(req.user!.id, provider, deleteData));
});

// GET /api/wearables/recovery?date=YYYY-MM-DD
router.get('/wearables/recovery', requireAuth, gate, async (req, res) => {
  const date = typeof req.query.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date) ? req.query.date : undefined;
  res.json(await recoveryFor(req.user!.id, date));
});

// GET /api/wearables/days?days=14
router.get('/wearables/days', requireAuth, gate, async (req, res) => {
  const n = Math.min(90, Math.max(1, Number(req.query.days) || 14));
  res.json({ days: await watchDays(req.user!.id, n) });
});

// POST /api/wearables/simulate { scenario, days } — testers only.
router.post('/wearables/simulate', requireAuth, gate, async (req, res) => {
  if (!wearablesSimulatorFor(req.user!.id, req.user!.email)) return res.status(404).json({ error: 'Not found' });
  const body = z.object({ scenario: z.enum(SCENARIOS).default('normal'), days: z.number().int().min(7).max(120).default(60), hrvMethod: z.enum(['sdnn', 'rmssd']).optional() }).safeParse(req.body ?? {});
  if (!body.success) return res.status(400).json({ error: `Scenario must be one of: ${SCENARIOS.join(', ')}.` });
  const u = await prisma.user.findUnique({ where: { id: req.user!.id }, select: { timezone: true } });
  const out = await runSimulation(req.user!.id, { ...body.data, endDate: todayForTz(u?.timezone) });
  res.json({ ...out, label: SCENARIO_LABEL[body.data.scenario] });
});

export default router;
