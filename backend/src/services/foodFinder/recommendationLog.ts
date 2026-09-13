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
export async function markActedOn(userId: string, itemKey: string, at = new Date()): Promise<void> {
  try {
    const row = await prisma.foodRecommendationLog.findFirst({
      where: { userId, itemKey, actedAt: null },
      orderBy: { shownAt: 'desc' },
      select: { id: true },
    });
    if (row) await prisma.foodRecommendationLog.update({ where: { id: row.id }, data: { actedAt: at } });
  } catch (err) {
    console.warn('[foodFinder] could not mark suggestion acted-on:', (err as Error).message);
  }
}
