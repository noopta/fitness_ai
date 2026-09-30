// Chat card taps (CHAT_CARDS_RN_SPEC §2, §6, §7). The client names a card
// and an action id; the server looks up what that action means. No LLM runs
// here — Apply, Send, Delete, Undo, inline edits and toggles are
// deterministic and bounded by the user's tap.

import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/requireAuth.js';
import { applyCardAction, undoCard, editCardField, toggleCardField, answerCard, editDraftBody, getCard, CardError } from '../agent/cards/store.js';
import { revertChange, listChanges, UndoError } from '../agent/ops.js';
import '../agent/toolkits/index.js';

const router = Router();
const AGENT_ENABLED = process.env.AGENT_ENABLED === 'true';
const AGENT_ALLOWLIST = (process.env.AGENT_USER_ALLOWLIST || '').split(',').map((s) => s.trim()).filter(Boolean);

router.use(['/coach/agent/cards', '/coach/agent/changes'], (req, res, next) => {
  if (!AGENT_ENABLED) return res.status(404).json({ error: 'Not found' });
  next();
});
function access(req: any, res: any, next: any) {
  if (AGENT_ALLOWLIST.length && !AGENT_ALLOWLIST.includes(req.user?.id)) return res.status(404).json({ error: 'Not found' });
  next();
}
function fail(res: any, err: any, what: string) {
  if (err instanceof CardError) return res.status(err.status).json({ error: err.message });
  if (err instanceof UndoError) return res.status(409).json({ error: err.message });
  if (err?.name === 'ZodError') return res.status(400).json({ error: 'Invalid request', details: err.errors });
  console.error(`[cards] ${what} failed:`, err?.message ?? err);
  return res.status(400).json({ error: err?.message ?? `Couldn’t ${what}` });
}

const actionSchema = z.object({ actionId: z.string().min(1).max(40), typed: z.string().max(40).optional(), choice: z.number().int().min(0).max(10).optional() });

// Batch fetch (history hydrate): ?ids=a,b,c — only the caller's own cards.
router.get('/coach/agent/cards', requireAuth, access, async (req, res) => {
  try {
    const ids = String(req.query.ids ?? '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 60);
    const out = [];
    for (const id of ids) { try { out.push(await getCard(req.user!.id, id)); } catch { /* gone or not theirs */ } }
    res.json({ cards: out });
  } catch (e) { fail(res, e, 'load cards'); }
});

router.get('/coach/agent/cards/:id', requireAuth, access, async (req, res) => {
  try { res.json({ card: await getCard(req.user!.id, req.params.id) }); } catch (e) { fail(res, e, 'load the card'); }
});

// Apply / Keep / Send / Delete / any action on the card.
router.post('/coach/agent/cards/:id/action', requireAuth, access, async (req, res) => {
  try {
    const b = actionSchema.parse(req.body);
    res.json({ card: await applyCardAction(req.user!.id, req.params.id, b.actionId, b) });
  } catch (e) { fail(res, e, 'do that'); }
});
// Design's name for the primary action on a proposal.
router.post('/coach/agent/cards/:id/apply', requireAuth, access, async (req, res) => {
  try {
    const b = z.object({ choice: z.number().int().min(0).max(10).optional() }).parse(req.body ?? {});
    res.json({ card: await applyCardAction(req.user!.id, req.params.id, 'apply', b) });
  } catch (e) { fail(res, e, 'apply that'); }
});

router.post('/coach/agent/cards/:id/undo', requireAuth, access, async (req, res) => {
  try { res.json({ card: await undoCard(req.user!.id, req.params.id) }); } catch (e) { fail(res, e, 'undo that'); }
});

router.post('/coach/agent/cards/:id/edit', requireAuth, access, async (req, res) => {
  try {
    const b = z.object({ field: z.string().min(1).max(60), value: z.union([z.string().max(200), z.number()]) }).parse(req.body);
    res.json({ card: await editCardField(req.user!.id, req.params.id, b.field, b.value) });
  } catch (e) { fail(res, e, 'save that'); }
});

router.post('/coach/agent/cards/:id/toggle', requireAuth, access, async (req, res) => {
  try {
    const b = z.object({ field: z.string().min(1).max(60), on: z.boolean() }).parse(req.body);
    res.json({ card: await toggleCardField(req.user!.id, req.params.id, b.field, b.on) });
  } catch (e) { fail(res, e, 'change that'); }
});

// Draft "Edit": the rewritten message replaces the card body and what Send sends.
router.post('/coach/agent/cards/:id/draft', requireAuth, access, async (req, res) => {
  try {
    const b = z.object({ body: z.string().min(1).max(2000) }).parse(req.body);
    res.json({ card: await editDraftBody(req.user!.id, req.params.id, b.body) });
  } catch (e) { fail(res, e, 'update the draft'); }
});

// Ask / Flow answers. Returns `sendAsMessage` when the answer should go back
// into the conversation (the client then streams it as the next user turn).
router.post('/coach/agent/cards/:id/answer', requireAuth, access, async (req, res) => {
  try {
    const b = z.object({ option: z.number().int().min(0).max(10).optional(), text: z.string().max(1000).optional() }).parse(req.body);
    res.json(await answerCard(req.user!.id, req.params.id, b));
  } catch (e) { fail(res, e, 'answer that'); }
});

router.get('/coach/agent/changes', requireAuth, access, async (req, res) => {
  try { res.json({ changes: await listChanges(req.user!.id, Number(req.query.limit ?? 20)) }); } catch (e) { fail(res, e, 'load your changes'); }
});

// Revert from the change log (design §2). Respects the undo window unless
// `fromChat` — the chat path ("undo that") reverses past the window.
router.post('/coach/agent/changes/:id/revert', requireAuth, access, async (req, res) => {
  try { res.json(await revertChange(req.user!.id, req.params.id)); } catch (e) { fail(res, e, 'undo that'); }
});

export default router;
