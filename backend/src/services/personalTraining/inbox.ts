// One inbox for every client thread (handoff gap A9), with the client's
// context beside the conversation so a reply never needs a second tab. An
// AI-drafted reply is a PtDraft like every other: the trainer edits and sends
// it through the same undo-window pipeline, or it goes nowhere.

import { prisma } from './db.js';
import { createDraft, toDraft, writeDraftText } from './drafts.js';
import { LIFT_LABEL } from './lifts.js';
import { nutritionSummary } from './nutrition.js';
import { PROSPECT_PREFIX, loadClients } from './roster.js';
import type { Client, Draft, InboxContext, InboxConversation, InboxThread } from './types.js';

export class InboxError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'InboxError';
    this.status = status;
  }
}

const pair = (x: string, y: string) => (x < y ? [x, y] : [y, x]);
const ref = (c: Client) => ({ id: c.id, name: c.name, initials: c.initials, status: c.status, channel: c.channel });

export async function listThreads(practiceId: string, trainerId: string): Promise<InboxThread[]> {
  const clients = (await loadClients(practiceId)).filter((c) => !c.id.startsWith(PROSPECT_PREFIX));
  if (clients.length === 0) return [];
  const ids = clients.map((c) => c.id);
  const convos = await prisma.directConversation.findMany({
    where: { OR: [{ participantAId: trainerId, participantBId: { in: ids } }, { participantBId: trainerId, participantAId: { in: ids } }] },
    select: { id: true, participantAId: true, participantBId: true },
  });
  const clientOf = new Map(convos.map((c) => [c.id, c.participantAId === trainerId ? c.participantBId : c.participantAId]));
  const convoIds = convos.map((c) => c.id);
  const [latest, unread] = convoIds.length
    ? await Promise.all([
        // Newest message per thread: one query, sorted, first wins.
        prisma.message.findMany({ where: { conversationId: { in: convoIds } }, orderBy: { createdAt: 'desc' }, take: 2000, select: { conversationId: true, body: true, createdAt: true, senderId: true } }),
        prisma.message.groupBy({ by: ['conversationId'], where: { conversationId: { in: convoIds }, senderId: { not: trainerId }, readAt: null }, _count: { _all: true } }),
      ])
    : [[], []];
  const last = new Map<string, (typeof latest)[number]>();
  for (const m of latest) if (!last.has(m.conversationId)) last.set(m.conversationId, m);
  const unreadBy = new Map(unread.map((u) => [u.conversationId, u._count._all]));
  const byClient = new Map(clients.map((c) => [c.id, c]));

  const threads: InboxThread[] = [];
  for (const [convoId, clientId] of clientOf) {
    const c = byClient.get(clientId);
    if (!c) continue;
    const m = last.get(convoId);
    threads.push({
      clientId,
      client: ref(c),
      lastMessage: m ? { body: m.body, at: m.createdAt.toISOString(), fromClient: m.senderId === clientId } : null,
      unread: unreadBy.get(convoId) ?? 0,
      awaitingReply: !!m && m.senderId === clientId,
    });
  }
  // Waiting on the trainer first, then most recent.
  return threads
    .filter((t) => t.lastMessage)
    .sort((a, b) => Number(b.awaitingReply) - Number(a.awaitingReply) || (b.lastMessage!.at > a.lastMessage!.at ? 1 : -1));
}

async function contextFor(practiceId: string, c: Client, now: Date): Promise<InboxContext> {
  const [nextDue, goals, nutrition] = await Promise.all([
    prisma.ptCheckIn.findFirst({ where: { practiceId, clientId: c.id, status: 'due' }, orderBy: { dueAt: 'asc' }, select: { dueAt: true } }),
    prisma.ptGoal.findMany({ where: { practiceId, clientId: c.id, status: 'active' }, select: { label: true, target: true, metric: true } }),
    nutritionSummary(practiceId, c.id, now).catch(() => null),
  ]);
  return {
    status: c.status,
    ...(c.statusReason ? { statusReason: c.statusReason } : {}),
    block: c.program,
    ...(c.lastSessionAt ? { lastSessionAt: c.lastSessionAt } : {}),
    ...(nextDue ? { nextCheckInDue: nextDue.dueAt.toISOString() } : {}),
    contraindications: c.contraindications.filter((x) => x.active).map((x) => x.label),
    goals: goals.map((g) => (g.metric.startsWith('e1rm:') ? `${LIFT_LABEL[g.metric.slice(5) as keyof typeof LIFT_LABEL] ?? g.label}` : g.label)),
    ...(nutrition && nutrition.week.daysLogged > 0 ? { nutrition: nutrition.line } : {}),
  };
}

async function clientOrThrow(practiceId: string, clientId: string) {
  if (clientId.startsWith(PROSPECT_PREFIX)) throw new InboxError(`This client is not on Axiom yet`, 409);
  const [c] = await loadClients(practiceId, { ids: [clientId], includeArchived: true });
  if (!c) throw new InboxError('Client not found', 404);
  return c;
}

/** One thread with its context strip. Opening it marks the client's messages read. */
export async function openThread(practiceId: string, trainerId: string, clientId: string, now: Date = new Date()): Promise<InboxConversation> {
  const c = await clientOrThrow(practiceId, clientId);
  const [a, b] = pair(trainerId, clientId);
  const convo = await prisma.directConversation.findUnique({ where: { participantAId_participantBId: { participantAId: a, participantBId: b } }, select: { id: true } });
  const rows = convo
    ? await prisma.message.findMany({ where: { conversationId: convo.id }, orderBy: { createdAt: 'desc' }, take: 200, select: { id: true, body: true, createdAt: true, senderId: true } })
    : [];
  if (convo) await prisma.message.updateMany({ where: { conversationId: convo.id, senderId: clientId, readAt: null }, data: { readAt: now } });
  return {
    client: ref(c),
    context: await contextFor(practiceId, c, now),
    messages: rows.reverse().map((m) => ({ id: m.id, body: m.body, at: m.createdAt.toISOString(), fromClient: m.senderId === clientId })),
  };
}

/**
 * Draft a reply to the client's latest message, in the trainer's voice, from
 * the facts in the context strip. It is a proposal; nothing is sent.
 */
export async function draftReply(practiceId: string, trainerId: string, clientId: string, now: Date = new Date()): Promise<Draft> {
  const c = await clientOrThrow(practiceId, clientId);
  const convo = await openThread(practiceId, trainerId, clientId, now);
  const lastFromClient = [...convo.messages].reverse().find((m) => m.fromClient);
  if (!lastFromClient) throw new InboxError(`${c.name.split(' ')[0]} has not written anything to reply to`, 409);
  const trainer = await prisma.user.findUnique({ where: { id: trainerId }, select: { name: true } });
  const first = c.name.split(' ')[0];
  const ctx = convo.context;
  const facts = [
    `Their latest message: "${lastFromClient.body.slice(0, 600)}"`,
    ...(ctx.statusReason ? [`What the data shows: ${ctx.statusReason}`] : []),
    ...(ctx.block ? [`They are in week ${ctx.block.week} of ${ctx.block.weeks} of ${ctx.block.blockLabel}`] : []),
    ...(ctx.contraindications.length ? [`Injuries on record: ${ctx.contraindications.join(', ')}`] : []),
    ...(ctx.nutrition ? [`Nutrition this week: ${ctx.nutrition}`] : []),
  ];
  const text = await writeDraftText({
    clientFirstName: first,
    trainerFirstName: trainer?.name?.split(' ')[0] ?? '',
    purpose: 'reply to the client\'s latest message',
    facts,
    fallback: `Thanks for the message, ${first}. Let me look at this properly and come back to you today.`,
  });
  const row = await createDraft({ practiceId, trainerId, clientId, kind: 'inbox_reply', sourceId: lastFromClient.id, text });
  return toDraft(row);
}
