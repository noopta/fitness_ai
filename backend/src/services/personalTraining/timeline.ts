// Pure assembly of a client's timeline from rows the app already stores.
// Each source table maps to one event kind; the route does the querying and
// this file does the shaping, PR detection and cursor paging so all of it is
// testable without a database.

import { e1rmWithRpe, parseRPE } from '../../engine/e1rm.js';
import { formatWeight, type UnitPreference } from '../weightUnits.js';
import type { TimelineEvent, TimelineKind } from './types.js';

export const TIMELINE_PAGE_SIZE = 30;

/** Kinds with a data source today. photos / note / billing have none yet. */
export const SUPPORTED_KINDS: TimelineKind[] = ['workout', 'checkin', 'message', 'measurement', 'program'];

export function parseKinds(raw: unknown): TimelineKind[] {
  if (typeof raw !== 'string' || !raw.trim()) return SUPPORTED_KINDS;
  const asked = raw.split(',').map((s) => s.trim());
  const kinds = SUPPORTED_KINDS.filter((k) => asked.includes(k));
  return kinds.length ? kinds : SUPPORTED_KINDS;
}

// ── Workouts ─────────────────────────────────────────────────────────────────

interface LoggedExercise { name?: string; sets?: number; reps?: string | number; weightKg?: number | null; rpe?: string | number | null }

function parseExercises(json: string): LoggedExercise[] {
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function lowerReps(reps: unknown): number {
  const m = String(reps ?? '').match(/^(\d+)/);
  return m ? parseInt(m[1], 10) : 0;
}

/** "Back squat 3×5 at 100 kg · Bench press 3×8 at 60 kg · 2 more" */
export function summariseExercises(json: string, pref: UnitPreference, max = 3): string {
  const exercises = parseExercises(json).filter((e) => typeof e.name === 'string' && e.name.trim());
  const parts = exercises.slice(0, max).map((e) => {
    const scheme = e.sets && e.reps ? ` ${e.sets}×${e.reps}` : '';
    const load = e.weightKg && e.weightKg > 0 ? ` at ${formatWeight(e.weightKg, pref)}` : '';
    return `${e.name!.trim()}${scheme}${load}`;
  });
  if (exercises.length > max) parts.push(`${exercises.length - max} more`);
  return parts.join(' · ');
}

export interface WorkoutRow { id: string; createdAt: Date; title: string | null; exercises: string; notes: string | null; duration: number | null }

/**
 * Which logs set an estimated-1RM record, and on which lifts. Needs the
 * client's whole history, oldest first: a lift's first appearance is a
 * baseline, not a PR.
 */
export function detectPrs(logsOldestFirst: Pick<WorkoutRow, 'id' | 'exercises'>[]): Map<string, string[]> {
  const best = new Map<string, number>();
  const prs = new Map<string, string[]>();
  for (const log of logsOldestFirst) {
    const sessionBest = new Map<string, { name: string; e1rm: number }>();
    for (const ex of parseExercises(log.exercises)) {
      if (!ex.name || !ex.weightKg || ex.weightKg <= 0) continue;
      const e1rm = e1rmWithRpe(ex.weightKg, lowerReps(ex.reps), parseRPE(ex.rpe));
      if (e1rm <= 0) continue;
      const key = ex.name.trim().toLowerCase();
      if (e1rm > (sessionBest.get(key)?.e1rm ?? 0)) sessionBest.set(key, { name: ex.name.trim(), e1rm });
    }
    for (const [key, { name, e1rm }] of sessionBest) {
      const prior = best.get(key);
      if (prior !== undefined && e1rm > prior) prs.set(log.id, [...(prs.get(log.id) ?? []), name]);
      if (prior === undefined || e1rm > prior) best.set(key, e1rm);
    }
  }
  return prs;
}

export function workoutEvent(row: WorkoutRow, clientId: string, pref: UnitPreference, prLifts: string[] = []): TimelineEvent {
  const summary = summariseExercises(row.exercises, pref);
  const meta = [row.duration ? `${row.duration} min` : '', row.notes?.trim() ?? ''].filter(Boolean).join(' · ');
  return {
    id: `workout:${row.id}`,
    clientId,
    kind: 'workout',
    at: row.createdAt.toISOString(),
    title: row.title?.trim() || 'Workout',
    body: [summary, meta].filter(Boolean).join('\n'),
    ...(prLifts.length ? { flag: { label: `PR · ${prLifts[0]}${prLifts.length > 1 ? ` +${prLifts.length - 1}` : ''}`, tone: 'green' as const } } : {}),
  };
}

// ── Check-ins (1–5 scales) ───────────────────────────────────────────────────

export interface CheckInRow { id: string; createdAt: Date; mood: number; energy: number; sleepHours: number; stress: number }

export function checkInEvent(row: CheckInRow, clientId: string): TimelineEvent {
  const flag =
    row.stress >= 4 ? { label: 'High stress', tone: 'amber' as const }
    : row.energy <= 2 ? { label: 'Low energy', tone: 'amber' as const }
    : row.mood <= 2 ? { label: 'Low mood', tone: 'amber' as const }
    : undefined;
  return {
    id: `checkin:${row.id}`,
    clientId,
    kind: 'checkin',
    at: row.createdAt.toISOString(),
    title: 'Wellness check-in',
    body: `Mood ${row.mood}/5 · Energy ${row.energy}/5 · Stress ${row.stress}/5 · Sleep ${row.sleepHours} h`,
    ...(flag ? { flag } : {}),
  };
}

// ── Messages between this trainer and this client ────────────────────────────

export interface MessageRow { id: string; createdAt: Date; senderId: string; body: string }

/** `latestId` is the newest message in the thread; it is "unanswered" when the client sent it. */
export function messageEvent(row: MessageRow, clientId: string, clientName: string, latestId: string | null): TimelineEvent {
  const fromClient = row.senderId === clientId;
  return {
    id: `message:${row.id}`,
    clientId,
    kind: 'message',
    at: row.createdAt.toISOString(),
    title: fromClient ? clientName : 'You',
    body: row.body,
    ...(fromClient && row.id === latestId ? { flag: { label: 'Unanswered', tone: 'zinc' as const } } : {}),
  };
}

// ── Measurements ─────────────────────────────────────────────────────────────

export interface WeightRow { id: string; createdAt: Date; weightKg: number | null; notes: string | null }

export function measurementEvent(row: WeightRow, clientId: string, pref: UnitPreference): TimelineEvent | null {
  const weight = formatWeight(row.weightKg, pref, 1);
  if (!weight) return null;
  return {
    id: `measurement:${row.id}`,
    clientId,
    kind: 'measurement',
    at: row.createdAt.toISOString(),
    title: 'Bodyweight',
    body: [weight, row.notes?.trim() ?? ''].filter(Boolean).join(' · '),
  };
}

// ── Program changes Axiom proposed to the client ─────────────────────────────

export interface ProposalRow { id: string; createdAt: Date; title: string; reasoning: string; status: string }

const PROPOSAL_FLAG: Record<string, TimelineEvent['flag']> = {
  pending: { label: 'Awaiting client', tone: 'zinc' },
  snoozed: { label: 'Awaiting client', tone: 'zinc' },
  applied: { label: 'Applied', tone: 'green' },
  declined: { label: 'Declined', tone: 'zinc' },
  undone: { label: 'Undone', tone: 'zinc' },
};

export function programEvent(row: ProposalRow, clientId: string): TimelineEvent {
  const flag = PROPOSAL_FLAG[row.status];
  return {
    id: `program:${row.id}`,
    clientId,
    kind: 'program',
    at: row.createdAt.toISOString(),
    title: row.title,
    body: row.reasoning,
    ai: true,
    ...(flag ? { flag } : {}),
  };
}

// ── Cursor paging across merged sources ──────────────────────────────────────
// The cursor is the last event served, as "<ISO time>|<event id>". The id
// breaks ties so two rows written in the same millisecond are neither skipped
// nor repeated across pages.

export interface Cursor { at: string; id: string }

export function encodeCursor(e: Pick<TimelineEvent, 'at' | 'id'>): string {
  return `${e.at}|${e.id}`;
}

export function decodeCursor(raw: unknown): Cursor | null {
  if (typeof raw !== 'string') return null;
  const i = raw.indexOf('|');
  if (i <= 0) return null;
  const at = raw.slice(0, i);
  const id = raw.slice(i + 1);
  if (!id || Number.isNaN(new Date(at).getTime())) return null;
  return { at: new Date(at).toISOString(), id };
}

function newestFirst(a: TimelineEvent, b: TimelineEvent): number {
  if (a.at !== b.at) return a.at < b.at ? 1 : -1;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

export function pageEvents(
  events: TimelineEvent[],
  cursor: Cursor | null,
  limit = TIMELINE_PAGE_SIZE,
): { events: TimelineEvent[]; nextCursor: string | null } {
  const sorted = [...events].sort(newestFirst);
  const after = cursor
    ? sorted.filter((e) => e.at < cursor.at || (e.at === cursor.at && e.id < cursor.id))
    : sorted;
  const page = after.slice(0, limit);
  return { events: page, nextCursor: after.length > limit ? encodeCursor(page[page.length - 1]) : null };
}
