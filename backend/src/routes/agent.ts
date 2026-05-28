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
import { loadConversation, appendTurn, clearConversation } from '../agent/conversation.js';
import { evaluateProactiveTrigger, type ProactiveTrigger } from '../agent/proactive.js';
import { runAgentTask, AGENT_TASKS, type AgentTaskId } from '../agent/tasks.js';
import type Anthropic from '@anthropic-ai/sdk';

const PROACTIVE_TRIGGERS: ProactiveTrigger[] = [
  'nightly_review', 'streak_at_risk', 'post_workout', 'wellness_flag', 'nutrition_gap',
];

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
  // History is server-managed by default (Phase 2). Pass resetConversation
  // to start a fresh thread (e.g. a "new chat" button).
  resetConversation: z.boolean().optional(),
});

// POST /api/coach/agent — one agent turn. Conversation history is loaded +
// persisted server-side so multi-turn continuity works without the client
// tracking it.
router.post('/coach/agent', requireAuth, async (req, res) => {
  try {
    const { message, resetConversation } = turnSchema.parse(req.body);
    const userId = req.user!.id;

    if (resetConversation) await clearConversation(userId);
    const history: Anthropic.MessageParam[] = await loadConversation(userId);

    const result = await runAgentTurn(userId, message, history);

    // Persist the text transcript for next turn's continuity.
    await appendTurn(userId, message, result.reply);

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

const taskSchema = z.object({ input: z.string().max(4000).optional() });

// POST /api/coach/agent/task/:taskId — run a purpose-built agent task
// (program_adjustment, life_happened, plateau, meal_suggestions, daily_tips,
// weekly_review, injury_intake, research_apply). Each is the same agent loop
// with a task-specific framing. `input` required for tasks that need it.
router.post('/coach/agent/task/:taskId', requireAuth, async (req, res) => {
  try {
    const taskId = req.params.taskId as AgentTaskId;
    if (!(taskId in AGENT_TASKS)) {
      return res.status(400).json({ error: `Unknown task. One of: ${Object.keys(AGENT_TASKS).join(', ')}` });
    }
    const { input } = taskSchema.parse(req.body ?? {});
    const result = await runAgentTask(req.user!.id, taskId, input);
    res.json(result);
  } catch (err: any) {
    if (err?.name === 'ZodError') {
      return res.status(400).json({ error: 'Invalid request', details: err.errors });
    }
    console.error('[agent] task failed:', err?.message ?? err);
    res.status(500).json({ error: err?.message ?? 'Agent task error' });
  }
});

// POST /api/coach/agent/proactive/:trigger — DECISION-ONLY. Runs the agent's
// proactive evaluation for the current user and returns what it would do.
// Never sends a notification (that's the sweep + AGENT_PROACTIVE_ENABLED).
// Exists so you can eyeball the agent's judgement before trusting delivery.
router.post('/coach/agent/proactive/:trigger', requireAuth, async (req, res) => {
  try {
    const trigger = req.params.trigger as ProactiveTrigger;
    if (!PROACTIVE_TRIGGERS.includes(trigger)) {
      return res.status(400).json({ error: `Unknown trigger. One of: ${PROACTIVE_TRIGGERS.join(', ')}` });
    }
    const decision = await evaluateProactiveTrigger(req.user!.id, trigger);
    res.json({ ...decision, note: 'decision-only — nothing was sent' });
  } catch (err: any) {
    console.error('[agent] proactive eval failed:', err?.message ?? err);
    res.status(500).json({ error: err?.message ?? 'Proactive eval error' });
  }
});

export default router;
