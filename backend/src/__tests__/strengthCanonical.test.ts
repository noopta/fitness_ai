// D1 — strength-profile correctness: per-set logs drive the numbers, and every
// spelling of a lift keys through the adaptation engine's canonical key
// (DB normalization row → seed dictionary → collapse), in the strength
// profile, in PR detection, and in the shared resolver itself.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  user: { findUnique: vi.fn() },
  workoutLog: { findMany: vi.fn() },
  exerciseNormalization: { findMany: vi.fn() },
  session: { findMany: vi.fn() },
  bodyWeightLog: { findMany: vi.fn() },
  nutritionLog: { findMany: vi.fn() },
  wellnessCheckin: { findMany: vi.fn() },
}));
vi.mock('@prisma/client', () => ({ PrismaClient: vi.fn(function (this: any) { Object.assign(this, mocks); }) }));
vi.mock('../services/llmService.js', () => ({ generateStrengthProfileInsights: vi.fn(async () => []) }));
vi.mock('../services/notificationService.js', () => ({ notifyNewPR: vi.fn(), notifyWeightProgress: vi.fn() }));
vi.mock('../services/cacheService.js', () => ({ cacheGet: vi.fn(() => null), cacheSet: vi.fn(), cacheDelete: vi.fn() }));

import { makeCanonicalResolver, liftResolver, toLedgerExercises, loadCanonicalResolver } from '../services/liftCanonical.js';
import { bestE1RMByLift, detectStrengthPRs, epley1RM } from '../services/progressService.js';
import { computeStrengthProfile, recomputeStrengthProfileInBackground } from '../routes/strength.js';
import { e1rmWithRpe } from '../engine/e1rm.js';
import { cacheDelete } from '../services/cacheService.js';

beforeEach(() => {
  Object.values(mocks).forEach((m) => Object.values(m).forEach((fn: any) => fn.mockReset()));
  mocks.user.findUnique.mockResolvedValue({ id: 'u1', weightKg: 80, unitPreference: 'metric' });
  mocks.exerciseNormalization.findMany.mockResolvedValue([]);
  mocks.session.findMany.mockResolvedValue([]);
  mocks.bodyWeightLog.findMany.mockResolvedValue([]);
  mocks.nutritionLog.findMany.mockResolvedValue([]);
  mocks.wellnessCheckin.findMany.mockResolvedValue([]);
});

describe('canonical resolver', () => {
  it('keys every spelling of a seeded lift the same', () => {
    const r = makeCanonicalResolver();
    expect(r.key('Barbell Bench Press')).toBe(r.key('bench  press'));
    expect(r.key('Flat Bench Press')).toBe(r.key('Bench Press'));
    expect(r.key('Incline Bench Press')).not.toBe(r.key('Bench Press'));
    expect(r.resolve('barbell bench press')).toMatchObject({ canonicalName: 'Bench Press', isCompound: true, category: 'push' });
  });

  it('lets a DB normalization row win over the seed and fills missing classification', () => {
    const r = makeCanonicalResolver([{ rawName: 'Flat BB', canonicalName: 'Bench Press' }]);
    expect(r.key('Flat BB')).toBe(r.key('Bench Press'));
    expect(r.resolve('Flat BB')).toMatchObject({ canonicalName: 'Bench Press', isCompound: true });
  });

  it('falls back to a collapse for unknown names, and returns null meta', () => {
    const r = makeCanonicalResolver();
    expect(r.key('Zercher Carry!!')).toBe('zercher carry');
    expect(r.resolve('Zercher Carry')).toBeNull();
  });

  it('liftResolver gives one display name per key, preferring a known canonical', () => {
    const names = liftResolver([]);
    expect(names.of('bench press').canonical).toBe('Bench Press');
    expect(names.of('Barbell Bench Press').canonical).toBe('Bench Press');
    expect(names.of('Zercher Carry').canonical).toBe('Zercher Carry');
  });

  it('loadCanonicalResolver tolerates a client without the normalization model', async () => {
    const r = await loadCanonicalResolver({} as any, ['Bench Press']);
    expect(r.key('barbell bench press')).toBe(r.key('Bench Press'));
  });

  it('toLedgerExercises groups identical per-set runs and keeps real loads', () => {
    const out = toLedgerExercises({ name: 'x', sets: 3, reps: '5', weightKg: 60, setEntries: [{ weightKg: 100, reps: 5 }, { weightKg: 60, reps: 8 }, { weightKg: 60, reps: 8 }] }, 'Bench Press');
    expect(out).toEqual([
      { name: 'Bench Press', sets: 1, reps: 5, weightKg: 100, rpe: null },
      { name: 'Bench Press', sets: 2, reps: 8, weightKg: 60, rpe: null },
    ]);
    // Unparseable reps keep the old volume signal.
    expect(toLedgerExercises({ name: 'x', sets: 2, reps: 'AMRAP' } as any, 'Pull-Up')[0]).toMatchObject({ name: 'Pull-Up', sets: 2 });
  });
});

describe('computeStrengthProfile (per-set + canonical names)', () => {
  it('uses setEntries for e1RM and tonnage, and merges spellings into one lift', async () => {
    mocks.workoutLog.findMany.mockResolvedValue([
      { date: '2026-09-01', exercises: JSON.stringify([{ name: 'bench press', sets: 3, reps: '5', weightKg: 90 }]) },
      // Top-level weightKg is the back-off load; the real top set lives in setEntries.
      { date: '2026-09-08', exercises: JSON.stringify([{ name: 'Barbell Bench Press', sets: 3, reps: '5', weightKg: 60, setEntries: [{ weightKg: 100, reps: 5 }, { weightKg: 60, reps: 5 }, { weightKg: 60, reps: 5 }] }]) },
    ]);
    const p: any = await computeStrengthProfile('u1');
    expect(p.lifts).toHaveLength(1);
    const bench = p.lifts[0];
    expect(bench.canonicalName).toBe('Bench Press');
    expect(bench.sessionCount).toBe(2);
    expect(bench.isCompound).toBe(true);
    expect(bench.category).toBe('push');
    expect(bench.current1RMkg).toBeCloseTo(e1rmWithRpe(100, 5, null), 5);
    expect(bench.totalTonnageKg).toBe(100 * 5 + 60 * 5 + 60 * 5 + 90 * 5 * 3);
  });

  it('honours the DB normalization map for odd names', async () => {
    mocks.exerciseNormalization.findMany.mockResolvedValue([{ rawName: 'Flat BB', canonicalName: 'Bench Press', category: 'push', primaryMuscle: 'chest', isCompound: true }]);
    mocks.workoutLog.findMany.mockResolvedValue([
      { date: '2026-09-01', exercises: JSON.stringify([{ name: 'Flat BB', sets: 1, reps: '5', weightKg: 80 }]) },
      { date: '2026-09-03', exercises: JSON.stringify([{ name: 'Bench Press', sets: 1, reps: 5, weightKg: 82.5 }]) },
    ]);
    const p: any = await computeStrengthProfile('u1');
    expect(p.lifts.map((l: any) => l.canonicalName)).toEqual(['Bench Press']);
    expect(p.lifts[0].sessionCount).toBe(2);
  });

  it('skips bodyweight-only sets and survives unparseable logs', async () => {
    mocks.workoutLog.findMany.mockResolvedValue([
      { date: '2026-09-01', exercises: 'not json' },
      { date: '2026-09-02', exercises: JSON.stringify([{ name: 'Pull-Up', sets: 3, reps: '8', weightKg: 80, bodyweight: true }]) },
    ]);
    const p: any = await computeStrengthProfile('u1');
    expect(p.lifts).toEqual([]);
    expect(p.totalLogs).toBe(2);
  });

  it('still evicts the cached profile on a workout mutation', () => {
    mocks.workoutLog.findMany.mockResolvedValue([]);
    recomputeStrengthProfileInBackground('u1');
    expect(cacheDelete).toHaveBeenCalledWith('strength:profile:u1');
  });
});

describe('PR detection keys through the canonical name', () => {
  const prismaWith = (prior: any[][], norms: any[] | null = null) => ({
    workoutLog: { findMany: vi.fn(async () => prior.map((ex) => ({ exercises: JSON.stringify(ex) }))) },
    ...(norms ? { exerciseNormalization: { findMany: vi.fn(async () => norms) } } : {}),
  }) as any;

  it('bestE1RMByLift merges spellings when given the key fn', () => {
    const r = makeCanonicalResolver();
    const ex = [{ name: 'Barbell Bench Press', sets: 1, reps: 5, weightKg: 90 }, { name: 'bench press', sets: 1, reps: 3, weightKg: 100 }];
    expect(bestE1RMByLift(ex).size).toBe(2); // legacy lowercase key
    const merged = bestE1RMByLift(ex, r.key);
    expect(merged.size).toBe(1);
    expect([...merged.values()][0].e1RMLbs).toBe(epley1RM(100 * 2.20462, 3));
  });

  it('beats a prior best logged under a different spelling', async () => {
    const prs = await detectStrengthPRs(prismaWith([[{ name: 'Barbell Bench Press', sets: 1, reps: 5, weightKg: 90 }]]), 'u1', 'w-new', [{ name: 'bench press', sets: 1, reps: 3, weightKg: 100 }]);
    expect(prs).toHaveLength(1);
    expect(prs[0].displayName).toBe('bench press');
    expect(prs[0].prevLbs).toBe(epley1RM(90 * 2.20462, 5));
  });

  it('a new spelling that does NOT beat the old best is not a PR (it is not a first-ever lift either)', async () => {
    const prs = await detectStrengthPRs(prismaWith([[{ name: 'Barbell Bench Press', sets: 1, reps: 5, weightKg: 120 }]]), 'u1', 'w-new', [{ name: 'Bench Press', sets: 1, reps: 5, weightKg: 100 }]);
    expect(prs).toEqual([]);
  });

  it('history keyed the old way (case / whitespace) still compares', async () => {
    const prs = await detectStrengthPRs(prismaWith([[{ name: 'Bench Press', sets: 1, reps: 5, weightKg: 90 }]]), 'u1', 'w-new', [{ name: 'bench   PRESS', sets: 1, reps: 3, weightKg: 100 }]);
    expect(prs).toHaveLength(1);
  });

  it('uses the DB normalization row for odd names, per set', async () => {
    const prisma = prismaWith([[{ name: 'Flat BB', sets: 1, reps: 5, weightKg: 90 }]], [{ rawName: 'Flat BB', canonicalName: 'Bench Press' }]);
    const prs = await detectStrengthPRs(prisma, 'u1', 'w-new', [{ name: 'Bench Press', sets: 2, reps: 5, weightKg: 60, setEntries: [{ weightKg: 100, reps: 3 }, { weightKg: 60, reps: 5 }] }]);
    expect(prs).toHaveLength(1);
    expect(prs[0].e1RMLbs).toBe(epley1RM(100 * 2.20462, 3));
  });
});
