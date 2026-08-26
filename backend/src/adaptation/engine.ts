// Orchestrates the rules over a loaded context. Pure — no DB, no LLM.

import { doubleProgressionRule } from './rules/doubleProgression.js';
import { buildRetrofitProposal } from './rules/retrofit.js';
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

export function runBootstrapRules(ctx: AdaptationContext): ProposalDraft[] {
  const r = buildRetrofitProposal(ctx);
  return r ? [r] : [];
}
