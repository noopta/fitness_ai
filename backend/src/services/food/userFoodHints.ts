// The foods a user logs most, as short names — hints for the photo model so
// recurring meals are recognised by the user's own name and usual portion.
// Saved foods (use count) first, then frequent meal names from 60 days.

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const TTL_MS = 60 * 60 * 1000;
const cache = new Map<string, { at: number; foods: string[] }>();

/** Pure: rank, dedupe and trim names. Exported for tests. */
export function pickHints(saved: Array<{ name: string; useCount: number }>, meals: Array<{ name: string }>, max = 20): string[] {
  const counts = new Map<string, { name: string; n: number }>();
  const add = (name: string, n: number) => {
    const clean = name.replace(/\s*[·(].*$/, '').trim();
    if (!clean || clean.length > 40) return;
    const key = clean.toLowerCase();
    const cur = counts.get(key);
    counts.set(key, { name: cur?.name ?? clean, n: (cur?.n ?? 0) + n });
  };
  for (const s of saved) add(s.name, s.useCount * 2);
  for (const m of meals) add(m.name, 1);
  return [...counts.values()].filter((x) => x.n >= 2).sort((a, b) => b.n - a.n).slice(0, max).map((x) => x.name);
}

export async function userFoodHints(userId: string): Promise<string[]> {
  const hit = cache.get(userId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.foods;
  const since = new Date(Date.now() - 60 * 86_400_000);
  const [saved, meals] = await Promise.all([
    prisma.savedFood.findMany({ where: { userId }, orderBy: { useCount: 'desc' }, take: 30, select: { name: true, useCount: true } }).catch(() => []),
    prisma.mealEntry.findMany({ where: { userId, createdAt: { gte: since } }, select: { name: true }, take: 300, orderBy: { createdAt: 'desc' } }).catch(() => []),
  ]);
  const foods = pickHints(saved, meals);
  cache.set(userId, { at: Date.now(), foods });
  return foods;
}
