// Log review's flag for code paths that only have a userId (the debounced
// review after a save, the agent's tools and prompt). Email lookups are
// cached for a minute so a chat turn doesn't add a query per tool call.

import { PrismaClient } from '@prisma/client';
import { logReviewAvailableFor } from '../featureFlags.js';

const prisma = new PrismaClient();
const cache = new Map<string, { on: boolean; at: number }>();

export async function logReviewOn(userId: string): Promise<boolean> {
  const hit = cache.get(userId);
  if (hit && Date.now() - hit.at < 60_000) return hit.on;
  if (logReviewAvailableFor(userId, null)) return true;
  let email: string | null = null;
  try { email = (await prisma.user.findUnique({ where: { id: userId }, select: { email: true } }))?.email ?? null; } catch { /* off */ }
  const on = logReviewAvailableFor(userId, email);
  cache.set(userId, { on, at: Date.now() });
  return on;
}
