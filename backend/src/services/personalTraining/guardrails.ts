// Server-side safety checks (handoff §2.3). Before a suggestion that touches
// training load is returned, the client's active injuries are checked against
// the lift involved. The client only renders the resulting badge; it never
// computes it.

import type { Contraindication, LiftKey } from './types.js';

// Which main lifts load which injured area. Conservative on purpose: a false
// "conflict" costs the trainer a second look; a missed one could cost a client.
const AREA_LIFTS: { area: RegExp; lifts: LiftKey[] }[] = [
  { area: /knee|patell|acl|mcl|menisc|quad tendon/i, lifts: ['squat'] },
  { area: /shoulder|rotator|ac joint|labr|pec/i, lifts: ['bench', 'ohp'] },
  { area: /back|lumbar|disc|sciatic|spine|\bsi joint/i, lifts: ['deadlift', 'squat', 'ohp'] },
  { area: /hamstring|glute/i, lifts: ['deadlift'] },
  { area: /hip|groin|adductor/i, lifts: ['squat', 'deadlift'] },
  { area: /elbow|wrist|forearm/i, lifts: ['bench', 'ohp'] },
  { area: /ankle|achilles|calf/i, lifts: ['squat'] },
  { area: /neck|trap/i, lifts: ['ohp', 'squat'] },
];

export interface GuardrailResult {
  /** Active contraindications that were examined. */
  checked: number;
  /** Labels of the ones that conflict with the lift. */
  conflicts: string[];
  label: string;
}

export function liftsLoadedBy(area: string): LiftKey[] {
  const hit = new Set<LiftKey>();
  for (const row of AREA_LIFTS) if (row.area.test(area)) row.lifts.forEach((l) => hit.add(l));
  return [...hit];
}

/**
 * Check a client's active injuries against `lift` (null = a suggestion that
 * is not about a specific lift). Cleared injuries are not examined.
 */
export function checkContraindications(contraindications: Contraindication[], lift: LiftKey | null): GuardrailResult {
  const active = contraindications.filter((c) => c.active);
  const conflicts = lift ? active.filter((c) => liftsLoadedBy(c.label).includes(lift)).map((c) => c.label) : [];
  return {
    checked: active.length,
    conflicts,
    label: `Checked against ${active.length} contraindication${active.length === 1 ? '' : 's'}`,
  };
}
