// Orchestrates the rules over a loaded context. Pure — no DB, no LLM.

import { doubleProgressionRule } from './rules/doubleProgression.js';
import { buildRetrofitProposal } from './rules/retrofit.js';
import { buildInferredProgramProposal, programLooksAbandoned } from './rules/inferProgram.js';
import type { AdaptationContext, ProposalDraft } from './types.js';

/**
 * Rules that run after a workout is logged. `keys` limits evaluation to the
 * lifts in that workout (so a bench session doesn't propose squat changes);
 * omit to evaluate the whole program.
 */
export function runPostWorkoutRules(ctx: AdaptationContext, keys?: Set<string>): ProposalDraft[] {
  if (!ctx.program) return [];
  const drafts: ProposalDraft[] = [];
  for (const planned of ctx.planned) {
    if (keys && !keys.has(planned.key)) continue;
    const exposures = ctx.exposuresByKey.get(planned.key) ?? [];
    const d = doubleProgressionRule(planned, exposures, ctx.unitPref);
    if (d) drafts.push(d);
  }
  return drafts.sort((a, b) => b.priority - a.priority);
}

/**
 * One-time bootstrap for an existing user.
 *   no program + enough history        → propose the program the logs describe (Cohort C)
 *   program the logs don't match       → same, framed as "what you've actually been running"
 *   program + history                  → retrofit targets (Cohort A)
 *   otherwise                          → nothing (Cohort B calibrates from the next session)
 */
export function runBootstrapRules(ctx: AdaptationContext): ProposalDraft[] {
  if (!ctx.program) {
    const d = buildInferredProgramProposal(ctx, 'no_program');
    return d ? [d] : [];
  }
  if (programLooksAbandoned(ctx)) {
    const d = buildInferredProgramProposal(ctx, 'abandoned');
    if (d) return [d];
  }
  const r = buildRetrofitProposal(ctx);
  return r ? [r] : [];
}
