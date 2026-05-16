// The per-muscle ledger — the accumulating "Athlete Model" of one lifter's
// musculature. Rolls a user's whole training history (already dissected by
// workoutStimulusService) into a continuously-updated record per muscle:
// strength, weekly volume, intensity-zone distribution, trend, and a
// confidence score reflecting how much data backs the estimate.
//
// Pure + deterministic. The caller loads + normalizes workout logs; this
// service does the math. No DB. Recomputing from the full log history each
// time naturally incorporates every new workout — that IS the "reinforced
// over time" behavior, no snapshot table required (a stored-snapshot trend
// view is a future optimization, not a functional gate).

import { computeMuscleScores, type MuscleScores } from './muscleScoringService.js';
import {
  dissectWorkout, mergeStimulus, type LoggedExercise, type WorkoutStimulus,
} from './workoutStimulusService.js';
import type { MuscleGroup } from '../data/muscleAttribution.js';
import type { IntensityZone } from '../data/liftMechanics.js';

/** A workout as the ledger consumes it — date + canonical-named exercises. */
export interface LedgerWorkout {
  date: string;                 // YYYY-MM-DD
  exercises: LoggedExercise[];
}

export type MuscleTrend = 'improving' | 'plateau' | 'declining' | 'insufficient-data';

export interface MuscleLedgerEntry {
  muscle: MuscleGroup;
  /** 0-100 user-relative strength score (same basis as the radar). */
  strengthScore: number;
  /** Average tonnage this muscle received per week over the trailing window. */
  weeklyTonnageKg: number;
  /** Average fractional hard-set count per week over the trailing window. */
  weeklyHardSets: number;
  /** Fraction of trailing-window tonnage in each intensity zone (sums ~1). */
  zoneDistribution: Record<IntensityZone, number>;
  /** Strength trajectory from a regression on the muscle's weekly best e1RM. */
  trend: MuscleTrend;
  /** Slope of that regression — kg of e1RM change per week. */
  trendSlopePerWeekKg: number;
  /** 0-1 — how much data backs this muscle's estimates. */
  confidence: number;
  /** Days since this muscle was last trained, or null if never. */
  lastTrainedDaysAgo: number | null;
}

export interface MuscleLedger {
  entries: Partial<Record<MuscleGroup, MuscleLedgerEntry>>;
  windowWeeks: number;
  computedAt: string;
}

const TRAILING_WINDOW_WEEKS = 4;
// e1RM slope thresholds (kg/week) for trend classification. A muscle gaining
// >0.4 kg of e1RM per week is improving; losing >0.4 is declining; between
// is a plateau. Tuned conservative so noise doesn't read as a trend.
const TREND_IMPROVING_SLOPE = 0.4;
const TREND_DECLINING_SLOPE = -0.4;

/** ISO-week key (e.g. "2026-W07") for a YYYY-MM-DD date. Exported so the
 *  Athlete Model assembler can bucket lift series on the same calendar. */
export function isoWeekKey(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00Z');
  if (Number.isNaN(d.getTime())) return dateStr;
  const day = (d.getUTCDay() + 6) % 7; // Mon=0
  d.setUTCDate(d.getUTCDate() - day + 3);
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(
    ((d.getTime() - firstThursday.getTime()) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7,
  );
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/** Ordinary-least-squares slope of y over evenly-indexed x (0,1,2,...). */
function olsSlope(ys: number[]): number {
  const n = ys.length;
  if (n < 2) return 0;
  const meanX = (n - 1) / 2;
  const meanY = ys.reduce((s, y) => s + y, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - meanX) * (ys[i] - meanY);
    den += (i - meanX) ** 2;
  }
  return den === 0 ? 0 : num / den;
}

function classifyTrend(slope: number, points: number): MuscleTrend {
  if (points < 3) return 'insufficient-data';
  if (slope >= TREND_IMPROVING_SLOPE) return 'improving';
  if (slope <= TREND_DECLINING_SLOPE) return 'declining';
  return 'plateau';
}

/**
 * Build the per-muscle ledger from a user's full training history.
 * `workouts` should be sorted ascending by date with canonical exercise names.
 */
export function buildMuscleLedger(workouts: LedgerWorkout[]): MuscleLedger {
  const computedAt = new Date().toISOString();
  if (workouts.length === 0) {
    return { entries: {}, windowWeeks: TRAILING_WINDOW_WEEKS, computedAt };
  }

  // ── Per-week dissection ────────────────────────────────────────────────
  // Group workouts into ISO weeks; dissect + merge each week's workouts.
  const byWeek = new Map<string, WorkoutStimulus[]>();
  const weekOrder: string[] = [];
  for (const w of workouts) {
    const wk = isoWeekKey(w.date);
    if (!byWeek.has(wk)) { byWeek.set(wk, []); weekOrder.push(wk); }
    byWeek.get(wk)!.push(dissectWorkout(w.exercises));
  }
  const weeklyStimulus = weekOrder.map((wk) => ({
    week: wk,
    stim: mergeStimulus(byWeek.get(wk)!),
  }));

  // ── Trailing-window aggregate (last N weeks) for volume + zone split ───
  const trailing = weeklyStimulus.slice(-TRAILING_WINDOW_WEEKS);
  const trailingMerged = mergeStimulus(trailing.map((t) => t.stim));
  const trailingWeekCount = Math.max(1, trailing.length);

  // ── Strength scores — best e1RM per lift across all history ────────────
  // A PR doesn't un-happen, so strength uses each lift's best-ever e1RM.
  // computeMuscleScores log-scales the inputs, so a plain Epley estimate
  // here is fine — the RPE-aware path matters for the displayed lift e1RMs
  // (strength route), not for this relative muscle-balance scoring.
  const bestE1rmByLift = new Map<string, number>();
  for (const w of workouts) {
    for (const ex of w.exercises) {
      const reps = typeof ex.reps === 'number' ? ex.reps : parseInt(String(ex.reps), 10) || 0;
      if (!ex.weightKg || ex.weightKg <= 0 || reps <= 0) continue;
      const naive = Math.round(ex.weightKg * (1 + Math.min(reps, 12) / 30));
      if (naive > (bestE1rmByLift.get(ex.name) ?? 0)) bestE1rmByLift.set(ex.name, naive);
    }
  }
  const strengthScores: MuscleScores = computeMuscleScores(
    Array.from(bestE1rmByLift, ([canonicalName, current1RMkg]) => ({ canonicalName, current1RMkg })),
  );

  // ── Per-muscle weekly e1RM series for trend regression ─────────────────
  const muscleWeeklyE1rm = new Map<MuscleGroup, number[]>();
  for (const { stim } of weeklyStimulus) {
    for (const [muscle, s] of Object.entries(stim.perMuscle) as Array<[MuscleGroup, { bestE1rmKg: number }]>) {
      if (s.bestE1rmKg <= 0) continue;
      if (!muscleWeeklyE1rm.has(muscle)) muscleWeeklyE1rm.set(muscle, []);
      muscleWeeklyE1rm.get(muscle)!.push(s.bestE1rmKg);
    }
  }

  // ── Last-trained recency ───────────────────────────────────────────────
  const today = new Date();
  const lastTrainedByMuscle = new Map<MuscleGroup, string>();
  for (const w of workouts) {
    const s = dissectWorkout(w.exercises);
    for (const muscle of Object.keys(s.perMuscle) as MuscleGroup[]) {
      lastTrainedByMuscle.set(muscle, w.date); // workouts sorted asc → last wins
    }
  }

  // ── Assemble entries ───────────────────────────────────────────────────
  const entries: Partial<Record<MuscleGroup, MuscleLedgerEntry>> = {};
  const allMuscles = new Set<MuscleGroup>([
    ...(Object.keys(trailingMerged.perMuscle) as MuscleGroup[]),
    ...(Object.keys(strengthScores) as MuscleGroup[]),
  ]);

  for (const muscle of allMuscles) {
    const trailingS = trailingMerged.perMuscle[muscle];
    const series = muscleWeeklyE1rm.get(muscle) ?? [];
    const slope = olsSlope(series);
    const trend = classifyTrend(slope, series.length);

    // Zone distribution from trailing tonnage.
    const zoneRaw = trailingS?.byZone ?? { strength: 0, hypertrophy: 0, endurance: 0, power: 0 };
    const zoneTotal = Object.values(zoneRaw).reduce((s, v) => s + v, 0) || 1;
    const zoneDistribution = {
      strength: zoneRaw.strength / zoneTotal,
      hypertrophy: zoneRaw.hypertrophy / zoneTotal,
      endurance: zoneRaw.endurance / zoneTotal,
      power: zoneRaw.power / zoneTotal,
    };

    // Confidence: scales with weeks of e1RM data + total hard sets + recency.
    const lastDate = lastTrainedByMuscle.get(muscle);
    const daysAgo = lastDate
      ? Math.round((today.getTime() - new Date(lastDate + 'T00:00:00Z').getTime()) / 86400000)
      : null;
    const dataWeeks = series.length;
    let confidence = 0.25;
    confidence += Math.min(0.4, dataWeeks * 0.08);            // up to +0.40 from history depth
    confidence += Math.min(0.25, (trailingS?.hardSets ?? 0) * 0.03); // up to +0.25 from recent volume
    if (daysAgo != null && daysAgo <= 14) confidence += 0.10; // recency bonus
    if (daysAgo != null && daysAgo > 60) confidence -= 0.15;  // stale penalty
    confidence = Math.max(0.1, Math.min(1, confidence));

    entries[muscle] = {
      muscle,
      strengthScore: strengthScores[muscle] ?? 0,
      weeklyTonnageKg: Math.round((trailingS?.tonnageKg ?? 0) / trailingWeekCount),
      weeklyHardSets: Math.round(((trailingS?.hardSets ?? 0) / trailingWeekCount) * 10) / 10,
      zoneDistribution,
      trend,
      trendSlopePerWeekKg: Math.round(slope * 100) / 100,
      confidence: Math.round(confidence * 100) / 100,
      lastTrainedDaysAgo: daysAgo,
    };
  }

  return { entries, windowWeeks: TRAILING_WINDOW_WEEKS, computedAt };
}

/**
 * Overall profile confidence — the mean of per-muscle confidence, weighted
 * toward the muscles that actually have data. Surfaced as the Athlete
 * Model's headline "how complete is this picture" number.
 */
export function ledgerConfidence(ledger: MuscleLedger): number {
  const vals = Object.values(ledger.entries)
    .map((e) => e?.confidence ?? 0)
    .filter((c) => c > 0);
  if (vals.length === 0) return 0;
  return Math.round((vals.reduce((s, c) => s + c, 0) / vals.length) * 100) / 100;
}
