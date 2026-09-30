// Card persistence and the tap handlers. Every card the thread shows is a
// row here; its pendingJson says what each action id does. The client only
// ever names an action id — it can't supply an operation or its arguments.

import { PrismaClient } from '@prisma/client';
import type { Card, CardDraft, CardState, PendingActions, PendingOp } from './types.js';
import { executeOp, revertChange, withWriteGuard, UndoError, UNDO_LOG_MS } from '../ops.js';
import { clockTime } from './format.js';

const prisma = new PrismaClient();

type Stored = { card: Card; pending: PendingActions & { entity?: string; undoLine?: string } };

export class CardError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

function strip(draft: CardDraft): { card: Omit<Card, 'id'>; pending: PendingActions & { entity?: string; undoLine?: string } } {
  const { pending, entity, undoLine, ...card } = draft;
  return { card, pending: { ...(pending ?? {}), ...(entity ? { entity } : {}), ...(undoLine ? { undoLine } : {}) } };
}

/**
 * Persist a card and give it its id. A card that already made a change
 * (Logged / Setting) gets an Undo action and its undo window. A card with an
 * `entity` replaces any earlier live card for the same thing.
 */
export async function saveCard(userId: string, draft: CardDraft, opts: { change?: { changeId: string; undoUntil: string | null; reversible: boolean } } = {}): Promise<Card> {
  const { card, pending } = strip(draft);
  if (opts.change) {
    pending.changeId = opts.change.changeId;
    card.state = { status: 'live', changeId: opts.change.changeId, ...(opts.change.undoUntil ? { undoUntil: opts.change.undoUntil } : {}) };
    if (opts.change.reversible && !(card.actions ?? []).some((a) => a.kind === 'undo')) {
      card.actions = [...(card.actions ?? []), { id: 'undo', label: 'Undo', kind: 'undo' }];
    }
  }
  card.state = card.state ?? { status: 'live' };

  if (pending.entity) {
    const earlier = await prisma.agentCard.findMany({ where: { userId, status: 'live' }, orderBy: { createdAt: 'desc' }, take: 40 });
    for (const row of earlier) {
      try {
        const p = row.pendingJson ? JSON.parse(row.pendingJson) : {};
        if (p.entity !== pending.entity) continue;
        const c = JSON.parse(row.payloadJson) as Card;
        c.state = { ...(c.state ?? { status: 'live' }), status: 'replaced', line: 'Replaced by a newer card ↓' };
        await prisma.agentCard.update({ where: { id: row.id }, data: { status: 'replaced', payloadJson: JSON.stringify(c) } });
      } catch { /* a malformed old row never blocks a new card */ }
    }
  }

  const row = await prisma.agentCard.create({
    data: {
      userId,
      fn: card.fn,
      pattern: card.pattern,
      rule: card.rule,
      payloadJson: '{}',
      pendingJson: JSON.stringify(pending),
      status: card.state.status,
      changeId: pending.changeId ?? null,
    },
  });
  const full: Card = { id: row.id, ...card };
  await prisma.agentCard.update({ where: { id: row.id }, data: { payloadJson: JSON.stringify(full) } });
  // The change was made before the card existed; link it for the change log.
  if (pending.changeId) await prisma.agentChange.update({ where: { id: pending.changeId }, data: { cardId: row.id } }).catch(() => {});
  return full;
}

async function load(userId: string, cardId: string): Promise<Stored & { row: { id: string; status: string } }> {
  const row = await prisma.agentCard.findFirst({ where: { id: cardId, userId } });
  if (!row) throw new CardError('That card is no longer available.', 404);
  return { row, card: JSON.parse(row.payloadJson) as Card, pending: row.pendingJson ? JSON.parse(row.pendingJson) : {} };
}

async function persist(cardId: string, card: Card, pending?: PendingActions) {
  await prisma.agentCard.update({
    where: { id: cardId },
    data: { payloadJson: JSON.stringify(card), status: card.state?.status ?? 'live', changeId: card.state?.changeId ?? null, ...(pending ? { pendingJson: JSON.stringify(pending) } : {}) },
  });
}

export async function getCard(userId: string, cardId: string): Promise<Card> {
  return (await load(userId, cardId)).card;
}

const DONE_LINE: Record<string, string> = { applied: 'Applied', sent: 'Sent', posted: 'Posted', deleted: 'Deleted', kept: 'Kept', cancelled: 'Cancelled' };

/** Run the action a user tapped. Returns the updated card. */
export async function applyCardAction(userId: string, cardId: string, actionId: string, body: { typed?: string; choice?: number } = {}): Promise<Card> {
  const { card, pending } = await load(userId, cardId);
  const tz = await userTz(userId);

  if (actionId === 'undo') return undoCard(userId, cardId);

  if (card.state?.status && card.state.status !== 'live') throw new CardError('This card has already been acted on.', 409);
  const action = (card.actions ?? []).find((a) => a.id === actionId);
  const spec = pending.actions?.[actionId];
  if (!action || !spec) throw new CardError('Unknown action.', 400);
  if (action.requiresTyped && (body.typed ?? '').trim() !== action.requiresTyped) {
    throw new CardError(`Type ${action.requiresTyped} to confirm.`, 400);
  }

  if ('kind' in spec) {
    const status = spec.kind === 'keep' ? 'kept' : spec.kind === 'cancel' ? 'cancelled' : 'kept';
    card.state = { status, line: spec.line ?? DONE_LINE[status], at: new Date().toISOString() };
    await persist(cardId, card);
    return card;
  }

  const op = spec as PendingOp;
  const args = { ...op.args };
  if (pending.choice && typeof body.choice === 'number') {
    const v = pending.choice.values[body.choice];
    if (v !== undefined) args[pending.choice.argKey] = v;
  }
  const status = op.status ?? 'applied';
  const undoMs = status === 'deleted' ? 30_000 : UNDO_LOG_MS;
  const change = await withWriteGuard('allow', `card:${card.fn}`, () => executeOp(userId, op.op, args, { cardId, undoMs }));
  const when = clockTime(new Date(), tz);
  card.state = {
    status,
    line: op.line ?? `${DONE_LINE[status] ?? 'Done'} ${when}`,
    at: new Date().toISOString(),
    changeId: change.changeId,
    ...(change.reversible && change.undoUntil ? { undoUntil: change.undoUntil } : {}),
  };
  await persist(cardId, card, { ...pending, changeId: change.changeId });
  return card;
}

/** Undo whatever this card changed. */
export async function undoCard(userId: string, cardId: string): Promise<Card> {
  const { card, pending } = await load(userId, cardId);
  const changeId = card.state?.changeId ?? pending.changeId;
  if (!changeId) throw new CardError('Nothing to undo on this card.', 400);
  try {
    await revertChange(userId, changeId);
  } catch (e: any) {
    if (e instanceof UndoError) throw new CardError(e.message, 409);
    throw e;
  }
  card.state = { status: 'undone', line: pending.undoLine ?? 'Undone', at: new Date().toISOString() };
  await persist(cardId, card);
  return card;
}

/** Inline edit of a dotted value (§7.3). */
export async function editCardField(userId: string, cardId: string, field: string, raw: unknown): Promise<Card> {
  const { card, pending } = await load(userId, cardId);
  const spec = pending.edits?.[field];
  if (!spec) throw new CardError('That value can’t be edited here.', 400);
  if ('stage' in spec) {
    if (card.state?.status && card.state.status !== 'live') throw new CardError('This card has already been acted on.', 409);
    const n = Number(String(raw).replace(/[^0-9.\-]/g, ''));
    if (!Number.isFinite(n) || n <= 0) throw new CardError('Enter a number.', 400);
    const act = pending.actions?.[spec.stage.action] as PendingOp | undefined;
    if (!act || !('op' in act)) throw new CardError('Nothing to adjust.', 400);
    const kg = spec.stage.unit === 'imperial' ? n * 0.45359237 : n;
    const edits = Array.isArray(act.args.edits) ? (act.args.edits as any[]).filter((e) => e.key !== spec.stage.key) : [];
    act.args.edits = [...edits, { key: spec.stage.key, targetWeightKg: Math.round(kg * 100) / 100 }];
    const unitWord = spec.stage.unit === 'metric' ? 'kg' : 'lb';
    for (const r of card.rows ?? []) if (r.editable?.field === field) { r.was = r.was ?? r.value; r.value = `${n} ${unitWord}`; }
    await persist(cardId, card, pending);
    return card;
  }
  const value = parseValue(raw, spec.parse);
  const change = await withWriteGuard('allow', `edit:${card.fn}`, () => executeOp(userId, spec.op, { ...spec.args, [spec.valueKey]: value }, { cardId }));
  const display = (change.result as any)?.display ?? String(raw);
  const rows = card.rows ?? [];
  let from = '';
  for (const r of rows) if (r.editable?.field === field) { from = r.value ?? ''; r.was = r.value; r.value = display; }
  card.rows = rows;
  card.state = { status: card.state?.status === 'undone' ? 'live' : (card.state?.status ?? 'live'), line: `Corrected — ${from} → ${display}`, at: new Date().toISOString(), changeId: change.changeId, ...(change.undoUntil ? { undoUntil: change.undoUntil } : {}) };
  await persist(cardId, card, { ...pending, changeId: change.changeId });
  return card;
}

/** Toggle row (Setting cards with switches). */
export async function toggleCardField(userId: string, cardId: string, field: string, on: boolean): Promise<Card> {
  const { card, pending } = await load(userId, cardId);
  const spec = pending.toggles?.[field];
  if (!spec) throw new CardError('That switch isn’t available here.', 400);
  const change = await withWriteGuard('allow', `toggle:${card.fn}`, () => executeOp(userId, spec.op, { ...spec.args, [spec.valueKey]: !!on }, { cardId }));
  for (const r of card.rows ?? []) if (r.toggle?.field === field) r.toggle.on = !!on;
  card.state = { status: 'live', line: change.summary, at: new Date().toISOString(), changeId: change.changeId, ...(change.undoUntil ? { undoUntil: change.undoUntil } : {}) };
  await persist(cardId, card, { ...pending, changeId: change.changeId });
  return card;
}

/**
 * Answer an Ask / Flow card. Either runs its op (a check-in, a flow step) or
 * returns the text the client should send into the conversation so Anakin
 * continues with the answer in context.
 */
const DRAFT_BODY_KEYS = ['body', 'text', 'caption', 'note', 'comment', 'message'];

/**
 * Draft "Edit" (spec §7.6): the user rewrote the message. The card body and
 * the send op's own argument change together, so Send sends what the card
 * shows. Nothing leaves until Send.
 */
export async function editDraftBody(userId: string, cardId: string, body: string): Promise<Card> {
  const { card, pending } = await load(userId, cardId);
  if (card.pattern !== 'draft' || !card.draft) throw new CardError('Only a draft can be rewritten.', 400);
  if (card.state?.status && card.state.status !== 'live') throw new CardError('This draft was already sent or cancelled.', 409);
  const text = body.trim();
  if (!text) throw new CardError('The message can’t be empty.', 400);
  let updated = false;
  for (const a of Object.values(pending.actions ?? {})) {
    if (!('op' in a) || !a.op) continue;
    const key = DRAFT_BODY_KEYS.find((k) => typeof a.args?.[k] === 'string' || (k === 'note' && 'note' in (a.args ?? {})));
    if (key) { a.args = { ...a.args, [key]: text }; updated = true; }
  }
  if (!updated) throw new CardError('This draft’s text can’t be changed here — ask Anakin to rewrite it.', 400);
  card.draft = { ...card.draft, body: text };
  await persist(cardId, card, pending);
  return card;
}

export async function answerCard(userId: string, cardId: string, answer: { option?: number; text?: string }): Promise<{ card: Card; sendAsMessage?: string; next?: Card | null }> {
  const { card, pending } = await load(userId, cardId);
  if (card.state?.status && !['live'].includes(card.state.status)) throw new CardError('This question has already been answered.', 409);
  const options = card.ask?.options ?? card.options ?? [];
  const chosen = typeof answer.option === 'number' ? options[answer.option] : undefined;
  const value = (chosen ?? answer.text ?? '').toString().trim();
  if (!value) throw new CardError('Pick an option or type an answer.', 400);

  let changeId: string | undefined;
  let next: Card | null = null;
  let line = value;
  if (pending.answer?.op) {
    const change = await withWriteGuard('allow', `answer:${card.fn}`, () =>
      executeOp(userId, pending.answer!.op!, { ...(pending.answer!.args ?? {}), [pending.answer!.valueKey ?? 'value']: value, optionIndex: answer.option ?? null }, { cardId }));
    const result = (change.result ?? {}) as { nextCard?: CardDraft; nextOwnsChange?: boolean; line?: string };
    // A capture's answer is ids, not words: the op names the line, and the
    // card it hands back (the Logged card) carries the Undo instead.
    if (result.line) line = result.line;
    if (result.nextCard) next = await saveCard(userId, result.nextCard, result.nextOwnsChange ? { change } : {});
    if (!result.nextOwnsChange) changeId = change.changeId;
  }
  card.state = { status: 'answered', line, at: new Date().toISOString(), ...(changeId ? { changeId } : {}) };
  await persist(cardId, card);
  const q = card.ask?.q ?? card.meta?.label ?? 'your question';
  const sendAsMessage = pending.answer?.op && !pending.answer.asMessage ? undefined : (pending.answer?.asMessage ?? `${value}`).replace('{answer}', value).replace('{q}', q);
  return { card, sendAsMessage, next };
}

function parseValue(raw: unknown, kind?: string): unknown {
  if (kind === 'number') {
    const n = Number(String(raw).replace(/[^0-9.\-]/g, ''));
    if (!Number.isFinite(n)) throw new CardError('Enter a number.', 400);
    return n;
  }
  if (kind === 'weightReps') {
    const m = String(raw).match(/([\d.]+)\s*[x×]\s*(\d+)/i);
    if (!m) throw new CardError('Enter it as weight × reps, e.g. 185 × 5.', 400);
    return { weight: Number(m[1]), reps: Number(m[2]) };
  }
  return String(raw ?? '').trim();
}

const tzCache = new Map<string, { tz: string; at: number }>();
export async function userTz(userId: string): Promise<string> {
  const hit = tzCache.get(userId);
  if (hit && Date.now() - hit.at < 5 * 60_000) return hit.tz;
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { timezone: true } }).catch(() => null);
  const tz = u?.timezone || 'America/New_York';
  tzCache.set(userId, { tz, at: Date.now() });
  return tz;
}
export function forgetTz(userId: string) { tzCache.delete(userId); }

export async function recentCards(userId: string, limit = 30): Promise<Card[]> {
  const rows = await prisma.agentCard.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: limit });
  return rows.map((r) => JSON.parse(r.payloadJson) as Card);
}

export type { CardState };
