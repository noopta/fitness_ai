// A workout logged for an earlier day: saved like any other, but it does not
// send a PR push or propose a program change about a session from weeks ago,
// and a date in the future is refused.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const db = vi.hoisted(() => ({
  user: { findUnique: vi.fn() },
  workoutLog: { create: vi.fn() },
}));
const effects = vi.hoisted(() => ({ notifyNewPR: vi.fn(async () => {}), runPostWorkout: vi.fn(async () => [{ id: 'p1' }]), postInitiatedLater: vi.fn(), recordActivity: vi.fn(async () => null) }));

vi.mock('@prisma/client', () => ({ PrismaClient: vi.fn(function (this: any) { Object.assign(this, db); }) }));
vi.mock('../services/notificationService.js', () => ({
  notifyNewPR: effects.notifyNewPR, notifyStreakMilestone: vi.fn(), notifyComeback: vi.fn(), notifyPersonalBest: vi.fn(), notifyStreakFreezeUsed: vi.fn(), notifySurpriseReward: vi.fn(),
}));
vi.mock('../services/streakService.js', () => ({ recordActivity: effects.recordActivity }));
vi.mock('../services/progressService.js', () => ({ detectStrengthPRs: vi.fn(async () => [{ displayName: 'Bench press', e1RMLbs: 250 }]), prDisplay: () => ({ value: 250, unit: 'lbs' }) }));
vi.mock('../adaptation/proposalService.js', () => ({ runPostWorkout: effects.runPostWorkout }));
vi.mock('../agent/initiated.js', () => ({ postInitiatedLater: effects.postInitiatedLater }));
vi.mock('../services/exerciseNormalizationService.js', () => ({ normalizeExerciseBatch: vi.fn(async () => {}) }));
vi.mock('../routes/strength.js', () => ({ recomputeStrengthProfileInBackground: vi.fn() }));
vi.mock('../services/activityService.js', () => ({ logActivity: vi.fn(async () => {}) }));
vi.mock('../services/posthogClient.js', () => ({ default: { capture: vi.fn(), captureException: vi.fn() } }));
vi.mock('../services/cacheService.js', () => ({ cacheDelete: vi.fn(), cacheClearByPrefix: vi.fn() }));
vi.mock('../agent/proactiveSweep.js', () => ({ runProactiveSweep: vi.fn(async () => {}) }));

import { createWorkoutLog, WorkoutDateError, todayForTz, addDays } from '../services/workoutLogService.js';

const today = todayForTz('America/New_York');
const input = (date: string) => ({ date, title: 'Push', exercises: [{ name: 'Bench press', sets: 3, reps: '5', weightKg: 100 }] });

beforeEach(() => {
  vi.clearAllMocks();
  db.user.findUnique.mockResolvedValue({ weightKg: 80, unitPreference: 'imperial', timezone: 'America/New_York' });
  db.workoutLog.create.mockImplementation(async ({ data }: any) => ({ id: 'w1', createdAt: new Date(), ...data }));
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
