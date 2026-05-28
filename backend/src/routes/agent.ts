// Agentic Anakin endpoint (agentic-main branch, Phase 1).
//
// Feature-flagged behind AGENT_ENABLED. When the flag is off (default, and
// the case in production), every route here 404s as if it doesn't exist —
// so merging this to main is inert until the flag is deliberately turned on.
// This is the parallel-run pattern the repo already uses for
// USE_ENGINE_FOR_RATIO_ANALYSIS.

import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/requireAuth.js';
import { runAgentTurn } from '../agent/loop.js';
import { readMemory } from '../agent/memory.js';
import type Anthropic from '@anthropic-ai/sdk';

const router = Router();

const AGENT_ENABLED = process.env.AGENT_ENABLED === 'true';

// Guard middleware — if the flag is off, behave as if these routes don't
// exist. Keeps the surface invisible in production until cutover.
router.use('/coach/agent', (req, res, next) => {
  if (!AGENT_ENABLED) return res.status(404).json({ error: 'Not found' });
  next();
});

const turnSchema = z.object({
  message: z.string().min(1).max(4000),
  // Optional prior turns, client-supplied, in Anthropic message format. For
  // v1 the client can keep it simple and omit this (stateless single-turn);
  // Phase 2 wires real server-side conversation persistence.
  history: z
    .array(z.object({ role: z.enum(['user', 'assistant']), content: z.any() }))
    .optional(),
});

// POST /api/coach/agent — one agent turn.
router.post('/coach/agent', requireAuth, async (req, res) => {
  try {
    const { message, history } = turnSchema.parse(req.body);
    const userId = req.user!.id;
    const result = await runAgentTurn(
      userId,
      message,
      (history as Anthropic.MessageParam[]) ?? [],
    );
    res.json(result);
  } catch (err: any) {
    if (err?.name === 'ZodError') {
      return res.status(400).json({ error: 'Invalid request', details: err.errors });
    }
    console.error('[agent] turn failed:', err?.message ?? err);
    res.status(500).json({ error: err?.message ?? 'Agent error' });
  }
});

// GET /api/coach/agent/memory — inspect what the agent remembers (debug + an
// eventual "what Anakin knows about you" UI surface).
router.get('/coach/agent/memory', requireAuth, async (req, res) => {
  try {
    const notes = await readMemory(req.user!.id);
    res.json({ notes });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? 'Failed to read memory' });
  }
});

export default router;
