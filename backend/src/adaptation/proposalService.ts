// The only place adaptive changes touch the database.
//
// Flow: load context → run rules → persist drafts as AdaptationProposal rows
// (status=pending) → the user decides → apply / snooze / decline → undo.
// A program is NEVER modified except inside `decide('apply')` and `undo`,
// and both record what they did on the proposal row.

import { PrismaClient } from '@prisma/client';
import { cacheDelete, cacheClearByPrefix } from '../services/cacheService.js';
import { normalizePreference, type UnitPreference } from '../services/weightUnits.js';
import { parseSavedProgram } from '../services/programPhaseService.js';
import { buildExposures, makeKeyFn, type KeyFn } from './history.js';
import { applyTargetsToProgram, extractPlannedExercises, type TargetWrite } from './targets.js';
import { runBootstrapRules, runPostWorkoutRules } from './engine.js';
import type { AdaptationContext, EvidenceLine, ProposalDraft, ProposalPayload } from './types.js';

const prisma = new PrismaClient();

/**
 * Feature gate. ADAPTATION_ENABLED=1 turns it on for everyone; otherwise
 * ADAPTATION_USER_ALLOWLIST (comma-separated user ids) opts individuals in so
 * the first week can be watched user by user. Read at call time, not import
 * time, so tests and ops can flip it without a module reload.
 */
export function adaptationEnabledFor(userId: string): boolean {
  const flag = process.env.ADAPTATION_ENABLED;
  if (flag === '1' || flag === 'true') return true;
  const allow = (process.env.ADAPTATION_USER_ALLOWLIST ?? '').split(',').map(s => s.trim()).filter(Boolean);
  return allow.includes(userId);
}

const SNOOZE_DAYS_DEFAULT = 7;
const DECLINE_SUPPRESS_COUNT = 3;
const DECLINE_WINDOW_DAYS = 60;

function invalidateProgramCaches(userId: string) {
  cacheDelete(`program:${userId}`);
  cacheClearByPrefix(`today:${userId}:`);
  cacheClearByPrefix(`schedule:${userId}:`);
  cacheClearByPrefix(`dashboard:${userId}:`);
  cacheDelete(`userctx:${userId}`);
}

// ─── Context ─────────────────────────────────────────────────────────────────

export async function loadContext(userId: string, now = new Date()): Promise<AdaptationContext> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { savedProgram: true, unitPreference: true },
  });
  const workouts = await prisma.workoutLog.findMany({
    where: { userId },
    orderBy: { date: 'asc' },
    select: { id: true, date: true, exercises: true, programDayRef: true },
  });

  // Names → canonical from the normalization table (LLM classifications of
  // odd names live there). Seed-dictionary fallback happens inside keyFn.
  const rawNames = new Set<string>();
  for (const w of workouts) {
    try {
      for (const ex of JSON.parse(w.exercises) ?? []) if (ex?.name) rawNames.add(String(ex.name).trim());
    } catch { /* skip */ }
  }
  const program = parseSavedProgram(user?.savedProgram ?? null);
  for (const phase of program?.phases ?? [])
    for (const day of phase?.trainingDays ?? [])
      for (const ex of day?.exercises ?? []) {
        const n = String(ex?.exercise ?? ex?.name ?? '').trim();
        if (n) rawNames.add(n);
      }
  const dbCanonical = new Map<string, string>();
  if (rawNames.size > 0) {
    const rows = await prisma.exerciseNormalization.findMany({
      where: { rawName: { in: [...rawNames] } },
      select: { rawName: true, canonicalName: true },
    });
    for (const r of rows) dbCanonical.set(r.rawName, r.canonicalName);
  }
  const keyFn = makeKeyFn(dbCanonical);
  const exposuresByKey = buildExposures(workouts, keyFn);

  return {
    userId,
    program,
    unitPref: normalizePreference(user?.unitPreference),
    planned: program ? extractPlannedExercises(program, keyFn) : [],
    exposuresByKey,
    workoutCount: workouts.length,
    firstWorkoutDate: workouts[0]?.date ?? null,
    now,
  };
}

/** Key function matching what loadContext used — for apply paths that need
 *  to walk the program without reloading history. */
async function keyFnFor(program: any): Promise<KeyFn> {
  const names = new Set<string>();
  for (const phase of program?.phases ?? [])
    for (const day of phase?.trainingDays ?? [])
      for (const ex of day?.exercises ?? []) {
        const n = String(ex?.exercise ?? ex?.name ?? '').trim();
        if (n) names.add(n);
      }
  const dbCanonical = new Map<string, string>();
  if (names.size) {
    const rows = await prisma.exerciseNormalization.findMany({
      where: { rawName: { in: [...names] } },
      select: { rawName: true, canonicalName: true },
    });
    for (const r of rows) dbCanonical.set(r.rawName, r.canonicalName);
  }
  return makeKeyFn(dbCanonical);
}

// ─── Persist drafts ──────────────────────────────────────────────────────────

export interface ProposalRow {
  id: string;
  kind: string;
  dedupeKey: string;
  title: string;
  evidence: EvidenceLine[];
  reasoning: string;
  proposal: ProposalPayload;
  inverse: any | null;
  confidence: number;
  status: string;
  trigger: string;
  createdAt: Date;
  decidedAt: Date | null;
  snoozeUntil: Date | null;
}

function rowToProposal(r: any): ProposalRow {
  const parse = (s: string | null) => { try { return s ? JSON.parse(s) : null; } catch { return null; } };
  return {
    id: r.id, kind: r.kind, dedupeKey: r.dedupeKey, title: r.title,
    evidence: parse(r.evidence) ?? [], reasoning: r.reasoning,
    proposal: parse(r.proposal), inverse: parse(r.inverse),
    confidence: r.confidence, status: r.status, trigger: r.trigger,
    createdAt: r.createdAt, decidedAt: r.decidedAt, snoozeUntil: r.snoozeUntil,
  };
}

/**
 * Persist drafts, skipping any whose dedupeKey already has a pending or
 * still-snoozed row, or that the user has declined 3× recently ("stop
 * suggesting this"). Returns the rows actually created.
 */
export async function createProposals(userId: string, drafts: ProposalDraft[], trigger: string, now = new Date()): Promise<ProposalRow[]> {
  if (drafts.length === 0) return [];
  const keys = [...new Set(drafts.map(d => d.dedupeKey))];
  const since = new Date(now.getTime() - DECLINE_WINDOW_DAYS * 86400000);
  const existing = await prisma.adaptationProposal.findMany({
    where: { userId, dedupeKey: { in: keys }, OR: [{ status: 'pending' }, { status: 'snoozed' }, { status: 'declined', decidedAt: { gte: since } }] },
    select: { dedupeKey: true, status: true, snoozeUntil: true },
  });
  const blocked = new Set<string>();
  const declines = new Map<string, number>();
  for (const e of existing) {
    if (e.status === 'pending') blocked.add(e.dedupeKey);
    else if (e.status === 'snoozed' && e.snoozeUntil && e.snoozeUntil > now) blocked.add(e.dedupeKey);
    else if (e.status === 'declined') declines.set(e.dedupeKey, (declines.get(e.dedupeKey) ?? 0) + 1);
  }
  for (const [k, n] of declines) if (n >= DECLINE_SUPPRESS_COUNT) blocked.add(k);

  const created: ProposalRow[] = [];
  for (const d of drafts) {
    if (blocked.has(d.dedupeKey)) continue;
    blocked.add(d.dedupeKey); // one per key per run
    const row = await prisma.adaptationProposal.create({
      data: {
        userId, kind: d.kind, dedupeKey: d.dedupeKey, title: d.title,
        evidence: JSON.stringify(d.evidence), reasoning: d.reasoning,
        proposal: JSON.stringify(d.proposal), confidence: d.confidence, trigger,
      },
    });
    created.push(rowToProposal(row));
  }
  return created;
}

export async function listPending(userId: string, now = new Date()): Promise<ProposalRow[]> {
  // Snoozes that have expired come back as pending.
  await prisma.adaptationProposal.updateMany({
    where: { userId, status: 'snoozed', snoozeUntil: { lte: now } },
    data: { status: 'pending', snoozeUntil: null },
  });
  const rows = await prisma.adaptationProposal.findMany({
    where: { userId, status: 'pending' },
    orderBy: { createdAt: 'desc' },
  });
  // Retrofit first, then newest.
  return rows.map(rowToProposal).sort((a, b) => (a.kind === 'retrofit' ? -1 : b.kind === 'retrofit' ? 1 : 0));
}

export async function listRecent(userId: string, limit = 20): Promise<ProposalRow[]> {
  const rows = await prisma.adaptationProposal.findMany({
    where: { userId, status: { in: ['applied', 'undone', 'declined', 'snoozed'] } },
    orderBy: { updatedAt: 'desc' },
    take: limit,
  });
  return rows.map(rowToProposal);
}

// ─── Apply / undo ────────────────────────────────────────────────────────────

/** Turn a proposal payload into target writes. Edited targets (from the
 *  retrofit "Let me edit" flow) override the stored ones by key. */
function targetWritesFor(payload: ProposalPayload, edits?: Array<{ key: string; targetWeightKg: number | null }>): TargetWrite[] {
  const editMap = new Map((edits ?? []).map(e => [e.key, e.targetWeightKg]));
  switch (payload.kind) {
    case 'retrofit':
      return payload.targets
        .map(t => ({
          key: t.key,
          targetWeightKg: editMap.has(t.key) ? editMap.get(t.key)! : t.targetWeightKg,
          targetRPE: t.targetRPE,
          confidence: editMap.has(t.key) ? 0.95 : t.confidence,
          basis: editMap.has(t.key) ? 'user' : t.basis,
        }))
        .filter(t => t.targetWeightKg != null);
    case 'load_change':
      return [{ key: payload.key, targetWeightKg: editMap.get(payload.key) ?? payload.toWeightKg, confidence: 0.95, basis: 'progression' }];
    case 'calibration':
      return [{ key: payload.key, targetWeightKg: editMap.get(payload.key) ?? payload.targetWeightKg, targetRPE: payload.targetRPE, confidence: 0.8, basis: 'calibration' }];
    case 'set_targets':
      return payload.targets;
  }
}

export type DecideAction = 'apply' | 'decline' | 'snooze';

export async function decide(
  userId: string,
  proposalId: string,
  action: DecideAction,
  opts: { edits?: Array<{ key: string; targetWeightKg: number | null }>; snoozeDays?: number; now?: Date } = {},
): Promise<{ proposal: ProposalRow; touched?: number }> {
  const now = opts.now ?? new Date();
  const row = await prisma.adaptationProposal.findUnique({ where: { id: proposalId } });
  if (!row || row.userId !== userId) throw new Error('Proposal not found');
  if (row.status !== 'pending' && row.status !== 'snoozed') throw new Error(`Proposal is already ${row.status}`);

  if (action === 'decline') {
    const updated = await prisma.adaptationProposal.update({ where: { id: proposalId }, data: { status: 'declined', decidedAt: now } });
    return { proposal: rowToProposal(updated) };
  }
  if (action === 'snooze') {
    const days = Math.max(1, Math.min(60, opts.snoozeDays ?? SNOOZE_DAYS_DEFAULT));
    const until = new Date(now.getTime() + days * 86400000);
    const updated = await prisma.adaptationProposal.update({ where: { id: proposalId }, data: { status: 'snoozed', snoozeUntil: until, decidedAt: now } });
    return { proposal: rowToProposal(updated) };
  }

  // apply
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { savedProgram: true } });
  const program = parseSavedProgram(user?.savedProgram ?? null);
  if (!program) throw new Error('No saved program to update');
  const payload = JSON.parse(row.proposal) as ProposalPayload;
  const writes = targetWritesFor(payload, opts.edits);
  if (writes.length === 0) throw new Error('Nothing to apply');
  const keyFn = await keyFnFor(program);
  const { program: next, previous, touched } = applyTargetsToProgram(program, writes, keyFn, now.toISOString());
  if (touched === 0) throw new Error('None of the proposed exercises are in the current program');

  const inverse: ProposalPayload = { kind: 'set_targets', targets: previous };
  await prisma.user.update({ where: { id: userId }, data: { savedProgram: JSON.stringify(next) } });
  invalidateProgramCaches(userId);
  const updated = await prisma.adaptationProposal.update({
    where: { id: proposalId },
    data: { status: 'applied', decidedAt: now, inverse: JSON.stringify(inverse), proposal: JSON.stringify(withEdits(payload, opts.edits)) },
  });
  return { proposal: rowToProposal(updated), touched };
}

/** Record the user's edits on the stored proposal so history shows what was actually applied. */
function withEdits(payload: ProposalPayload, edits?: Array<{ key: string; targetWeightKg: number | null }>): ProposalPayload {
  if (!edits?.length) return payload;
  const m = new Map(edits.map(e => [e.key, e.targetWeightKg]));
  if (payload.kind === 'retrofit') {
    return { ...payload, targets: payload.targets.map(t => (m.has(t.key) ? { ...t, targetWeightKg: m.get(t.key)!, basis: 'user' as const, confidence: 0.95 } : t)) };
  }
  if (payload.kind === 'load_change' && m.has(payload.key)) return { ...payload, toWeightKg: m.get(payload.key)! };
  return payload;
}

export async function undo(userId: string, proposalId: string, now = new Date()): Promise<{ proposal: ProposalRow; touched: number }> {
  const row = await prisma.adaptationProposal.findUnique({ where: { id: proposalId } });
  if (!row || row.userId !== userId) throw new Error('Proposal not found');
  if (row.status !== 'applied' || !row.inverse) throw new Error('Nothing to undo');
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { savedProgram: true } });
  const program = parseSavedProgram(user?.savedProgram ?? null);
  if (!program) throw new Error('No saved program to update');
  const inverse = JSON.parse(row.inverse) as ProposalPayload;
  const keyFn = await keyFnFor(program);
  const { program: next, touched } = applyTargetsToProgram(program, targetWritesFor(inverse), keyFn, now.toISOString());
  await prisma.user.update({ where: { id: userId }, data: { savedProgram: JSON.stringify(next) } });
  invalidateProgramCaches(userId);
  const updated = await prisma.adaptationProposal.update({ where: { id: proposalId }, data: { status: 'undone', decidedAt: now } });
  return { proposal: rowToProposal(updated), touched };
}

// ─── Triggers ────────────────────────────────────────────────────────────────

/** After a workout is logged: evaluate the lifts in that workout. */
export async function runPostWorkout(userId: string, loggedNames: string[]): Promise<ProposalRow[]> {
  if (!adaptationEnabledFor(userId)) return [];
  const ctx = await loadContext(userId);
  if (!ctx.program) return [];
  const keyFn = await keyFnFor(ctx.program);
  const keys = new Set(loggedNames.map(keyFn).filter(Boolean));
  const drafts = runPostWorkoutRules(ctx, keys);
  return createProposals(userId, drafts, 'post_workout', ctx.now);
}

export type BootstrapResult =
  | { cohort: 'no_program' }
  | { cohort: 'already_bootstrapped' }
  | { cohort: 'no_history'; workouts: number }
  | { cohort: 'retrofit'; proposal: ProposalRow }
  | { cohort: 'retrofit_pending'; proposal: ProposalRow };

/**
 * Idempotent bootstrap for existing users. Cohort A (program + loaded
 * history) gets a retrofit proposal; Cohort B (program, no loaded history)
 * gets nothing — calibration happens from their first weighted session.
 */
export async function bootstrap(userId: string): Promise<BootstrapResult> {
  const ctx = await loadContext(userId);
  if (!ctx.program) return { cohort: 'no_program' };
  const prior = await prisma.adaptationProposal.findFirst({ where: { userId, kind: 'retrofit' }, orderBy: { createdAt: 'desc' } });
  if (prior) {
    if (prior.status === 'pending' || prior.status === 'snoozed') return { cohort: 'retrofit_pending', proposal: rowToProposal(prior) };
    return { cohort: 'already_bootstrapped' };
  }
  if (ctx.planned.some(p => p.targetWeightKg != null)) return { cohort: 'already_bootstrapped' };
  const drafts = runBootstrapRules(ctx);
  if (drafts.length === 0) return { cohort: 'no_history', workouts: ctx.workoutCount };
  const [row] = await createProposals(userId, drafts, 'bootstrap', ctx.now);
  if (!row) return { cohort: 'already_bootstrapped' };
  return { cohort: 'retrofit', proposal: row };
}

/** Seed targets straight into a program object from history — used when a
 *  NEW program is saved so it carries targets from day one. Never proposes;
 *  the user is choosing this program right now. */
export async function seedTargetsForNewProgram(userId: string, program: any): Promise<{ program: any; seeded: number }> {
  const ctx = await loadContext(userId);
  const keyFn = await keyFnFor(program);
  const planned = extractPlannedExercises(program, keyFn);
  const { seedTargetFromExposures } = await import('./targets.js');
  const writes: TargetWrite[] = [];
  for (const p of planned) {
    const exposures = (ctx.exposuresByKey.get(p.key) ?? []).filter(e => e.top && e.e1rmKg > 0);
    if (exposures.length === 0) continue;
    const seed = seedTargetFromExposures(exposures, p.repRange, p.targetRPE, p.exercise, ctx.unitPref);
    if (!seed) continue;
    writes.push({ key: p.key, targetWeightKg: seed.targetWeightKg, targetRPE: p.targetRPE, confidence: seed.confidence, basis: seed.basis });
  }
  if (writes.length === 0) return { program, seeded: 0 };
  const { program: next, touched } = applyTargetsToProgram(program, writes, keyFn, new Date().toISOString());
  return { program: next, seeded: touched };
}

// ─── "Last time" ─────────────────────────────────────────────────────────────

export interface ExerciseLast {
  name: string;
  key: string | null;
  /** Newest first, at most `limit`. */
  exposures: Array<{
    date: string;
    sets: Array<{ weightKg: number | null; reps: number; rpe: number | null }>;
    top: { weightKg: number | null; reps: number; rpe: number | null } | null;
    e1rmKg: number;
    confidence: number;
  }>;
  target: { targetWeightKg: number | null; targetRPE: number | null; reps: string; sets: number } | null;
  /** How the most recent exposure scored against the plan, if both exist. */
  lastScore: { result: string; note: string; rpeDelta: number | null; loadDeltaKg: number | null } | null;
  unitPref: UnitPreference;
}

/**
 * Recent performance for each named exercise + the program target and how
 * the last session scored against it. One context load for the whole batch.
 */
export async function lastForExercises(userId: string, names: string[], limit = 3): Promise<ExerciseLast[]> {
  const ctx = await loadContext(userId);
  const keyFn = await keyFnFor(ctx.program ?? { phases: [] });
  const { scoreExposure } = await import('./score.js');
  const plannedByKey = new Map(ctx.planned.map(p => [p.key, p]));
  return names.map(name => {
    const key = keyFn(name) || null;
    const exposures = (key ? ctx.exposuresByKey.get(key) ?? [] : []).slice(0, limit);
    const planned = key ? plannedByKey.get(key) ?? null : null;
    const target = planned
      ? { targetWeightKg: planned.targetWeightKg, targetRPE: planned.targetRPE, reps: planned.repsRaw, sets: planned.sets }
      : null;
    const last = exposures[0];
    const score = planned && last ? scoreExposure(planned, last) : null;
    return {
      name,
      key,
      exposures: exposures.map(e => ({ date: e.date, sets: e.sets, top: e.top, e1rmKg: e.e1rmKg, confidence: e.confidence })),
      target,
      lastScore: score ? { result: score.result, note: score.note, rpeDelta: score.rpeDelta, loadDeltaKg: score.loadDeltaKg } : null,
      unitPref: ctx.unitPref,
    };
  });
}

export type { UnitPreference };
