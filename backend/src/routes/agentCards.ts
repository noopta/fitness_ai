// Chat card taps (CHAT_CARDS_RN_SPEC §2, §6, §7). The client names a card
// and an action id; the server looks up what that action means. No LLM runs
// here — Apply, Send, Delete, Undo, inline edits and toggles are
// deterministic and bounded by the user's tap.

import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/requireAuth.js';
import { getCardProgram, applyCardAction, undoCard, editCardField, toggleCardField, answerCard, editDraftBody, getCard, saveCard, CardError } from '../agent/cards/store.js';
import { revertChange, listChanges, UndoError, executeOp, withWriteGuard } from '../agent/ops.js';
import { appendInitiated } from '../agent/conversation.js';
import { cardRef } from '../agent/cardNotes.js';
import '../agent/toolkits/index.js';
import { runNativeTool, NativeToolError } from '../agent/nativeTools.js';
import { applyFlag, keepFlag, undoFlag, applyAll, expandDigest, ReviewError } from '../services/logReview/index.js';
import { openAwayDigest, markAwayOpened } from '../services/awayDigest.js';
import { logReviewAvailableFor, awayDigestAvailableFor } from '../services/featureFlags.js';

const router = Router();
const AGENT_ENABLED = process.env.AGENT_ENABLED === 'true';
const AGENT_ALLOWLIST = (process.env.AGENT_USER_ALLOWLIST || '').split(',').map((s) => s.trim()).filter(Boolean);

router.use(['/coach/agent/cards', '/coach/agent/changes', '/coach/agent/log-review', '/coach/agent/away'], (req, res, next) => {
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
  if (err instanceof ReviewError) return res.status(err.status).json({ error: err.message });
  if (err?.name === 'ZodError') return res.status(400).json({ error: 'Invalid request', details: err.errors });
  console.error(`[cards] ${what} failed:`, err?.message ?? err);
  return res.status(400).json({ error: err?.message ?? `Couldn’t ${what}` });
}

// `selection` is a batch card's ticks and dates (past workouts); the store
// validates it against the sessions the card already holds.
const selectionSchema = z.object({
  skip: z.array(z.number().int().min(0).max(500)).max(500).optional(),
  dates: z.record(z.string().regex(/^\d{1,3}$/), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).optional(),
}).optional();
const actionSchema = z.object({ actionId: z.string().min(1).max(40), typed: z.string().max(40).optional(), choice: z.number().int().min(0).max(10).optional(), selection: selectionSchema });

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

// The program a new-program proposal would start (v2 T-07: review before saving).
router.get('/coach/agent/cards/:id/program', requireAuth, access, async (req, res) => {
  try {
    const r = await getCardProgram(req.user!.id, req.params.id);
    if (!r.program) return res.status(404).json({ error: 'That card has no program.' });
    res.json(r);
  } catch (e) { fail(res, e, 'load the program'); }
});

// A meal logged outside chat — Fuel's food search opened from a chat "Log
// food" (bug fixes 5 Oct, 4b) — lands in the thread as a Logged card that owns
// its Undo, exactly like a capture's.
const loggedSchema = z.object({ mealIds: z.array(z.string().min(1).max(64)).min(1).max(10) });
router.post('/coach/agent/cards/logged', requireAuth, access, async (req, res) => {
  try {
    const { mealIds } = loggedSchema.parse(req.body);
    const userId = req.user!.id;
    const change = await withWriteGuard('allow', 'logged:search', () => executeOp(userId, 'capture.meal_logged', { value: mealIds.join(',') }));
    const draft = (change.result as any)?.nextCard;
    if (!draft) return res.status(400).json({ error: 'Nothing was logged.' });
    const card = await saveCard(userId, draft, { change });
    await appendInitiated(userId, '', [cardRef(card)]);
    res.json({ card });
  } catch (e) { fail(res, e, 'add that to chat'); }
});

// Fuel → Nutrition plan with none yet: the gut and nutrition questions go
// straight into the thread at the next unanswered one — no model turn, so
// nothing can claim a card is "already on your screen" (20 Oct 2026).
router.post('/coach/agent/cards/nutrition-questions', requireAuth, access, async (req, res) => {
  try {
    const userId = req.user!.id;
    const { result, cards } = await runNativeTool(userId, 'start_nutrition_assessment', {}, { allowSet: true });
    const r: any = result;
    await appendInitiated(userId, r?.resumed ? `Picking up where you left off — ${r.answered} of ${r.of} done.` : 'Thirteen quick ones — they build your nutrition plan, and it lands on Fuel when you finish.', cards.map(cardRef));
    res.json({ card: cards[0] ?? null });
  } catch (e: any) {
    if (e instanceof NativeToolError) return res.status(e.status).json({ error: e.message });
    fail(res, e, 'start the questions');
  }
});

// A native v2 screen asks for a proposal (Swap, Life happened, freestyle pick,
// exercise swap). Only the tools in agent/nativeTools.ts; nothing changes
// until the returned card's Apply is tapped.
const runSchema = z.object({ tool: z.string().min(1).max(60), input: z.record(z.unknown()).default({}) });
router.post('/coach/agent/cards/run', requireAuth, access, async (req, res) => {
  try {
    const { tool, input } = runSchema.parse(req.body);
    res.json(await runNativeTool(req.user!.id, tool, input));
  } catch (e: any) {
    if (e instanceof NativeToolError) return res.status(e.status).json({ error: e.message });
    fail(res, e, 'build that');
  }
});

// Opening chat raises what we detected (notices.ts) and pending progression
// suggestions that chat hasn't shown in the last two days.
router.post('/coach/agent/adaptation/surface', requireAuth, access, async (req, res) => {
  try {
    // Things we detected first (each once), then pending suggestions.
    const [{ surfacePendingAdaptations }, { postPendingNotices }] = await Promise.all([import('../agent/adaptationSurface.js'), import('../agent/notices.js')]);
    const notices = await postPendingNotices(req.user!.id).catch(() => 0);
    res.json({ posted: notices + await surfacePendingAdaptations(req.user!.id, { force: notices > 0 }) });
  } catch (e) { fail(res, e, 'raise suggestions'); }
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
    const b = z.object({ choice: z.number().int().min(0).max(10).optional(), selection: selectionSchema }).parse(req.body ?? {});
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

// ─── Log review (design "Log review 1a") ─────────────────────────────────────
// Each tap returns the re-rendered digest card. Nothing changes without one.
// Behind LOG_REVIEW_ENABLED / LOG_REVIEW_USERS: 404 for everyone else.
router.use('/coach/agent/log-review', requireAuth, (req, res, next) => {
  if (!logReviewAvailableFor(req.user!.id, req.user!.email)) return res.status(404).json({ error: 'Not found' });
  next();
});
router.post('/coach/agent/log-review/flags/:id/apply', requireAuth, access, async (req, res) => {
  try { res.json({ card: await applyFlag(req.user!.id, req.params.id) }); } catch (e) { fail(res, e, 'apply that fix'); }
});
router.post('/coach/agent/log-review/flags/:id/keep', requireAuth, access, async (req, res) => {
  try { res.json({ card: await keepFlag(req.user!.id, req.params.id) }); } catch (e) { fail(res, e, 'keep that entry'); }
});
router.post('/coach/agent/log-review/flags/:id/undo', requireAuth, access, async (req, res) => {
  try { res.json({ card: await undoFlag(req.user!.id, req.params.id) }); } catch (e) { fail(res, e, 'undo that'); }
});
router.post('/coach/agent/log-review/:digestId/apply-all', requireAuth, access, async (req, res) => {
  try { res.json({ card: await applyAll(req.user!.id, req.params.digestId) }); } catch (e) { fail(res, e, 'apply the fixes'); }
});
router.post('/coach/agent/log-review/:digestId/expand', requireAuth, access, async (req, res) => {
  try { res.json({ card: await expandDigest(req.user!.id, req.params.digestId) }); } catch (e) { fail(res, e, 'show the rest'); }
});

// ─── While you were away (design 3b) ─────────────────────────────────────────
// Called when chat opens: posts one card per absence (≥ AWAY_HOURS) with ≥ 1 unseen update.
router.post('/coach/agent/away', requireAuth, access, async (req, res) => {
  try {
    // Behind AWAY_DIGEST_ENABLED / AWAY_DIGEST_USERS: off = nothing posted (the app keeps its divider).
    if (!awayDigestAvailableFor(req.user!.id, req.user!.email)) return res.json({ posted: false, card: null });
    const lastOpenAt = typeof req.body?.lastOpenAt === 'string' ? req.body.lastOpenAt : null;
    const card = await openAwayDigest(req.user!.id, lastOpenAt);
    res.json({ posted: !!card, card });
  } catch (e) { fail(res, e, 'load what you missed'); }
});
router.post('/coach/agent/away/:cardId/items/:itemId/open', requireAuth, access, async (req, res) => {
  try { res.json({ card: await markAwayOpened(req.user!.id, req.params.cardId, decodeURIComponent(req.params.itemId)) }); } catch (e: any) { if (e?.status === 404) return res.status(404).json({ error: e.message }); fail(res, e, 'open that'); }
});

export default router;
