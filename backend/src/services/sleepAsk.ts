// "How did you sleep?" goes out at most once a day (Nov 2026). It had two
// sources — Home's ask, appended to chat each time chat opened without a
// check-in (so again after every app restart), and the agent's ask_checkin —
// and neither knew about the other. Both now check and set one marker on the
// coach-profile blob: the local date it was last asked.

import { PrismaClient } from '@prisma/client';
import { mergeBlobKeys, parseBlob } from '../agent/profile/coachProfile.js';

const prisma = new PrismaClient();

export const SLEEP_ASKED_KEY = 'sleepAskedOn';

/** Pure: ask today only when there's no check-in for today and it hasn't been asked today. */
export function sleepAskAllowed(blob: Record<string, unknown>, today: string, checkedInToday: boolean): boolean {
  return !checkedInToday && blob[SLEEP_ASKED_KEY] !== today;
}

export async function sleepAskedOn(userId: string): Promise<string | null> {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { coachProfile: true } });
  const v = parseBlob(u?.coachProfile)[SLEEP_ASKED_KEY];
  return typeof v === 'string' ? v : null;
}

export async function markSleepAsked(userId: string, today: string): Promise<void> {
  await mergeBlobKeys(userId, { [SLEEP_ASKED_KEY]: today });
}
