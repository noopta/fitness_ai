// Helpers shared between routes/nutrition.ts and routes/recipes.ts. Extracted
// from nutrition.ts verbatim so the recipes router doesn't have to import that
// module (it constructs an OpenAI client at import time, which makes anything
// importing it heavy to test).

import type { PrismaClient } from '@prisma/client';
import type { Response } from 'express';
import { recordActivity } from './streakService.js';
import {
  notifyStreakMilestone,
  notifyComeback,
  notifyPersonalBest,
  notifyStreakFreezeUsed,
  notifySurpriseReward,
} from './notificationService.js';

export const nutritionProfileCacheKey = (userId: string) => `nutrition_profile:${userId}`;

export function normalizeFoodName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function parseJsonArray(value: string | null): string[] {
  if (!value) return [];
  try {
    const arr = JSON.parse(value);
    if (!Array.isArray(arr)) return [];
    return arr.map(v => String(v)).filter(Boolean);
  } catch {
    return [];
  }
}

export function parseJsonObject<T>(value: string | null): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

// Free-tier cap on AI meal-logging calls (photo analyze + text parse + recipe
// parse share this counter). Dropped from 10 → 7 in response to a
// scripted-abuse incident (~2700 parse-meal calls from a single /24 across 14
// fake accounts) — real users log 3-5 meals/day, so 7 is a comfortable ceiling
// that still kills industrial-scale burn. Pro tier is unmetered.
export const FREE_DAILY_PHOTO_LIMIT = 7;

// Shared daily quota across ALL AI meal-logging endpoints (/parse-meal,
// /analyze-photo, /recipes/parse) so an attacker can't multiply the free-tier
// limit by bouncing between endpoints. Writes the 429 itself when exhausted.
export async function consumeMealLoggingQuota(
  prisma: PrismaClient,
  userId: string,
  tier: string,
  res: Response,
): Promise<boolean> {
  if (tier !== 'free') return true; // pro/enterprise unmetered
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { dailyPhotoScanCount: true, dailyPhotoScanDate: true },
  });
  if (!user) { res.status(404).json({ error: 'User not found' }); return false; }
  const today = new Date().toISOString().slice(0, 10);
  const isNewDay = user.dailyPhotoScanDate !== today;
  const count = isNewDay ? 0 : user.dailyPhotoScanCount;
  if (count >= FREE_DAILY_PHOTO_LIMIT) {
    res.status(429).json({
      error: `Free tier is capped at ${FREE_DAILY_PHOTO_LIMIT} AI meal logs per day. Upgrade to Pro for unlimited.`,
    });
    return false;
  }
  await prisma.user.update({
    where: { id: userId },
    data: { dailyPhotoScanCount: count + 1, dailyPhotoScanDate: today },
  });
  return true;
}

// Update the user's nutrition streak in the background and fire reinforcement
// pushes. Mirrors workouts.ts:updateStreakInBackground.
export function updateNutritionStreakInBackground(prisma: PrismaClient, userId: string, dateStr: string): void {
  (async () => {
    try {
      const result = await recordActivity(prisma, userId, 'nutrition', dateStr);
      if (!result || result.newStreak === result.prevStreak) return;
      if (result.isMilestone) {
        notifyStreakMilestone(userId, result.newStreak).catch(() => {});
      } else if (result.fireSurpriseReward) {
        notifySurpriseReward(userId, 'nutrition', result.newStreak).catch(() => {});
      }
      if (result.freezeUsed) {
        notifyStreakFreezeUsed(userId, 'nutrition', result.newStreak).catch(() => {});
      }
      if (result.isPersonalBest && !result.isMilestone) {
        notifyPersonalBest(userId, 'nutrition', result.newStreak).catch(() => {});
      }
      if (result.isComeback && result.newStreak === 1) {
        const u = await prisma.user.findUnique({
          where: { id: userId }, select: { longestNutritionStreak: true },
        });
        if (u && u.longestNutritionStreak >= 3) {
          notifyComeback(userId, 'nutrition', u.longestNutritionStreak).catch(() => {});
        }
      }
    } catch (err) {
      console.error('[nutrition-streak] update error:', err);
    }
  })();
}
