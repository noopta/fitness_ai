// Server-side safety checks (handoff §2.3). Before a suggestion that touches
// training load is returned, the client's active contraindications are run
// through the rules engine against the lift involved. The client only renders
// the resulting badge; it never computes it.

import { patternBlocked, type Pattern } from './contraindicationRules.js';
import { toRuleInput } from './contraindications.js';
import type { Contraindication, LiftKey } from './types.js';

/** The movement patterns each main lift loads. */
export const LIFT_PATTERNS: Record<LiftKey, Pattern[]> = {
  squat: ['squat', 'axial_load'],
  bench: ['horizontal_press'],
  deadlift: ['hinge', 'axial_load', 'grip'],
  ohp: ['overhead_press', 'axial_load'],
};

export interface GuardrailResult {
  /** Active contraindications that were examined. */
  checked: number;
  /** Labels of the ones that conflict with the lift. */
  conflicts: string[];
  label: string;
}

/** Main lifts a free-text area would refuse while not cleared. Kept for callers that only have a label. */
export function liftsLoadedBy(area: string): LiftKey[] {
  const c = toRuleInput({ label: area, active: true });
  return (Object.keys(LIFT_PATTERNS) as LiftKey[]).filter((lift) => LIFT_PATTERNS[lift].some((p) => patternBlocked([c], p).length));
}

/**
 * Check a client's active contraindications against `lift` (null = a
 * suggestion that is not about a specific lift). Cleared ones are not examined.
 */
export function checkContraindications(contraindications: Contraindication[], lift: LiftKey | null): GuardrailResult {
  const active = contraindications.filter((c) => c.active);
  const rules = active.map(toRuleInput);
  const conflicts = lift
    ? rules.filter((r) => LIFT_PATTERNS[lift].some((p) => patternBlocked([r], p).length)).map((r) => r.condition)
    : [];
  return {
    checked: active.length,
    conflicts,
    label: `Checked against ${active.length} contraindication${active.length === 1 ? '' : 's'}`,
  };
}
