/**
 * Recency penalty, so the finder does not say salmon every single day.
 *
 * A ranker with no memory is deterministic given similar inputs, and a user's
 * remaining macros ARE similar most days — so the same option wins forever. That
 * is how a recommendation feature dies: not by being wrong, but by being boring
 * enough to stop opening.
 *
 * This is a penalty, not a filter. If wild salmon really is the best answer to
 * today's gap, it can still win — it just has to beat the alternatives by enough
 * to overcome having been suggested yesterday. Decay is over days rather than
 * shows, because "you told me this yesterday" is the complaint, not "you told me
 * this twice in one session".
 */

/**
 * Half-life in days.
 *
 * Tuned so the curve matches the actual complaint. "You told me this yesterday"
 * is the thing users notice, so a 1-day-old repeat still carries a ~41% penalty;
 * by 3 days it is down to ~16% and by a week it is negligible. A longer
 * half-life reads as the finder holding a grudge against a food.
 */
const HALF_LIFE_DAYS = 1.5;

/** Floor on the multiplier: even a suggestion made an hour ago keeps a third of its score. */
const MAX_PENALTY = 0.35;

export interface ShownRecord {
  itemKey: string;
  shownAt: Date;
  /** Set when the user actually logged something matching it. */
  actedAt?: Date | null;
}

/**
 * Multiplier in [MAX_PENALTY, 1] for a candidate given what we have shown before.
 *
 * Acting on a suggestion is treated as a WEAKER signal to suppress than ignoring
 * one. A user who cooked the salmon and logged it liked the salmon; a user who
 * saw it three times and never logged it is being nagged. So an acted-on item
 * recovers at twice the rate.
 */
export function varietyFactor(itemKey: string, history: ShownRecord[], now = new Date()): number {
  let worst = 1;
  for (const h of history) {
    if (h.itemKey !== itemKey) continue;
    const ageDays = (now.getTime() - h.shownAt.getTime()) / 86_400_000;
    if (ageDays < 0) continue;
    const halfLife = h.actedAt ? HALF_LIFE_DAYS / 2 : HALF_LIFE_DAYS;
    const decay = Math.pow(0.5, ageDays / halfLife);
    const factor = 1 - (1 - MAX_PENALTY) * decay;
    if (factor < worst) worst = factor;
  }
  return worst;
}

/**
 * Penalise a whole PLACE, not just a dish.
 *
 * Without this every option clusters at the single nearest grocer, because
 * distance decay makes it win for every ingredient independently. Spreading
 * across venues is what makes the list read as a set of real choices rather than
 * one shop's inventory.
 */
export function venueSpreadFactor(placeKey: string | null | undefined, alreadyPicked: Array<string | null | undefined>): number {
  if (!placeKey) return 1;
  const n = alreadyPicked.filter(p => p === placeKey).length;
  if (n === 0) return 1;
  return Math.pow(0.75, n);
}
