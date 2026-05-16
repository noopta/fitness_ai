// The Athlete Model assembler — composes every layer of the Strength
// Profile into one structured object: the per-muscle ledger, derived
// metrics (ratios, relative strength, antagonist balance), the ranked
// insight feed, recovery/diet factors, and an overall confidence score.
//
// Pure + deterministic: the caller (the /strength/profile route) loads all
// the data and passes it in; this composes. Keeps the route thin and the
// whole model unit-testable without a DB.

import {
  buildMuscleLedger, ledgerConfidence, isoWeekKey,
  type LedgerWorkout, type MuscleLedger,
} from './muscleLedgerService.js';
import {
  computeRatios, computeRelativeStrength, computeBalance,
  type LiftE1rm, type RatioResult, type RelStrengthResult, type BalanceResult,
} from './strengthMetricsService.js';
import {
  generateInsights, type Insight, type LiftSeries,
} from './insightEngine.js';
import {
  analyzeRecoveryFactors,
  type RecoveryFactor, type BodyWeightPoint, type NutritionPoint, type WellnessPoint,
} from './recoveryFactorsService.js';
import { e1rmWithRpe, parseRPE } from '../engine/e1rm.js';
import { movementPatternFor, PATTERN_LABEL, type MovementPattern } from '../data/liftMechanics.js';

export interface AthleteModelInput {
  /** Canonical-named, date-stamped workouts, ascending by date. */
  workouts: LedgerWorkout[];
  /** Best e1RM (kg) per canonical lift across all history. */
  liftE1rms: LiftE1rm[];
  bodyweightKg: number | null;
  bodyWeight: BodyWeightPoint[];
  nutrition: NutritionPoint[];
  wellness: WellnessPoint[];
}

export interface PatternCoverage {
  pattern: MovementPattern;
  label: string;
  trailingSets: number;     // hard sets in the trailing window
  status: 'covered' | 'light' | 'neglected';
}

export interface AthleteModel {
  ledger: MuscleLedger;
  confidence: number;                 // 0-1, overall completeness of the model
  ratios: RatioResult[];
  relativeStrength: RelStrengthResult[];
  balance: BalanceResult[];
  patternCoverage: PatternCoverage[];
  insights: Insight[];
  recoveryFactors: RecoveryFactor[];
  computedAt: string;
}

const COVERAGE_WINDOW_WEEKS = 4;

/**
 * Per-lift weekly best-e1RM series, for the Insight Engine's stagnation
 * detection. One LiftSeries per canonical lift, e1RMs ordered oldest→newest.
 */
function buildLiftSeries(workouts: LedgerWorkout[]): LiftSeries[] {
  // lift → week → best e1RM that week
  const byLift = new Map<string, Map<string, number>>();
  const weekOrderByLift = new Map<string, string[]>();
  for (const w of workouts) {
    const wk = isoWeekKey(w.date);
    for (const ex of w.exercises) {
      const reps = typeof ex.reps === 'number' ? ex.reps : parseInt(String(ex.reps), 10) || 0;
      if (!ex.weightKg || ex.weightKg <= 0 || reps <= 0) continue;
      const e1rm = e1rmWithRpe(ex.weightKg, reps, parseRPE(ex.rpe));
      if (e1rm <= 0) continue;
      if (!byLift.has(ex.name)) { byLift.set(ex.name, new Map()); weekOrderByLift.set(ex.name, []); }
      const weekMap = byLift.get(ex.name)!;
      if (!weekMap.has(wk)) weekOrderByLift.get(ex.name)!.push(wk);
      weekMap.set(wk, Math.max(weekMap.get(wk) ?? 0, e1rm));
    }
  }
  const series: LiftSeries[] = [];
  for (const [lift, weekMap] of byLift) {
    const order = weekOrderByLift.get(lift)!;
    series.push({ canonicalName: lift, weeklyE1rmKg: order.map((wk) => weekMap.get(wk)!) });
  }
  return series;
}

/** Movement-pattern coverage over the trailing window. */
function buildPatternCoverage(workouts: LedgerWorkout[]): PatternCoverage[] {
  // Bucket the trailing window's workouts by ISO week, keep the last N weeks.
  const weeks = new Map<string, LedgerWorkout[]>();
  const order: string[] = [];
  for (const w of workouts) {
    const wk = isoWeekKey(w.date);
    if (!weeks.has(wk)) { weeks.set(wk, []); order.push(wk); }
    weeks.get(wk)!.push(w);
  }
  const trailingWeeks = order.slice(-COVERAGE_WINDOW_WEEKS);
  const setCount: Partial<Record<MovementPattern, number>> = {};
  for (const wk of trailingWeeks) {
    for (const w of weeks.get(wk)!) {
      for (const ex of w.exercises) {
        const pat = movementPatternFor(ex.name);
        if (!pat) continue;
        setCount[pat] = (setCount[pat] ?? 0) + Math.max(0, Math.round(ex.sets));
      }
    }
  }
  // Report the major movement patterns (skip isolation/core noise here).
  const major: MovementPattern[] = [
    'horizontal-push', 'incline-push', 'vertical-push',
    'horizontal-pull', 'vertical-pull', 'squat', 'hinge', 'lunge',
  ];
  return major.map((pattern) => {
    const sets = setCount[pattern] ?? 0;
    const status: PatternCoverage['status'] =
      sets >= 6 ? 'covered' : sets >= 1 ? 'light' : 'neglected';
    return { pattern, label: PATTERN_LABEL[pattern], trailingSets: sets, status };
  });
}

/**
 * Compose the full Athlete Model from already-loaded data.
 */
export function buildAthleteModel(input: AthleteModelInput): AthleteModel {
  const ledger = buildMuscleLedger(input.workouts);
  const confidence = ledgerConfidence(ledger);

  const ratios = computeRatios(input.liftE1rms);
  const relativeStrength = computeRelativeStrength(input.liftE1rms, input.bodyweightKg ?? 0);

  // Balance reads off the ledger's strength scores.
  const muscleScores: Record<string, number> = {};
  for (const [muscle, entry] of Object.entries(ledger.entries)) {
    if (entry) muscleScores[muscle] = entry.strengthScore;
  }
  const balance = computeBalance(muscleScores);

  const patternCoverage = buildPatternCoverage(input.workouts);

  // Days since last workout — gates the "neglect" insights.
  const lastWorkout = input.workouts[input.workouts.length - 1];
  const daysSinceLastWorkout = lastWorkout
    ? Math.round((Date.now() - new Date(lastWorkout.date + 'T00:00:00Z').getTime()) / 86400000)
    : null;

  const recoveryFactors = analyzeRecoveryFactors({
    bodyWeight: input.bodyWeight,
    nutrition: input.nutrition,
    wellness: input.wellness,
    bodyWeightLbs: input.bodyweightKg != null ? input.bodyweightKg * 2.2046 : null,
  });

  let insights = generateInsights({
    ledger,
    ratios,
    balance,
    liftSeries: buildLiftSeries(input.workouts),
    daysSinceLastWorkout,
  });

  // Enrich stagnation insights with the top recovery factor — turns
  // "bench stalled" into "bench stalled, and you've been in a deficit".
  if (recoveryFactors.length > 0) {
    const topFactor = recoveryFactors[0];
    insights = insights.map((ins) =>
      ins.kind === 'stagnation'
        ? { ...ins, detail: `${ins.detail} Contributing factor: ${topFactor.note}` }
        : ins,
    );
  }

  return {
    ledger,
    confidence,
    ratios,
    relativeStrength,
    balance,
    patternCoverage,
    insights,
    recoveryFactors,
    computedAt: new Date().toISOString(),
  };
}
