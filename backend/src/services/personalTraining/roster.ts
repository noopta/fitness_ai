// Roster assembly for a trainer's practice. A practice is an Institution; a
// client is an active 'athlete' member of it. Everything here is read-only
// over data clients already log — there is no personal-training table yet.

import { parseBlob, readInjuries } from '../../agent/profile/coachProfile.js';
import { prisma } from './db.js';
import { computePhaseState, parseSavedProgram } from '../programPhaseService.js';
import {
  DEFAULT_WEEKLY_SESSIONS, ENGAGEMENT_WEEKS, deriveStatus, engagementSeries, engagementTrend, estDateString,
} from './status.js';
import type { Client, ClientStatus, Contraindication } from './types.js';


const DAY_MS = 86_400_000;

export function initialsOf(name: string | null | undefined, email?: string | null): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  if (email) return email[0].toUpperCase();
  return '?';
}

export function displayNameOf(name: string | null | undefined, email?: string | null): string {
  return name?.trim() || email?.split('@')[0] || 'Client';
}

export interface ClientUserRow {
  id: string;
  name: string | null;
  email: string | null;
  savedProgram: string | null;
  programStartDate: Date | null;
  coachGoal: string | null;
  coachProfile: string | null;
  constraintsText: string | null;
}

export interface ClientActivity {
  /** YYYY-MM-DD of each logged session in the engagement window. */
  workoutDates: string[];
  /** YYYY-MM-DD of each nutrition or wellness log in the window. */
  logDates: string[];
  lastSessionAt: Date | null;
  lastCheckInAt: Date | null;
  latestCheckIn: { at: Date; stress: number; energy: number } | null;
}

/** Injuries live in both coachProfile and constraintsText; readInjuries reconciles the two. */
export function contraindicationsOf(user: Pick<ClientUserRow, 'coachProfile' | 'constraintsText'>): Contraindication[] {
  return readInjuries(parseBlob(user.coachProfile), user.constraintsText)
    .filter((i) => i && typeof i.area === 'string' && i.area.trim())
    .map((i) => ({ label: i.area.trim(), ...(i.note ? { note: i.note } : {}), active: !i.resolvedAt }));
}

export function buildClient(user: ClientUserRow, joinedAt: Date, activity: ClientActivity, now: Date): Client {
  const program = parseSavedProgram(user.savedProgram);
  const phase = program ? computePhaseState(program, user.programStartDate, now) : null;
  const targetSessions =
    phase?.trainingDays.length ||
    (typeof program?.daysPerWeek === 'number' ? program.daysPerWeek : 0) ||
    DEFAULT_WEEKLY_SESSIONS;

  const engagement8w = engagementSeries({
    workoutDates: activity.workoutDates,
    logDates: activity.logDates,
    targetSessions,
    now,
  });
  const { status, reason } = deriveStatus({
    joinedAt,
    lastSessionAt: activity.lastSessionAt,
    engagement8w,
    latestCheckIn: activity.latestCheckIn,
    now,
  });

  return {
    id: user.id,
    name: displayNameOf(user.name, user.email),
    initials: initialsOf(user.name, user.email),
    email: user.email,
    status,
    ...(reason ? { statusReason: reason } : {}),
    // Every client today joined through the app; the no-install web link is not built.
    channel: 'app',
    program: program && phase
      ? {
          blockLabel: phase.phaseName ?? 'Program',
          week: phase.weekNumber,
          weeks: Math.max(phase.totalWeeks, phase.weekNumber),
          goal: user.coachGoal?.trim() ?? '',
        }
      : null,
    sessionsPerWeek: targetSessions,
    engagement8w,
    engagementTrend: engagementTrend(engagement8w),
    ...(activity.lastCheckInAt ? { lastCheckInAt: activity.lastCheckInAt.toISOString() } : {}),
    ...(activity.lastSessionAt ? { lastSessionAt: activity.lastSessionAt.toISOString() } : {}),
    joinedAt: joinedAt.toISOString(),
    contraindications: contraindicationsOf(user),
  };
}

const STATUS_ORDER: Record<ClientStatus, number> = { support: 0, new: 1, onPlan: 2, paused: 3 };

/** Clients who might need the trainer come first; names break ties. */
export function sortClients(clients: Client[]): Client[] {
  return [...clients].sort(
    (a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || a.name.localeCompare(b.name),
  );
}

export function countStatuses(clients: Client[]): Record<'all' | ClientStatus, number> {
  const counts = { all: clients.length, support: 0, new: 0, onPlan: 0, paused: 0 };
  for (const c of clients) counts[c.status] += 1;
  return counts;
}

const emptyActivity = (): ClientActivity => ({
  workoutDates: [], logDates: [], lastSessionAt: null, lastCheckInAt: null, latestCheckIn: null,
});

/**
 * Load clients of a practice with their derived fields. Activity is fetched
 * in a fixed number of batched queries regardless of roster size. `ids`
 * narrows to specific clients and doubles as the membership check for a
 * single-client read: a user who is not an active client simply isn't returned.
 */
export async function loadClients(practiceId: string, opts: { ids?: string[]; now?: Date } = {}): Promise<Client[]> {
  const now = opts.now ?? new Date();
  const members = await prisma.institutionMember.findMany({
    where: {
      institutionId: practiceId,
      role: 'athlete',
      active: true,
      ...(opts.ids ? { userId: { in: opts.ids } } : {}),
    },
    select: {
      joinedAt: true,
      user: {
        select: {
          id: true, name: true, email: true, savedProgram: true, programStartDate: true,
          coachGoal: true, coachProfile: true, constraintsText: true,
        },
      },
    },
  });
  if (members.length === 0) return [];

  const userIds = members.map((m) => m.user.id);
  const since = estDateString(new Date(now.getTime() - ENGAGEMENT_WEEKS * 7 * DAY_MS));
  const inWindow = { userId: { in: userIds }, date: { gte: since } };

  const [workouts, nutrition, wellness, lastSessions, lastCheckIns] = await Promise.all([
    prisma.workoutLog.findMany({ where: inWindow, select: { userId: true, date: true } }),
    prisma.nutritionLog.findMany({ where: inWindow, select: { userId: true, date: true } }),
    prisma.wellnessCheckin.findMany({
      where: inWindow,
      select: { userId: true, date: true, createdAt: true, stress: true, energy: true },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.workoutLog.groupBy({ by: ['userId'], where: { userId: { in: userIds } }, _max: { createdAt: true } }),
    prisma.wellnessCheckin.groupBy({ by: ['userId'], where: { userId: { in: userIds } }, _max: { createdAt: true } }),
  ]);

  const activity = new Map<string, ClientActivity>(userIds.map((id) => [id, emptyActivity()]));
  for (const w of workouts) activity.get(w.userId)?.workoutDates.push(w.date);
  for (const n of nutrition) activity.get(n.userId)?.logDates.push(n.date);
  for (const c of wellness) {
    const a = activity.get(c.userId);
    if (!a) continue;
    a.logDates.push(c.date);
    // Rows arrive newest first, so the first one seen per client is the latest.
    if (!a.latestCheckIn) a.latestCheckIn = { at: c.createdAt, stress: c.stress, energy: c.energy };
  }
  for (const s of lastSessions) {
    const a = activity.get(s.userId);
    if (a) a.lastSessionAt = s._max.createdAt ?? null;
  }
  for (const c of lastCheckIns) {
    const a = activity.get(c.userId);
    if (a) a.lastCheckInAt = c._max.createdAt ?? null;
  }

  return sortClients(members.map((m) => buildClient(m.user, m.joinedAt, activity.get(m.user.id)!, now)));
}
