// Contract 7 — the training summary injected into the agent context: recent
// sessions, per-lift trends, strength-profile highlights, phase, pending
// proposals; user's unit; within the char budget; fails soft; gated by flags.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  user: { findUnique: vi.fn() },
  workoutLog: { findMany: vi.fn() },
  exerciseNormalization: { findMany: vi.fn() },
  mealEntry: { findMany: vi.fn() },
  bodyWeightLog: { findMany: vi.fn() },
  wellnessCheckin: { findFirst: vi.fn() },
  agentMemory: { findUnique: vi.fn() },
  adaptationProposal: { findMany: vi.fn() },
}));
const flags = vi.hoisted(() => ({ freestyle: false, logAdaptation: false, phase: false }));
vi.mock('@prisma/client', () => ({ PrismaClient: vi.fn(function (this: any) { Object.assign(this, mocks); }) }));
vi.mock('../services/cacheService.js', () => ({ cacheGet: vi.fn(() => null), cacheSet: vi.fn(), cacheDelete: vi.fn(), cacheClearByPrefix: vi.fn() }));
vi.mock('../services/featureFlags.js', () => ({
  freestyleAvailableFor: () => flags.freestyle,
  logAdaptationAvailableFor: () => flags.logAdaptation,
  phaseInferenceAvailableFor: () => flags.phase,
}));
// The default strength-profile warm imports the route; keep it inert.
vi.mock('../routes/strength.js', () => ({ getStrengthProfileCached: vi.fn(async () => null) }));

import {
  buildTrainingSummary, historyFromRows, liftTrends, profileHighlights, recentSessions, renderTrainingSummary,
  trainingSummaryEnabledFor, type SummaryData,
} from '../services/trainingSummary.js';
import { assembleContext, renderContext } from '../agent/context.js';

const TODAY = '2026-10-05';
const ex = (name: string, weightKg: number | null, reps: number, sets = 3) => ({ name, sets, reps: String(reps), weightKg, bodyweight: weightKg == null });

/** Weekly bench sessions with rising load, plus a flat squat. */
function rows() {
  const out: any[] = [];
  for (let w = 0; w < 6; w++) {
    const d = new Date(Date.UTC(2026, 7, 27 + w * 7)).toISOString().slice(0, 10); // Aug 27 → Oct 1
    out.push({ id: `w${w}`, date: d, title: w === 5 ? 'Push day' : null, exercises: JSON.stringify([ex(w % 2 ? 'bench press' : 'Barbell Bench Press', 80 + w * 2.5, 5), ex('Squat', 120, 5), ex('Pull-Up', null, 8)]) });
  }
  out.push({ id: 'w6', date: '2026-10-04', title: 'Legs', exercises: JSON.stringify([ex('Squat', 120, 5), ex('Romanian Deadlift', 100, 8)]) });
  return out;
}

beforeEach(() => {
  Object.values(mocks).forEach((m) => Object.values(m).forEach((fn: any) => fn.mockReset()));
  flags.freestyle = false; flags.logAdaptation = false; flags.phase = false;
  mocks.exerciseNormalization.findMany.mockResolvedValue([]);
  mocks.workoutLog.findMany.mockResolvedValue(rows());
  mocks.user.findUnique.mockResolvedValue({ unitPreference: 'metric', savedProgram: null, email: 'a@b.c' });
});

describe('summary pieces (pure)', () => {
  it('lists last-14-day sessions newest first with canonical top lifts in the user unit', () => {
    const h = historyFromRows(rows());
    const s = recentSessions(h, TODAY, 'metric');
    expect(s.map((x) => x.date)).toEqual(['2026-10-04', '2026-10-01', '2026-09-24']);
    expect(s[1].title).toBe('Push day');
    expect(s[1].lifts[0]).toMatch(/^Squat 120 kg×5/);
    expect(s[1].lifts.join(' ')).toContain('Bench Press 92.5 kg×5');
    const imperial = recentSessions(h, TODAY, 'imperial');
    expect(imperial[1].lifts.join(' ')).toContain('Bench Press 204 lbs×5');
  });

  it('classifies per-lift trends, merging spellings', () => {
    const t = liftTrends(historyFromRows(rows()), TODAY, 'metric');
    const bench = t.find((x) => x.name === 'Bench Press')!;
    expect(bench.trend).toBe('progressing');
    expect(bench.weeks).toBe(6);
    expect(t.find((x) => x.name === 'Squat')!.trend).toBe('plateau');
    expect(t.some((x) => /bench/i.test(x.name) && x.name !== 'Bench Press')).toBe(false);
  });

  it('buckets athlete-model insights', () => {
    expect(profileHighlights(null)).toBeNull();
    const h = profileHighlights({ athleteModel: { insights: [
      { kind: 'win', title: 'Your quads are climbing' }, { kind: 'stagnation', title: 'Overhead Press has stalled' },
      { kind: 'neglect', title: 'Hamstrings is under-trained' }, { kind: 'imbalance', title: 'Push:pull is out of balance' },
    ] } });
    expect(h).toEqual({ wins: ['Your quads are climbing'], imbalances: ['Push:pull is out of balance'], neglected: ['Hamstrings is under-trained'], stalled: ['Overhead Press has stalled'] });
  });

  it('renders every section and stays within budget by shedding detail', () => {
    const base: SummaryData = {
      unit: 'metric', today: TODAY, hasProgram: false, totalWorkouts: 7,
      sessions: recentSessions(historyFromRows(rows()), TODAY, 'metric'),
      trends: liftTrends(historyFromRows(rows()), TODAY, 'metric'),
      highlights: { wins: ['Your quads are climbing'], imbalances: [], neglected: ['Hamstrings is under-trained'], stalled: [] },
      phase: { effective: 'building_strength', inferred: 'building_strength', confidence: 0.72, confirmed: null, statedGoalMismatch: 'You said bulk, but bodyweight has fallen for 3 weeks' },
      pending: ['Bench Press: ready for 95 kg'],
    };
    const out = renderTrainingSummary(base)!;
    expect(out).toContain('3 sessions in the last 14 days');
    expect(out).toContain('no saved program');
    expect(out).toContain('Bench Press progressing');
    expect(out).toContain('neglected: Hamstrings is under-trained');
    expect(out).toContain('building strength (inferred, 72% confidence)');
    expect(out).toContain('Goal mismatch: You said bulk');
    expect(out).toContain('"Bench Press: ready for 95 kg"');
    expect(out.length).toBeLessThanOrEqual(1200);

    const many = { ...base, sessions: Array.from({ length: 14 }, (_v, i) => ({ date: `2026-09-${String(10 + i).padStart(2, '0')}`, title: 'A very long session title indeed', lifts: ['Bench Press 100 kg×5', 'Squat 140 kg×5', 'Romanian Deadlift 120 kg×8'], more: 3 })) };
    const tight = renderTrainingSummary(many)!;
    expect(tight.length).toBeLessThanOrEqual(1200);
    expect(tight).toContain('earlier');
    expect(renderTrainingSummary({ ...base, totalWorkouts: 0 })).toBeNull();
  });
});

describe('buildTrainingSummary', () => {
  it('assembles from history + deps, gating phase on its flag', async () => {
    const inferPhase = vi.fn(async () => ({ inferred: 'cutting', confidence: 0.8, evidence: [], since: null, confirmed: null, effective: 'cutting', maintenanceKcal: null, maintenanceSource: null, statedGoalMismatch: null } as any));
    const deps = { inferPhase, listPendingTitles: async () => ['Deload next week'], cachedProfile: () => ({ athleteModel: { insights: [{ kind: 'win', title: 'Back is climbing' }] } }), now: new Date(`${TODAY}T12:00:00Z`) };
    const off = (await buildTrainingSummary('u1', deps))!;
    expect(off).toContain('Bench Press');
    expect(off).toContain('wins: Back is climbing');
    expect(off).toContain('"Deload next week"');
    expect(off).not.toContain('Training phase');
    expect(inferPhase).not.toHaveBeenCalled();
    flags.phase = true;
    expect(await buildTrainingSummary('u1', deps)).toContain('Training phase — cutting');
  });

  it('fails soft: a broken dependency drops only its section, a broken read returns null', async () => {
    flags.phase = true;
    const out = await buildTrainingSummary('u1', { inferPhase: async () => { throw new Error('boom'); }, listPendingTitles: async () => { throw new Error('boom'); }, cachedProfile: () => null, now: new Date(`${TODAY}T12:00:00Z`) });
    expect(out).toContain('Training log');
    mocks.workoutLog.findMany.mockRejectedValueOnce(new Error('db down'));
    expect(await buildTrainingSummary('u1', { cachedProfile: () => null })).toBeNull();
    mocks.workoutLog.findMany.mockResolvedValueOnce([]);
    expect(await buildTrainingSummary('u1', { cachedProfile: () => null })).toBeNull();
  });

  it("anchors on the user's LOCAL today and reads only the 12-week window", async () => {
    // 03:00 UTC on Oct 5 is still Oct 4 in Los Angeles: the 14-day window
    // reaches back to Sep 21 there (Sep 22 by the UTC date).
    mocks.user.findUnique.mockResolvedValue({ unitPreference: 'metric', savedProgram: null, email: 'a@b.c', timezone: 'America/Los_Angeles' });
    mocks.workoutLog.findMany.mockResolvedValue([...rows(), { id: 'w9', date: '2026-09-21', title: null, exercises: JSON.stringify([ex('Squat', 120, 5)]) }]);
    const now = new Date('2026-10-05T03:00:00Z');
    const la = (await buildTrainingSummary('u1', { cachedProfile: () => null, pendingTitles: [], now }))!;
    expect(la).toContain('4 sessions in the last 14 days');
    expect(mocks.workoutLog.findMany.mock.calls[0][0].where).toEqual({ userId: 'u1', date: { gte: '2026-07-12' } });
    mocks.user.findUnique.mockResolvedValue({ unitPreference: 'metric', savedProgram: null, email: 'a@b.c', timezone: 'UTC' });
    expect(await buildTrainingSummary('u1', { cachedProfile: () => null, pendingTitles: [], now })).toContain('3 sessions in the last 14 days');
  });

  it('uses pending titles the caller already fetched (no second read)', async () => {
    const listPendingTitles = vi.fn(async () => ['should not be read']);
    const out = (await buildTrainingSummary('u1', { cachedProfile: () => null, pendingTitles: ['Try 82.5 kg'], listPendingTitles, now: new Date(`${TODAY}T12:00:00Z`) }))!;
    expect(out).toContain('"Try 82.5 kg"');
    expect(listPendingTitles).not.toHaveBeenCalled();
  });

  it('serves the per-user cache without touching the database, and writes it after a build', async () => {
    const cache = await import('../services/cacheService.js');
    (cache.cacheGet as any).mockReturnValueOnce({ text: 'cached summary' });
    expect(await buildTrainingSummary('u1')).toBe('cached summary');
    expect(mocks.user.findUnique).not.toHaveBeenCalled();
    const out = await buildTrainingSummary('u1', { cachedProfile: () => null, pendingTitles: [], now: new Date(`${TODAY}T12:00:00Z`) });
    expect(cache.cacheSet).toHaveBeenCalledWith('training:summary:u1', { text: out }, 5 * 60 * 1000);
  });

  it('older history with nothing in the window still summarizes; never-logged is null', async () => {
    mocks.workoutLog.findMany.mockResolvedValue([]);
    (mocks.workoutLog as any).count = vi.fn(async () => 12);
    const out = await buildTrainingSummary('u1', { cachedProfile: () => null, pendingTitles: [], now: new Date(`${TODAY}T12:00:00Z`) });
    expect(out).toContain('nothing logged in the last 14 days');
    (mocks.workoutLog as any).count = vi.fn(async () => 0);
    expect(await buildTrainingSummary('u1', { cachedProfile: () => null, pendingTitles: [], now: new Date(`${TODAY}T12:00:00Z`) })).toBeNull();
    delete (mocks.workoutLog as any).count;
  });

  it('is gated on freestyle OR logAdaptation', () => {
    expect(trainingSummaryEnabledFor('u1')).toBe(false);
    flags.logAdaptation = true;
    expect(trainingSummaryEnabledFor('u1')).toBe(true);
  });
});

describe('agent context injection', () => {
  beforeEach(() => {
    mocks.user.findUnique.mockResolvedValue({ name: 'T', email: 'a@b.c', tier: 'pro', heightCm: 180, weightKg: 80, unitPreference: 'metric', trainingAge: null, equipment: null, constraintsText: null, coachGoal: null, coachBudget: null, coachProfile: null, savedProgram: null });
    mocks.mealEntry.findMany.mockResolvedValue([]);
    mocks.bodyWeightLog.findMany.mockResolvedValue([]);
    mocks.wellnessCheckin.findFirst.mockResolvedValue(null);
    mocks.agentMemory.findUnique.mockResolvedValue(null);
    mocks.adaptationProposal.findMany.mockResolvedValue([]);
  });

  it('adds no workout history when the flags are off (today’s behavior)', async () => {
    const ctx = await assembleContext('u1');
    expect(ctx.trainingSummary).toBeNull();
    expect(renderContext(ctx)).not.toContain('Training log');
    expect(mocks.workoutLog.findMany).not.toHaveBeenCalled();
  });

  it('injects the summary + usage guidance when a flag is on', async () => {
    flags.freestyle = true;
    const ctx = await assembleContext('u1');
    const text = renderContext(ctx);
    expect(text).toContain('## Training log');
    expect(text).toContain('suggest_session');
    expect(text).toContain('how am I doing');
  });

  it('builds the summary alongside the other reads, reusing the pending titles it fetched', async () => {
    flags.freestyle = true;
    mocks.adaptationProposal.findMany.mockResolvedValue([{ title: 'Bench: try 82.5 kg' }]);
    const ctx = await assembleContext('u1');
    expect(ctx.trainingSummary).toContain('"Bench: try 82.5 kg"');
    expect(mocks.adaptationProposal.findMany).toHaveBeenCalledTimes(1);
  });

  it('respects the logs consent switch', async () => {
    flags.freestyle = true;
    mocks.user.findUnique.mockResolvedValue({ name: 'T', email: 'a@b.c', tier: 'pro', heightCm: null, weightKg: null, unitPreference: 'metric', trainingAge: null, equipment: null, constraintsText: null, coachGoal: null, coachBudget: null, coachProfile: JSON.stringify({ consent: { logs: false } }) });
    const ctx = await assembleContext('u1');
    expect(ctx.trainingSummary).toBeNull();
  });
});
