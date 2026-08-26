// Rule: double progression (reps first, then load).
//
// Fires when the lifter has topped the rep range at (or above) the target
// load for two consecutive exposures without grinding. Proposes ONE
// increment. Never applies anything — returns a draft for the user to confirm.

import { scoreExposure } from '../score.js';
import { nextLoad } from '../targets.js';
import { formatWeight, type UnitPreference } from '../../services/weightUnits.js';
import type { Exposure, PlannedExercise, ProposalDraft } from '../types.js';

const SESSIONS_REQUIRED = 2;

function fmt(kg: number | null | undefined, pref: UnitPreference): string {
  return kg == null ? '—' : (formatWeight(kg, pref, pref === 'metric' ? 1 : 0) ?? '—');
}

function fmtSet(e: Exposure, pref: UnitPreference): string {
  const t = e.top!;
  const reps = e.sets.filter(s => s.weightKg != null).map(s => s.reps).join(', ');
  return `${fmt(t.weightKg, pref)} × ${reps}${t.rpe != null ? ` @ RPE ${t.rpe}` : ''}`;
}

export function doubleProgressionRule(
  planned: PlannedExercise,
  exposures: Exposure[],   // newest first
  pref: UnitPreference,
): ProposalDraft | null {
  const loaded = exposures.filter(e => e.top && e.e1rmKg > 0);
  if (loaded.length < SESSIONS_REQUIRED) return null;
  const recent = loaded.slice(0, SESSIONS_REQUIRED);

  // The load we're progressing FROM: the target if the plan has one, else the
  // load they've actually been using (must be the same across both sessions —
  // otherwise they're already self-progressing and we'd be guessing).
  const currentKg = planned.targetWeightKg ?? recent[0].top!.weightKg!;
  const sameLoad = recent.every(e => Math.abs(e.top!.weightKg! - currentKg) < 0.26);
  if (!sameLoad) return null;

  const scores = recent.map(e => scoreExposure(planned, e));
  if (!scores.every(s => s.result === 'exceeded')) return null;

  const toKg = nextLoad(currentKg, planned.exercise, pref);
  if (toKg <= currentKg) return null;

  const rpeLoggedBoth = recent.every(e => e.rpeLogged);
  const confidence = rpeLoggedBoth ? 0.9 : 0.65;
  const { min, max } = planned.repRange;
  const rangeLabel = min === max ? `${min}` : `${min}–${max}`;

  const evidence = [
    ...recent.slice().reverse().map(e => ({ label: e.date, value: fmtSet(e, pref) })),
    { label: 'Program target', value: `${fmt(currentKg, pref)} × ${rangeLabel}${planned.targetRPE != null ? ` @ RPE ${planned.targetRPE}` : ''}` },
    { label: 'Est. 1RM', value: fmt(recent[0].e1rmKg, pref) },
  ];

  const rpeClause = rpeLoggedBoth
    ? `with RPE ${recent.map(e => e.top!.rpe).join(' and ')} — reps in reserve on every set`
    : 'twice in a row';
  const reasoning = `You hit the top of the ${rangeLabel} range on every set at ${fmt(currentKg, pref)} ${rpeClause}. Double progression says reps first, then load — you've done the reps part. One step up keeps the stimulus where strength is built without a jump you can't recover from.`;

  return {
    kind: 'load_change',
    dedupeKey: `load_change:${planned.key}`,
    title: `Your ${planned.exercise} is ahead of plan`,
    evidence,
    reasoning,
    proposal: { kind: 'load_change', key: planned.key, exercise: planned.exercise, fromWeightKg: currentKg, toWeightKg: toKg, scope: 'program' },
    confidence,
    priority: 40,
  };
}
