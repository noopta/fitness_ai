// Rule: retrofit — bootstrap targets for a user who already has history.
//
// "We looked back at your 42 workouts since March." For every exercise in the
// program: seed a target from their logs, classify the trend, and flag what
// the plan should do next. One proposal covering every lift, applied only when
// the user says "use these" (optionally after editing the numbers).

import { isoWeekKey } from '../../services/muscleLedgerService.js';
import { weeklyBestSeries } from '../history.js';
import { seedTargetFromExposures } from '../targets.js';
import { doubleProgressionRule } from './doubleProgression.js';
import { formatWeight, type UnitPreference } from '../../services/weightUnits.js';
import type { AdaptationContext, ProposalDraft, TargetSeed } from '../types.js';

function olsSlope(ys: number[]): number {
  const n = ys.length;
  if (n < 2) return 0;
  const mx = (n - 1) / 2;
  const my = ys.reduce((s, y) => s + y, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) { num += (i - mx) * (ys[i] - my); den += (i - mx) ** 2; }
  return den === 0 ? 0 : num / den;
}

export type Trend = 'progressing' | 'plateau' | 'declining' | 'insufficient';

/** Relative weekly slope thresholds: +0.5%/wk improving, −0.3%/wk declining. */
export function classifyTrend(series: number[]): { trend: Trend; pctPerWeek: number } {
  if (series.length < 4) return { trend: 'insufficient', pctPerWeek: 0 };
  const recentMax = Math.max(...series.slice(-4));
  if (recentMax <= 0) return { trend: 'insufficient', pctPerWeek: 0 };
  const slope = olsSlope(series);
  const pct = (slope / recentMax) * 100;
  const trend: Trend = pct >= 0.5 ? 'progressing' : pct <= -0.3 ? 'declining' : 'plateau';
  return { trend, pctPerWeek: Math.round(pct * 10) / 10 };
}

function monthLabel(dateStr: string | null): string {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00Z');
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { month: 'long', timeZone: 'UTC' });
}

export function buildRetrofitProposal(ctx: AdaptationContext): ProposalDraft | null {
  if (!ctx.program || ctx.planned.length === 0) return null;
  const pref: UnitPreference = ctx.unitPref;
  const fmt = (kg: number) => formatWeight(kg, pref, pref === 'metric' ? 1 : 0) ?? '';

  const targets: TargetSeed[] = [];
  let matched = 0;
  for (const p of ctx.planned) {
    const exposures = ctx.exposuresByKey.get(p.key) ?? [];
    const loaded = exposures.filter(e => e.top && e.e1rmKg > 0);
    if (loaded.length === 0) {
      targets.push({
        key: p.key, exercise: p.exercise, targetWeightKg: null, targetRPE: p.targetRPE, repRange: p.repRange,
        confidence: 0, basis: 'none', finding: 'calibrate', exposures: 0,
        summary: 'no weights logged → calibrate next session', spark: [],
      });
      continue;
    }
    matched += 1;
    const seed = seedTargetFromExposures(loaded, p.repRange, p.targetRPE, p.exercise, pref)!;
    const spark = weeklyBestSeries(loaded, isoWeekKey);
    const { trend, pctPerWeek } = classifyTrend(spark);
    const bump = doubleProgressionRule({ ...p, targetWeightKg: null }, loaded, pref);
    const weeks = spark.length;
    const last = loaded[0];
    const lastLabel = `${fmt(last.top!.weightKg!)} × ${last.top!.reps}`;

    let finding: TargetSeed['finding'];
    let summary: string;
    if (bump) {
      finding = 'ready_to_bump';
      summary = `${lastLabel} · topped the range ${Math.min(loaded.length, 2)}× → ready to bump`;
    } else if (trend === 'progressing') {
      finding = 'progressing';
      const first = spark[0], now = spark[spark.length - 1];
      summary = `${fmt(first)} → ${fmt(now)} e1RM · +${Math.round(((now - first) / first) * 100)}% over ${weeks} wks`;
    } else if (trend === 'plateau') {
      finding = 'plateau';
      summary = `${lastLabel} · flat ${weeks} wks (${pctPerWeek >= 0 ? '+' : ''}${pctPerWeek}%/wk)`;
    } else if (trend === 'declining') {
      finding = 'declining';
      summary = `${lastLabel} · slipping ${pctPerWeek}%/wk over ${weeks} wks`;
    } else {
      finding = 'insufficient';
      summary = `${lastLabel} · ${loaded.length} session${loaded.length === 1 ? '' : 's'} logged`;
    }
    targets.push({
      key: p.key, exercise: p.exercise, targetWeightKg: seed.targetWeightKg, targetRPE: p.targetRPE, repRange: p.repRange,
      confidence: seed.confidence, basis: seed.basis, finding, exposures: loaded.length, summary, spark,
    });
  }

  if (matched === 0) return null;

  const withRpe = [...ctx.exposuresByKey.values()].flat().filter(e => e.rpeLogged).length;
  const total = [...ctx.exposuresByKey.values()].flat().filter(e => e.e1rmKg > 0).length;
  const avgConf = targets.filter(t => t.basis !== 'none').reduce((s, t) => s + t.confidence, 0) / matched;
  const confidence = Math.round(avgConf * 100) / 100;

  const plateaus = targets.filter(t => t.finding === 'plateau' || t.finding === 'declining').length;
  const bumps = targets.filter(t => t.finding === 'ready_to_bump').length;
  const calibrate = targets.filter(t => t.finding === 'calibrate').length;

  const since = monthLabel(ctx.firstWorkoutDate);
  const evidence = [
    { label: 'Workouts reviewed', value: `${ctx.workoutCount}${since ? ` since ${since}` : ''}` },
    { label: 'Lifts matched to your program', value: `${matched} of ${ctx.planned.length}` },
    { label: 'Sessions with RPE logged', value: `${withRpe} of ${total}` },
  ];
  const parts: string[] = [];
  if (bumps) parts.push(`${bumps} lift${bumps === 1 ? ' is' : 's are'} ready for more weight`);
  if (plateaus) parts.push(`${plateaus} ${plateaus === 1 ? 'has' : 'have'} stalled`);
  if (calibrate) parts.push(`${calibrate} ${calibrate === 1 ? 'has' : 'have'} no weights logged yet`);
  const reasoning = `These targets come from the weights you've actually been lifting — the median of your last few sessions, not your single best day. ${parts.length ? parts.join(', ') + '. ' : ''}Once set, Axiom can tell when you're ahead of plan, behind it, or stuck, and propose the next step. Edit any number you disagree with; you know if a week was a deload.${withRpe < total / 2 ? ' Logging RPE will make future suggestions more precise.' : ''}`;

  return {
    kind: 'retrofit',
    dedupeKey: 'retrofit',
    title: `We looked back at your ${ctx.workoutCount} workout${ctx.workoutCount === 1 ? '' : 's'}${since ? ` since ${since}` : ''}`,
    evidence,
    reasoning,
    proposal: { kind: 'retrofit', targets },
    confidence,
    priority: 100,
  };
}
