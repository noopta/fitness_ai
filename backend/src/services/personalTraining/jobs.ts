// Background work for the personal-training dashboard. Everything here is
// scoped to practices run by a trainer the feature is switched on for, so with
// no such trainer each tick is one cheap query and nothing else.

import { personalTrainingAvailableFor } from '../featureFlags.js';
import { generateBriefing } from './briefingService.js';
import { runCheckInSchedule } from './checkins.js';
import { prisma } from './db.js';
import { deliverDueDrafts } from './drafts.js';
import { sweepNotifications } from './notifications.js';
import { loadClients } from './roster.js';
import { dateStringIn, hourIn } from './status.js';

/** Briefings are ready by this hour in the trainer's own timezone (handoff §6.1). */
export const BRIEFING_HOUR = 6;

interface ActiveTrainer { practiceId: string; trainerId: string; tz: string | null }

export async function activeTrainers(): Promise<ActiveTrainer[]> {
  const coaches = await prisma.institutionMember.findMany({
    where: { role: 'coach', active: true, institution: { active: true } },
    orderBy: { joinedAt: 'asc' },
    select: { institutionId: true, user: { select: { id: true, email: true, timezone: true } } },
  });
  return coaches
    .filter((c) => personalTrainingAvailableFor(c.user.id, c.user.email))
    .map((c) => ({ practiceId: c.institutionId, trainerId: c.user.id, tz: c.user.timezone }));
}

const guard = (name: string, fn: () => Promise<unknown>) => () => {
  fn().catch((err) => console.error(`[personal-training] ${name}`, err));
};

export async function runSweeps(now: Date = new Date()) {
  const trainers = await activeTrainers();
  const seenPractice = new Set<string>();
  for (const t of trainers) {
    // Check-in prompts go out once per practice, from its longest-standing trainer.
    if (!seenPractice.has(t.practiceId)) {
      seenPractice.add(t.practiceId);
      const clients = await loadClients(t.practiceId, { now });
      if (clients.length) await runCheckInSchedule(t.practiceId, t.trainerId, clients, now, t.tz ?? undefined);
    }
    await sweepNotifications(t.practiceId, t.trainerId, now);
  }
}

export async function runMorningBriefings(now: Date = new Date()) {
  for (const t of await activeTrainers()) {
    if (hourIn(t.tz, now) < BRIEFING_HOUR) continue;
    const date = dateStringIn(t.tz, now);
    const existing = await prisma.ptBriefing.findUnique({
      where: { practiceId_trainerId_date: { practiceId: t.practiceId, trainerId: t.trainerId, date } },
      select: { status: true },
    });
    if (existing?.status === 'ready' || existing?.status === 'streaming') continue;
    await generateBriefing(t.practiceId, t.trainerId, { now });
  }
}

export function startPersonalTrainingJobs() {
  if (process.env.PERSONAL_TRAINING_JOBS === '0') return;
  // Backstop for the per-send timer: a message whose undo window closed across a restart still goes out.
  setInterval(guard('deliver drafts', () => deliverDueDrafts()), 30_000).unref();
  setInterval(guard('sweeps', () => runSweeps()), 5 * 60_000).unref();
  setInterval(guard('morning briefings', () => runMorningBriefings()), 10 * 60_000).unref();
  setTimeout(guard('startup sweep', async () => { await deliverDueDrafts(); await runSweeps(); await runMorningBriefings(); }), 45_000).unref();
}
