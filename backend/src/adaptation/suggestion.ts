// Next-session suggestion per lift (contract 1). Pure.
//
// The one line on the log sheet: "Last two sessions felt easier at 80 kg × 8
// — try 82.5 kg". Precedence:
//   1. program target          (the plan the user chose wins)
//   2. latest applied next_session within ~21 days, until a logged session
//      reaches it (then it's done its job)
//   3. trend-derived           (detectors + planForSignal — the same logic a
//      card would use, so the sheet and the card never disagree; a pending
//      card's numbers are used verbatim)
// An applied deload covering the lift (7 days) turns any of these into a
// deload session — same weight, fewer sets. An accepted volume_balance for
// the lift's muscle adds / removes a set on trend and applied suggestions.

import { parseRepRange } from './targets.js';
import { detectLiftSignal, daysBetween, dateStr, GAP_DAYS, primaryMuscleOf } from './detectors.js';
import { planForSignal, fmtKg, liftDedupeKey } from './rules/logTrend.js';
import { roundToIncrement } from './targets.js';
import type { UnitPreference } from '../services/weightUnits.js';
import type { Exposure, PlannedExercise, ProposalPayload, SuggestionAction, TrainingPhase, NextSessionPayload } from './types.js';

export interface Suggestion {
  weightKg: number | null;
  reps: string;
  sets: number;
  rpe: number | null;
  action: SuggestionAction;
  basis: 'applied_target' | 'program_target' | 'trend';
  note: string;
  proposalId: string | null;
}

/** The slice of an AdaptationProposal row the suggestion needs. */
export interface SuggestionProposalRow {
  id: string;
  kind: string;
  dedupeKey: string;
  status: string;
  proposal: ProposalPayload | null;
  decidedAt: Date | null;
}

export interface SuggestionInput {
  key: string;
  name: string;
  /** Newest first. */
  exposures: Exposure[];
  planned: PlannedExercise | null;
  /** Applied next_session / deload / volume_balance rows (any lift). */
  applied: SuggestionProposalRow[];
  /** Pending rows (any lift). */
  pending: SuggestionProposalRow[];
  unitPref: UnitPreference;
  phase: TrainingPhase;
  now: Date;
  plateauStep?: number;
}

export const APPLIED_TARGET_DAYS = 21;
export const DELOAD_DAYS = 7;
const r2 = (n: number | null) => (n == null ? null : Math.round(n * 100) / 100);

function ageDays(d: Date | null, now: Date): number {
  return d ? (now.getTime() - new Date(d).getTime()) / 86_400_000 : Infinity;
}

/** An applied target is used up once a session on/after it reached it. */
function consumed(p: NextSessionPayload, decidedAt: Date, exposures: Exposure[]): boolean {
  const from = dateStr(new Date(decidedAt));
  const minReps = parseRepRange(p.reps).min;
  return exposures.some(e =>
    // Strictly after: the session that triggered the card is the one it's
    // about, not the one that answers it.
    e.date > from &&
    (p.toWeightKg == null || (e.top?.weightKg ?? 0) >= p.toWeightKg - 0.26) &&
    e.minReps >= minReps);
}

export function computeSuggestion(input: SuggestionInput): Suggestion | null {
  const { key, name, exposures, planned, unitPref: pref, now } = input;
  if (exposures.length < 2) return null;
  const last = exposures[0];
  const lastTopKg = last.top?.weightKg ?? null;
  const pendingRow = input.pending.find(p => p.dedupeKey === liftDedupeKey(key) && p.proposal?.kind === 'next_session') ?? null;

  let base: Suggestion;
  let baseAt = 0; // when the base was decided (ms) — a newer deload overrides
  const appliedNext = input.applied
    .filter(r => r.proposal?.kind === 'next_session' && (r.proposal as NextSessionPayload).key === key && r.decidedAt && ageDays(r.decidedAt, now) <= APPLIED_TARGET_DAYS)
    .sort((a, b) => new Date(b.decidedAt!).getTime() - new Date(a.decidedAt!).getTime())[0];

  if (planned) {
    const target = planned.targetWeightKg ?? lastTopKg;
    let action: SuggestionAction = 'repeat';
    if (planned.targetWeightKg != null && lastTopKg != null) {
      const diff = planned.targetWeightKg - lastTopKg;
      action = diff > 0.26 ? 'add_load' : diff < -0.26 ? 'reset' : 'repeat';
    }
    const reps = planned.repsRaw || (planned.repRange.min === planned.repRange.max ? String(planned.repRange.min) : `${planned.repRange.min}-${planned.repRange.max}`);
    base = {
      weightKg: r2(target), reps, sets: planned.sets, rpe: planned.targetRPE, action, basis: 'program_target',
      note: `Program: ${fmtKg(target, pref)} × ${reps}${planned.targetRPE != null ? ` @ RPE ${planned.targetRPE}` : ''}`,
      proposalId: pendingRow?.id ?? null,
    };
  } else if (appliedNext && !consumed(appliedNext.proposal as NextSessionPayload, appliedNext.decidedAt!, exposures)) {
    const p = appliedNext.proposal as NextSessionPayload;
    base = {
      weightKg: r2(p.toWeightKg), reps: p.reps, sets: p.sets, rpe: p.rpe, action: p.action, basis: 'applied_target',
      note: p.note || `Your target: ${fmtKg(p.toWeightKg, pref)} × ${p.reps}`,
      proposalId: pendingRow?.id ?? null,
    };
    baseAt = new Date(appliedNext.decidedAt!).getTime();
  } else if (pendingRow) {
    const p = pendingRow.proposal as NextSessionPayload;
    base = { weightKg: r2(p.toWeightKg), reps: p.reps, sets: p.sets, rpe: p.rpe, action: p.action, basis: 'trend', note: p.note || '', proposalId: pendingRow.id };
  } else {
    const away = daysBetween(dateStr(now), last.date);
    if (away >= GAP_DAYS && lastTopKg != null) {
      const to = roundToIncrement(lastTopKg * 0.9, name, pref);
      const reps = String(last.top?.reps ?? last.minReps);
      base = {
        weightKg: r2(to), reps, sets: last.sets.length, rpe: null, action: 'resume', basis: 'trend',
        note: `${away} days since your last ${name} — start at ${fmtKg(to, pref)} and ramp back over two sessions`,
        proposalId: null,
      };
    } else {
      const sig = detectLiftSignal(exposures, now);
      const plan = planForSignal(sig, pref, { phase: input.phase, plateauStep: input.plateauStep ?? 0 });
      base = { weightKg: r2(plan.toWeightKg), reps: plan.reps, sets: plan.sets, rpe: plan.rpe, action: plan.action, basis: 'trend', note: plan.note, proposalId: null };
    }
  }

  // Deload modifier.
  const deload = input.applied
    .filter(r => r.proposal?.kind === 'deload' && (r.proposal as any).keys?.includes(key) && ageDays(r.decidedAt, now) <= DELOAD_DAYS)
    .sort((a, b) => new Date(b.decidedAt!).getTime() - new Date(a.decidedAt!).getTime())[0];
  if (deload && new Date(deload.decidedAt!).getTime() >= baseAt) {
    const cut = Number((deload.proposal as any).volumeCutPct) || 40;
    const sets = Math.max(1, Math.round(base.sets * (1 - cut / 100)));
    const weightKg = base.weightKg ?? r2(lastTopKg);
    return {
      ...base, weightKg, sets, action: 'deload', rpe: base.rpe != null ? Math.min(base.rpe, 7) : 7,
      note: `Deload week — ${sets} × ${base.reps} at ${fmtKg(weightKg, pref)}, same weight, fewer sets`,
      proposalId: base.proposalId,
    };
  }

  // Accepted volume_balance for this lift's muscle.
  if (base.basis !== 'program_target') {
    const muscle = primaryMuscleOf(name);
    const vb = muscle ? input.applied
      .filter(r => r.proposal?.kind === 'volume_balance' && (r.proposal as any).muscle === muscle && ageDays(r.decidedAt, now) <= APPLIED_TARGET_DAYS)
      .sort((a, b) => new Date(b.decidedAt!).getTime() - new Date(a.decidedAt!).getTime())[0] : undefined;
    if (vb && (base.action === 'repeat' || base.action === 'hold' || base.action === 'add_rep')) {
      const dir = (vb.proposal as any).direction;
      if ((dir === 'add' || dir === 'rebalance') && base.sets < 6) {
        return { ...base, sets: base.sets + 1, action: 'add_set', note: `${base.note} · +1 set (more ${muscle} volume)` };
      }
      if (dir === 'reduce' && base.sets > 2) {
        return { ...base, sets: base.sets - 1, action: 'drop_set', note: `${base.note} · one fewer set (${muscle} volume)` };
      }
    }
  }
  return base;
}
