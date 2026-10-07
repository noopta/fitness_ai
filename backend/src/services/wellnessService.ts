// One write path for wellness check-ins, shared by /wellness/checkin and
// Anakin's log_wellness tool: one check-in per date (a second one that day
// replaces the first), stress on the app's 1–10 scale, activity logged.
//
// Only what the user answered is saved (v2 H-04): mood, energy and stress are
// optional, and a later check-in the same day fills in what it answers while
// keeping what it doesn't. Nothing is ever estimated from another answer —
// the one-tap sleep question used to save made-up mood, energy and stress.

import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { cacheDelete } from './cacheService.js';
import { logActivity } from './activityService.js';

const prisma = new PrismaClient();

export const checkinSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  mood: z.number().int().min(1).max(5).optional().nullable(),
  energy: z.number().int().min(1).max(5).optional().nullable(),
  sleepHours: z.number().min(0).max(24),
  // Stress is a 1–10 fatigue scale in the app ("1-3 Fresh, 4-6 Moderate,
  // 7-10 Fatigued"); mood and energy stay 1–5.
  stress: z.number().int().min(1).max(10).optional().nullable(),
});
export type CheckinInput = z.infer<typeof checkinSchema>;

/** Upsert the check-in for a date. `before` is the row it replaced (for undo), or null. */
export async function upsertCheckin(userId: string, input: CheckinInput) {
  const data = checkinSchema.parse(input);
  const before = await prisma.wellnessCheckin.findFirst({ where: { userId, date: data.date } });
  // Unanswered fields: keep that day's earlier answer on an update, leave empty on a new row.
  const answered = Object.fromEntries(Object.entries(data).filter(([, v]) => v != null)) as typeof data;
  const checkin = before
    ? await prisma.wellnessCheckin.update({ where: { id: before.id }, data: answered })
    : await prisma.wellnessCheckin.create({ data: { userId, mood: null, energy: null, stress: null, ...answered } });
  cacheDelete(`userctx:${userId}`);
  logActivity(userId, 'wellness').catch(() => {});
  return { checkin, before };
}

/** Undo: put the prior check-in back, or remove the one that was new. */
export async function revertCheckin(userId: string, date: string, before: any | null) {
  if (before) {
    const { id, userId: _u, createdAt, ...rest } = before;
    await prisma.wellnessCheckin.updateMany({ where: { userId, date }, data: { mood: rest.mood, energy: rest.energy, sleepHours: rest.sleepHours, stress: rest.stress } });
  } else {
    await prisma.wellnessCheckin.deleteMany({ where: { userId, date } });
  }
  cacheDelete(`userctx:${userId}`);
}


// The text and maths helpers live in a dependency-free module so readers anywhere
// (prompts, personal-training rules) can use them without loading this service.
export { describeCheckin, meanAnswered } from './checkinText.js';
