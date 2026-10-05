// Freestyle release, DB layer: log-trend wiring in runPostWorkout / weekly,
// guardrails (cap, dedupe, decline snooze), apply + undo for every new kind
// with and without a program, suggestions on lastForExercises, flag-off no-ops.
// Prisma is an in-memory store (same pattern as adaptationProposalService.test).
import { describe, it, expect, vi, beforeEach } from 'vitest';

const store = vi.hoisted(() => ({
  user: {} as any,
  workouts: [] as any[],
  proposals: [] as any[],
  seq: 0,
  flags: { log: false, phase: false },
  phase: null as any,
  confirmed: null as any,
}));

vi.mock('@prisma/client', () => ({
  PrismaClient: vi.fn(function (this: any) {
    this.user = {
      findUnique: vi.fn(async () => ({ ...store.user })),
      update: vi.fn(async (args: any) => { Object.assign(store.user, args.data); return { ...store.user }; }),
    };
    this.workoutLog = { findMany: vi.fn(async () => store.workouts.slice().sort((a, b) => (a.date < b.date ? -1 : 1))) };
    this.exerciseNormalization = { findMany: vi.fn(async () => []) };
    this.wellnessCheckin = { findMany: vi.fn(async () => []) };
    this.adaptationProposal = {
      findMany: vi.fn(async (args: any) => store.proposals.filter(p => matches(p, args?.where))),
      findFirst: vi.fn(async (args: any) => store.proposals.filter(p => matches(p, args?.where))[0] ?? null),
      findUnique: vi.fn(async (args: any) => store.proposals.find(p => p.id === args.where.id) ?? null),
      create: vi.fn(async (args: any) => {
        const row = { id: 'p' + (++store.seq), status: 'pending', inverse: null, decidedAt: null, snoozeUntil: null, createdAt: new Date(), updatedAt: new Date(), ...args.data };
        store.proposals.push(row); return row;
      }),
      update: vi.fn(async (args: any) => { const r = store.proposals.find(p => p.id === args.where.id); Object.assign(r, args.data); return r; }),
      updateMany: vi.fn(async (args: any) => {
        const rows = store.proposals.filter(p => matches(p, args?.where));
        for (const r of rows) Object.assign(r, args.data);
        return { count: rows.length };
      }),
    };
  }),
}));
vi.mock('../services/cacheService.js', () => ({ cacheDelete: vi.fn(), cacheClearByPrefix: vi.fn(), cacheGet: vi.fn(() => null), cacheSet: vi.fn() }));
vi.mock('../services/completedProgramService.js', () => ({ archiveProgram: vi.fn(async () => ({ id: 'cp1' })) }));
vi.mock('../services/trainTogetherService.js', () => ({ deriveSplitLabel: () => 'PPL' }));
vi.mock('../services/featureFlags.js', () => ({
  logAdaptationAvailableFor: () => store.flags.log,
  phaseInferenceAvailableFor: () => store.flags.phase,
}));
vi.mock('../services/phaseInference.js', () => ({
  EFFECTIVE_CONFIDENCE: 0.6,
  inferPhaseDetailed: vi.fn(async () => store.phase),
  setConfirmedPhase: vi.fn(async (_u: string, phase: string) => { const prev = store.confirmed; store.confirmed = { phase, source: 'confirmed' }; return prev; }),
  restoreConfirmedPhase: vi.fn(async (_u: string, prev: any) => { store.confirmed = prev; }),
}));

function matches(row: any, where: any): boolean {
  if (!where) return true;
  for (const [k, v] of Object.entries(where)) {
    if (k === 'OR') { if (!(v as any[]).some(w => matches(row, w))) return false; continue; }
    if (v && typeof v === 'object' && !(v instanceof Date)) {
      const o = v as any;
      if ('in' in o && !o.in.includes(row[k])) return false;
      if ('not' in o && row[k] === o.not) return false;
      if ('gte' in o && !(row[k] != null && row[k] >= o.gte)) return false;
      if ('lte' in o && !(row[k] != null && row[k] <= o.lte)) return false;
      continue;
    }
    if (row[k] !== v) return false;
  }
  return true;
}

import {
  runPostWorkout, runWeeklyForUser, createLogTrendProposals, decide, undo, lastForExercises,
} from '../adaptation/proposalService.js';

const today = new Date();
const d = (daysAgo: number) => new Date(today.getTime() - daysAgo * 86400000).toISOString().slice(0, 10);
const log = (id: string, ago: number, items: Array<[string, number, number, number | null]>) => ({
  id, date: d(ago), programDayRef: null,
  exercises: JSON.stringify(items.map(([name, w, reps, rpe]) => ({ name, sets: 3, reps: String(reps), weightKg: w, setEntries: [0, 1, 2].map(() => ({ weightKg: w, reps, rpe })) }))),
});
// Bench getting easier (RPE 9 → 8 → 7.5 at 80 × 8).
const easierBench = () => [log('w1', 14, [['Bench Press', 80, 8, 9]]), log('w2', 7, [['Bench Press', 80, 8, 8]]), log('w3', 0, [['Bench Press', 80, 8, 7.5]])];
const program = () => ({ phases: [{ trainingDays: [{ day: 'A', exercises: [{ exercise: 'Bench Press', sets: 3, reps: '6-8', intensity: 'RPE 8', targetWeightKg: 80 }] }] }] });
const draft = (key: string, priority = 40, kind = 'next_session') => ({
  kind, dedupeKey: `lift:${key}`, title: 't', evidence: [], reasoning: 'r', confidence: 0.7, priority,
  proposal: { kind: 'next_session', key, exercise: key, action: 'add_load', fromWeightKg: 80, toWeightKg: 82.5, reps: '8', sets: 3, rpe: 8 },
}) as any;
const seed = (data: any) => { const row = { id: 'p' + (++store.seq), userId: 'u1', status: 'pending', inverse: null, decidedAt: null, snoozeUntil: null, createdAt: new Date(), evidence: '[]', reasoning: 'r', title: 't', confidence: 0.7, trigger: 'post_workout', ...data, proposal: JSON.stringify(data.proposal ?? {}) }; store.proposals.push(row); return row; };

beforeEach(() => {
  // Fixture dates are UTC dates, so the user lives in UTC.
  store.user = { savedProgram: null, unitPreference: 'metric', email: 'a@b.c', prefsJson: null, dailyCalorieTarget: 1800, programStartDate: null, splitLabel: null, timezone: 'UTC' };
  store.workouts = []; store.proposals = []; store.seq = 0;
  store.flags = { log: false, phase: false };
  store.phase = null; store.confirmed = null;
  delete process.env.ADAPTATION_ENABLED;
  process.env.ADAPTATION_USER_ALLOWLIST = '';
});

describe('runPostWorkout — log-trend wiring', () => {
  it('flag off → no-op (today\'s behaviour)', async () => {
    store.workouts = easierBench();
    expect(await runPostWorkout('u1', ['Bench Press'])).toEqual([]);
    expect(store.proposals).toHaveLength(0);
  });
  it('flag on, no program → a next_session card for the logged lift', async () => {
    store.flags.log = true;
    store.workouts = easierBench();
    const rows = await runPostWorkout('u1', ['Bench Press']);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'next_session', dedupeKey: 'lift:bench press', trigger: 'post_workout' });
    expect(rows[0].proposal).toMatchObject({ action: 'add_load', toWeightKg: 82.5 });
  });
  it('respects the per-user "stop suggesting" switch', async () => {
    store.flags.log = true;
    store.user.prefsJson = JSON.stringify({ adaptationEnabled: false });
    store.workouts = easierBench();
    expect(await runPostWorkout('u1', ['Bench Press'])).toEqual([]);
  });
  it('with a program, double progression keeps its lift — no double proposal', async () => {
    store.flags.log = true;
    process.env.ADAPTATION_USER_ALLOWLIST = 'u1';
    store.user.savedProgram = JSON.stringify(program());
    // Topped the 6–8 range at the 80 kg target twice, RPE 7 → load_change.
    store.workouts = [log('w1', 14, [['Bench Press', 80, 8, 7]]), log('w2', 7, [['Bench Press', 80, 8, 7]])];
    const rows = await runPostWorkout('u1', ['Bench Press']);
    expect(rows.map(r => r.kind)).toEqual(['load_change']);
  });
});

describe('guardrails', () => {
  it('max 3 new log-trend cards per rolling 7 days, highest priority first', async () => {
    const rows = await createLogTrendProposals('u1', [draft('a', 10), draft('b', 50), draft('c', 30), draft('d', 40)], 'weekly');
    expect(rows.map(r => r.dedupeKey)).toEqual(['lift:b', 'lift:d', 'lift:c']);
    expect(await createLogTrendProposals('u1', [draft('e', 99)], 'weekly')).toEqual([]);
  });
  it('one open card per lift; a pending load_change blocks the lift too', async () => {
    seed({ kind: 'next_session', dedupeKey: 'lift:a', createdAt: new Date(Date.now() - 10 * 86400000) });
    seed({ kind: 'load_change', dedupeKey: 'load_change:b' });
    const rows = await createLogTrendProposals('u1', [draft('a'), draft('b'), draft('c')], 'post_workout');
    expect(rows.map(r => r.dedupeKey)).toEqual(['lift:c']);
  });
  it('declined lift → quiet 14 days; declined phase → 21 days', async () => {
    const old = new Date(Date.now() - 30 * 86400000);
    seed({ kind: 'next_session', dedupeKey: 'lift:a', status: 'declined', decidedAt: new Date(Date.now() - 10 * 86400000), createdAt: old });
    seed({ kind: 'next_session', dedupeKey: 'lift:b', status: 'declined', decidedAt: new Date(Date.now() - 15 * 86400000), createdAt: old });
    seed({ kind: 'phase_confirm', dedupeKey: 'phase_confirm:cutting', status: 'declined', decidedAt: new Date(Date.now() - 18 * 86400000), createdAt: old });
    const phase = { ...draft('x'), kind: 'phase_confirm', dedupeKey: 'phase_confirm:cutting', proposal: { kind: 'phase_confirm', phase: 'cutting', previous: null, evidence: [] } };
    const rows = await createLogTrendProposals('u1', [draft('a'), draft('b'), phase], 'weekly');
    expect(rows.map(r => r.dedupeKey)).toEqual(['lift:b']);
  });
});

describe('apply / undo — new kinds', () => {
  it('next_session without a program: no program write, no throw; the row is the target; undo marks it undone', async () => {
    const row = seed({ kind: 'next_session', dedupeKey: 'lift:bench press', proposal: draft('bench press').proposal });
    const r = await decide('u1', row.id, 'apply', { edits: [{ key: 'bench press', targetWeightKg: 85, reps: '6', sets: 4 }] });
    expect(r.proposal.status).toBe('applied');
    expect(r.proposal.proposal).toMatchObject({ toWeightKg: 85, reps: '6', sets: 4 });
    expect(r.proposal.inverse).toEqual({ kind: 'revert_record' });
    expect(store.user.savedProgram).toBeNull();
    const u = await undo('u1', row.id);
    expect(u.proposal.status).toBe('undone');
  });
  it('next_session with a program patches the target (and sets on add_set); undo restores', async () => {
    store.user.savedProgram = JSON.stringify(program());
    const row = seed({ kind: 'next_session', dedupeKey: 'lift:bench press', proposal: { ...draft('bench press').proposal, key: 'bench press', action: 'add_set', toWeightKg: 80, sets: 5 } });
    const r = await decide('u1', row.id, 'apply');
    expect(r.touched).toBe(1);
    let ex = JSON.parse(store.user.savedProgram).phases[0].trainingDays[0].exercises[0];
    expect(ex).toMatchObject({ targetWeightKg: 80, sets: 5, reps: '6-8' });
    await undo('u1', row.id);
    ex = JSON.parse(store.user.savedProgram).phases[0].trainingDays[0].exercises[0];
    expect(ex).toMatchObject({ targetWeightKg: 80, sets: 3 });
  });
  it('Adjust edits that merely echo the card\'s reps / sets do not overwrite the program prescription', async () => {
    store.user.savedProgram = JSON.stringify(program());
    // add_load card: "8" × 3 — the program says "6-8".
    const row = seed({ kind: 'next_session', dedupeKey: 'lift:bench press', proposal: { ...draft('bench press').proposal } });
    await decide('u1', row.id, 'apply', { edits: [{ key: 'bench press', targetWeightKg: 82.5, reps: '8', sets: 3 }] });
    const ex = JSON.parse(store.user.savedProgram).phases[0].trainingDays[0].exercises[0];
    expect(ex).toMatchObject({ targetWeightKg: 82.5, reps: '6-8', sets: 3 });
  });
  it('Adjust edits that change reps / sets do override — in the current phase only', async () => {
    store.user.savedProgram = JSON.stringify({ phases: [
      { durationWeeks: 4, trainingDays: [{ day: 'A', exercises: [{ exercise: 'Bench Press', sets: 3, reps: '6-8', targetWeightKg: 80 }] }] },
      { durationWeeks: 4, trainingDays: [{ day: 'A', exercises: [{ exercise: 'Bench Press', sets: 5, reps: '3', targetWeightKg: 80 }] }] },
    ] });
    store.user.programStartDate = new Date(); // week 1 → phase 0
    const row = seed({ kind: 'next_session', dedupeKey: 'lift:bench press', proposal: { ...draft('bench press').proposal } });
    await decide('u1', row.id, 'apply', { edits: [{ key: 'bench press', targetWeightKg: 82.5, reps: '6', sets: 4 }] });
    let phases = JSON.parse(store.user.savedProgram).phases;
    expect(phases[0].trainingDays[0].exercises[0]).toMatchObject({ reps: '6', sets: 4, targetWeightKg: 82.5 });
    expect(phases[1].trainingDays[0].exercises[0]).toMatchObject({ reps: '3', sets: 5 });
    await undo('u1', row.id);
    phases = JSON.parse(store.user.savedProgram).phases;
    expect(phases[0].trainingDays[0].exercises[0]).toMatchObject({ reps: '6-8', sets: 3, targetWeightKg: 80 });
    expect(phases[1].trainingDays[0].exercises[0]).toMatchObject({ reps: '3', sets: 5, targetWeightKg: 80 });
  });
  it('next_session for a lift not in the program falls back to record-only', async () => {
    store.user.savedProgram = JSON.stringify(program());
    const row = seed({ kind: 'next_session', dedupeKey: 'lift:squat', proposal: { ...draft('squat').proposal } });
    const r = await decide('u1', row.id, 'apply');
    expect(r.proposal.inverse).toEqual({ kind: 'revert_record' });
  });
  it('deload and volume_balance are record-only and undoable', async () => {
    const dl = seed({ kind: 'deload', dedupeKey: 'deload:systemic', proposal: { kind: 'deload', keys: ['bench press'], exercises: ['Bench Press'], volumeCutPct: 40, weeks: 1, reason: 'systemic_fatigue' } });
    const vb = seed({ kind: 'volume_balance', dedupeKey: 'volume:chest:add', proposal: { kind: 'volume_balance', muscle: 'chest', currentSets: 6, suggestedSets: 10, direction: 'add', note: '' } });
    for (const row of [dl, vb]) {
      expect((await decide('u1', row.id, 'apply')).proposal.status).toBe('applied');
      expect((await undo('u1', row.id)).proposal.status).toBe('undone');
    }
  });
  it('phase_confirm writes the confirmed phase; undo restores the previous one', async () => {
    store.confirmed = { phase: 'building_muscle', source: 'user_set' };
    const row = seed({ kind: 'phase_confirm', dedupeKey: 'phase_confirm:cutting', proposal: { kind: 'phase_confirm', phase: 'cutting', previous: 'building_muscle', evidence: [] } });
    await decide('u1', row.id, 'apply');
    expect(store.confirmed.phase).toBe('cutting');
    await undo('u1', row.id);
    expect(store.confirmed).toEqual({ phase: 'building_muscle', source: 'user_set' });
  });
  it('calorie_adjust updates dailyCalorieTarget; undo restores it', async () => {
    const row = seed({ kind: 'calorie_adjust', dedupeKey: 'calorie_adjust', proposal: { kind: 'calorie_adjust', fromKcal: 1800, toKcal: 2050, reason: 'cut_too_aggressive' } });
    await decide('u1', row.id, 'apply');
    expect(store.user.dailyCalorieTarget).toBe(2050);
    await undo('u1', row.id);
    expect(store.user.dailyCalorieTarget).toBe(1800);
  });
  it('decline is just a decline (the 14-day snooze is enforced at creation)', async () => {
    const row = seed({ kind: 'next_session', dedupeKey: 'lift:a', proposal: draft('a').proposal });
    expect((await decide('u1', row.id, 'decline')).proposal.status).toBe('declined');
  });
});

describe('stale pending cards', () => {
  it('a later session of the lift supersedes its pending card, and a fresh card replaces it', async () => {
    store.flags.log = true;
    store.workouts = easierBench();
    // Card created 3 days ago (after w2, before today's w3).
    const stale = seed({ kind: 'next_session', dedupeKey: 'lift:bench press', createdAt: new Date(Date.now() - 3 * 86400000), proposal: { ...draft('bench press').proposal, toWeightKg: 90 } });
    const rows = await runPostWorkout('u1', ['Bench Press']);
    expect(stale.status).toBe('superseded');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'next_session', dedupeKey: 'lift:bench press' });
    expect(rows[0].proposal).toMatchObject({ toWeightKg: 82.5 });
  });
  it('a card created by today\'s session stays pending (and keeps blocking a duplicate)', async () => {
    store.flags.log = true;
    store.workouts = easierBench();
    const current = seed({ kind: 'next_session', dedupeKey: 'lift:bench press', createdAt: new Date(), proposal: draft('bench press').proposal });
    expect(await runPostWorkout('u1', ['Bench Press'])).toEqual([]);
    expect(current.status).toBe('pending');
  });
  it('the weekly sweep retires cards older than 14 days', async () => {
    store.flags.log = true;
    const old = seed({ kind: 'next_session', dedupeKey: 'lift:squat', createdAt: new Date(Date.now() - 20 * 86400000), proposal: { ...draft('squat').proposal } });
    await runWeeklyForUser('u1');
    expect(old.status).toBe('superseded');
  });
  it('the suggestion ignores a stale pending card until the run retires it', async () => {
    store.flags.log = true;
    store.workouts = easierBench();
    seed({ kind: 'next_session', dedupeKey: 'lift:bench press', createdAt: new Date(Date.now() - 3 * 86400000), proposal: { ...draft('bench press').proposal, toWeightKg: 90 } });
    const [r] = await lastForExercises('u1', ['Bench Press']);
    expect(r.suggestion).toMatchObject({ basis: 'trend', weightKg: 82.5, proposalId: null });
  });
});

describe('lastForExercises — suggestion', () => {
  it('null when the flag is off', async () => {
    store.workouts = easierBench();
    const [r] = await lastForExercises('u1', ['Bench Press']);
    expect(r.suggestion).toBeNull();
    expect(r.exposures).toHaveLength(3);
  });
  it('trend-derived when on; an applied next_session becomes the target', async () => {
    store.flags.log = true;
    store.workouts = easierBench();
    let [r] = await lastForExercises('u1', ['Bench Press']);
    expect(r.suggestion).toMatchObject({ basis: 'trend', action: 'add_load', weightKg: 82.5 });
    seed({ kind: 'next_session', dedupeKey: 'lift:bench press', status: 'applied', decidedAt: new Date(), proposal: { ...draft('bench press').proposal, toWeightKg: 85, note: 'Try 85' } });
    [r] = await lastForExercises('u1', ['Bench Press']);
    expect(r.suggestion).toMatchObject({ basis: 'applied_target', weightKg: 85 });
  });
});

describe('runWeeklyForUser', () => {
  it('both flags off → nothing', async () => {
    store.workouts = easierBench();
    expect(await runWeeklyForUser('u1')).toEqual([]);
  });
  it('phase flag → phase_confirm (and calorie_adjust for a steep cut)', async () => {
    store.flags.phase = true;
    store.phase = {
      inferred: 'cut_too_aggressive', confidence: 0.8, evidence: [{ label: 'Bodyweight', value: '−1.4%/wk' }], since: null,
      confirmed: null, effective: 'cut_too_aggressive', maintenanceKcal: 2500, maintenanceSource: 'adaptive', statedGoalMismatch: null,
      signals: { bwPctPerWeek: -1.4, avgIntakeKcal: 1700, loggedDays: 20 },
    };
    const rows = await runWeeklyForUser('u1');
    expect(rows.map(r => r.kind).sort()).toEqual(['calorie_adjust', 'phase_confirm']);
    expect(rows.find(r => r.kind === 'calorie_adjust')!.proposal).toMatchObject({ fromKcal: 1800, toKcal: 2050 });
    expect(rows.every(r => r.trigger === 'weekly')).toBe(true);
  });
  it('log flag → plateau cards for stalled lifts (not per-session signals)', async () => {
    store.flags.log = true;
    store.workouts = [35, 28, 21, 14, 7, 0].map((a, i) => log('w' + i, a, [['Back Squat', 100, 5, 8], ['Bench Press', 80 + i * 2.5, 8, 8]]));
    const rows = await runWeeklyForUser('u1');
    // Bench is progressing → no card; squat has stalled on ~3 sets/wk → +2 sets,
    // and quads sit under 10 hard sets/wk → one volume card.
    expect(rows.map(r => r.dedupeKey)).toEqual(['lift:squat', 'volume:quads:add']);
    expect(rows[0].proposal).toMatchObject({ signal: 'plateau', action: 'add_set', strategy: 'volume' });
  });
});
