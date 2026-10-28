// A server flag for code paths that only have a userId (agent tools and
// prompt addenda): the flag's (id, email) predicate with the email looked up
// once a minute. logReview/flag.ts and swap/flag.ts are the same shape.

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export function userFlag(available: (userId: string, email?: string | null) => boolean): (userId: string) => Promise<boolean> {
  const cache = new Map<string, { on: boolean; at: number }>();
  return async (userId) => {
    const hit = cache.get(userId);
    if (hit && Date.now() - hit.at < 60_000) return hit.on;
    if (available(userId, null)) return true;
    let email: string | null = null;
    try { email = (await prisma.user.findUnique({ where: { id: userId }, select: { email: true } }))?.email ?? null; } catch { /* off */ }
    const on = available(userId, email);
    cache.set(userId, { on, at: Date.now() });
    return on;
  };
}
