// Drafts and the only path by which the dashboard messages a client.
//
// A draft becomes a real Message through exactly one sequence:
//   pending ──requestSend (a trainer's authenticated request)──▶ sending
//   sending ──deliverDueDrafts, once the undo window has closed──▶ sent
// The one other path is sendAutomated below: check-in prompts and nudges,
// which only run for a schedule a trainer switched on (or a check-in they
// requested). Every Message this feature creates is created in this file,
// and every step writes an audit row (handoff §2.1, §11).

import { chatComplete } from '../chatClient.js';
import { moderateText } from '../moderationService.js';
import { sendPushToUser } from '../notificationService.js';
import { prisma } from './db.js';
import type { Draft } from './types.js';

/** Undo window for a sent message (handoff §12: proposed 5s). */
export const UNDO_SECONDS = Number(process.env.PERSONAL_TRAINING_UNDO_SECONDS ?? 5);
const MAX_DRAFT_LEN = 2000;

export class DraftError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'DraftError';
    this.status = status;
  }
}

interface DraftRow {
  id: string; clientId: string; text: string; sentText: string | null; status: string;
  undoUntil: Date | null; sentAt: Date | null;
}

export function toDraft(row: DraftRow): Draft {
  return {
    id: row.id,
    clientId: row.clientId,
    text: row.sentText ?? row.text,
    channel: 'app',
    status: row.status as Draft['status'],
    ...(row.sentAt ? { sentAt: row.sentAt.toISOString() } : {}),
    ...(row.status === 'sending' && row.undoUntil ? { undoUntil: row.undoUntil.toISOString() } : {}),
  };
}

// ── Wording ──────────────────────────────────────────────────────────────────
// The facts in a draft come from the rules engine. The model is only asked to
// say them the way a coach would; if it is unavailable, slow or strays, the
// plain template is used instead. Either way the trainer edits before sending.

const SYSTEM_PROMPT = [
  'You write short messages a personal trainer sends to one of their clients.',
  'Write in the first person as the trainer, to the client, in plain warm language.',
  'Two or three sentences. No greeting line, no sign-off, no emoji, no exclamation marks, no bullet points.',
  'Use only the facts given. Do not invent numbers, dates, exercises or history, and do not promise a call or a meeting.',
  'Never diagnose or give medical advice; for pain, say to ease off and that you will adjust the plan together.',
  'Reply with the message text only.',
].join(' ');

const llmEnabled = () => process.env.PERSONAL_TRAINING_LLM !== '0' && process.env.NODE_ENV !== 'test' && !process.env.VITEST;

/** One short completion with a deadline; null when the model is off, slow or fails. */
export async function completeRaw(system: string, user: string, maxTokens: number): Promise<string | null> {
  if (!llmEnabled()) return null;
  try {
    const result = await Promise.race([
      chatComplete({ messages: [{ role: 'system', content: system }, { role: 'user', content: user }], max_completion_tokens: maxTokens, temperature: 0 } as any),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 6000)),
    ]);
    return (result as any)?.choices?.[0]?.message?.content?.trim() || null;
  } catch {
    return null;
  }
}

async function complete(user: string, maxTokens: number): Promise<string | null> {
  if (!llmEnabled()) return null;
  try {
    const result = await Promise.race([
      chatComplete({
        messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: user }],
        max_completion_tokens: maxTokens,
        temperature: 0.5,
      } as any),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 9000)),
    ]);
    const text = (result as any)?.choices?.[0]?.message?.content?.trim();
    if (!text || text.length < 20 || text.length > 700) return null;
    // House style is enforced, not requested: no exclamation marks, no emoji.
    return text.replace(/!/g, '.').replace(/\p{Extended_Pictographic}/gu, '').replace(/^["']|["']$/g, '').trim();
  } catch (err) {
    console.warn('[personal-training] draft wording fell back to template:', (err as Error)?.message);
    return null;
  }
}

export interface DraftBrief {
  clientFirstName: string;
  trainerFirstName: string;
  /** What the message is for, e.g. "reply to a message about knee soreness". */
  purpose: string;
  /** The facts the message may use. */
  facts: string[];
  /** The template wording, used as-is when the model is unavailable. */
  fallback: string;
}

export async function writeDraftText(brief: DraftBrief): Promise<string> {
  const prompt = [
    `Client first name: ${brief.clientFirstName}`,
    `Purpose: ${brief.purpose}`,
    'Facts you may use:',
    ...brief.facts.map((f) => `- ${f}`),
  ].join('\n');
  return (await complete(prompt, 200)) ?? brief.fallback;
}

/** The first two sentences — what "Shorter" does when the model is unavailable. */
export function shortenFallback(text: string): string {
  const sentences = text.trim().split(/(?<=[.?])\s+/).filter(Boolean);
  return sentences.length <= 2 ? text.trim() : sentences.slice(0, 2).join(' ');
}

export async function shortenText(text: string): Promise<string> {
  const shorter = await complete(`Purpose: rewrite this message to be shorter, keeping its meaning and every fact.\nMessage:\n${text}`, 140);
  return shorter && shorter.length < text.length ? shorter : shortenFallback(text);
}

// ── Lifecycle ────────────────────────────────────────────────────────────────

export async function createDraft(input: {
  practiceId: string; trainerId: string; clientId: string; kind: string; sourceId?: string; text: string;
}) {
  return prisma.ptDraft.create({ data: input });
}

export async function audit(entry: {
  practiceId: string; trainerId: string; clientId?: string | null; action: string; itemType: string; itemId: string;
  originalText?: string | null; editedText?: string | null; meta?: Record<string, unknown>;
}) {
  const { meta, ...rest } = entry;
  await prisma.ptAuditLog.create({ data: { ...rest, metaJson: meta ? JSON.stringify(meta) : null } });
}

/** Levenshtein distance — "edit distance on drafts is the primary AI-quality signal" (§11). */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let last = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = a[i - 1] === b[j - 1] ? last : 1 + Math.min(last, prev[j], prev[j - 1]);
      last = tmp;
    }
  }
  return prev[b.length];
}

async function loadOwnedDraft(draftId: string, practiceId: string) {
  const draft = await prisma.ptDraft.findUnique({ where: { id: draftId } });
  if (!draft || draft.practiceId !== practiceId) throw new DraftError('Draft not found', 404);
  return draft;
}

/**
 * A trainer asked for this draft to be sent. Opens the undo window; the
 * message itself is created by deliverDueDrafts once the window closes.
 */
export async function requestSend(input: {
  draftId: string; practiceId: string; trainerId: string; editedText?: string; now?: Date;
}): Promise<Draft> {
  const now = input.now ?? new Date();
  const draft = await loadOwnedDraft(input.draftId, input.practiceId);
  if (draft.status !== 'pending') throw new DraftError('This draft has already been sent or discarded', 409);

  const text = (input.editedText ?? draft.text).trim();
  if (!text) throw new DraftError('Message is empty', 400);
  if (text.length > MAX_DRAFT_LEN) throw new DraftError(`Message is too long (max ${MAX_DRAFT_LEN} characters)`, 400);

  // The client must still be an active client of this practice at send time.
  const member = await prisma.institutionMember.findUnique({
    where: { institutionId_userId: { institutionId: input.practiceId, userId: draft.clientId } },
    select: { active: true, role: true },
  });
  if (!member?.active || member.role !== 'athlete') throw new DraftError('This client is no longer on your roster', 409);

  const verdict = await moderateText(text, 'dm', input.trainerId);
  if (!verdict.allowed) throw new DraftError(verdict.message ?? 'This message could not be sent', 400);

  const undoUntil = new Date(now.getTime() + UNDO_SECONDS * 1000);
  const claimed = await prisma.ptDraft.updateMany({
    where: { id: draft.id, status: 'pending' },
    // The sender is whoever tapped Send, which in a shared practice may not be who the draft was written for.
    data: { status: 'sending', sentText: text, undoUntil, trainerId: input.trainerId },
  });
  if (claimed.count !== 1) throw new DraftError('This draft has already been sent or discarded', 409);

  await audit({
    practiceId: input.practiceId, trainerId: input.trainerId, clientId: draft.clientId,
    action: 'sent', itemType: 'draft', itemId: draft.id, originalText: draft.text, editedText: text,
    meta: { kind: draft.kind, editDistance: editDistance(draft.text, text) },
  });

  setTimeout(() => { void deliverDueDrafts().catch(() => {}); }, UNDO_SECONDS * 1000 + 250).unref?.();
  return toDraft({ ...draft, status: 'sending', sentText: text, undoUntil });
}

/** Take a send back while its undo window is open. */
export async function undoSend(input: { draftId: string; practiceId: string; trainerId: string; now?: Date }): Promise<Draft> {
  const now = input.now ?? new Date();
  const draft = await loadOwnedDraft(input.draftId, input.practiceId);
  const reverted = await prisma.ptDraft.updateMany({
    where: { id: draft.id, status: 'sending', undoUntil: { gt: now } },
    data: { status: 'pending', undoUntil: null },
  });
  if (reverted.count !== 1) throw new DraftError('This message has already been delivered', 409);
  await audit({
    practiceId: input.practiceId, trainerId: input.trainerId, clientId: draft.clientId,
    action: 'undone', itemType: 'draft', itemId: draft.id, originalText: draft.text, editedText: draft.sentText,
  });
  return toDraft({ ...draft, status: 'pending', undoUntil: null });
}

export async function discardDraft(input: { draftId: string; practiceId: string; trainerId: string; reason: string }) {
  const draft = await loadOwnedDraft(input.draftId, input.practiceId);
  const done = await prisma.ptDraft.updateMany({ where: { id: draft.id, status: 'pending' }, data: { status: 'discarded' } });
  if (done.count === 1) {
    await audit({
      practiceId: input.practiceId, trainerId: input.trainerId, clientId: draft.clientId,
      action: 'discarded', itemType: 'draft', itemId: draft.id, originalText: draft.text, meta: { reason: input.reason },
    });
  }
}

export async function redraft(input: { draftId: string; practiceId: string; style: 'shorter'; currentText?: string }): Promise<Draft> {
  const draft = await loadOwnedDraft(input.draftId, input.practiceId);
  if (draft.status !== 'pending') throw new DraftError('This draft has already been sent or discarded', 409);
  const text = await shortenText((input.currentText ?? draft.text).slice(0, MAX_DRAFT_LEN));
  const updated = await prisma.ptDraft.update({ where: { id: draft.id }, data: { text } });
  return toDraft(updated);
}

/**
 * Deliver every draft whose undo window has closed. Claiming the row with a
 * conditional update makes this safe to call from the timer, the periodic
 * sweep and a request at the same time: only one caller sends each message.
 */
export async function deliverDueDrafts(now: Date = new Date()): Promise<number> {
  const due = await prisma.ptDraft.findMany({
    where: { status: 'sending', undoUntil: { lte: now } },
    take: 50,
  });
  let delivered = 0;
  for (const draft of due) {
    const claimed = await prisma.ptDraft.updateMany({ where: { id: draft.id, status: 'sending' }, data: { status: 'sent', sentAt: now } });
    if (claimed.count !== 1) continue;
    try {
      const body = draft.sentText ?? draft.text;
      const [a, b] = draft.trainerId < draft.clientId ? [draft.trainerId, draft.clientId] : [draft.clientId, draft.trainerId];
      const conversation = await prisma.directConversation.upsert({
        where: { participantAId_participantBId: { participantAId: a, participantBId: b } },
        update: { updatedAt: now },
        create: { participantAId: a, participantBId: b },
      });
      const message = await prisma.message.create({ data: { conversationId: conversation.id, senderId: draft.trainerId, body } });
      await prisma.ptDraft.update({ where: { id: draft.id }, data: { messageId: message.id } });
      await audit({
        practiceId: draft.practiceId, trainerId: draft.trainerId, clientId: draft.clientId,
        action: 'delivered', itemType: 'draft', itemId: draft.id, editedText: body, meta: { messageId: message.id },
      });
      const sender = await prisma.user.findUnique({ where: { id: draft.trainerId }, select: { name: true } });
      const preview = body.length > 60 ? `${body.slice(0, 57)}…` : body;
      sendPushToUser(draft.clientId, `Message from ${sender?.name ?? 'your trainer'}`, preview, { type: 'message', conversationId: conversation.id }).catch(() => {});
      delivered += 1;
    } catch (err) {
      // Put it back so the next sweep retries rather than losing the message.
      console.error('[personal-training] draft delivery failed', draft.id, err);
      await prisma.ptDraft.updateMany({ where: { id: draft.id, status: 'sent', messageId: null }, data: { status: 'sending', sentAt: null } });
    }
  }
  return delivered;
}

/**
 * A message the system sends on a trainer's standing instruction: a check-in
 * prompt or nudge from a schedule they enabled. Not a draft — there is nothing
 * to edit — but it is audited like one.
 */
export async function sendAutomated(input: {
  practiceId: string; trainerId: string; clientId: string; body: string; action: 'checkin_prompt' | 'checkin_nudge'; itemId: string;
}): Promise<void> {
  const [a, b] = input.trainerId < input.clientId ? [input.trainerId, input.clientId] : [input.clientId, input.trainerId];
  const conversation = await prisma.directConversation.upsert({
    where: { participantAId_participantBId: { participantAId: a, participantBId: b } },
    update: { updatedAt: new Date() },
    create: { participantAId: a, participantBId: b },
  });
  const message = await prisma.message.create({ data: { conversationId: conversation.id, senderId: input.trainerId, body: input.body } });
  await audit({
    practiceId: input.practiceId, trainerId: input.trainerId, clientId: input.clientId,
    action: input.action, itemType: 'checkin', itemId: input.itemId, editedText: input.body, meta: { messageId: message.id, automated: true },
  });
  sendPushToUser(input.clientId, 'Check-in from your trainer', input.body.slice(0, 80), { type: 'message', conversationId: conversation.id }).catch(() => {});
}
