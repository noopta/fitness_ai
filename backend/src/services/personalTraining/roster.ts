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

const STATUS_ORDER: Record<ClientStatus, number> = { support: 0, new: 1, onPlan: 2, paused: 3, notJoined: 4 };

/** Clients who might need the trainer come first; names break ties. */
export function sortClients(clients: Client[]): Client[] {
  return [...clients].sort(
    (a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || a.name.localeCompare(b.name),
  );
}

export function countStatuses(clients: Client[]): Record<'all' | ClientStatus, number> {
  const counts = { all: clients.length, support: 0, new: 0, onPlan: 0, paused: 0, notJoined: 0 };
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
export async function loadClients(
  practiceId: string,
  opts: { ids?: string[]; now?: Date; includeProspects?: boolean } = {},
): Promise<Client[]> {
  const now = opts.now ?? new Date();
  // "Not joined" clients from spreadsheet imports are opt-in: anything that
  // sends to a client (briefing, check-ins, notifications) must not see them.
  const prospects = opts.includeProspects ? await loadProspectClients(practiceId, now, opts.ids) : [];
  const wantedUsers = opts.ids?.filter((id) => !id.startsWith(PROSPECT_PREFIX));
  const members = wantedUsers && wantedUsers.length === 0 ? [] : await prisma.institutionMember.findMany({
    where: {
      institutionId: practiceId,
      role: 'athlete',
      active: true,
      ...(wantedUsers ? { userId: { in: wantedUsers } } : {}),
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
  if (members.length === 0) return sortClients(prospects);

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

  return sortClients([...members.map((m) => buildClient(m.user, m.joinedAt, activity.get(m.user.id)!, now)), ...prospects]);
}

// ── "Not joined" clients ─────────────────────────────────────────────────────

export const PROSPECT_PREFIX = 'prospect:';

/**
 * Imported clients with no Axiom account, as roster rows. Their id is
 * prefixed so it can never be mistaken for a user id, and their status is
 * always 'notJoined' — the support rules are about people the trainer can
 * actually reach.
 */
async function loadProspectClients(practiceId: string, now: Date, ids?: string[]): Promise<Client[]> {
  const wanted = ids?.filter((id) => id.startsWith(PROSPECT_PREFIX)).map((id) => id.slice(PROSPECT_PREFIX.length));
  if (wanted && wanted.length === 0) return [];
  const rows = await prisma.ptProspect.findMany({ where: { practiceId, userId: null, ...(wanted ? { id: { in: wanted } } : {}) } });
  if (rows.length === 0) return [];
  const sessions = await prisma.ptImportedWorkout.findMany({
    where: { prospectId: { in: rows.map((r) => r.id) } },
    select: { prospectId: true, date: true, at: true },
    orderBy: { at: 'asc' },
  });
  return rows.map((p) => {
    const mine = sessions.filter((s) => s.prospectId === p.id);
    const engagement8w = engagementSeries({ workoutDates: mine.map((s) => s.date), logDates: [], targetSessions: DEFAULT_WEEKLY_SESSIONS, now });
    const last = mine[mine.length - 1];
    return {
      id: `${PROSPECT_PREFIX}${p.id}`,
      name: p.name,
      initials: initialsOf(p.name, p.email),
      email: p.email,
      status: 'notJoined' as const,
      statusReason: `Not on Axiom yet${mine.length ? ` · ${mine.length} imported ${mine.length === 1 ? 'session' : 'sessions'}` : ''}${p.invitedAt ? ' · invited' : ''}`,
      channel: 'app' as const,
      program: null,
      sessionsPerWeek: DEFAULT_WEEKLY_SESSIONS,
      engagement8w,
      engagementTrend: engagementTrend(engagement8w),
      ...(last ? { lastSessionAt: last.at.toISOString() } : {}),
      joinedAt: p.createdAt.toISOString(),
      // Free text from the sheet: listed as-is, and treated as active because nothing says otherwise.
      contraindications: (p.injuries ?? '').split(/[;,\n]/).map((s) => s.trim()).filter((s) => s && !/^(none|no|n\/a|-)$/i.test(s)).map((label) => ({ label, active: true })),
    };
  });
}
