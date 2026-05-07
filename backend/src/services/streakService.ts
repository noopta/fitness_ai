// Centralized streak logic for workout + nutrition activity.
//
// Why this lives in one file: prior versions had streak math inline in
// workouts.ts only, with no nutrition equivalent and no streak freeze. Putting
// the rules in one place lets us evolve the reinforcement design (milestones,
// freezes, personal bests) without touching route handlers.

import type { PrismaClient, User } from '@prisma/client';

export type StreakKind = 'workout' | 'nutrition';

// Milestones that fire a celebration push. Expanded from the old 7/14/30 set —
// goal-gradient research shows reinforcing on a varied schedule sustains
// engagement better than uniform spacing.
export const STREAK_MILESTONES = [3, 7, 14, 21, 30, 60, 90, 100, 180, 365];

export interface StreakUpdate {
  kind: StreakKind;
  prevStreak: number;
  newStreak: number;
  isMilestone: boolean;
  isPersonalBest: boolean;
  freezeUsed: boolean;
  isComeback: boolean;
  fireSurpriseReward: boolean;
}

const FREEZE_GRANT_INTERVAL = 7; // award 1 freeze every 7 logged days
const MAX_FREEZES = 2;
const SURPRISE_REWARD_PROBABILITY = 0.15; // ~15% chance after streak ≥ 5

export function todayString(date: Date = new Date()): string {
  return date.toISOString().split('T')[0];
}

function daysBetween(aStr: string, bStr: string): number {
  const a = new Date(aStr + 'T00:00:00Z').getTime();
  const b = new Date(bStr + 'T00:00:00Z').getTime();
  return Math.round((b - a) / 86400000);
}

interface StreakFields {
  streak: number;
  longest: number;
  lastDate: string | null;
}

function readKindFields(user: User, kind: StreakKind): StreakFields {
  if (kind === 'workout') {
    return {
      streak: user.currentStreak,
      longest: user.longestStreak,
      lastDate: user.lastWorkoutDate,
    };
  }
  return {
    streak: user.nutritionStreak,
    longest: user.longestNutritionStreak,
    lastDate: user.lastNutritionLogDate,
  };
}

interface KindUpdateData {
  currentStreak?: number;
  longestStreak?: number;
  lastWorkoutDate?: string;
  nutritionStreak?: number;
  longestNutritionStreak?: number;
  lastNutritionLogDate?: string;
  streakFreezes?: number;
  typicalWorkoutLogHour?: number;
  typicalNutritionLogHour?: number;
}

function writeKindFields(
  kind: StreakKind,
  fields: StreakFields,
): KindUpdateData {
  if (kind === 'workout') {
    const update: KindUpdateData = {
      currentStreak: fields.streak,
      longestStreak: fields.longest,
    };
    if (fields.lastDate !== null) update.lastWorkoutDate = fields.lastDate;
    return update;
  }
  const update: KindUpdateData = {
    nutritionStreak: fields.streak,
    longestNutritionStreak: fields.longest,
  };
  if (fields.lastDate !== null) update.lastNutritionLogDate = fields.lastDate;
  return update;
}

// Exponential smoothing of "what hour of the day does this user usually log?"
// alpha=0.3 lets the estimate respond to schedule changes within ~5-7 logs.
function smoothHour(prev: number | null, observed: number, alpha = 0.3): number {
  if (prev === null) return observed;
  return Math.round(prev * (1 - alpha) + observed * alpha);
}

/**
 * Apply an activity log to the user's streak state.
 *
 * Single-day gap behavior: if user has a freeze, consume it (streak preserved).
 * Otherwise the streak resets to 1.
 *
 * Idempotent on same-day re-log: streak doesn't double-increment if the user
 * logs twice on the same date.
 */
export async function recordActivity(
  prisma: PrismaClient,
  userId: string,
  kind: StreakKind,
  dateStr: string = todayString(),
  now: Date = new Date(),
): Promise<StreakUpdate | null> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return null;

  const fields = readKindFields(user, kind);
  const prevStreak = fields.streak;
  let newStreak = prevStreak;
  let freezeUsed = false;
  let isComeback = false;
  let freezesAfter = user.streakFreezes;

  if (!fields.lastDate) {
    // First log ever for this kind
    newStreak = 1;
    isComeback = prevStreak === 0 && user.longestStreak > 0; // had a streak before, lost it, coming back
  } else {
    const gap = daysBetween(fields.lastDate, dateStr);
    if (gap === 0) {
      // Same-day re-log — no streak change
      newStreak = prevStreak;
    } else if (gap === 1) {
      // Consecutive day
      newStreak = prevStreak + 1;
    } else if (gap === 2 && user.streakFreezes > 0 && prevStreak >= 1) {
      // One-day miss with a freeze available
      newStreak = prevStreak + 1;
      freezeUsed = true;
      freezesAfter = user.streakFreezes - 1;
    } else if (gap < 0) {
      // Backdated log — leave streak alone, just refresh lastDate (best-effort)
      newStreak = prevStreak;
    } else {
      // Multi-day gap with no freeze (or first kind log after a long break)
      isComeback = prevStreak >= 3 || readKindFields(user, kind).longest >= 3;
      newStreak = 1;
    }
  }

  const newLongest = Math.max(newStreak, fields.longest);
  const isPersonalBest = newStreak > fields.longest && newStreak >= 3;
  const isMilestone = newStreak !== prevStreak && STREAK_MILESTONES.includes(newStreak);

  // Award a freeze every 7 days of the *combined* logged history, capped.
  // We approximate "logged days" by combining current streaks (close enough
  // for awarding a small reward, and avoids a separate counter table).
  const totalLoggedDaysApprox = newStreak + (kind === 'workout' ? user.nutritionStreak : user.currentStreak);
  if (totalLoggedDaysApprox > 0 && totalLoggedDaysApprox % FREEZE_GRANT_INTERVAL === 0 && freezesAfter < MAX_FREEZES) {
    freezesAfter += 1;
  }

  // Surprise reward eligibility: only after streak ≥ 5, never on milestone days
  // (would feel redundant), and at most once per 24h across kinds.
  const lastSurprise = user.lastSurpriseRewardAt?.getTime() ?? 0;
  const surpriseEligible =
    newStreak >= 5 &&
    !isMilestone &&
    Date.now() - lastSurprise > 24 * 3600 * 1000 &&
    Math.random() < SURPRISE_REWARD_PROBABILITY;

  // Personalized log hour for at-risk timing
  const observedHour = parseInt(now.toLocaleString('en-US', { hour: 'numeric', hour12: false, timeZone: 'America/New_York' }), 10);
  const hourField =
    kind === 'workout' ? 'typicalWorkoutLogHour' : 'typicalNutritionLogHour';
  const prevHour = kind === 'workout' ? user.typicalWorkoutLogHour : user.typicalNutritionLogHour;
  const newHour = smoothHour(prevHour, observedHour);

  const updateData: KindUpdateData & { lastSurpriseRewardAt?: Date } = {
    ...writeKindFields(kind, { streak: newStreak, longest: newLongest, lastDate: dateStr }),
    streakFreezes: freezesAfter,
    [hourField]: newHour,
  };
  if (surpriseEligible) updateData.lastSurpriseRewardAt = new Date();

  await prisma.user.update({
    where: { id: userId },
    data: updateData,
  });

  return {
    kind,
    prevStreak,
    newStreak,
    isMilestone,
    isPersonalBest,
    freezeUsed,
    isComeback,
    fireSurpriseReward: surpriseEligible,
  };
}

/**
 * Returns user IDs that should receive an "about to lose your streak" push.
 * Criteria:
 *  - Has a streak ≥ 3 of either kind
 *  - Hasn't logged that kind today
 *  - Now ≥ user's typical log hour for that kind (so we wait until they're past
 *    their normal logging time before nagging)
 *  - Haven't sent an at-risk push to this user in the last 20h
 *
 * Returns an array of { userId, kind, streak } so the caller can fire pushes.
 */
export async function findAtRiskStreaks(
  prisma: PrismaClient,
  now: Date = new Date(),
): Promise<Array<{ userId: string; kind: StreakKind; streak: number }>> {
  const today = todayString(now);
  const hourEST = parseInt(
    now.toLocaleString('en-US', { hour: 'numeric', hour12: false, timeZone: 'America/New_York' }),
    10,
  );
  const cutoff20h = new Date(now.getTime() - 20 * 3600 * 1000);

  const users = await prisma.user.findMany({
    where: {
      expoPushToken: { not: null },
      reengagementOptOut: false,
      AND: [
        {
          OR: [
            { currentStreak: { gte: 3 } },
            { nutritionStreak: { gte: 3 } },
          ],
        },
        {
          OR: [
            { lastStreakAtRiskAt: null },
            { lastStreakAtRiskAt: { lt: cutoff20h } },
          ],
        },
      ],
    },
    select: {
      id: true,
      currentStreak: true,
      nutritionStreak: true,
      lastWorkoutDate: true,
      lastNutritionLogDate: true,
      typicalWorkoutLogHour: true,
      typicalNutritionLogHour: true,
    },
  });

  const result: Array<{ userId: string; kind: StreakKind; streak: number }> = [];
  for (const u of users) {
    if (
      u.currentStreak >= 3 &&
      u.lastWorkoutDate !== today &&
      hourEST >= (u.typicalWorkoutLogHour ?? 19)
    ) {
      result.push({ userId: u.id, kind: 'workout', streak: u.currentStreak });
      continue; // one push per user per pass
    }
    if (
      u.nutritionStreak >= 3 &&
      u.lastNutritionLogDate !== today &&
      hourEST >= (u.typicalNutritionLogHour ?? 19)
    ) {
      result.push({ userId: u.id, kind: 'nutrition', streak: u.nutritionStreak });
    }
  }
  return result;
}
