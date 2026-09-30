// One write path for weigh-ins, shared by /coach/body-weight and Anakin's
// log_body_weight tool: one entry per date (a second log that day replaces
// the first), plausibility warnings, and the weight-milestone push.

import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { cacheDelete } from './cacheService.js';
import { detectAndNotifyWeightMilestone } from './progressService.js';
import { bodyWeightKg } from './weightUnits.js';
import { bounded, implausibilityWarning, weightDeltaWarning } from '../validation/physiologicalBounds.js';

const prisma = new PrismaClient();

// Canonical storage is kg. New clients send `weightKg`; older builds send
// `weightLbs` (pounds). Exactly one is required and we normalise to kg.
export const bodyWeightSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  // Bodyweight drives TDEE, the macro plan, the weight chart and the
  // milestone pushes, so it is bounded.
  weightKg: bounded('bodyWeightKg', 'Weight').optional(),
  // Pounds bound is the kg bound converted, so both paths gate identically.
  weightLbs: z.number().finite().min(44).max(880).optional(),
  notes: z.string().max(500).optional(),
}).refine((v) => v.weightKg != null || v.weightLbs != null, {
  message: 'weightKg or weightLbs is required',
});
export type BodyWeightInput = z.input<typeof bodyWeightSchema>;

/** Upsert the weigh-in for a date. `before` is the row it replaced (for undo), or null. */
export async function logBodyWeight(userId: string, input: BodyWeightInput) {
  const { date, weightKg: kgIn, weightLbs: lbsIn, notes } = bodyWeightSchema.parse(input);
  const weightKg = kgIn != null ? kgIn : bodyWeightKg({ weightLbs: lbsIn })!;

  // A large day-over-day jump is nearly always a unit mixup. Warn, don't reject.
  const lastLog = await prisma.bodyWeightLog.findFirst({
    where: { userId, date: { not: date } }, orderBy: { date: 'desc' }, select: { weightKg: true },
  });
  const warnings = [
    implausibilityWarning('bodyWeightKg', weightKg, 'Weight'),
    weightDeltaWarning(lastLog?.weightKg ?? null, weightKg),
  ].filter((w): w is string => w !== null);

  const before = await prisma.bodyWeightLog.findFirst({ where: { userId, date } });
  const entry = before
    // Clear any stale legacy pounds so weightKg is the single source of truth.
    ? await prisma.bodyWeightLog.update({ where: { id: before.id }, data: { weightKg, weightLbs: null, notes: notes || null } })
    : await prisma.bodyWeightLog.create({ data: { userId, date, weightKg, notes: notes || null } });
  cacheDelete(`userctx:${userId}`);

  detectAndNotifyWeightMilestone(prisma, userId, date, weightKg).catch((err) =>
    console.error('[body-weight] milestone detection error:', err));

  return { entry, before, warnings };
}

/** Delete a weigh-in by id; returns the row (for undo) or null. */
export async function deleteBodyWeight(userId: string, id: string) {
  const row = await prisma.bodyWeightLog.findFirst({ where: { id, userId } });
  if (!row) return null;
  await prisma.bodyWeightLog.delete({ where: { id } });
  cacheDelete(`userctx:${userId}`);
  return row;
}

/** Put a deleted or replaced weigh-in back exactly (undo). */
export async function restoreBodyWeight(userId: string, row: any) {
  if (!row || row.userId !== userId) throw new Error('Nothing to restore.');
  const clash = await prisma.bodyWeightLog.findFirst({ where: { userId, date: row.date } });
  if (clash && clash.id !== row.id) await prisma.bodyWeightLog.delete({ where: { id: clash.id } });
  const restored = clash?.id === row.id
    ? await prisma.bodyWeightLog.update({ where: { id: row.id }, data: { weightKg: row.weightKg, weightLbs: row.weightLbs ?? null, notes: row.notes ?? null } })
    : await prisma.bodyWeightLog.create({ data: { id: row.id, userId, date: row.date, weightKg: row.weightKg, weightLbs: row.weightLbs ?? null, notes: row.notes ?? null } });
  cacheDelete(`userctx:${userId}`);
  return restored;
}

/** Remove a weigh-in entirely by date (undo of a first-time log). */
export async function removeBodyWeightOn(userId: string, date: string) {
  await prisma.bodyWeightLog.deleteMany({ where: { userId, date } });
  cacheDelete(`userctx:${userId}`);
}
