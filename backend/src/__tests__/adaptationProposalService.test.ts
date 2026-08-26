// The DB layer: dedupe / suppression on create, apply writes targets + an
// inverse, undo restores, bootstrap cohorts, and the "last time" lookup.
// Prisma is mocked with an in-memory store so we can assert the program that
// actually gets persisted.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const store = vi.hoisted(() => ({
  user: { savedProgram: null as string | null, unitPreference: 'metric' },
  workouts: [] as any[],
  norm: [] as Array<{ rawName: string; canonicalName: string }>,
  proposals: [] as any[],
  seq: 0,
}));

vi.mock('@prisma/client', () => ({
  PrismaClient: vi.fn(function (this: any) {
    this.user = {
      findUnique: vi.fn(async () => ({ ...store.user })),
      update: vi.fn(async (args: any) => { Object.assign(store.user, args.data); return { ...store.user }; }),
    };
    this.workoutLog = { findMany: vi.fn(async () => store.workouts.slice().sort((a, b) => (a.date < b.date ? -1 : 1))) };
    this.exerciseNormalization = { findMany: vi.fn(async () => store.norm) };
    this.adaptationProposal = {
      findMany: vi.fn(async (args: any) => store.proposals.filter(p => matches(p, args?.where))),
      findFirst: vi.fn(async (args: any) => store.proposals.filter(p => matches(p, args?.where)).sort((a, b) => b.createdAt - a.createdAt)[0] ?? null),
      findUnique: vi.fn(async (args: any) => store.proposals.find(p => p.id === args.where.id) ?? null),
      create: vi.fn(async (args: any) => {
        const row = { id: 'p' + (++store.seq), status: 'pending', inverse: null, decidedAt: null, snoozeUntil: null, createdAt: new Date(2026, 7, 20 + store.seq), updatedAt: new Date(), ...args.data };
        store.proposals.push(row); return row;
      }),
      update: vi.fn(async (args: any) => { const r = store.proposals.find(p => p.id === args.where.id); Object.assign(r, args.data, { updatedAt: new Date() }); return r; }),
      updateMany: vi.fn(async (args: any) => { let n = 0; for (const p of store.proposals) if (matches(p, args.where)) { Object.assign(p, args.data); n++; } return { count: n }; }),
    };
  }),
}));
vi.mock('../services/cacheService.js', () => ({ cacheDelete: vi.fn(), cacheClearByPrefix: vi.fn() }));

function matches(row: any, where: any): boolean {
  if (!where) return true;
  for (const [k, v] of Object.entries(where)) {
    if (k === 'OR') { if (!(v as any[]).some(w => matches(row, w))) return false; continue; }
    if (v && typeof v === 'object' && !(v instanceof Date)) {
      const o = v as any;
      if ('in' in o && !o.in.includes(row[k])) return false;
      if ('gte' in o && !(row[k] != null && row[k] >= o.gte)) return false;
      if ('lte' in o && !(row[k] != null && row[k] <= o.lte)) return false;
      continue;
    }
    if (row[k] !== v) return false;
  }
  return true;
}

import { createProposals, decide, undo, bootstrap, listPending, runPostWorkout, lastForExercises, seedTargetsForNewProgram } from '../adaptation/proposalService.js';

const program = () => ({
  goal: 'strength',
  phases: [{ trainingDays: [
    { day: 'Upper A', exercises: [{ exercise: 'Bench Press', sets: 3, reps: '6-8', intensity: 'RPE 8' }, { exercise: 'Overhead Press', sets: 3, reps: '8', intensity: 'RPE 7' }] },
    { day: 'Upper B', exercises: [{ exercise: 'Barbell Bench Press', sets: 3, reps: '8-10', intensity: 'RPE 7' }] },
  ] }],
});
const benchLog = (id: string, date: string, weightKg: number, reps = 8) => ({
  id, date, programDayRef: null,
  exercises: JSON.stringify([{ name: 'Bench Press', sets: 3, reps: String(reps), weightKg, setEntries: [{ weightKg, reps }, { weightKg, reps }, { weightKg, reps }] }]),
});
const draft = (key = 'load_change:bench press') => ({
  kind: 'load_change' as const, dedupeKey: key, title: 't', evidence: [], reasoning: 'r', confidence: 0.65, priority: 40,
  proposal: { kind: 'load_change' as const, key: 'bench press', exercise: 'Bench Press', fromWeightKg: 80, toWeightKg: 82.5, scope: 'program' as const },
});

beforeEach(() => {
  store.user = { savedProgram: JSON.stringify(program()), unitPreference: 'metric' };
  store.workouts = []; store.norm = []; store.proposals = []; store.seq = 0;
  process.env.ADAPTATION_USER_ALLOWLIST = 'u1';
});

describe('createProposals', () => {
  it('creates once per dedupeKey and blocks while one is pending', async () => {
    const a = await createProposals('u1', [draft(), draft()], 'post_workout');
    expect(a).toHaveLength(1);
    const b = await createProposals('u1', [draft()], 'post_workout');
    expect(b).toHaveLength(0);
  });
  it('blocks while snoozed, allows after the snooze expires', async () => {
    const now = new Date('2026-08-26T00:00:00Z');
    const [p] = await createProposals('u1', [draft()], 'post_workout', now);
    await decide('u1', p.id, 'snooze', { snoozeDays: 3, now });
    expect(await createProposals('u1', [draft()], 'post_workout', new Date('2026-08-27T00:00:00Z'))).toHaveLength(0);
    expect(await listPending('u1', new Date('2026-08-30T00:00:00Z'))).toHaveLength(1); // snooze expired → pending again
  });
  it('suppresses a kind the user has declined three times recently', async () => {
    const now = new Date('2026-08-26T00:00:00Z');
    for (let i = 0; i < 3; i++) {
      const [p] = await createProposals('u1', [draft()], 'post_workout', now);
      await decide('u1', p.id, 'decline', { now });
    }
    expect(await createProposals('u1', [draft()], 'post_workout', now)).toHaveLength(0);
    // ...but a different lift is unaffected.
    expect(await createProposals('u1', [draft('load_change:back squat')], 'post_workout', now)).toHaveLength(1);
  });
});

describe('decide(apply) / undo', () => {
  it('apply writes the target onto every matching exercise, stores an inverse; undo restores', async () => {
    const [p] = await createProposals('u1', [draft()], 'post_workout');
    const r = await decide('u1', p.id, 'apply');
    expect(r.touched).toBe(2);
    expect(r.proposal.status).toBe('applied');
    const saved = JSON.parse(store.user.savedProgram!);
    expect(saved.phases[0].trainingDays[0].exercises[0].targetWeightKg).toBe(82.5);
    expect(saved.phases[0].trainingDays[1].exercises[0].targetWeightKg).toBe(82.5);
    expect(saved.phases[0].trainingDays[0].exercises[1]).not.toHaveProperty('targetWeightKg');
    expect(r.proposal.inverse).toMatchObject({ kind: 'set_targets', targets: [{ key: 'bench press', targetWeightKg: null }] });

    const u = await undo('u1', p.id);
    expect(u.proposal.status).toBe('undone');
    const restored = JSON.parse(store.user.savedProgram!);
    expect(restored.phases[0].trainingDays[0].exercises[0]).not.toHaveProperty('targetWeightKg');
  });
  it('apply honours user edits and records them on the proposal', async () => {
    const [p] = await createProposals('u1', [draft()], 'post_workout');
    const r = await decide('u1', p.id, 'apply', { edits: [{ key: 'bench press', targetWeightKg: 81 }] });
    expect(JSON.parse(store.user.savedProgram!).phases[0].trainingDays[0].exercises[0].targetWeightKg).toBe(81);
    expect((r.proposal.proposal as any).toWeightKg).toBe(81);
  });
  it('refuses to decide twice, and refuses another user', async () => {
    const [p] = await createProposals('u1', [draft()], 'post_workout');
    await decide('u1', p.id, 'decline');
    await expect(decide('u1', p.id, 'apply')).rejects.toThrow(/already declined/);
    await expect(decide('u2', p.id, 'apply')).rejects.toThrow(/not found/);
    await expect(undo('u1', p.id)).rejects.toThrow(/Nothing to undo/);
  });
});

describe('bootstrap', () => {
  it('no program → no_program', async () => {
    store.user.savedProgram = null;
    expect(await bootstrap('u1')).toEqual({ cohort: 'no_program' });
  });
  it('program but no loaded history → no_history (Cohort B)', async () => {
    store.workouts = [{ id: 'w', date: '2026-08-01', programDayRef: null, exercises: JSON.stringify([{ name: 'Push-Up', sets: 3, reps: '15', bodyweight: true }]) }];
    expect(await bootstrap('u1')).toEqual({ cohort: 'no_history', workouts: 1 });
  });
  it('program + history → one retrofit proposal; second call reports it pending; after apply it is bootstrapped', async () => {
    store.workouts = [benchLog('a', '2026-07-01', 80), benchLog('b', '2026-07-08', 80), benchLog('c', '2026-07-15', 80)];
    const r1 = await bootstrap('u1');
    expect(r1.cohort).toBe('retrofit');
    const prop = (r1 as any).proposal;
    expect(prop.kind).toBe('retrofit');
    expect(prop.proposal.targets.find((t: any) => t.key === 'bench press')).toMatchObject({ targetWeightKg: 80, finding: 'ready_to_bump' });
    expect(prop.proposal.targets.find((t: any) => t.key === 'overhead press')).toMatchObject({ finding: 'calibrate', targetWeightKg: null });

    const r2 = await bootstrap('u1');
    expect(r2.cohort).toBe('retrofit_pending');

    const applied = await decide('u1', prop.id, 'apply');
    expect(applied.touched).toBe(2); // bench on both days; OHP has no target → skipped
    expect(JSON.parse(store.user.savedProgram!).phases[0].trainingDays[0].exercises[0].targetWeightKg).toBe(80);
    expect(await bootstrap('u1')).toEqual({ cohort: 'already_bootstrapped' });
  });
});

describe('runPostWorkout', () => {
  it('is gated per user and only proposes for the lifts logged', async () => {
    store.workouts = [benchLog('a', '2026-08-10', 80), benchLog('b', '2026-08-17', 80)];
    process.env.ADAPTATION_USER_ALLOWLIST = 'someone-else';
    expect(await runPostWorkout('u1', ['Bench Press'])).toEqual([]);
    process.env.ADAPTATION_USER_ALLOWLIST = 'u1';
    const rows = await runPostWorkout('u1', ['Bench Press', 'Overhead Press']);
    expect(rows.map(r => r.dedupeKey)).toEqual(['load_change:bench press']);
    expect((rows[0].proposal as any).toWeightKg).toBe(82.5);
  });
});

describe('lastForExercises / seedTargetsForNewProgram', () => {
  it('returns recent exposures, the plan target and a score for the last session', async () => {
    store.workouts = [benchLog('a', '2026-08-10', 80), benchLog('b', '2026-08-17', 82.5)];
    const [bench, ohp] = await lastForExercises('u1', ['bench press', 'OHP']);
    expect(bench.key).toBe('bench press');
    expect(bench.exposures[0].date).toBe('2026-08-17');
    expect(bench.exposures[0].top).toEqual({ weightKg: 82.5, reps: 8, rpe: null });
    expect(bench.target).toMatchObject({ targetWeightKg: null, targetRPE: 8, reps: '6-8', sets: 3 });
    expect(bench.lastScore?.result).toBe('exceeded');
    expect(ohp.exposures).toEqual([]);
    expect(ohp.target).toMatchObject({ reps: '8' });
    expect(ohp.lastScore).toBeNull();
  });
  it('seeds a brand-new program with targets from history', async () => {
    store.workouts = [benchLog('a', '2026-08-10', 80), benchLog('b', '2026-08-17', 80), benchLog('c', '2026-08-20', 80)];
    const { program: seeded, seeded: n } = await seedTargetsForNewProgram('u1', program());
    expect(n).toBe(2);
    expect(seeded.phases[0].trainingDays[0].exercises[0].targetWeightKg).toBe(80);
    expect(seeded.phases[0].trainingDays[0].exercises[0].targetBasis).toBe('history');
    expect(seeded.phases[0].trainingDays[0].exercises[1]).not.toHaveProperty('targetWeightKg');
  });
});
