// The user's timezone: reported by the phone on every request (X-Timezone),
// saved on User.timezone when it changes, and used to answer "what day is it
// for this user" when a request doesn't say.
//
// Requests that carry a date keep it — the phone's local date always wins.
// This only fills the gap for requests without one (older builds, server
// jobs, the agent), which used to fall back to the server's UTC day and hid
// every meal logged that day once the US evening rolled UTC over.

import type { Request } from 'express';
import { PrismaClient } from '@prisma/client';
import { todayForTz } from './localDate.js';

const prisma = new PrismaClient();

export const TZ_HEADER = 'x-timezone';

/** An IANA zone the runtime understands ("America/Edmonton"), else null. */
export function validTz(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const tz = raw.trim();
  if (!tz || tz.length > 64 || !/^[A-Za-z_]+(?:\/[A-Za-z0-9_+\-]+){0,2}$/.test(tz)) return null;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch {
    return null;
  }
}

// Last zone we know is stored per user, so a steady phone costs no writes.
const known = new Map<string, string | null>();
const listeners: Array<(userId: string) => void> = [];

/** Called when a user's stored zone changes (the agent drops its cached copy). */
export function onTimezoneChange(fn: (userId: string) => void): void {
  listeners.push(fn);
}

/** Save the phone's zone if it differs from what's stored. Fire-and-forget. */
export function noteTimezone(userId: string, raw: unknown): void {
  const tz = validTz(raw);
  if (!tz || known.get(userId) === tz) return;
  setImmediate(async () => {
    try {
      if (!known.has(userId)) {
        const u = await prisma.user.findUnique({ where: { id: userId }, select: { timezone: true } });
        known.set(userId, u?.timezone ?? null);
        if (u?.timezone === tz) return;
      }
      await prisma.user.update({ where: { id: userId }, data: { timezone: tz } });
      known.set(userId, tz);
      for (const fn of listeners) fn(userId);
    } catch { /* next request tries again */ }
  });
}

/** The zone to use for a request: the phone's header, else the stored one. */
export async function requestTz(req: Request): Promise<string | null> {
  const header = validTz(req.headers[TZ_HEADER]);
  if (header) return header;
  const userId = req.user?.id;
  if (!userId) return null;
  if (known.has(userId)) return known.get(userId) ?? null;
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { timezone: true } }).catch(() => null);
  known.set(userId, u?.timezone ?? null);
  return u?.timezone ?? null;
}

/** The user's local day for this request (ET when nothing is known). */
export async function requestToday(req: Request, now = new Date()): Promise<string> {
  return todayForTz(await requestTz(req), now);
}

/** A YYYY-MM-DD from the query if it is one, else the user's local today. */
export async function queryDateOrToday(req: Request, raw: unknown): Promise<string> {
  return typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : requestToday(req);
}

export function _resetTimezoneCacheForTests(): void {
  known.clear();
}
