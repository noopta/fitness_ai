// Rules: training phase → phase_confirm and calorie_adjust drafts. Pure.
//
// The phase is inferred from logs (services/phaseInference.ts) but never acted
// on silently: when the inference is confident and differs from what the user
// confirmed, we ask ("looks like you're cutting — right?"). Calorie nudges
// only fire on the effective phase — i.e. something the user confirmed or the
// evidence is strong on — and always as a card.

import type { EvidenceLine, PhaseResult, ProposalDraft, TrainingPhase } from '../types.js';
import { EFFECTIVE_CONFIDENCE, type PhaseSignals } from '../../services/phaseInference.js';

export const PHASE_COPY: Record<TrainingPhase, { title: string; body: string }> = {
  building_strength: { title: "Looks like you're building strength", body: 'Your main lifts are climbing with bodyweight steady and most work in lower rep ranges. Confirming lets suggestions favour load increases and periodic top-set PR attempts.' },
  cutting: { title: "Looks like you're cutting", body: 'Bodyweight is trending down at a sustainable pace. Confirming means flat strength reads as a win, not a plateau, and we stop pushing PR-style load jumps.' },
  cut_too_aggressive: { title: 'Your cut looks steeper than it needs to be', body: "Bodyweight is dropping faster than ~1% a week, which usually costs strength and muscle. Confirming lets us suggest a smaller deficit and hold loads while you're here." },
  building_muscle: { title: "Looks like you're building muscle", body: 'Bodyweight is trending up. Confirming lets suggestions favour extra sets and reps — the main drivers of growth.' },
  recomp: { title: "Looks like you're recomping", body: 'Strength is climbing while bodyweight holds steady. Confirming keeps suggestions balanced between load and volume.' },
  plateau: { title: 'Looks like things have stalled', body: "Strength has been flat for a few weeks with no change in bodyweight. Confirming lets us work through a plateau plan rather than one lift at a time." },
  rebuilding_consistency: { title: "Looks like you're getting back into it", body: "After some time off, the priority is showing up — suggestions will resume and ramp rather than push." },
  unknown: { title: 'Training phase', body: '' },
};

export interface PhaseDraftInput {
  result: PhaseResult;
  signals: PhaseSignals;
  dailyCalorieTarget: number | null;
}

export function phaseConfirmDraft(result: PhaseResult): ProposalDraft | null {
  if (result.inferred === 'unknown' || result.confidence < EFFECTIVE_CONFIDENCE) return null;
  if (result.confirmed?.phase === result.inferred) return null;
  const copy = PHASE_COPY[result.inferred];
  const evidence: EvidenceLine[] = result.evidence.slice(0, 5);
  const mismatch = result.statedGoalMismatch ? ` ${result.statedGoalMismatch}.` : '';
  return {
    kind: 'phase_confirm',
    dedupeKey: `phase_confirm:${result.inferred}`,
    title: copy.title,
    evidence,
    reasoning: `${copy.body}${mismatch} If that's not what you're going for, decline and we'll keep treating your training the way it was.`,
    proposal: { kind: 'phase_confirm', phase: result.inferred, previous: result.confirmed?.phase ?? null, evidence },
    confidence: result.confidence,
    priority: 85,
  };
}

/**
 * cut_too_aggressive → a smaller deficit (+~250 kcal, never above
 * maintenance − 250); building_muscle gaining >0.5%/wk → trim the surplus.
 * Needs a number to move FROM: the declared target, else logged intake.
 */
export function calorieAdjustDraft(input: PhaseDraftInput): ProposalDraft | null {
  const { result, signals } = input;
  const from = input.dailyCalorieTarget ?? signals.avgIntakeKcal;
  if (from == null || from <= 0) return null;
  const m = result.maintenanceKcal;
  const bwLine = signals.bwPctPerWeek != null ? { label: 'Bodyweight', value: `${signals.bwPctPerWeek > 0 ? '+' : ''}${signals.bwPctPerWeek}%/wk` } : null;
  if (result.effective === 'cut_too_aggressive') {
    let to = from + 250;
    if (m != null) to = Math.min(Math.max(to, m - 500), m - 250);
    to = Math.round(to / 10) * 10;
    if (to <= from) return null;
    return {
      kind: 'calorie_adjust', dedupeKey: 'calorie_adjust',
      title: 'Ease the cut a little',
      evidence: [
        ...(bwLine ? [bwLine] : []),
        { label: input.dailyCalorieTarget != null ? 'Daily target' : 'Avg intake', value: `${Math.round(from)} kcal` },
        ...(m != null ? [{ label: 'Maintenance', value: `~${m} kcal` }] : []),
      ],
      reasoning: `You're losing more than ~1% of bodyweight a week. Past that, a bigger share of what you lose is muscle and strength drops with it. Moving to ${to} kcal keeps the cut going at a pace you can hold — and hold your loads steady meanwhile rather than chasing increases.`,
      proposal: { kind: 'calorie_adjust', fromKcal: Math.round(from), toKcal: to, reason: 'cut_too_aggressive' },
      confidence: result.confidence,
      priority: 80,
    };
  }
  if (result.effective === 'building_muscle' && signals.bwPctPerWeek != null && signals.bwPctPerWeek > 0.5) {
    const to = Math.round((from - 200) / 10) * 10;
    if (to <= 1200) return null;
    return {
      kind: 'calorie_adjust', dedupeKey: 'calorie_adjust',
      title: 'Trim the surplus a little',
      evidence: [
        ...(bwLine ? [bwLine] : []),
        { label: input.dailyCalorieTarget != null ? 'Daily target' : 'Avg intake', value: `${Math.round(from)} kcal` },
      ],
      reasoning: `Bodyweight is climbing faster than ~0.5% a week. Muscle can only be built so fast — beyond ~0.25–0.5% a week most of the extra is fat. ${to} kcal keeps the surplus that drives growth without the excess.`,
      proposal: { kind: 'calorie_adjust', fromKcal: Math.round(from), toKcal: to, reason: 'surplus_too_large' },
      confidence: result.confidence,
      priority: 75,
    };
  }
  return null;
}

export function buildPhaseDrafts(input: PhaseDraftInput): ProposalDraft[] {
  const out: ProposalDraft[] = [];
  const c = phaseConfirmDraft(input.result);
  if (c) out.push(c);
  const k = calorieAdjustDraft(input);
  if (k) out.push(k);
  return out;
}
