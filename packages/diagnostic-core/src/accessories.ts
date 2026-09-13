import type { AccessoryRecord, LiftId } from './types';
import { ladderFor } from './lifts';

// Accessory collection policy (§5): minimum 2 ratios, target 3, one lift at a
// time. Everything advances by "next un-answered index" — never a cursor —
// so Change and Skip can't strand the user at the end of the ladder.

export const MIN_RATIOS = 2;
export const TARGET_RATIOS = 3;

export function loggedCount(records: AccessoryRecord[]): number {
  return records.filter((r) => r.status === 'logged').length;
}

export function isAnswered(records: AccessoryRecord[], exerciseId: string): boolean {
  return records.some((r) => r.exerciseId === exerciseId);
}

/** Lowest-index ladder lift the user hasn't logged, marked untrained, or skipped. */
export function nextOffer(lift: LiftId, records: AccessoryRecord[]): string | null {
  return ladderFor(lift).find((id) => !isAnswered(records, id)) ?? null;
}

/**
 * "Change": the next un-answered lift AFTER the current one, wrapping. Never
 * an answered lift, and null when the current one is the only option left.
 */
export function changeOffer(lift: LiftId, records: AccessoryRecord[], current: string): string | null {
  const ladder = ladderFor(lift);
  const start = ladder.indexOf(current);
  for (let step = 1; step <= ladder.length; step++) {
    const id = ladder[(start + step + ladder.length) % ladder.length];
    if (id !== current && !isAnswered(records, id)) return id;
  }
  return null;
}

/** Loop ends when 3 are logged or the ladder is exhausted (Move on handled by the caller). */
export function loopComplete(lift: LiftId, records: AccessoryRecord[]): boolean {
  return loggedCount(records) >= TARGET_RATIOS || nextOffer(lift, records) === null;
}

/** Below the minimum the escape hatch is a quiet Skip; at 2+ it's a solid Move on. */
export function canMoveOn(records: AccessoryRecord[]): boolean {
  return loggedCount(records) >= MIN_RATIOS;
}
