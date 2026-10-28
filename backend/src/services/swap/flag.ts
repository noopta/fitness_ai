// The swap flag for code paths that only have a userId (the agent's tool and
// prompt). Same shape as logReview/flag.ts: email cached for a minute.

import { PrismaClient } from '@prisma/client';
import { swapV2AvailableFor } from '../featureFlags.js';

const prisma = new PrismaClient();
const cache = new Map<string, { on: boolean; at: number }>();

export async function swapOn(userId: string): Promise<boolean> {
  const hit = cache.get(userId);
  if (hit && Date.now() - hit.at < 60_000) return hit.on;
  if (swapV2AvailableFor(userId, null)) return true;
  let email: string | null = null;
  try { email = (await prisma.user.findUnique({ where: { id: userId }, select: { email: true } }))?.email ?? null; } catch { /* off */ }
  const on = swapV2AvailableFor(userId, email);
  cache.set(userId, { on, at: Date.now() });
  return on;
}
