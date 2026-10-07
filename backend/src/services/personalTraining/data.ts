// One batched read of everything the analysis surfaces need about a practice:
// the roster plus each client's sessions, wellness check-ins, messages with
// this trainer, pending program proposals and trainer check-ins. The briefing,
// Progress, Ask Anakin and notification detection all work from this snapshot.

import { prisma } from './db.js';
import { PROSPECT_PREFIX, loadClients } from './roster.js';
import type { WorkoutLite } from './lifts.js';
import type { Client } from './types.js';

const DAY_MS = 86_400_000;

export interface MessageLite { id: string; createdAt: Date; fromClient: boolean; body: string }
// mood / energy / stress are optional — a check-in saves only what the client answered.
export interface WellnessLite { id: string; createdAt: Date; mood: number | null; energy: number | null; sleepHours: number; stress: number | null }
export interface ProposalLite { id: string; createdAt: Date; title: string; reasoning: string; status: string }
export interface WeightLite { id: string; createdAt: Date; weightKg: number | null; weightLbs: number | null }
export interface PtCheckInLite {
  id: string; dueAt: Date; status: string; submittedAt: Date | null; classification: string | null;
  summary: string | null; answersJson: string | null; reviewedAt: Date | null; nudgedAt: Date | null;
}

export interface ClientData {
  /** Every session, oldest first — PR and plateau rules need the full history. */
  workouts: WorkoutLite[];
  wellness: WellnessLite[];
  /** Thread with this trainer, oldest first. */
  messages: MessageLite[];
  proposals: ProposalLite[];
  weights: WeightLite[];
  checkIns: PtCheckInLite[];
}

export interface PracticeData {
  now: Date;
  clients: Client[];
  byClient: Map<string, ClientData>;
}

export const emptyClientData = (): ClientData => ({ workouts: [], wellness: [], messages: [], proposals: [], weights: [], checkIns: [] });

export async function loadPracticeData(
  practiceId: string,
  trainerId: string,
  opts: { now?: Date; clientIds?: string[]; includeProspects?: boolean } = {},
): Promise<PracticeData> {
  const now = opts.now ?? new Date();
  const clients = await loadClients(practiceId, { now, ids: opts.clientIds, includeProspects: opts.includeProspects });
  const byClient = new Map<string, ClientData>(clients.map((c) => [c.id, emptyClientData()]));
  if (clients.length === 0) return { now, clients, byClient };

  // Prospect ids are not user ids; they match nothing in the user-keyed tables below.
  const ids = clients.filter((c) => !c.id.startsWith(PROSPECT_PREFIX)).map((c) => c.id);
  const recent = new Date(now.getTime() - 60 * DAY_MS);

  const [workouts, wellness, proposals, weights, checkIns, conversations] = await Promise.all([
    prisma.workoutLog.findMany({
      where: { userId: { in: ids } },
      orderBy: { createdAt: 'asc' },
      select: { id: true, userId: true, createdAt: true, title: true, exercises: true, notes: true },
    }),
    prisma.wellnessCheckin.findMany({
      where: { userId: { in: ids }, createdAt: { gte: recent } },
      orderBy: { createdAt: 'asc' },
      select: { id: true, userId: true, createdAt: true, mood: true, energy: true, sleepHours: true, stress: true },
    }),
    prisma.adaptationProposal.findMany({
      where: { userId: { in: ids }, status: 'pending' },
      orderBy: { createdAt: 'asc' },
      select: { id: true, userId: true, createdAt: true, title: true, reasoning: true, status: true },
    }),
    prisma.bodyWeightLog.findMany({
      where: { userId: { in: ids }, createdAt: { gte: new Date(now.getTime() - 120 * DAY_MS) } },
      orderBy: { createdAt: 'asc' },
      select: { id: true, userId: true, createdAt: true, weightKg: true, weightLbs: true },
    }),
    prisma.ptCheckIn.findMany({
      where: { practiceId, clientId: { in: ids }, dueAt: { gte: recent } },
      orderBy: { dueAt: 'asc' },
      select: {
        id: true, clientId: true, dueAt: true, status: true, submittedAt: true, classification: true,
        summary: true, answersJson: true, reviewedAt: true, nudgedAt: true,
      },
    }),
    prisma.directConversation.findMany({
      where: {
        OR: [
          { participantAId: trainerId, participantBId: { in: ids } },
          { participantBId: trainerId, participantAId: { in: ids } },
        ],
      },
      select: { id: true, participantAId: true, participantBId: true },
    }),
  ]);

  for (const { userId, ...w } of workouts) byClient.get(userId)?.workouts.push(w);
  for (const { userId, ...w } of wellness) byClient.get(userId)?.wellness.push(w);
  for (const { userId, ...p } of proposals) byClient.get(userId)?.proposals.push(p);
  for (const { userId, ...w } of weights) byClient.get(userId)?.weights.push(w);
  for (const { clientId, ...c } of checkIns) byClient.get(clientId)?.checkIns.push(c);

  if (conversations.length) {
    const clientOf = new Map(conversations.map((c) => [c.id, c.participantAId === trainerId ? c.participantBId : c.participantAId]));
    const messages = await prisma.message.findMany({
      where: { conversationId: { in: conversations.map((c) => c.id) }, createdAt: { gte: recent } },
      orderBy: { createdAt: 'asc' },
      select: { id: true, conversationId: true, createdAt: true, senderId: true, body: true },
    });
    for (const m of messages) {
      const clientId = clientOf.get(m.conversationId);
      if (!clientId) continue;
      byClient.get(clientId)?.messages.push({ id: m.id, createdAt: m.createdAt, fromClient: m.senderId === clientId, body: m.body });
    }
  }

  if (opts.includeProspects) await addImportedHistory(practiceId, clients.map((c) => c.id), byClient);
  return { now, clients, byClient };
}

/**
 * History that came from a spreadsheet import: a "Not joined" client's whole
 * record, and for a client who has since joined, what the trainer had on file
 * from before. It is kept apart from what the client logs themselves and
 * merged only here, for the trainer's view.
 */
async function addImportedHistory(practiceId: string, clientIds: string[], byClient: Map<string, ClientData>) {
  const prospectIds = clientIds.filter((id) => id.startsWith(PROSPECT_PREFIX)).map((id) => id.slice(PROSPECT_PREFIX.length));
  const userIds = clientIds.filter((id) => !id.startsWith(PROSPECT_PREFIX));
  const linked = userIds.length
    ? await prisma.ptProspect.findMany({ where: { practiceId, userId: { in: userIds } }, select: { id: true, userId: true } })
    : [];
  // prospect row id → the client id its history belongs under
  const owner = new Map<string, string>([
    ...prospectIds.map((id) => [id, `${PROSPECT_PREFIX}${id}`] as [string, string]),
    ...linked.map((p) => [p.id, p.userId!] as [string, string]),
  ]);
  if (owner.size === 0) return;
  const [workouts, weights] = await Promise.all([
    prisma.ptImportedWorkout.findMany({ where: { practiceId, prospectId: { in: [...owner.keys()] } }, orderBy: { at: 'asc' } }),
    prisma.ptImportedWeight.findMany({ where: { practiceId, prospectId: { in: [...owner.keys()] } }, orderBy: { at: 'asc' } }),
  ]);
  const touched = new Set<string>();
  for (const w of workouts) {
    const id = owner.get(w.prospectId)!;
    byClient.get(id)?.workouts.push({ id: `imp:${w.id}`, createdAt: w.at, title: w.title, exercises: w.exercises, notes: w.notes });
    touched.add(id);
  }
  for (const w of weights) {
    const id = owner.get(w.prospectId)!;
    byClient.get(id)?.weights.push({ id: `imp:${w.id}`, createdAt: w.at, weightKg: w.weightKg, weightLbs: null });
    touched.add(id);
  }
  // PR and plateau rules read sessions oldest first.
  for (const id of touched) {
    const d = byClient.get(id)!;
    d.workouts.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    d.weights.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }
}
