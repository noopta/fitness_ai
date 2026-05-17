// The Insight Engine — the proactive layer of the Athlete Model.
//
// Consumes the per-muscle ledger + derived metrics and produces ranked,
// structured insights: stalled lifts with a root-caused lagging muscle,
// imbalances out of band, neglected muscles, and wins worth reinforcing.
//
// Deterministic — the math and detection live here. Turning an insight
// into a polished sentence is a separate (presentation / optional-LLM)
// concern; the structured Insight objects are fully renderable as-is.
//
// Design rule from the RPE discussion: never flag a plateau on a single
// noisy signal. A lift is "stalled" only when its e1RM trend is flat AND
// it has enough data points — and the engine cross-checks volume so a
// genuine deload isn't mislabeled a plateau.

import { muscleWeightsFor, type MuscleGroup } from '../data/muscleAttribution.js';
import type { MuscleLedger } from './muscleLedgerService.js';
import type { RatioResult, BalanceResult } from './strengthMetricsService.js';

export type InsightKind = 'stagnation' | 'imbalance' | 'neglect' | 'win';
export type InsightPriority = 'high' | 'medium' | 'low';

export interface Insight {
  id: string;
  kind: InsightKind;
  priority: InsightPriority;
  title: string;       // short headline
  detail: string;      // one-line explanation, plain English
  metric?: string;     // optional numeric callout (e.g. "1.32")
  ctaHint?: string;    // optional suggested action
  /** Optional e1RM history (oldest→newest) for the card's sparkline. Set on
   *  stagnation insights so the UI draws the actual flat/declining trend. */
  spark?: number[];
}

/** A lift's e1RM history, oldest → newest, for stagnation detection. */
export interface LiftSeries {
  canonicalName: string;
  weeklyE1rmKg: number[];
}

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

const PRIORITY_RANK: Record<InsightPriority, number> = { high: 0, medium: 1, low: 2 };

export interface InsightEngineInput {
  ledger: MuscleLedger;
  ratios: RatioResult[];
  balance: BalanceResult[];
  liftSeries: LiftSeries[];
  /** Days since the user last logged any workout — gates "neglect" insights. */
  daysSinceLastWorkout: number | null;
}

/**
 * Generate the ranked insight list. Returns at most `limit` insights,
 * ordered: high priority first, then by how actionable / severe.
 */
export function generateInsights(input: InsightEngineInput, limit = 6): Insight[] {
  const insights: Insight[] = [];

  // ── 1. Stalled lifts + root-cause ──────────────────────────────────────
  // A lift is stalled when its e1RM trend is flat-or-down across ≥4 weeks.
  // Root-cause: among the muscles the lift trains, find the one whose ledger
  // trend is worst / strength score lowest — that's the likely lock.
  for (const series of input.liftSeries) {
    const pts = series.weeklyE1rmKg.filter((v) => v > 0);
    if (pts.length < 4) continue;
    const slope = olsSlope(pts);
    const recentMax = Math.max(...pts);
    // "flat" relative to the lift's own magnitude — <0.3% e1RM gain/week.
    const flatThreshold = recentMax * 0.003;
    if (slope > flatThreshold) continue; // still progressing — not stalled

    const weeks = pts.length;
    const declining = slope < -flatThreshold;

    // Root-cause: walk contributing muscles, pick the worst.
    const weights = muscleWeightsFor(series.canonicalName);
    let lock: { muscle: MuscleGroup; score: number } | null = null;
    for (const muscle of Object.keys(weights) as MuscleGroup[]) {
      const entry = input.ledger.entries[muscle];
      if (!entry) continue;
      // Worst = lowest strength score, with a penalty if also plateaued/declining.
      const trendPenalty = entry.trend === 'declining' ? 25 : entry.trend === 'plateau' ? 12 : 0;
      const effectiveScore = entry.strengthScore - trendPenalty;
      if (!lock || effectiveScore < lock.score) {
        lock = { muscle, score: effectiveScore };
      }
    }

    const lockMuscle = lock?.muscle;
    insights.push({
      id: `stall-${series.canonicalName.toLowerCase().replace(/\s+/g, '-')}`,
      kind: 'stagnation',
      priority: declining ? 'high' : 'medium',
      title: declining
        ? `${series.canonicalName} is sliding backward`
        : `${series.canonicalName} has stalled`,
      detail: lockMuscle
        ? `${weeks} weeks without progress. The likely lock is your ${lockMuscle.toLowerCase()} — it's the weakest link feeding this lift.`
        : `${weeks} weeks without progress — time to change the stimulus (intensity, volume, or variation).`,
      ctaHint: lockMuscle ? `Add direct ${lockMuscle.toLowerCase()} work` : 'Vary intensity or volume',
      // Real e1RM history (last 8 weeks) — the card draws the actual
      // flat/declining shape rather than a synthetic line.
      spark: pts.slice(-8),
    });
  }

  // ── 2. Imbalances — ratios out of band ─────────────────────────────────
  for (const r of input.ratios) {
    if (r.status === 'in-band' || r.status === 'no-data' || r.value == null) continue;
    if (r.severity < 0.08) continue; // ignore trivially-off ratios
    insights.push({
      id: `ratio-${r.id}`,
      kind: 'imbalance',
      priority: r.severity >= 0.25 ? 'high' : 'medium',
      title: `${r.name} is out of balance`,
      detail: r.note,
      metric: String(r.value),
      ctaHint: 'Adjust your accessory split',
    });
  }

  // ── 3. Imbalances — antagonist muscle balance ──────────────────────────
  for (const b of input.balance) {
    if (b.status === 'in-band' || b.status === 'no-data' || b.ratio == null) continue;
    if (b.severity < 0.1) continue;
    insights.push({
      id: `balance-${b.id}`,
      kind: 'imbalance',
      priority: b.severity >= 0.3 ? 'high' : 'low',
      title: `${b.name} mismatch`,
      detail: `These should track together — yours are ${Math.round(b.severity * 100)}% out of the healthy range.`,
      metric: String(b.ratio),
      ctaHint: 'Add volume to the weaker side',
    });
  }

  // ── 4. Neglect — muscles with little/no recent volume ──────────────────
  // Only fire when the user is actually training (skip if they're on a
  // genuine break — no point nagging someone who hasn't logged in 3 weeks).
  if (input.daysSinceLastWorkout != null && input.daysSinceLastWorkout <= 14) {
    for (const entry of Object.values(input.ledger.entries)) {
      if (!entry) continue;
      if (entry.confidence < 0.35) continue; // too little data to claim neglect
      const stale = entry.lastTrainedDaysAgo != null && entry.lastTrainedDaysAgo > 21;
      const lowVolume = entry.weeklyHardSets < 2;
      if (stale || lowVolume) {
        insights.push({
          id: `neglect-${entry.muscle.toLowerCase().replace(/\s+/g, '-')}`,
          kind: 'neglect',
          priority: 'low',
          title: `${entry.muscle} is under-trained`,
          detail: stale
            ? `No direct ${entry.muscle.toLowerCase()} work in ${entry.lastTrainedDaysAgo} days.`
            : `Only ${entry.weeklyHardSets} weekly sets reach your ${entry.muscle.toLowerCase()} — below the growth threshold.`,
          ctaHint: `Add 2-3 ${entry.muscle.toLowerCase()} sets per week`,
        });
      }
    }
  }

  // ── 5. Wins — positive reinforcement ───────────────────────────────────
  // The user explicitly asked for positive reinforcement. Surface the
  // strongest "improving" muscle so the feed isn't all problems.
  const improving = Object.values(input.ledger.entries)
    .filter((e): e is NonNullable<typeof e> => !!e && e.trend === 'improving' && e.confidence >= 0.4)
    .sort((a, b) => b.trendSlopePerWeekKg - a.trendSlopePerWeekKg);
  if (improving[0]) {
    const top = improving[0];
    insights.push({
      id: `win-${top.muscle.toLowerCase().replace(/\s+/g, '-')}`,
      kind: 'win',
      priority: 'low',
      title: `Your ${top.muscle.toLowerCase()} is climbing`,
      detail: `Steady upward trend over the last few weeks — keep the current stimulus, it's working.`,
    });
  }

  // ── Rank: priority, then stagnation/imbalance ahead of neglect/win ─────
  const kindRank: Record<InsightKind, number> = { stagnation: 0, imbalance: 1, neglect: 2, win: 3 };
  insights.sort((a, b) =>
    PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] ||
    kindRank[a.kind] - kindRank[b.kind],
  );

  return insights.slice(0, limit);
}
