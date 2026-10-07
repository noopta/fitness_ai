// Deterministic client status for the personal-training roster. No LLM, no
// side effects: the server owns every derived field (handoff §8) and a
// "Might need support" status must always say why (§6.2), so each rule
// returns the sentence the trainer reads.

import type { ClientStatus, EngagementTrend } from './types.js';

const DAY_MS = 86_400_000;

export const ENGAGEMENT_WEEKS = 8;
/** Days without a logged session before a client is flagged (rule PT-STATUS-01). */
export const INACTIVE_DAYS = 7;
/** A client is "new" for this long after joining the practice. */
export const NEW_CLIENT_DAYS = 14;
/** Sessions a week assumed when the client has no program to read a target from. */
export const DEFAULT_WEEKLY_SESSIONS = 3;

function dayNumber(dateStr: string): number {
  return Math.floor(new Date(`${dateStr.slice(0, 10)}T12:00:00Z`).getTime() / DAY_MS);
}

/** Calendar date in the timezone the rest of the backend buckets days in. */
export function estDateString(d: Date): string {
  return d.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

export const DEFAULT_TZ = 'America/New_York';

/** Calendar date in a trainer's own timezone; Eastern when they have none set or it is invalid. */
export function dateStringIn(tz: string | null | undefined, d: Date): string {
  try {
    return d.toLocaleDateString('en-CA', { timeZone: tz || DEFAULT_TZ });
  } catch {
    return estDateString(d);
  }
}

/** Hour of day (0–23) in a trainer's timezone. */
export function hourIn(tz: string | null | undefined, d: Date): number {
  try {
    return Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: tz || DEFAULT_TZ }).format(d)) % 24;
  } catch {
    return d.getUTCHours();
  }
}

/**
 * Weekly engagement, 0–10, for the trailing eight 7-day windows (oldest
 * first). 70% is training — distinct session days against the program's
 * weekly target — and 30% is other logging (nutrition or wellness) on five or
 * more days. Training dominates because that is what the trainer programs;
 * logging keeps a deload week from reading as disengagement.
 */
export function engagementSeries(input: {
  workoutDates: string[];
  logDates: string[];
  targetSessions: number;
  now: Date;
}): number[] {
  const today = dayNumber(estDateString(input.now));
  const bucket = (dates: string[]): Set<number>[] => {
    const weeks = Array.from({ length: ENGAGEMENT_WEEKS }, () => new Set<number>());
    for (const d of dates) {
      const ago = today - dayNumber(d);
      if (ago < 0 || ago >= ENGAGEMENT_WEEKS * 7) continue;
      weeks[ENGAGEMENT_WEEKS - 1 - Math.floor(ago / 7)].add(ago);
    }
    return weeks;
  };
  const workouts = bucket(input.workoutDates);
  const logs = bucket(input.logDates);
  const target = Math.max(1, input.targetSessions);
  return workouts.map((w, i) => {
    const training = Math.min(1, w.size / target);
    const logging = Math.min(1, logs[i].size / 5);
    return Math.round(10 * (0.7 * training + 0.3 * logging));
  });
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/** Last three weeks against the three before them; a 1.5-point move is a trend. */
export function engagementTrend(series: number[]): EngagementTrend {
  if (series.length < 6) return 'steady';
  const delta = mean(series.slice(-3)) - mean(series.slice(-6, -3));
  if (delta >= 1.5) return 'rising';
  if (delta <= -1.5) return 'falling';
  return 'steady';
}

export interface StatusInput {
  joinedAt: Date;
  lastSessionAt: Date | null;
  engagement8w: number[];
  /** Most recent wellness check-in (1–5 scales), if any. */
  latestCheckIn: { at: Date; stress: number | null; energy: number | null } | null;
  now: Date;
}

export function deriveStatus(input: StatusInput): { status: ClientStatus; reason?: string } {
  const { joinedAt, lastSessionAt, engagement8w, latestCheckIn, now } = input;
  const daysSince = (d: Date) => Math.floor((now.getTime() - d.getTime()) / DAY_MS);

  // PT-STATUS-01 — no session in a week. Measured from joining for a client
  // who has never logged, so a brand-new client is not flagged on day one.
  if (lastSessionAt && daysSince(lastSessionAt) >= INACTIVE_DAYS) {
    return { status: 'support', reason: `No session logged in ${daysSince(lastSessionAt)} days` };
  }
  if (!lastSessionAt && daysSince(joinedAt) >= INACTIVE_DAYS) {
    return { status: 'support', reason: `No session logged since joining ${daysSince(joinedAt)} days ago` };
  }

  // PT-STATUS-02 — engagement halved against the client's own recent baseline.
  if (engagement8w.length >= 6) {
    const recent = mean(engagement8w.slice(-2));
    const baseline = mean(engagement8w.slice(-6, -2));
    if (baseline >= 3 && recent <= baseline / 2) {
      return {
        status: 'support',
        reason: `Engagement down from ${Math.round(baseline)} to ${Math.round(recent)} out of 10 over two weeks`,
      };
    }
  }

  // PT-STATUS-03 — the client told us: high stress and low energy this week.
  if (latestCheckIn && daysSince(latestCheckIn.at) < 7 && latestCheckIn.stress != null && latestCheckIn.energy != null && latestCheckIn.stress >= 4 && latestCheckIn.energy <= 2) {
    return { status: 'support', reason: 'Reported high stress and low energy in their last check-in' };
  }

  if (daysSince(joinedAt) < NEW_CLIENT_DAYS) return { status: 'new' };
  return { status: 'onPlan' };
}
