// Exercise alternatives (v2 handoff T-10): what Swap offers on an exercise
// page. Same primary muscle from the seed library, same kind (compound or
// isolation) first, then the rest. DB-free and pure, so it's tested.

import { SEED, canonicalizeSync } from './exerciseCanonical.js';

export interface Alternative { name: string; primaryMuscle: string; isCompound: boolean }

/** Up to `limit` swaps for `name`, never itself. Unknown names get none. */
export function alternativesFor(name: string, limit = 5): Alternative[] {
  const me = canonicalizeSync(name);
  if (!me) return [];
  const seen = new Set<string>([me.canonicalName]);
  const same: Alternative[] = [];
  const other: Alternative[] = [];
  for (const e of Object.values(SEED)) {
    if (e.primaryMuscle !== me.primaryMuscle || seen.has(e.canonicalName)) continue;
    seen.add(e.canonicalName);
    (e.isCompound === me.isCompound ? same : other).push({ name: e.canonicalName, primaryMuscle: e.primaryMuscle, isCompound: e.isCompound });
  }
  return [...same, ...other].slice(0, Math.max(0, limit));
}
