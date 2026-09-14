/**
 * What we have already suggested, so the finder does not repeat itself.
 *
 * Also the seed of something larger. Every row here is a suggestion we made; the
 * `actedAt` column is filled in when the user later logs a meal matching it.
 * That pairing — what we proposed against what they actually ate — is the only
 * route to menu data nobody can buy, and the only way `inferred` nutrition ever
 * graduates to observed. See docs/food-finder-architecture.md.
 */

import { PrismaClient } from '@prisma/client';
import type { ShownRecord } from '../../engine/foodVariety.js';

const prisma = new PrismaClient();

/** How far back the recency penalty looks. Beyond a week the decay is ~0 anyway. */
const LOOKBACK_DAYS = 8;

export async function recentlyShown(userId: string, now = new Date()): Promise<ShownRecord[]> {
  const since = new Date(now.getTime() - LOOKBACK_DAYS * 86_400_000);
  const rows = await prisma.foodRecommendationLog.findMany({
    where: { userId, shownAt: { gte: since } },
    select: { itemKey: true, shownAt: true, actedAt: true },
    orderBy: { shownAt: 'desc' },
    take: 200,
  });
  return rows;
}

/**
 * Record a set of suggestions.
 *
 * Never throws into the request: a failed write here costs some variety
 * tomorrow, which is not worth failing a response the user is waiting on.
 */
export async function logShown(userId: string, itemKeys: string[]): Promise<void> {
  if (itemKeys.length === 0) return;
  try {
    await prisma.foodRecommendationLog.createMany({
      data: itemKeys.map(itemKey => ({ userId, itemKey })),
    });
  } catch (err) {
    console.warn('[foodFinder] could not log recommendations:', (err as Error).message);
  }
}

/**
 * Mark a suggestion as taken.
 *
 * Called when a logged meal came from the finder's prefill. Only the most recent
 * unacted showing is marked, so one suggestion cannot be credited twice.
 */
export async function markActedOn(userId: string, itemKey: string, at = new Date()): Promise<boolean> {
  try {
    const row = await prisma.foodRecommendationLog.findFirst({
      where: { userId, itemKey, actedAt: null },
      orderBy: { shownAt: 'desc' },
      select: { id: true },
    });
    if (!row) return false;
    await prisma.foodRecommendationLog.update({ where: { id: row.id }, data: { actedAt: at } });
    return true;
  } catch (err) {
    console.warn('[foodFinder] could not mark suggestion acted-on:', (err as Error).message);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Passive matching: a logged meal that looks like something we just suggested
// ---------------------------------------------------------------------------

/** How recently a suggestion must have been shown to be credited for a meal. */
const MATCH_WINDOW_MS = 6 * 60 * 60 * 1000;

/** Words that say nothing about WHICH food it was. */
const STOP = new Set([
  'with', 'and', 'the', 'bowl', 'plate', 'meal', 'side', 'cooked', 'grilled',
  'fresh', 'small', 'large', 'medium', 'regular', 'wheat', 'grain', 'whole', 'rolled',
]);

/**
 * Singularise so "lentil" in a logged meal matches "lentils" in a suggestion.
 * Crude on purpose ("hummus" -> "hummu") — it only has to be applied the same
 * way to both sides, never to read as English.
 */
const stem = (t: string) => (t.length > 3 && t.endsWith('s') && !t.endsWith('ss') ? t.slice(0, -1) : t);

/** Significant words in a suggestion, recovered from its stable id slug. */
export function keyTokens(itemKey: string): string[] {
  const slug = itemKey.slice(itemKey.lastIndexOf(':') + 1);
  return [...new Set(slug.split(/[+-]+/).filter(t => t.length >= 3 && !STOP.has(t)).map(stem))];
}

function nameTokens(name: string): Set<string> {
  return new Set(
    name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .split(/[^a-z0-9]+/).filter(t => t.length >= 3 && !STOP.has(t)).map(stem),
  );
}

/**
 * Credit a suggestion when the user logs a meal that matches it.
 *
 * Most people will not tap "I'm having this" — they eat, then log. So a meal
 * logged within a few hours of a suggestion, sharing most of its significant
 * words, marks that suggestion acted-on.
 *
 * Deliberately conservative, because a false match teaches us a suggestion
 * worked when it did not: at least two shared significant words (or the only
 * word, for a one-word suggestion logged under a short name), covering at
 * least 60% of the suggestion. Never throws into meal logging.
 */
export async function matchLoggedMeal(userId: string, mealName: string, now = new Date()): Promise<string | null> {
  try {
    const eaten = nameTokens(mealName);
    if (eaten.size === 0) return null;

    const rows = await prisma.foodRecommendationLog.findMany({
      where: { userId, actedAt: null, shownAt: { gte: new Date(now.getTime() - MATCH_WINDOW_MS) } },
      select: { id: true, itemKey: true },
      orderBy: { shownAt: 'desc' },
      take: 60,
    });

    let best: { id: string; itemKey: string; coverage: number } | null = null;
    for (const row of rows) {
      const tokens = keyTokens(row.itemKey);
      if (tokens.length === 0) continue;
      const shared = tokens.filter(t => eaten.has(t)).length;
      const coverage = shared / tokens.length;
      const enough = tokens.length === 1 ? shared === 1 && eaten.size <= 3 : shared >= 2;
      if (!enough || coverage < 0.6) continue;
      if (!best || coverage > best.coverage) best = { id: row.id, itemKey: row.itemKey, coverage };
    }
    if (!best) return null;

    await prisma.foodRecommendationLog.update({ where: { id: best.id }, data: { actedAt: now } });
    return best.itemKey;
  } catch (err) {
    console.warn('[foodFinder] meal-to-suggestion match failed:', (err as Error).message);
    return null;
  }
}
