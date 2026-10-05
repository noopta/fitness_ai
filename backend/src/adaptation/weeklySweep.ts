// Weekly log-trend sweep (Freestyle release).
//
// Once a week, for every user with at least one workout in the last 21 days,
// run the slow-moving rules that a single session can't see: systemic
// fatigue, plateaus, volume balance per muscle, and the training-phase check
// (phase_confirm / calorie_adjust). Each user is gated by their own flags
// inside runWeeklyForUser, so with LOG_ADAPTATION and PHASE_INFERENCE off this
// reads one list of user ids and does nothing else. No pushes — new cards wait
// in the pending list for the next app open.

import { PrismaClient } from '@prisma/client';
import { runWeeklyForUser } from './proposalService.js';

const prisma = new PrismaClient();

export const SWEEP_ACTIVE_DAYS = 21;

export async function runWeeklyAdaptationSweep(now = new Date()): Promise<{ users: number; proposals: number; errors: number }> {
  const since = new Date(now.getTime() - SWEEP_ACTIVE_DAYS * 86_400_000).toISOString().slice(0, 10);
  const active = await prisma.workoutLog.findMany({
    where: { date: { gte: since } },
    select: { userId: true },
    distinct: ['userId'],
  });
  let proposals = 0, errors = 0;
  // Serial on purpose: a 2-vCPU box serving live traffic; speed doesn't matter here.
  for (const { userId } of active) {
    try {
      proposals += (await runWeeklyForUser(userId, now)).length;
    } catch (err: any) {
      errors++;
      console.error('[adaptation-weekly] user failed:', userId, err?.message ?? err);
    }
  }
  if (proposals || errors) console.log(`[adaptation-weekly] ${active.length} active users, ${proposals} new proposals, ${errors} errors`);
  return { users: active.length, proposals, errors };
}
