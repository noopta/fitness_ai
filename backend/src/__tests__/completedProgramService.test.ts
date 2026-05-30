// Tests for the finished-programs archive — verifies stats are computed
// correctly from logged data and that the archive row carries the right
// metadata (reason, goal, durationWeeks, daysPerWeek).

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  workoutLog: { findMany: vi.fn() },
  bodyWeightLog: { findFirst: vi.fn() },
  completedProgram: { create: vi.fn() },
}));
vi.mock('@prisma/client', () => {
  const PrismaClient = vi.fn(function (this: any) {
    Object.assign(this, mocks);
  });
  return { PrismaClient };
});

import { archiveProgram, computeProgramStats } from '../services/completedProgramService.js';

const USER = 'u1';
const START = new Date('2026-04-01T12:00:00Z');
const END = new Date('2026-05-30T12:00:00Z');

beforeEach(() => {
  Object.values(mocks).forEach((m) => Object.values(m).forEach((fn: any) => fn.mockReset()));
});

describe('computeProgramStats', () => {
  it('sums volume, counts workouts + distinct active days, computes BW delta', async () => {
    mocks.workoutLog.findMany.mockResolvedValue([
      // Two workouts on the same day → daysActive should still be 1.
      { date: '2026-04-05', exercises: JSON.stringify([
        { name: 'Bench', sets: 4, reps: 6, weightLbs: 185 },     // 4*6*185 = 4440
        { name: 'OHP',   sets: 3, reps: 8, weightLbs: 95 },      // 3*8*95  = 2280
      ]) },
      { date: '2026-04-05', exercises: JSON.stringify([
        { name: 'Curl',  sets: 3, reps: 10, weightLbs: 25 },     // 3*10*25 = 750
      ]) },
      { date: '2026-04-12', exercises: JSON.stringify([
        { name: 'Plank', sets: 3, reps: 30, bodyweight: true },  // bodyweight → 0
        { name: 'RDL',   sets: 4, reps: 8, weightKg: 100 },      // 4*8*220.462 = 7054.78 → 7055
      ]) },
    ]);
    mocks.bodyWeightLog.findFirst
      .mockResolvedValueOnce({ weightLbs: 180.5 })   // first (asc)
      .mockResolvedValueOnce({ weightLbs: 184.2 }); // last (desc)

    const stats = await computeProgramStats(USER, START, END, { durationWeeks: 8 });

    expect(stats.workoutsLogged).toBe(3);
    expect(stats.daysActive).toBe(2);
    // 4440 + 2280 + 750 + 7055 = 14525 (allow ±1 for the kg→lb rounding)
    expect(Math.abs(stats.totalVolumeLb - 14525)).toBeLessThanOrEqual(1);
    expect(stats.bodyWeightStartLb).toBe(180.5);
    expect(stats.bodyWeightEndLb).toBe(184.2);
    expect(stats.bodyWeightChangeLb).toBe(3.7);
    expect(stats.durationWeeks).toBe(8);
  });

  it('handles empty data gracefully', async () => {
    mocks.workoutLog.findMany.mockResolvedValue([]);
    mocks.bodyWeightLog.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
    const stats = await computeProgramStats(USER, START, END, null);
    expect(stats.workoutsLogged).toBe(0);
    expect(stats.daysActive).toBe(0);
    expect(stats.totalVolumeLb).toBe(0);
    expect(stats.bodyWeightChangeLb).toBeNull();
  });
});

describe('archiveProgram', () => {
  it('persists the archive with computed stats + goal/duration metadata', async () => {
    mocks.workoutLog.findMany.mockResolvedValue([
      { date: '2026-04-05', exercises: JSON.stringify([{ name: 'Bench', sets: 4, reps: 6, weightLbs: 185 }]) },
    ]);
    mocks.bodyWeightLog.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
    mocks.completedProgram.create.mockResolvedValue({ id: 'cp1' });

    const program = { goal: 'strength', durationWeeks: 8, daysPerWeek: 4, phases: [] };
    const res = await archiveProgram(USER, JSON.stringify(program), START, 'completed');

    expect(res?.id).toBe('cp1');
    expect(mocks.completedProgram.create).toHaveBeenCalledTimes(1);
    const data = mocks.completedProgram.create.mock.calls[0][0].data;
    expect(data.userId).toBe(USER);
    expect(data.goal).toBe('strength');
    expect(data.durationWeeks).toBe(8);
    expect(data.daysPerWeek).toBe(4);
    expect(data.reason).toBe('completed');
    const stats = JSON.parse(data.stats);
    expect(stats.workoutsLogged).toBe(1);
    expect(stats.totalVolumeLb).toBe(4440);
  });

  it('returns null and does not insert when there is no program JSON to archive', async () => {
    const res = await archiveProgram(USER, null, START, 'replaced');
    expect(res).toBeNull();
    expect(mocks.completedProgram.create).not.toHaveBeenCalled();
  });

  it('returns null for unparseable program JSON', async () => {
    const res = await archiveProgram(USER, '{not-json', START, 'replaced');
    expect(res).toBeNull();
    expect(mocks.completedProgram.create).not.toHaveBeenCalled();
  });
});
