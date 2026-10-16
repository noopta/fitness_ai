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
// /analyze-photo, /recipes/parse, /order-scan, /barcode/:code/label) so an
// attacker can't multiply the free-tier limit by bouncing between endpoints.
// Writes the 429 itself when exhausted.
//
// Atomic (Oct 2026 audit): the old read-then-write let N concurrent requests
// all read count=6 and all pass. Each step is now a single conditional
// UPDATE, so the database decides who gets the last slot.
export async function consumeMealLoggingQuota(
  prisma: PrismaClient,
  userId: string,
  tier: string,
  res: Response,
): Promise<boolean> {
  if (tier !== 'free') return true; // pro/enterprise unmetered
  const today = new Date().toISOString().slice(0, 10);
  // First call of a new day: reset the counter to 1 in the same statement.
  const fresh = await prisma.user.updateMany({
    where: { id: userId, OR: [{ dailyPhotoScanDate: null }, { dailyPhotoScanDate: { not: today } }] },
    data: { dailyPhotoScanCount: 1, dailyPhotoScanDate: today },
  });
  if (fresh.count === 1) return true;
  // Same day: increment only while under the cap.
  const bumped = await prisma.user.updateMany({
    where: { id: userId, dailyPhotoScanDate: today, dailyPhotoScanCount: { lt: FREE_DAILY_PHOTO_LIMIT } },
    data: { dailyPhotoScanCount: { increment: 1 } },
  });
  if (bumped.count === 1) return true;
  const exists = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
  if (!exists) { res.status(404).json({ error: 'User not found' }); return false; }
  res.status(429).json({
    error: `Free tier is capped at ${FREE_DAILY_PHOTO_LIMIT} AI meal logs per day. Upgrade to Pro for unlimited.`,
  });
  return false;
}

/**
 * Strict YYYY-MM-DD that is also a real calendar date (no 2026-02-31, no
 * 2026-13-01). The bare regex used across the nutrition routes accepted both.
 */
export function isValidIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  if (y < 1900 || y > 2100) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** Zod refinement form of isValidIsoDate. */
export const ISO_DATE_MESSAGE = 'must be a real date in YYYY-MM-DD form';

/** `?days=` for history/trend routes: integer clamped to 1..365 (default when absent/garbage). */
export function clampDays(raw: unknown, fallback = 30): number {
  const n = Number.parseInt(String(raw ?? ''), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(365, Math.max(1, n));
}

/** Most nutrient keys a single entry may carry (Oct 2026 audit: unbounded maps bloated every row). */
export const MAX_NUTRIENT_KEYS = 60;

/** Keep at most MAX_NUTRIENT_KEYS finite, non-negative numeric entries with sane keys. */
export function boundNutrientMap(m: unknown): Record<string, number> | null {
  if (!m || typeof m !== 'object' || Array.isArray(m)) return null;
  const out: Record<string, number> = {};
  let n = 0;
  for (const [k, v] of Object.entries(m as Record<string, unknown>)) {
    if (n >= MAX_NUTRIENT_KEYS) break;
    if (typeof k !== 'string' || k.length > 40 || !/^[A-Za-z0-9_]+$/.test(k)) continue;
    const num = typeof v === 'number' ? v : Number(v);
    if (!Number.isFinite(num) || num < 0 || num > 1_000_000) continue;
    out[k] = num;
    n++;
  }
  return out;
}

/** Upper bound for one logged entry's calories AFTER servings/quantity multiplication. */
export const MAX_ENTRY_KCAL = 20000;

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
