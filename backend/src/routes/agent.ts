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
import { checkAgentRateLimit } from '../middleware/checkAgentRateLimit.js';
import { runAgentTurn, streamAgentTurn, type AgentStreamEvent } from '../agent/loop.js';
import { readMemory } from '../agent/memory.js';
import { loadConversation, appendTurn, clearConversation } from '../agent/conversation.js';
import { evaluateProactiveTrigger, type ProactiveTrigger } from '../agent/proactive.js';
import { runAgentTask, AGENT_TASKS, type AgentTaskId } from '../agent/tasks.js';
import { applyProgramUpdate } from '../agent/applyTools.js';
import type Anthropic from '@anthropic-ai/sdk';

const PROACTIVE_TRIGGERS: ProactiveTrigger[] = [
  'nightly_review', 'streak_at_risk', 'post_workout', 'wellness_flag', 'nutrition_gap',
];

const router = Router();

const AGENT_ENABLED = process.env.AGENT_ENABLED === 'true';

// Optional allowlist for staged rollout: when AGENT_USER_ALLOWLIST is set
// (comma-separated user IDs), ONLY those users get the agent even with the
// flag on — everyone else 404s and stays on the existing coach. This is how
// you dogfood in production for just your own account before going wider.
// Empty allowlist = available to all (once AGENT_ENABLED is on).
const AGENT_ALLOWLIST = (process.env.AGENT_USER_ALLOWLIST || '')
  .split(',').map((s) => s.trim()).filter(Boolean);

// Master flag guard — pre-auth, no user needed. 404s the whole surface when
// the agent is off (default + production until cutover).
router.use('/coach/agent', (req, res, next) => {
  if (!AGENT_ENABLED) return res.status(404).json({ error: 'Not found' });
  next();
});

// Per-user allowlist guard — runs AFTER requireAuth (needs req.user). Applied
// on each route below. 404s (not 403) so the surface stays invisible to
// non-allowlisted users rather than advertising a gated feature.
function requireAgentAccess(req: any, res: any, next: any) {
  if (AGENT_ALLOWLIST.length && !AGENT_ALLOWLIST.includes(req.user?.id)) {
    return res.status(404).json({ error: 'Not found' });
  }
  next();
}

const turnSchema = z.object({
  message: z.string().min(1).max(4000),
  // History is server-managed by default (Phase 2). Pass resetConversation
  // to start a fresh thread (e.g. a "new chat" button).
  resetConversation: z.boolean().optional(),
});

// POST /api/coach/agent — one agent turn. Conversation history is loaded +
// persisted server-side so multi-turn continuity works without the client
// tracking it.
router.post('/coach/agent', requireAuth, requireAgentAccess, checkAgentRateLimit, async (req, res) => {
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

// GET /api/coach/agent/status — tells the client whether the agent is
// available for THIS user (flag on + allowlisted), so UI like the "Apply to
// my plan" button only shows when it'll actually work. Auth-only (no
// allowlist guard — it answers "are you allowed?").
router.get('/coach/agent/status', requireAuth, (req, res) => {
  const available = AGENT_ALLOWLIST.length === 0 || AGENT_ALLOWLIST.includes(req.user!.id);
  res.json({ available });
});

// GET /api/coach/agent/history — the agent's own conversation transcript,
// shaped like /coach/messages so the chat UI can render it interchangeably.
// Clients try this first and fall back to /coach/messages on 404 (user not on
// the agent), keeping history consistent with whichever coach answered.
router.get('/coach/agent/history', requireAuth, requireAgentAccess, async (req, res) => {
  try {
    const turns = await loadConversation(req.user!.id);
    const messages = turns.map((t) => ({
      role: t.role,
      content: typeof t.content === 'string' ? t.content : '',
    }));
    res.json({ messages, hasThread: messages.length > 0, source: 'agent' });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? 'Failed to load history' });
  }
});

// GET /api/coach/agent/memory — inspect what the agent remembers (debug + an
// eventual "what Anakin knows about you" UI surface).
router.get('/coach/agent/memory', requireAuth, requireAgentAccess, async (req, res) => {
  try {
    const notes = await readMemory(req.user!.id);
    res.json({ notes });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? 'Failed to read memory' });
  }
});

// POST /api/coach/agent/stream — Server-Sent Events. Mirrors the existing
// /coach/chat/stream UX (token stream) so the web client doesn't sit on a
// 5-20s blank wait. Emits: status (thinking/tool), delta (text tokens), done.
router.post('/coach/agent/stream', requireAuth, requireAgentAccess, checkAgentRateLimit, async (req, res) => {
  let parsed;
  try {
    parsed = turnSchema.parse(req.body);
  } catch (err: any) {
    return res.status(400).json({ error: 'Invalid request', details: err?.errors });
  }
  const userId = req.user!.id;

  // SSE headers. Flush immediately so the client connection opens.
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // disable nginx proxy buffering
  res.flushHeaders?.();

  const send = (e: AgentStreamEvent) => {
    res.write(`data: ${JSON.stringify(e)}\n\n`);
  };

  try {
    if (parsed.resetConversation) await clearConversation(userId);
    const history = await loadConversation(userId);
    const result = await streamAgentTurn(userId, parsed.message, send, history);
    await appendTurn(userId, parsed.message, result.reply);
  } catch (err: any) {
    console.error('[agent] stream failed:', err?.message ?? err);
    send({ type: 'error', error: err?.message ?? 'Agent error' });
  } finally {
    res.write('event: end\ndata: {}\n\n');
    res.end();
  }
});

const taskSchema = z.object({ input: z.string().max(4000).optional() });

// POST /api/coach/agent/task/:taskId — run a purpose-built agent task
// (program_adjustment, life_happened, plateau, meal_suggestions, daily_tips,
// weekly_review, injury_intake, research_apply). Each is the same agent loop
// with a task-specific framing. `input` required for tasks that need it.
router.post('/coach/agent/task/:taskId', requireAuth, requireAgentAccess, checkAgentRateLimit, async (req, res) => {
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

const confirmProposalSchema = z.object({
  updatedProgram: z.unknown(),
});

// POST /api/coach/agent/confirm-proposal — second half of the
// propose-then-apply "Apply to my plan" flow. The client previously got a
// proposal back from /coach/agent/task/apply_suggestion (via the
// propose_program_update tool), showed it as a diff, and the user tapped
// Confirm. This endpoint persists that exact proposal — no LLM call, just
// the same goal-preserving validation + write path the agent would have
// used directly. Cheap, deterministic, and bounded by the user's tap.
router.post('/coach/agent/confirm-proposal', requireAuth, requireAgentAccess, async (req, res) => {
  try {
    const { updatedProgram } = confirmProposalSchema.parse(req.body);
    if (!updatedProgram || typeof updatedProgram !== 'object') {
      return res.status(400).json({ error: 'updatedProgram must be the proposed program object.' });
    }
    const result = await applyProgramUpdate(req.user!.id, updatedProgram);
    res.json(result);
  } catch (err: any) {
    if (err?.name === 'ZodError') {
      return res.status(400).json({ error: 'Invalid request', details: err.errors });
    }
    console.error('[agent] confirm-proposal failed:', err?.message ?? err);
    res.status(400).json({ error: err?.message ?? 'Could not apply proposal' });
  }
});

// POST /api/coach/agent/proactive/:trigger — DECISION-ONLY. Runs the agent's
// proactive evaluation for the current user and returns what it would do.
// Never sends a notification (that's the sweep + AGENT_PROACTIVE_ENABLED).
// Exists so you can eyeball the agent's judgement before trusting delivery.
router.post('/coach/agent/proactive/:trigger', requireAuth, requireAgentAccess, async (req, res) => {
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
