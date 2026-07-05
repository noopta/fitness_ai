// Train Together — overlap matching between friends' training calendars.
//
// The core promise of the feature: reveal the days friends naturally align
// WITHOUT anyone changing their program. Everything here is deterministic —
// no LLM on the hot path. Session focus strings are normalized against a
// static muscle-group taxonomy; day compatibility is a four-tier ladder
// (exact > strong > flexible > none); a group day's tier is the weakest
// pairwise link among its members.
//
// Pure functions (taxonomy, tiers, calendar resolution) live at the top and
// take data as arguments so they're testable without a DB. DB-touching
// helpers (pin-break watcher) are at the bottom.

import { PrismaClient } from '@prisma/client';
import { computePhaseState, parseSavedProgram, type SavedProgram } from './programPhaseService.js';
import { sendPushToUser } from './notificationService.js';

const prisma = new PrismaClient();

// ─── Tiers ────────────────────────────────────────────────────────────────────

export type MatchTier = 'exact' | 'strong' | 'flexible' | 'none';

export const TIER_RANK: Record<MatchTier, number> = {
  exact: 3,
  strong: 2,
  flexible: 1,
  none: 0,
};

// ─── Focus taxonomy ───────────────────────────────────────────────────────────
// Maps free-text session labels ("Push", "Upper Body Strength", "Legs + Core")
// to muscle-group sets. Keyword-driven so LLM-generated program day names
// normalize without an LLM call; genuinely novel labels fall through to an
// empty set and can only match by identical normalized key.

const MUSCLES = {
  push: ['chest', 'front_delts', 'side_delts', 'triceps'],
  pull: ['lats', 'upper_back', 'traps', 'rear_delts', 'biceps'],
  legs: ['quads', 'hamstrings', 'glutes', 'calves'],
  chest: ['chest', 'front_delts', 'triceps'],
  back: ['lats', 'upper_back', 'traps', 'rear_delts'],
  shoulders: ['front_delts', 'side_delts', 'rear_delts', 'traps'],
  arms: ['biceps', 'triceps'],
  posterior: ['hamstrings', 'glutes', 'lower_back', 'traps'],
  core: ['core'],
  cardio: ['cardio'],
} as const;

const UPPER = [...new Set([...MUSCLES.push, ...MUSCLES.pull])];
const LOWER = [...new Set([...MUSCLES.legs, 'lower_back'])];
const FULL = [...new Set([...UPPER, ...LOWER, 'core'])];

// Order matters only for the derived key when multiple keywords hit; matching
// itself unions every hit.
const KEYWORD_GROUPS: Array<{ key: string; muscles: readonly string[]; patterns: RegExp }> = [
  { key: 'push', muscles: MUSCLES.push, patterns: /\bpush\b/ },
  { key: 'pull', muscles: MUSCLES.pull, patterns: /\bpull\b/ },
  { key: 'legs', muscles: MUSCLES.legs, patterns: /\bleg(s)?\b|\bsquat\b|\bquad(s)?\b|\bhamstring(s)?\b|\bglute(s)?\b|\bcalves\b|\bcalf\b/ },
  { key: 'upper', muscles: UPPER, patterns: /\bupper\b/ },
  { key: 'lower', muscles: LOWER, patterns: /\blower(?!\s*back)\b/ },
  { key: 'full', muscles: FULL, patterns: /\bfull\s*body\b|\btotal\s*body\b|\bfull\b/ },
  { key: 'chest', muscles: MUSCLES.chest, patterns: /\bchest\b|\bbench\b/ },
  { key: 'back', muscles: MUSCLES.back, patterns: /\bback\b|\brow(s)?\b|\blat(s)?\b/ },
  { key: 'shoulders', muscles: MUSCLES.shoulders, patterns: /\bshoulder(s)?\b|\bdelt(s)?\b|\boverhead\b|\bohp\b/ },
  { key: 'arms', muscles: MUSCLES.arms, patterns: /\barm(s)?\b|\bbicep(s)?\b|\btricep(s)?\b|\bcurl(s)?\b/ },
  { key: 'posterior', muscles: MUSCLES.posterior, patterns: /\bdeadlift\b|\bposterior\b|\bhinge\b/ },
  { key: 'core', muscles: MUSCLES.core, patterns: /\bcore\b|\babs\b|\babdominal(s)?\b/ },
  { key: 'cardio', muscles: MUSCLES.cardio, patterns: /\bcardio\b|\bconditioning\b|\brun(ning)?\b|\bhiit\b|\bzone\s*2\b/ },
];

const REST_PATTERN = /\brest\b|\boff\s*day\b|\brecovery\b|\bactive\s*recovery\b/;

export interface NormalizedFocus {
  key: string;             // 'push' | 'upper' | 'push+core' | 'other:<slug>' ...
  muscles: Set<string>;    // empty for unrecognized labels
}

/** Normalize a session label to a taxonomy key + muscle-group set. */
export function normalizeFocus(label: string | null | undefined): NormalizedFocus | 'rest' {
  const text = (label ?? '').toLowerCase().trim();
  if (!text || REST_PATTERN.test(text)) return 'rest';

  const hitKeys: string[] = [];
  const muscles = new Set<string>();
  for (const group of KEYWORD_GROUPS) {
    if (group.patterns.test(text)) {
      hitKeys.push(group.key);
      for (const m of group.muscles) muscles.add(m);
    }
  }
  if (hitKeys.length === 0) {
    // Unrecognized label — matchable only against an identical label.
    return { key: `other:${text.replace(/\s+/g, '-')}`, muscles: new Set() };
  }
  return { key: hitKeys.join('+'), muscles };
}

// ─── Resolved calendar days ───────────────────────────────────────────────────

export interface ResolvedDay {
  date: string;              // YYYY-MM-DD (EST)
  rest: boolean;
  label: string | null;      // display label ("Push", "Upper A") — null when rest
  focusKey: string | null;
  muscles: string[];         // sorted, for stable payloads
  raw?: any;                 // the underlying session object (server-side only)
}

function getESTDateString(date: Date): string {
  return date.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

/** The next `count` EST date strings starting from `from` (defaults to today). */
export function upcomingDates(count: number, from: Date = new Date()): string[] {
  const start = new Date(getESTDateString(from) + 'T12:00:00Z');
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    out.push(getESTDateString(new Date(start.getTime() + i * 86_400_000)));
  }
  return out;
}

function sessionLabel(session: any): string | null {
  if (!session) return null;
  return session.focus || session.day || session.name || null;
}

/**
 * Resolve a user's concrete calendar for a set of dates. Mirrors the logic of
 * GET /coach/today exactly: daysSinceStart % 7 indexes into the current
 * phase's trainingDays (first N days of each personal week are training
 * days), and a per-date ScheduleOverride wins outright (sessionJson null =
 * rest). Pure — overrides are passed in as a date-keyed map.
 */
export function resolveCalendar(
  program: SavedProgram | null,
  programStartDate: Date | null,
  overridesByDate: Map<string, string | null>, // date -> sessionJson (null = forced rest)
  dates: string[],
): ResolvedDay[] {
  return dates.map((date) => {
    let session: any = null;

    if (overridesByDate.has(date)) {
      const json = overridesByDate.get(date);
      session = json ? JSON.parse(json) : null;
    } else if (program) {
      const now = new Date(date + 'T12:00:00Z');
      const state = computePhaseState(program, programStartDate, now);
      if (!state.isComplete && state.currentPhase) {
        const trainingDays = state.trainingDays ?? [];
        const dayInWeek = state.daysSinceStart % 7;
        session = dayInWeek < trainingDays.length ? trainingDays[dayInWeek] : null;
      }
    }

    const label = sessionLabel(session);
    const normalized = normalizeFocus(label);
    if (!session || normalized === 'rest') {
      return { date, rest: true, label: null, focusKey: null, muscles: [] };
    }
    return {
      date,
      rest: false,
      label,
      focusKey: normalized.key,
      muscles: [...normalized.muscles].sort(),
      raw: session,
    };
  });
}

// ─── Pairwise + group tiers ───────────────────────────────────────────────────

/**
 * Compatibility of two people's days.
 *  - exact:    same normalized focus (Push + Push)
 *  - strong:   overlapping muscle groups (Upper + Back) — overlap ratio ≥ 0.5
 *              of the smaller set
 *  - flexible: exactly one person rests (they could join)
 *  - none:     disjoint sessions, or both resting
 */
export function pairTier(a: ResolvedDay, b: ResolvedDay): MatchTier {
  if (a.rest && b.rest) return 'none';
  if (a.rest || b.rest) return 'flexible';
  if (a.focusKey && a.focusKey === b.focusKey) return 'exact';

  const setA = new Set(a.muscles);
  const shared = b.muscles.filter((m) => setA.has(m));
  const minSize = Math.min(a.muscles.length, b.muscles.length);
  if (minSize > 0 && shared.length / minSize >= 0.5) return 'strong';
  return 'none';
}

/**
 * A group day's tier is the weakest pairwise link among TRAINING members,
 * capped at 'flexible' if anyone rests. All resting -> none.
 */
export function groupTier(days: ResolvedDay[]): MatchTier {
  const training = days.filter((d) => !d.rest);
  if (training.length === 0) return 'none';
  if (training.length === 1) return days.length > 1 ? 'flexible' : 'none';

  let weakest: MatchTier = 'exact';
  for (let i = 0; i < training.length; i++) {
    for (let j = i + 1; j < training.length; j++) {
      const t = pairTier(training[i], training[j]);
      if (TIER_RANK[t] < TIER_RANK[weakest]) weakest = t;
      if (weakest === 'none') return 'none';
    }
  }
  const someoneRests = training.length < days.length;
  if (someoneRests && TIER_RANK.flexible < TIER_RANK[weakest]) return 'flexible';
  return weakest;
}

export const MUSCLE_DISPLAY: Record<string, string> = {
  chest: 'chest', front_delts: 'shoulders', side_delts: 'shoulders',
  rear_delts: 'shoulders', triceps: 'triceps', biceps: 'biceps',
  lats: 'back', upper_back: 'back', traps: 'traps', lower_back: 'lower back',
  quads: 'quads', hamstrings: 'hamstrings', glutes: 'glutes', calves: 'calves',
  core: 'core', cardio: 'conditioning',
};

/** Plain-language reason a day matched, for the day-detail sheet. */
export function matchReason(days: ResolvedDay[], tier: MatchTier): string | null {
  if (tier === 'exact') {
    const label = days.find((d) => !d.rest)?.label;
    return label ? `Everyone is on ${label}` : null;
  }
  if (tier === 'strong') {
    const training = days.filter((d) => !d.rest);
    let shared = new Set(training[0]?.muscles ?? []);
    for (const d of training.slice(1)) {
      shared = new Set(d.muscles.filter((m) => shared.has(m)));
    }
    const names = [...new Set([...shared].map((m) => MUSCLE_DISPLAY[m] ?? m))];
    return names.length ? `These sessions share ${names.join(', ')}` : null;
  }
  if (tier === 'flexible') {
    return 'Someone has a rest day and could join';
  }
  return null;
}

// ─── Split label ──────────────────────────────────────────────────────────────

/**
 * Short badge for a program's split style, derived from the first phase's
 * training-day names. Stored on User.splitLabel at program save.
 */
export function deriveSplitLabel(program: SavedProgram | null): string | null {
  const phase = program?.phases?.[0];
  const days: any[] = phase?.trainingDays ?? phase?.days ?? [];
  if (!days.length) return null;

  const keys = new Set<string>();
  for (const d of days) {
    const n = normalizeFocus(sessionLabel(d));
    if (n !== 'rest') keys.add(n.key.split('+')[0]);
  }
  const has = (...ks: string[]) => ks.every((k) => keys.has(k));

  if (has('push', 'pull', 'legs')) return 'PPL';
  if (has('upper', 'lower') || has('upper', 'legs')) return 'UL';
  if (keys.has('full')) return 'FB';
  if (has('chest', 'back', 'legs') && (keys.has('arms') || keys.has('shoulders'))) return 'Bro';
  return `${days.length}-day`;
}

// ─── Overlap computation (data already loaded) ────────────────────────────────

export interface ParticipantCalendar {
  userId: string;
  days: ResolvedDay[]; // same date ordering for every participant
}

/** Deduped, display-ready muscle names for a session ("chest, shoulders, triceps"). */
export function prettyMuscles(muscles: string[]): string[] {
  return [...new Set(muscles.map((m) => MUSCLE_DISPLAY[m] ?? m))];
}

export interface OverlapDay {
  date: string;
  tier: MatchTier;
  reason: string | null;
  sessions: Array<{ userId: string; rest: boolean; label: string | null; muscles: string[] }>;
}

export function computeOverlap(participants: ParticipantCalendar[], dates: string[]): OverlapDay[] {
  return dates.map((date, i) => {
    const days = participants.map((p) => p.days[i]);
    const tier = groupTier(days);
    return {
      date,
      tier,
      reason: matchReason(days, tier),
      sessions: participants.map((p) => ({
        userId: p.userId,
        rest: p.days[i].rest,
        label: p.days[i].label,
        muscles: prettyMuscles(p.days[i].muscles),
      })),
    };
  });
}

// ─── Shared session ("One session, two fits" — spec §10) ─────────────────────
// Deterministic builder: one workout both members can run side by side,
// assembled from THEIR OWN programmed exercises for that day. Common movements
// first, then alternating picks. Per-member "fit cards" explain the delta.

export interface SharedFitCard { heading: string; body: string }

export interface SharedSessionMemberInput {
  userId: string;
  name: string;
  day: ResolvedDay;
}

function exercisesOf(day: ResolvedDay): Array<{ name: string; sets?: number; reps?: any; raw: any }> {
  const list: any[] = day.raw?.exercises ?? [];
  return list
    .map((e) => ({ name: (e.exercise ?? e.name ?? '').toString(), sets: e.sets, reps: e.reps, raw: e }))
    .filter((e) => e.name);
}

const normName = (n: string) => n.toLowerCase().replace(/[^a-z0-9]/g, '');

export function buildSharedSession(members: SharedSessionMemberInput[]): {
  session: { day: string; focus: string; exercises: any[] };
  fits: Record<string, SharedFitCard[]>;
} | null {
  const training = members.filter((m) => !m.day.rest && exercisesOf(m.day).length > 0);
  if (training.length === 0) return null;

  const perMember = training.map((m) => ({ m, ex: exercisesOf(m.day) }));

  // Common movements (by normalized name) lead the session.
  const counts = new Map<string, { ex: any; n: number }>();
  for (const { ex } of perMember) {
    for (const e of ex) {
      const k = normName(e.name);
      const cur = counts.get(k);
      if (cur) cur.n += 1;
      else counts.set(k, { ex: e.raw, n: 1 });
    }
  }
  const common = [...counts.values()].filter((c) => c.n > 1).map((c) => c.ex);

  // Then alternate through each member's remaining list until we hit the cap.
  const cap = Math.max(4, Math.min(7, Math.max(...perMember.map((p) => p.ex.length))));
  const chosen: any[] = [...common];
  const seen = new Set(common.map((e) => normName(e.exercise ?? e.name ?? '')));
  let idx = 0;
  while (chosen.length < cap) {
    let added = false;
    for (const { ex } of perMember) {
      const next = ex[idx];
      if (next && !seen.has(normName(next.name))) {
        chosen.push(next.raw);
        seen.add(normName(next.name));
        added = true;
        if (chosen.length >= cap) break;
      }
    }
    idx++;
    if (!added && idx > 12) break;
  }

  const sharedMuscles = prettyMuscles(
    training.map((m) => new Set(m.day.muscles)).reduce<string[]>((acc, set, i) =>
      i === 0 ? [...set] : acc.filter((x) => set.has(x)),
    [] as string[]),
  );
  const focus = sharedMuscles.length
    ? sharedMuscles.slice(0, 3).join(', ')
    : training[0].day.label ?? 'Shared session';

  const estMin = Math.round(chosen.length * 8 + 10);

  const fits: Record<string, SharedFitCard[]> = {};
  for (const member of members) {
    const own = new Set(exercisesOf(member.day).map((e) => normName(e.name)));
    const kept = chosen.filter((e) => own.has(normName(e.exercise ?? e.name ?? ''))).length;
    const swaps = chosen.length - kept;
    const others = members.filter((x) => x.userId !== member.userId).map((x) => x.name.split(' ')[0]);
    const dayLabel = member.day.label ?? 'training';
    fits[member.userId] = [
      {
        heading: 'Keeps your progression',
        body: member.day.rest
          ? `You were resting — this is a bonus session, nothing in your program moves.`
          : `${kept} of ${chosen.length} exercises come straight from your ${dayLabel} day — same movements, same loads.`,
      },
      {
        heading: swaps === 0 ? 'No swaps' : swaps === 1 ? 'One swap' : `${swaps} swaps`,
        body: swaps === 0
          ? `Every movement is already in your day.`
          : `${swaps} slot${swaps === 1 ? 's' : ''} in from ${others.join(' and ')}'s day — same ${sharedMuscles.slice(0, 2).join(' and ') || 'muscle'} emphasis.`,
      },
      {
        heading: 'Same finish time',
        body: `~${estMin} min for ${chosen.length} exercises at your usual pace.`,
      },
    ];
  }

  return {
    session: { day: 'Shared session', focus, exercises: chosen },
    fits,
  };
}

// ─── DB helpers ───────────────────────────────────────────────────────────────

/**
 * Load and resolve a user's calendar for the given dates (program + overrides).
 * Returns null if the user has no active program.
 */
export async function loadUserCalendar(userId: string, dates: string[]): Promise<ResolvedDay[] | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { savedProgram: true, programStartDate: true },
  });
  if (!user?.savedProgram) return null;

  const overrides = await prisma.scheduleOverride.findMany({
    where: { userId, date: { in: dates } },
    select: { date: true, sessionJson: true },
  });
  const overridesByDate = new Map(overrides.map((o) => [o.date, o.sessionJson]));
  return resolveCalendar(parseSavedProgram(user.savedProgram), user.programStartDate, overridesByDate, dates);
}

/**
 * Pin-break watcher. Called (fire-and-forget) after any schedule mutation for
 * `userId`. Re-scores active pins the user belongs to; if a pin's tier
 * dropped below the tier it was made at, mark it 'changed' and notify every
 * member once. Targeted: only dates with an active pin are recomputed —
 * never whole calendars.
 */
export async function checkPinsAfterScheduleChange(
  userId: string,
  changedDates?: string[],
): Promise<void> {
  try {
    const today = getESTDateString(new Date());
    const pins = await prisma.partnerWorkout.findMany({
      where: {
        status: { in: ['pending', 'confirmed'] },
        date: { gte: today, ...(changedDates?.length ? { in: changedDates.filter((d) => d >= today) } : {}) },
        members: { some: { userId, response: { not: 'declined' } } },
      },
      include: { members: { select: { userId: true } } },
    });
    if (!pins.length) return;

    const changer = await prisma.user.findUnique({ where: { id: userId }, select: { name: true, username: true } });
    const changerName = changer?.name || changer?.username || 'A training partner';

    for (const pin of pins) {
      const memberIds = pin.members.map((m) => m.userId);
      const calendars = await Promise.all(memberIds.map((id) => loadUserCalendar(id, [pin.date])));
      const days = calendars.map((c, i) =>
        c?.[0] ?? { date: pin.date, rest: true, label: null, focusKey: null, muscles: [] as string[] },
      );
      const newTier = groupTier(days);
      if (TIER_RANK[newTier] >= TIER_RANK[pin.pinnedTier as MatchTier]) continue;

      await prisma.partnerWorkout.update({ where: { id: pin.id }, data: { status: 'changed' } });
      const weekday = new Date(pin.date + 'T12:00:00Z').toLocaleDateString('en-US', {
        weekday: 'long', timeZone: 'America/New_York',
      });
      await Promise.all(
        memberIds.map((id) =>
          sendPushToUser(
            id,
            'Training plan changed',
            `${changerName}'s ${weekday} changed — still training together?`,
            { type: 'partner_workout_changed', partnerWorkoutId: pin.id },
          ),
        ),
      );
    }
  } catch (err) {
    // Watcher must never break the schedule mutation that triggered it.
    console.error('[trainTogether] pin-break check failed:', (err as any)?.message ?? err);
  }
}

/**
 * Morning-of reminder (8am ET scheduler): for every confirmed pin dated
 * today, remind each accepted member who they're training with. One push per
 * member per pin; skips members who declined.
 */
export async function runPartnerWorkoutMorningReminders(): Promise<{ sent: number }> {
  const today = getESTDateString(new Date());
  const pins = await prisma.partnerWorkout.findMany({
    where: { date: today, status: 'confirmed' },
    include: {
      members: {
        where: { response: 'accepted' },
        include: { user: { select: { id: true, name: true, username: true } } },
      },
    },
  });

  let sent = 0;
  for (const pin of pins) {
    for (const member of pin.members) {
      const others = pin.members
        .filter((m) => m.userId !== member.userId)
        .map((m) => m.user.name || m.user.username || 'a friend');
      if (!others.length) continue;
      const names = others.length === 1 ? others[0] : `${others.slice(0, -1).join(', ')} & ${others[others.length - 1]}`;
      const day = await loadUserCalendar(member.userId, [today]);
      const session = day?.[0] && !day[0].rest && day[0].label ? `${day[0].label} day — ` : '';
      await sendPushToUser(
        member.userId,
        'Training together today',
        `${session}you're lifting with ${names}${pin.note ? ` (${pin.note})` : ''}`,
        { type: 'partner_workout_today', partnerWorkoutId: pin.id },
      );
      sent++;
    }
  }
  return { sent };
}
