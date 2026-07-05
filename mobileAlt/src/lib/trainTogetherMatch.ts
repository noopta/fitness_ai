// Train Together — match display engine, copied verbatim from the RN
// implementation spec §03. The server computes each day's tier; this module
// decides how a row LOOKS under the active filter. Do not "simplify":
// flexible days NEVER dim under "Strong & up" — that was the bug the spec
// calls out.

export type ServerTier = 'exact' | 'strong' | 'flexible' | 'none';
export type RowTier = 'exact' | 'strong' | 'flex' | 'none' | 'rest';
export type Filter = 'exact' | 'strong' | 'all';

export interface OverlapSession { userId: string; rest: boolean; label: string | null }
export interface OverlapDayDTO {
  date: string;
  tier: ServerTier;
  reason: string | null;
  sessions: OverlapSession[];
}

export const RANK: Record<Exclude<RowTier, 'rest'>, number> = { none: 0, flex: 1, strong: 2, exact: 3 };
export const THRESHOLD: Record<Filter, number> = { exact: 3, strong: 2, all: 1 };

/** Server tier -> display tier; both-resting days become the inert 'rest' row. */
export function rowTier(day: OverlapDayDTO): RowTier {
  if (day.sessions.length > 0 && day.sessions.every(s => s.rest)) return 'rest';
  if (day.tier === 'flexible') return 'flex';
  return day.tier;
}

export interface RowState {
  tier: RowTier;
  /** matched style: border ink + shadowSm */
  hi: boolean;
  /** dimmed style: border transparent, all text #a1a1aa, no badge */
  dim: boolean;
  /** inert: single "Both resting" lane, not tappable */
  rest: boolean;
}

export function rowState(day: OverlapDayDTO, filter: Filter): RowState {
  const tier = rowTier(day);
  const hi = tier !== 'rest' && RANK[tier] >= THRESHOLD[filter];
  const dim = tier === 'rest' ? true
    : filter === 'exact' ? RANK[tier] < 3
    : (tier === 'none' && filter !== 'all');
  // ⚠ flexible days NEVER dim under "Strong & up" — they keep full text +
  // hairline border + dashed badge.
  return { tier, hi, dim, rest: tier === 'rest' };
}

// ─── Insight line ─────────────────────────────────────────────────────────────
// "You and Alex align on Thu + Sat — and it repeats weekly." Bolded fragment
// is the weekday list. Computed over the full horizon (current + 3 weeks).

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function weekdayShort(date: string): string {
  return DOW[new Date(date + 'T12:00:00Z').getUTCDay()];
}

export function insightLine(
  days: OverlapDayDTO[],
  otherNames: string[],
): { pre: string; bold: string; post: string } | null {
  const matchedByDow = new Map<string, number>();
  for (const d of days) {
    const t = rowTier(d);
    if (t === 'exact' || t === 'strong') {
      const dow = weekdayShort(d.date);
      matchedByDow.set(dow, (matchedByDow.get(dow) ?? 0) + 1);
    }
  }
  const weeks = Math.max(1, Math.round(days.length / 7));
  const dows = [...matchedByDow.entries()];
  if (dows.length === 0) return null;

  const recurring = dows.filter(([, n]) => n >= Math.min(2, weeks)).map(([d]) => d);
  const list = (recurring.length ? recurring : dows.map(([d]) => d)).slice(0, 3);
  const who = otherNames.length === 1
    ? `You and ${otherNames[0]}`
    : `You, ${otherNames.slice(0, -1).join(', ')} + ${otherNames[otherNames.length - 1]}`;
  return {
    pre: `${who} align on `,
    bold: list.join(' + '),
    post: recurring.length ? ' — and it repeats weekly.' : ' in the next few weeks.',
  };
}

// ─── Week paging helpers ─────────────────────────────────────────────────────

export function weekLabel(dates: string[]): string {
  if (!dates.length) return '';
  const a = new Date(dates[0] + 'T12:00:00Z');
  const b = new Date(dates[dates.length - 1] + 'T12:00:00Z');
  const mon = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' });
  return a.getUTCMonth() === b.getUTCMonth()
    ? `${mon(a)} ${a.getUTCDate()}–${b.getUTCDate()}`
    : `${mon(a)} ${a.getUTCDate()} – ${mon(b)} ${b.getUTCDate()}`;
}

export function longDate(date: string): string {
  return new Date(date + 'T12:00:00Z').toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC',
  });
}
