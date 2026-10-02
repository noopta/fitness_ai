// Morning briefing: generation, the stale fallback, and resolving items.
// Generation plans the items with the deterministic engine, words each
// suggested message, persists, and reports progress as typed events so a
// client can render cards as they arrive (handoff §6.1).

import { formatWeight, normalizePreference } from '../weightUnits.js';
import { prisma } from './db.js';
import { planBriefing, type Candidate } from './briefingEngine.js';
import { loadPracticeData, type PracticeData } from './data.js';
import { syncReviewedWithDraft } from './checkins.js';
import { audit, createDraft, DraftError, requestSend, toDraft, undoSend, writeDraftText } from './drafts.js';
import { prEvents } from './lifts.js';
import { loadSettings } from './notifications.js';
import { resolveTier } from './notificationRules.js';
import { DEFAULT_WEEKLY_SESSIONS, dateStringIn } from './status.js';
import type {
  Briefing, BriefingItem, BriefingResponse, BriefingStreamEvent, Client, Evidence, ResolveAction, ScheduledResult,
} from './types.js';

const DAY_MS = 86_400_000;

export class BriefingError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'BriefingError';
    this.status = status;
  }
}

type Emit = (event: BriefingStreamEvent) => void;

interface ItemRow {
  id: string; clientId: string; severity: string; headline: string; detail: string; suggestionKind: string;
  suggestionText: string; draftId: string | null; primaryLabel: string; secondaryLabel: string; guardrailJson: string | null;
  evidenceJson: string; dataThrough: Date; resolutionAction: string | null; resolvedAt: Date | null;
  resolutionSummary: string | null; undoUntil: Date | null;
}

const clientMeta = (c: Client) =>
  [c.program ? `${c.program.blockLabel} · week ${c.program.week} of ${c.program.weeks}` : 'No program yet', c.program?.goal].filter(Boolean).join(' · ');

/**
 * Shape a stored item for the client. An item whose evidence has no reasons
 * is dropped and logged rather than rendered (handoff §2.2, §13).
 */
function toItem(row: ItemRow, client: Client | undefined, draft: Parameters<typeof toDraft>[0] | undefined): BriefingItem | null {
  let evidence: Evidence = { reasons: [], sources: [] };
  try { evidence = JSON.parse(row.evidenceJson); } catch { /* handled below */ }
  if (!client || !draft || !Array.isArray(evidence.reasons) || evidence.reasons.length === 0) {
    console.error('[personal-training] briefing item withheld: missing client, draft or evidence', row.id);
    return null;
  }
  return {
    id: row.id,
    clientId: row.clientId,
    client: { id: client.id, name: client.name, initials: client.initials, status: client.status, meta: clientMeta(client) },
    severity: row.severity as BriefingItem['severity'],
    headline: row.headline,
    detail: row.detail,
    suggestion: { kind: 'message', text: row.suggestionText, draftId: draft.id },
    draft: toDraft(draft),
    primaryLabel: row.primaryLabel,
    secondaryLabel: row.secondaryLabel,
    ...(row.guardrailJson ? { guardrail: JSON.parse(row.guardrailJson) } : {}),
    evidence,
    dataThrough: row.dataThrough.toISOString(),
    ...(row.resolutionAction && row.resolvedAt
      ? {
          resolution: {
            action: row.resolutionAction as ResolveAction,
            at: row.resolvedAt.toISOString(),
            summary: row.resolutionSummary ?? '',
            ...(row.undoUntil ? { undoUntil: row.undoUntil.toISOString() } : {}),
          },
        }
      : {}),
  };
}

async function loadBriefing(row: { id: string; date: string; status: string; generatedAt: Date | null; summaryJson: string; onPlanClientIdsJson: string; scheduledJson: string }, clients: Client[]): Promise<Briefing> {
  const items = await prisma.ptBriefingItem.findMany({ where: { briefingId: row.id }, orderBy: { sortOrder: 'asc' } });
  const drafts = await prisma.ptDraft.findMany({ where: { id: { in: items.map((i) => i.draftId).filter((x): x is string => !!x) } } });
  const draftById = new Map(drafts.map((d) => [d.id, d]));
  const clientById = new Map(clients.map((c) => [c.id, c]));
  const onPlanIds: string[] = JSON.parse(row.onPlanClientIdsJson || '[]');
  return {
    id: row.id,
    date: row.date,
    ...(row.generatedAt ? { generatedAt: row.generatedAt.toISOString() } : {}),
    status: row.status as Briefing['status'],
    summary: { attention: 0, look: 0, onPlan: 0, ...JSON.parse(row.summaryJson || '{}') },
    items: items
      .map((i) => toItem(i, clientById.get(i.clientId), i.draftId ? draftById.get(i.draftId) : undefined))
      .filter((x): x is BriefingItem => x !== null),
    onPlanClients: onPlanIds.map((id) => clientById.get(id)).filter((c): c is Client => !!c).map((c) => ({ id: c.id, name: c.name, initials: c.initials })),
    scheduled: JSON.parse(row.scheduledJson || '[]') as ScheduledResult[],
  };
}

function rosterStats(data: PracticeData) {
  const weekAgo = data.now.getTime() - 7 * DAY_MS;
  let sessions = 0;
  let target = 0;
  let checkIns = 0;
  let prs = 0;
  for (const c of data.clients) {
    const d = data.byClient.get(c.id)!;
    sessions += d.workouts.filter((w) => w.createdAt.getTime() > weekAgo).length;
    // Engagement already encodes the program's weekly target; fall back to the default.
    target += DEFAULT_WEEKLY_SESSIONS;
    checkIns += d.wellness.filter((w) => w.createdAt.getTime() > weekAgo).length
      + d.checkIns.filter((k) => k.submittedAt && k.submittedAt.getTime() > weekAgo).length;
    prs += prEvents(d.workouts).filter((e) => e.at.getTime() > weekAgo).length;
  }
  return { checkInsThisWeek: checkIns, adherence7d: target ? Math.min(100, Math.round((sessions / target) * 100)) : 0, prs7d: prs };
}

export async function getToday(practiceId: string, trainerId: string, now: Date = new Date()): Promise<BriefingResponse> {
  const [trainer, data, latest] = await Promise.all([
    prisma.user.findUnique({ where: { id: trainerId }, select: { name: true, timezone: true } }),
    loadPracticeData(practiceId, trainerId, { now }),
    prisma.ptBriefing.findFirst({ where: { practiceId, trainerId, status: 'ready' }, orderBy: { date: 'desc' } }),
  ]);
  const today = dateStringIn(trainer?.timezone, now);
  const stale = !!latest && latest.date !== today;
  let loggedSince = 0;
  if (stale && latest?.generatedAt) {
    const since = latest.generatedAt.getTime();
    loggedSince = data.clients.filter((c) => {
      const d = data.byClient.get(c.id)!;
      return d.workouts.some((w) => w.createdAt.getTime() > since) || d.wellness.some((w) => w.createdAt.getTime() > since)
        || d.checkIns.some((k) => (k.submittedAt?.getTime() ?? 0) > since);
    }).length;
  }
  return {
    trainerFirstName: trainer?.name?.trim().split(/\s+/)[0] ?? 'there',
    today,
    clientCount: data.clients.length,
    briefing: latest ? await loadBriefing(latest, data.clients) : null,
    stale,
    loggedSince,
    rosterStats: rosterStats(data),
  };
}

// One generation per trainer per practice at a time: a second caller (a
// double-mounted page, the 6 AM job racing an early riser) waits for the first.
const inFlight = new Map<string, Promise<Briefing>>();

export function generateBriefing(practiceId: string, trainerId: string, opts: { now?: Date; emit?: Emit; force?: boolean } = {}): Promise<Briefing> {
  const key = `${practiceId}:${trainerId}`;
  const running = inFlight.get(key);
  if (running) return running;
  const run = generate(practiceId, trainerId, opts).finally(() => inFlight.delete(key));
  inFlight.set(key, run);
  return run;
}

async function generate(practiceId: string, trainerId: string, opts: { now?: Date; emit?: Emit; force?: boolean }): Promise<Briefing> {
  const now = opts.now ?? new Date();
  const emit: Emit = opts.emit ?? (() => {});
  const tz = (await prisma.user.findUnique({ where: { id: trainerId }, select: { timezone: true } }))?.timezone;
  const date = dateStringIn(tz, now);

  const existing = await prisma.ptBriefing.findUnique({ where: { practiceId_trainerId_date: { practiceId, trainerId, date } } });
  if (existing?.status === 'ready' && !opts.force) {
    const clients = (await loadPracticeData(practiceId, trainerId, { now })).clients;
    return loadBriefing(existing, clients);
  }
  // A forced rebuild, or one that died mid-stream: start clean. Unsent drafts go with it.
  if (existing) {
    const stale = await prisma.ptBriefingItem.findMany({ where: { briefingId: existing.id }, select: { draftId: true } });
    await prisma.ptDraft.updateMany({
      where: { id: { in: stale.map((i) => i.draftId).filter((x): x is string => !!x) }, status: 'pending', kind: 'briefing' },
      data: { status: 'discarded' },
    });
    await prisma.ptBriefing.delete({ where: { id: existing.id } });
  }
  const briefing = await prisma.ptBriefing.create({ data: { practiceId, trainerId, date, status: 'streaming' } });

  try {
    const [trainer, settings, data] = await Promise.all([
      prisma.user.findUnique({ where: { id: trainerId }, select: { name: true, unitPreference: true } }),
      loadSettings(practiceId, trainerId),
      loadPracticeData(practiceId, trainerId, { now }),
    ]);
    emit({ type: 'status', text: `Reading ${data.clients.length} client${data.clients.length === 1 ? '' : 's'}' last 24 hours` });
    for (const source of ['workouts', 'checkIns', 'messages', 'programs'] as const) emit({ type: 'source', source });

    const pref = normalizePreference(trainer?.unitPreference);
    const trainerFirstName = trainer?.name?.trim().split(/\s+/)[0] ?? 'Your trainer';
    const checkIns = await prisma.ptCheckIn.findMany({
      where: { practiceId, status: 'submitted', reviewedAt: null, draftId: { not: null } },
      select: { id: true, draftId: true },
    });
    const plan = planBriefing(data, {
      fmt: (kg) => formatWeight(kg, pref) ?? '',
      tierOf: (eventType, clientId) => resolveTier(settings, eventType, clientId, now),
      checkInDraftIds: new Map(checkIns.map((k) => [k.id, k.draftId!])),
    });
    const clientById = new Map(data.clients.map((c) => [c.id, c]));

    for (const [index, candidate] of plan.items.entries()) {
      const item = await persistItem(briefing.id, practiceId, trainerId, candidate, clientById.get(candidate.clientId)!, trainerFirstName, index);
      if (item) emit({ type: 'item', item });
    }

    const scheduled = await runScheduledQuestions(practiceId, trainerId, data, pref);
    const ready = await prisma.ptBriefing.update({
      where: { id: briefing.id },
      data: {
        status: 'ready', generatedAt: new Date(), summaryJson: JSON.stringify(plan.summary),
        onPlanClientIdsJson: JSON.stringify(plan.onPlanClientIds), scheduledJson: JSON.stringify(scheduled),
      },
    });
    const result = await loadBriefing(ready, data.clients);
    emit({ type: 'done', briefing: result });
    return result;
  } catch (err) {
    await prisma.ptBriefing.update({ where: { id: briefing.id }, data: { status: 'failed' } }).catch(() => {});
    emit({ type: 'error', message: 'The briefing could not be generated' });
    throw err;
  }
}

async function persistItem(
  briefingId: string, practiceId: string, trainerId: string, c: Candidate, client: Client, trainerFirstName: string, sortOrder: number,
): Promise<BriefingItem | null> {
  const draft = c.existingDraftId
    ? await prisma.ptDraft.findUnique({ where: { id: c.existingDraftId } })
    : await createDraft({
        practiceId, trainerId, clientId: c.clientId, kind: 'briefing', sourceId: briefingId,
        text: await writeDraftText({ clientFirstName: client.name.split(' ')[0], trainerFirstName, ...c.draft }),
      });
  if (!draft) return null;
  const row = await prisma.ptBriefingItem.create({
    data: {
      briefingId, clientId: c.clientId, ruleId: c.ruleId, eventType: c.eventType, severity: c.severity,
      headline: c.headline, detail: c.detail, suggestionKind: 'message', suggestionText: draft.text, draftId: draft.id,
      primaryLabel: c.primaryLabel, secondaryLabel: 'Edit draft',
      guardrailJson: c.guardrail && c.guardrail.checked > 0 ? JSON.stringify({ checked: c.guardrail.checked, label: c.guardrail.label }) : null,
      evidenceJson: JSON.stringify({ reasons: c.reasons, sources: c.sources }),
      dataThrough: c.dataThrough, sortOrder,
    },
  });
  return toItem(row, client, draft);
}

// Scheduled Ask Anakin questions run with the briefing; imported lazily to keep
// the module graph acyclic (anakin.ts also reads practice data).
async function runScheduledQuestions(practiceId: string, trainerId: string, data: PracticeData, pref: 'metric' | 'imperial'): Promise<ScheduledResult[]> {
  const { runScheduled } = await import('./anakin.js');
  return runScheduled(practiceId, trainerId, data, pref);
}

// ── Resolving ────────────────────────────────────────────────────────────────

async function loadOwnedItem(itemId: string, practiceId: string, trainerId: string) {
  const item = await prisma.ptBriefingItem.findUnique({ where: { id: itemId }, include: { briefing: true } });
  if (!item || item.briefing.practiceId !== practiceId || item.briefing.trainerId !== trainerId) throw new BriefingError('Briefing item not found', 404);
  return item;
}

async function shapeItem(itemId: string, practiceId: string, trainerId: string): Promise<BriefingItem> {
  const row = await prisma.ptBriefingItem.findUnique({ where: { id: itemId } });
  const data = await loadPracticeData(practiceId, trainerId, { clientIds: row ? [row.clientId] : [] });
  const draft = row?.draftId ? await prisma.ptDraft.findUnique({ where: { id: row.draftId } }) : null;
  const item = row ? toItem(row, data.clients[0], draft ?? undefined) : null;
  if (!item) throw new BriefingError('Briefing item not found', 404);
  return item;
}

/** The last moment a dismissal can be undone: within an hour of the end of the trainer's day. */
function endOfDay(now: Date, tz: string | null | undefined): Date {
  const today = dateStringIn(tz, now);
  let t = now.getTime();
  while (dateStringIn(tz, new Date(t + 60 * 60_000)) === today) t += 60 * 60_000;
  return new Date(t + 60 * 60_000);
}

export async function resolveItem(input: {
  itemId: string; practiceId: string; trainerId: string; action: ResolveAction; editedText?: string; now?: Date;
}): Promise<BriefingItem> {
  const now = input.now ?? new Date();
  const item = await loadOwnedItem(input.itemId, input.practiceId, input.trainerId);
  if (item.resolutionAction) throw new BriefingError('This item has already been handled', 409);
  const clientName = (await prisma.user.findUnique({ where: { id: item.clientId }, select: { name: true } }))?.name ?? 'Client';

  let undoUntil: Date;
  let summary: string;
  if (input.action === 'messaged') {
    if (!item.draftId) throw new BriefingError('This item has no draft to send', 400);
    const draft = await requestSend({ draftId: item.draftId, practiceId: input.practiceId, trainerId: input.trainerId, editedText: input.editedText, now });
    undoUntil = new Date(draft.undoUntil!);
    summary = `${clientName} — Message sent · logged to audit trail`;
    // The draft may be a check-in reply; replying is reviewing.
    await syncReviewedWithDraft(item.draftId, true);
  } else {
    const tz = (await prisma.user.findUnique({ where: { id: input.trainerId }, select: { timezone: true } }))?.timezone;
    undoUntil = endOfDay(now, tz);
    summary = `${clientName} — ${input.action === 'dismissed' ? 'Dismissed' : 'Marked as handled'} · logged to audit trail`;
  }

  // Conditional, so two tabs resolving the same card cannot both win.
  const claimed = await prisma.ptBriefingItem.updateMany({
    where: { id: item.id, resolutionAction: null },
    data: { resolutionAction: input.action, resolvedAt: now, resolutionSummary: summary, undoUntil },
  });
  if (claimed.count !== 1) throw new BriefingError('This item has already been handled', 409);
  await audit({
    practiceId: input.practiceId, trainerId: input.trainerId, clientId: item.clientId,
    action: input.action === 'messaged' ? 'resolved' : input.action, itemType: 'briefing_item', itemId: item.id,
    originalText: item.suggestionText, editedText: input.action === 'messaged' ? (input.editedText ?? item.suggestionText) : null,
    meta: { ruleId: item.ruleId, action: input.action },
  });
  return shapeItem(item.id, input.practiceId, input.trainerId);
}

export async function undoResolve(input: { itemId: string; practiceId: string; trainerId: string; now?: Date }): Promise<BriefingItem> {
  const now = input.now ?? new Date();
  const item = await loadOwnedItem(input.itemId, input.practiceId, input.trainerId);
  if (!item.resolutionAction) throw new BriefingError('This item has not been handled', 409);
  if (!item.undoUntil || item.undoUntil.getTime() <= now.getTime()) throw new BriefingError('It is too late to undo this', 409);

  if (item.resolutionAction === 'messaged' && item.draftId) {
    try {
      await undoSend({ draftId: item.draftId, practiceId: input.practiceId, trainerId: input.trainerId, now });
      await syncReviewedWithDraft(item.draftId, false);
    } catch (err) {
      if (err instanceof DraftError) throw new BriefingError(err.message, err.status);
      throw err;
    }
  }
  await prisma.ptBriefingItem.update({
    where: { id: item.id },
    data: { resolutionAction: null, resolvedAt: null, resolutionSummary: null, undoUntil: null },
  });
  await audit({
    practiceId: input.practiceId, trainerId: input.trainerId, clientId: item.clientId,
    action: 'undone', itemType: 'briefing_item', itemId: item.id, meta: { undid: item.resolutionAction },
  });
  return shapeItem(item.id, input.practiceId, input.trainerId);
}


/**
 * A draft sent or taken back from somewhere other than its briefing card (the
 * check-in inbox, for one) must leave the card in the same state, or the
 * briefing would offer to send a message that has already gone.
 */
export async function syncItemsWithDraft(draftId: string, sent: { undoUntil: Date } | null) {
  if (sent) {
    const items = await prisma.ptBriefingItem.findMany({ where: { draftId, resolutionAction: null }, select: { id: true, clientId: true } });
    for (const item of items) {
      const name = (await prisma.user.findUnique({ where: { id: item.clientId }, select: { name: true } }))?.name ?? 'Client';
      await prisma.ptBriefingItem.update({
        where: { id: item.id },
        data: { resolutionAction: 'messaged', resolvedAt: new Date(), resolutionSummary: `${name} — Message sent · logged to audit trail`, undoUntil: sent.undoUntil },
      });
    }
  } else {
    await prisma.ptBriefingItem.updateMany({
      where: { draftId, resolutionAction: 'messaged' },
      data: { resolutionAction: null, resolvedAt: null, resolutionSummary: null, undoUntil: null },
    });
  }
}
