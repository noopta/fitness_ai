import { describe, it, expect, vi, beforeEach } from 'vitest';
import { recordActivity, todayString, STREAK_MILESTONES } from '../services/streakService.js';

// Build a mutable fake user that mimics Prisma row state.
function makeUser(over: Partial<any> = {}) {
  return {
    id: 'u1',
    currentStreak: 0,
    longestStreak: 0,
    lastWorkoutDate: null,
    nutritionStreak: 0,
    longestNutritionStreak: 0,
    lastNutritionLogDate: null,
    streakFreezes: 0,
    typicalWorkoutLogHour: null,
    typicalNutritionLogHour: null,
    lastSurpriseRewardAt: null,
    ...over,
  };
}

function makePrisma(initial: any) {
  let state = { ...initial };
  return {
    state,
    prisma: {
      user: {
        findUnique: vi.fn(async () => state),
        update: vi.fn(async ({ data }: any) => {
          state = { ...state, ...data };
          return state;
        }),
      },
    } as any,
    current: () => state,
  };
}

function daysAgoStr(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().split('T')[0];
}

beforeEach(() => {
  // Make non-deterministic surprise reward deterministic in tests
  vi.spyOn(Math, 'random').mockReturnValue(0.99); // > 0.15 threshold → no surprise by default
});

describe('recordActivity — workout streak', () => {
  it('starts streak at 1 on first log', async () => {
    const { prisma, current } = makePrisma(makeUser());
    const r = await recordActivity(prisma, 'u1', 'workout', todayString());
    expect(r?.newStreak).toBe(1);
    expect(r?.prevStreak).toBe(0);
    expect(current().currentStreak).toBe(1);
    expect(current().longestStreak).toBe(1);
  });

  it('increments on consecutive day', async () => {
    const { prisma, current } = makePrisma(makeUser({
      currentStreak: 5, longestStreak: 5, lastWorkoutDate: daysAgoStr(1),
    }));
    const r = await recordActivity(prisma, 'u1', 'workout', todayString());
    expect(r?.newStreak).toBe(6);
    expect(current().currentStreak).toBe(6);
    expect(current().longestStreak).toBe(6);
  });

  it('does not double-count same-day re-log', async () => {
    const today = todayString();
    const { prisma, current } = makePrisma(makeUser({
      currentStreak: 3, longestStreak: 3, lastWorkoutDate: today,
    }));
    const r = await recordActivity(prisma, 'u1', 'workout', today);
    expect(r?.newStreak).toBe(3);
    expect(current().currentStreak).toBe(3);
  });

  it('resets to 1 on multi-day gap with no freeze', async () => {
    const { prisma, current } = makePrisma(makeUser({
      currentStreak: 10, longestStreak: 10, lastWorkoutDate: daysAgoStr(3),
    }));
    const r = await recordActivity(prisma, 'u1', 'workout', todayString());
    expect(r?.newStreak).toBe(1);
    expect(r?.isComeback).toBe(true);
    expect(current().currentStreak).toBe(1);
    expect(current().longestStreak).toBe(10); // longest preserved
  });

  it('uses streak freeze on a 1-day miss instead of resetting', async () => {
    const { prisma, current } = makePrisma(makeUser({
      currentStreak: 8, longestStreak: 8, lastWorkoutDate: daysAgoStr(2), streakFreezes: 1,
    }));
    const r = await recordActivity(prisma, 'u1', 'workout', todayString());
    expect(r?.newStreak).toBe(9);
    expect(r?.freezeUsed).toBe(true);
    expect(current().streakFreezes).toBe(0);
  });

  it('resets when 1-day miss but no freeze available', async () => {
    const { prisma } = makePrisma(makeUser({
      currentStreak: 4, longestStreak: 4, lastWorkoutDate: daysAgoStr(2), streakFreezes: 0,
    }));
    const r = await recordActivity(prisma, 'u1', 'workout', todayString());
    expect(r?.newStreak).toBe(1);
    expect(r?.freezeUsed).toBe(false);
    expect(r?.isComeback).toBe(true);
  });

  it('flags isMilestone on day 7', async () => {
    const { prisma } = makePrisma(makeUser({
      currentStreak: 6, longestStreak: 6, lastWorkoutDate: daysAgoStr(1),
    }));
    const r = await recordActivity(prisma, 'u1', 'workout', todayString());
    expect(r?.newStreak).toBe(7);
    expect(r?.isMilestone).toBe(true);
  });

  it('expanded milestones include day 3 and day 21', () => {
    expect(STREAK_MILESTONES).toContain(3);
    expect(STREAK_MILESTONES).toContain(21);
    expect(STREAK_MILESTONES).toContain(60);
    expect(STREAK_MILESTONES).toContain(100);
  });

  it('flags isPersonalBest when newStreak exceeds prior longest', async () => {
    const { prisma } = makePrisma(makeUser({
      currentStreak: 9, longestStreak: 9, lastWorkoutDate: daysAgoStr(1),
    }));
    const r = await recordActivity(prisma, 'u1', 'workout', todayString());
    expect(r?.newStreak).toBe(10);
    expect(r?.isPersonalBest).toBe(true);
  });

  it('does not flag personal best below threshold (streak ≥ 3)', async () => {
    const { prisma } = makePrisma(makeUser());
    const r = await recordActivity(prisma, 'u1', 'workout', todayString());
    expect(r?.newStreak).toBe(1);
    expect(r?.isPersonalBest).toBe(false);
  });

  it('fires surprise reward when streak ≥ 5 and dice roll < 0.15', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.1); // below threshold
    const { prisma } = makePrisma(makeUser({
      currentStreak: 5, longestStreak: 5, lastWorkoutDate: daysAgoStr(1),
    }));
    const r = await recordActivity(prisma, 'u1', 'workout', todayString());
    expect(r?.fireSurpriseReward).toBe(true);
  });

  it('does NOT fire surprise reward on milestone days', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.1);
    const { prisma } = makePrisma(makeUser({
      currentStreak: 6, longestStreak: 6, lastWorkoutDate: daysAgoStr(1),
    }));
    const r = await recordActivity(prisma, 'u1', 'workout', todayString());
    expect(r?.newStreak).toBe(7);
    expect(r?.isMilestone).toBe(true);
    expect(r?.fireSurpriseReward).toBe(false);
  });

  it('grants a streak freeze every 7 logged days', async () => {
    const { prisma, current } = makePrisma(makeUser({
      currentStreak: 6, longestStreak: 6, lastWorkoutDate: daysAgoStr(1), streakFreezes: 0,
    }));
    await recordActivity(prisma, 'u1', 'workout', todayString());
    expect(current().streakFreezes).toBe(1);
  });

  it('caps streak freezes at 2', async () => {
    const { prisma, current } = makePrisma(makeUser({
      currentStreak: 13, longestStreak: 13, lastWorkoutDate: daysAgoStr(1), streakFreezes: 2,
    }));
    await recordActivity(prisma, 'u1', 'workout', todayString());
    expect(current().streakFreezes).toBe(2); // not 3
  });
});

describe('recordActivity — nutrition streak (independent of workout)', () => {
  it('increments nutrition streak without touching workout streak', async () => {
    const { prisma, current } = makePrisma(makeUser({
      nutritionStreak: 4, longestNutritionStreak: 4, lastNutritionLogDate: daysAgoStr(1),
      currentStreak: 12, longestStreak: 12, lastWorkoutDate: daysAgoStr(1),
    }));
    const r = await recordActivity(prisma, 'u1', 'nutrition', todayString());
    expect(r?.kind).toBe('nutrition');
    expect(r?.newStreak).toBe(5);
    expect(current().nutritionStreak).toBe(5);
    expect(current().currentStreak).toBe(12); // unchanged
  });
});

describe('recordActivity — typical log hour smoothing', () => {
  it('records the observed hour on first log', async () => {
    const { prisma, current } = makePrisma(makeUser());
    await recordActivity(prisma, 'u1', 'workout', todayString());
    expect(current().typicalWorkoutLogHour).toBeGreaterThanOrEqual(0);
    expect(current().typicalWorkoutLogHour).toBeLessThanOrEqual(23);
  });

  it('updates typical hour for the right kind only', async () => {
    const { prisma, current } = makePrisma(makeUser({
      typicalWorkoutLogHour: 19,
    }));
    await recordActivity(prisma, 'u1', 'nutrition', todayString());
    expect(current().typicalWorkoutLogHour).toBe(19); // untouched
    expect(current().typicalNutritionLogHour).not.toBeNull();
  });
});
