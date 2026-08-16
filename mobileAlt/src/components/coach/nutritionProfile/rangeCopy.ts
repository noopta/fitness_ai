// Window-aware copy for the Nutrition Profile. Pure and dependency-free so it
// stays testable the moment mobileAlt gets a test runner (it has none today).
//
// This exists because almost every label on the profile screen was written
// assuming a single day. Under a 7d/30d window the SAME engine output means
// something different — "2140 KCAL LOGGED" is a per-day average, and read as a
// month's total it understates by 30x. Every string that could be misread as a
// day total lives here, in one place.

import type { NpRange } from '../../../lib/api';

export const NP_RANGES: ReadonlyArray<{ value: NpRange; label: string; a11yLabel: string }> = [
  { value: 'today', label: 'Today', a11yLabel: 'Today' },
  { value: '7d', label: '7 days', a11yLabel: 'Last 7 days' },
  { value: '30d', label: '30 days', a11yLabel: 'Last 30 days' },
];

export function rangeWindowLabel(range: NpRange): string {
  return range === 'today' ? 'TODAY' : range === '7d' ? 'LAST 7 DAYS' : 'LAST 30 DAYS';
}

/** Sentence-case form for body copy ("No meals logged in the last 30 days."). */
export function rangeSpokenLabel(range: NpRange): string {
  return range === 'today' ? 'today' : range === '7d' ? 'the last 7 days' : 'the last 30 days';
}

export interface RangeCopy {
  /** Hero kicker above the stat rail. */
  heroKicker: string;
  /** Stat label under kcal — MUST say "per day" for windows. */
  kcalLabel: string;
  /** Section label above the meals list / day list. */
  mealsLabel: string;
  /** Kicker on the top-move card. */
  moveKicker: string;
  /** Empty-state body copy. */
  emptyText: string;
  /** Coverage disclosure, or null when there is nothing to disclose. */
  coverageNote: string | null;
}

export function rangeCopy(
  range: NpRange,
  loggedDays = 0,
  windowDays = 1,
  partialDays = 0,
): RangeCopy {
  const isToday = range === 'today';
  const window = rangeWindowLabel(range);

  // Only meaningful for windows: on a single day "1 of 1 days logged" is noise.
  let coverageNote: string | null = null;
  if (!isToday) {
    const base = `${loggedDays} of ${windowDays} days logged`;
    coverageNote = partialDays > 0
      ? `${base}, ${partialDays} lightly — averages cover logged days only.`
      : `${base} — averages cover logged days only.`;
  }

  return {
    heroKicker: isToday ? 'TODAY · BY BODY SYSTEM' : `${window} · TYPICAL DAY · BY BODY SYSTEM`,
    kcalLabel: isToday ? 'KCAL LOGGED' : 'KCAL / DAY',
    mealsLabel: isToday
      ? "TODAY'S MEALS · SYNCED FROM COACH"
      : `${window} · ${loggedDays} OF ${windowDays} LOGGED`,
    moveKicker: isToday ? "TODAY'S HIGHEST-LEVERAGE MOVE" : 'HIGHEST-LEVERAGE MOVE',
    emptyText: isToday
      ? 'No meals logged today. Log food in Coach → Nutrition and your profile updates automatically.'
      : `No meals logged in ${rangeSpokenLabel(range)}. Log food in Coach → Nutrition and your profile updates automatically.`,
    coverageNote,
  };
}
