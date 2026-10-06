// A workout logged for an earlier day: saved like any other, but it does not
// send a PR push or propose a program change about a session from weeks ago,
// and a date in the future is refused.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const db = vi.hoisted(() => ({
  user: { findUnique: vi.fn() },
  workoutLog: { create: vi.fn() },
}));
const effects = vi.hoisted(() => ({ notifyNewPR: vi.fn(async () => {}), runPostWorkout: vi.fn(async () => [{ id: 'p1' }]), postInitiatedLater: vi.fn(), recordActivity: vi.fn(async (): Promise<any> => null), notifyStreakMilestone: vi.fn(async () => {}), logActivity: vi.fn(async () => {}), detectStrengthPRs: vi.fn(async (): Promise<any[]> => [{ displayName: 'Bench press', e1RMLbs: 250 }]), recompute: vi.fn() }));

vi.mock('@prisma/client', () => ({ PrismaClient: vi.fn(function (this: any) { Object.assign(this, db); }) }));
vi.mock('../services/notificationService.js', () => ({
  notifyNewPR: effects.notifyNewPR, notifyStreakMilestone: effects.notifyStreakMilestone, notifyComeback: vi.fn(), notifyPersonalBest: vi.fn(), notifyStreakFreezeUsed: vi.fn(), notifySurpriseReward: vi.fn(),
}));
vi.mock('../services/streakService.js', () => ({ recordActivity: effects.recordActivity }));
vi.mock('../services/progressService.js', () => ({ detectStrengthPRs: effects.detectStrengthPRs, prDisplay: () => ({ value: 250, unit: 'lbs' }) }));
vi.mock('../adaptation/proposalService.js', () => ({ runPostWorkout: effects.runPostWorkout }));
vi.mock('../agent/initiated.js', () => ({ postInitiatedLater: effects.postInitiatedLater }));
vi.mock('../services/exerciseNormalizationService.js', () => ({ normalizeExerciseBatch: vi.fn(async () => {}) }));
vi.mock('../routes/strength.js', () => ({ recomputeStrengthProfileInBackground: effects.recompute }));
vi.mock('../services/activityService.js', () => ({ logActivity: effects.logActivity }));
vi.mock('../services/posthogClient.js', () => ({ default: { capture: vi.fn(), captureException: vi.fn() } }));
vi.mock('../services/cacheService.js', () => ({ cacheDelete: vi.fn(), cacheClearByPrefix: vi.fn() }));
vi.mock('../agent/proactiveSweep.js', () => ({ runProactiveSweep: vi.fn(async () => {}) }));

import { createWorkoutLog, createWorkoutLogsBulk, streakSettleDates, WorkoutDateError, todayForTz, addDays } from '../services/workoutLogService.js';

const flush = () => new Promise((r) => setTimeout(r, 0));

const today = todayForTz('America/New_York');
const input = (date: string) => ({ date, title: 'Push', exercises: [{ name: 'Bench press', sets: 3, reps: '5', weightKg: 100 }] });

beforeEach(() => {
  vi.clearAllMocks();
  db.user.findUnique.mockResolvedValue({ weightKg: 80, unitPreference: 'imperial', timezone: 'America/New_York' });
  let n = 0;
  db.workoutLog.create.mockImplementation(async ({ data }: any) => ({ id: `w${++n}`, createdAt: new Date(), ...data }));
});

describe('backdated workouts', () => {
  it('a workout from today sends the PR push and runs adaptation', async () => {
    const r = await createWorkoutLog('u1', input(today));
    expect(r.backdated).toBe(false);
    expect(effects.notifyNewPR).toHaveBeenCalled();
    expect(effects.runPostWorkout).toHaveBeenCalled();
    expect(effects.recordActivity).toHaveBeenCalledWith(expect.anything(), 'u1', 'workout', today);
  });

  it('yesterday still counts as just done', async () => {
    const r = await createWorkoutLog('u1', input(addDays(today, -1)));
    expect(r.backdated).toBe(false);
    expect(effects.notifyNewPR).toHaveBeenCalled();
  });

  it('an older workout is saved, counts for the streak and PRs, but sends nothing and proposes nothing', async () => {
    const date = addDays(today, -10);
    const r = await createWorkoutLog('u1', input(date));
    expect(r.backdated).toBe(true);
    expect(db.workoutLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ date }) }));
    expect(effects.recordActivity).toHaveBeenCalledWith(expect.anything(), 'u1', 'workout', date);
    expect(r.prs).toHaveLength(1);
    expect(effects.notifyNewPR).not.toHaveBeenCalled();
    expect(effects.runPostWorkout).not.toHaveBeenCalled();
    expect(effects.postInitiatedLater).not.toHaveBeenCalled();
    expect(r.adaptationProposals).toEqual([]);
  });

  it('refuses a date in the future, allowing a day for timezones', async () => {
    await expect(createWorkoutLog('u1', input(addDays(today, 2)))).rejects.toBeInstanceOf(WorkoutDateError);
    expect(db.workoutLog.create).not.toHaveBeenCalled();
    await expect(createWorkoutLog('u1', input(addDays(today, 1)))).resolves.toMatchObject({ backdated: false });
  });
});

describe('backfill side effects', () => {
  it('an old workout recounts the streak silently and is not counted as activity today', async () => {
    effects.recordActivity.mockResolvedValueOnce({ prevStreak: 4, newStreak: 30, isMilestone: true });
    const date = addDays(today, -60);
    await createWorkoutLog('u1', input(date));
    await flush();
    expect(effects.recordActivity).toHaveBeenCalledWith(expect.anything(), 'u1', 'workout', date);
    expect(effects.notifyStreakMilestone).not.toHaveBeenCalled();
    expect(effects.logActivity).not.toHaveBeenCalled();
  });

  it('a workout today still sends the milestone push and counts as activity', async () => {
    effects.recordActivity.mockResolvedValueOnce({ prevStreak: 6, newStreak: 7, isMilestone: true });
    await createWorkoutLog('u1', input(today));
    await flush();
    expect(effects.notifyStreakMilestone).toHaveBeenCalledWith('u1', 7);
    expect(effects.logActivity).toHaveBeenCalled();
  });

  it('an old workout is a best only against sessions on or before its day', async () => {
    const date = addDays(today, -40);
    await createWorkoutLog('u1', input(date));
    expect(effects.detectStrengthPRs).toHaveBeenCalledWith(expect.anything(), 'u1', expect.any(String), expect.any(Array), date);
    await createWorkoutLog('u1', input(today));
    expect(effects.detectStrengthPRs).toHaveBeenLastCalledWith(expect.anything(), 'u1', expect.any(String), expect.any(Array), undefined);
  });
});

describe('createWorkoutLogsBulk', () => {
  it('saves oldest first, quietly, keeps going past a bad session, then settles the batch once', async () => {
    db.user.findUnique.mockResolvedValue({ weightKg: 80, unitPreference: 'imperial', timezone: 'America/New_York', lastWorkoutDate: addDays(today, -3) });
    const d = (k: number) => addDays(today, -k);
    const r = await createWorkoutLogsBulk('u1', [input(d(20)), input(addDays(today, 5)), input(d(40)), input(d(30))]);
    expect(r.created.map((c) => c.date)).toEqual([d(40), d(30), d(20)]);
    expect(r.failed).toHaveLength(1); // the future one
    expect(effects.notifyNewPR).not.toHaveBeenCalled();
    expect(effects.runPostWorkout).not.toHaveBeenCalled();
    expect(effects.logActivity).not.toHaveBeenCalled();
    expect(effects.notifyStreakMilestone).not.toHaveBeenCalled();
    expect(effects.recompute).toHaveBeenCalledTimes(1);
    // One recount at the newest backfilled day covers the batch.
    expect(effects.recordActivity).toHaveBeenCalledTimes(1);
    expect(effects.recordActivity).toHaveBeenCalledWith(expect.anything(), 'u1', 'workout', d(20));
  });
});

describe('streakSettleDates', () => {
  it('no streak yet: every day in order', () => {
    expect(streakSettleDates(null, ['2026-07-01', '2026-07-02'])).toEqual(['2026-07-01', '2026-07-02']);
  });
  it('days before the last logged day collapse to one recount; newer days follow in order', () => {
    expect(streakSettleDates('2026-09-01', ['2026-07-01', '2026-08-01', '2026-09-01', '2026-09-02', '2026-09-03'])).toEqual(['2026-08-01', '2026-09-02', '2026-09-03']);
  });
});
