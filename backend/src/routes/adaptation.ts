// Adaptive progression — proposals the user reviews and decides on.
//
//   GET  /api/adaptation/pending          pending proposals (retrofit first)
//   GET  /api/adaptation/history          recent decided proposals
//   POST /api/adaptation/bootstrap        idempotent existing-user retrofit
//   POST /api/adaptation/:id/decide       { action: apply|decline|snooze, edits?, snoozeDays? }
//   POST /api/adaptation/:id/undo
//
// Nothing here calls an LLM. Every write is bounded by an explicit user tap.

import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/requireAuth.js';
import {
  adaptationEnabledFor, bootstrap, decide, listPending, listRecent, undo,
} from '../adaptation/proposalService.js';

const router = Router();

router.get('/adaptation/pending', requireAuth, async (req, res) => {
  try {
    if (!adaptationEnabledFor(req.user!.id)) return res.json({ enabled: false, proposals: [] });
    const proposals = await listPending(req.user!.id);
    res.json({ enabled: true, proposals });
  } catch (err: any) {
    console.error('[adaptation] pending failed:', err?.message ?? err);
    res.status(500).json({ error: 'Failed to load proposals' });
  }
});

router.get('/adaptation/history', requireAuth, async (req, res) => {
  try {
    const proposals = await listRecent(req.user!.id);
    res.json({ proposals });
  } catch (err: any) {
    console.error('[adaptation] history failed:', err?.message ?? err);
    res.status(500).json({ error: 'Failed to load history' });
  }
});

router.post('/adaptation/bootstrap', requireAuth, async (req, res) => {
  try {
    if (!adaptationEnabledFor(req.user!.id)) return res.json({ enabled: false, cohort: 'disabled' });
    const result = await bootstrap(req.user!.id);
    res.json({ enabled: true, ...result });
  } catch (err: any) {
    console.error('[adaptation] bootstrap failed:', err?.message ?? err);
    res.status(500).json({ error: 'Failed to bootstrap' });
  }
});

const decideSchema = z.object({
  action: z.enum(['apply', 'decline', 'snooze']),
  edits: z.array(z.object({ key: z.string().min(1), targetWeightKg: z.number().nonnegative().nullable() })).max(60).optional(),
  snoozeDays: z.number().int().min(1).max(60).optional(),
});

router.post('/adaptation/:id/decide', requireAuth, async (req, res) => {
  const parsed = decideSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid request', details: parsed.error.issues });
  try {
    const result = await decide(req.user!.id, req.params.id, parsed.data.action, {
      edits: parsed.data.edits, snoozeDays: parsed.data.snoozeDays,
    });
    res.json({ success: true, ...result });
  } catch (err: any) {
    const msg = err?.message ?? 'Could not apply';
    const code = /not found/i.test(msg) ? 404 : /already/i.test(msg) ? 409 : 400;
    res.status(code).json({ error: msg });
  }
});

router.post('/adaptation/:id/undo', requireAuth, async (req, res) => {
  try {
    const result = await undo(req.user!.id, req.params.id);
    res.json({ success: true, ...result });
  } catch (err: any) {
    const msg = err?.message ?? 'Could not undo';
    res.status(/not found/i.test(msg) ? 404 : 400).json({ error: msg });
  }
});

export default router;
