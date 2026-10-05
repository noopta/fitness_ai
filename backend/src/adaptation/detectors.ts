// Log-trend detectors. Pure — no DB, no LLM, no program.
//
// Each detector reads one lift's exposures (newest first, as buildExposures
// returns them) and says what the logs show: getting easier, holding steady,
// stalled, sliding, coming back from time off, or starting to fatigue. The
// rules in rules/logTrend.ts turn a signal into a proposal; this file only
// describes.
//
// Ground rules (the same ones the insight engine follows):
//   - Never fire from a single session. Every signal needs ≥2 exposures and
//     the trend ones need weeks, not days.
//   - A gap of ≥14 days resets the trend window. Lower numbers after time off
//     are detraining — never "plateau" or "decline".
//   - RPE makes a signal sharper. Without it we fall back to reps-at-load and
//     report a lower confidence.

import { canonicalizeSync } from '../services/exerciseCanonical.js';
import { isoWeekKey } from '../services/muscleLedgerService.js';
import { weeklyBestSeries } from './history.js';
import { classifyTrend } from './rules/retrofit.js';
import type { Exposure } from './types.js';

export type LiftSignalKind =
  | 'easier' | 'steady' | 'progressing' | 'plateau' | 'decline'
  | 'detraining' | 'early_fatigue' | 'insufficient';

export interface LiftSignal {
  key: string;
  name: string;
  kind: LiftSignalKind;
  /** 0..1. Lower when RPE wasn't logged. */
  confidence: number;
  /** Signal leaned on logged RPE (vs reps-at-load only). */
  rpeBased: boolean;
  /** Newest exposure's working numbers (canonical kg). */
  lastLoadKg: number | null;
  lastReps: number;
  lastSets: number;
  lastRpe: number | null;
  lastE1rmKg: number;
  lastDate: string | null;
  /** Load the lifter was using before a ≥14-day gap (detraining). */
  refLoadKg: number | null;
  refE1rmKg: number | null;
  gapDays: number | null;
  postGapSessions: number | null;
  /** Change in top-set RPE / min reps across the same-load chain. */
  rpeDelta: number | null;
  repsDelta: number | null;
  /** Same-load chain length (exposures at the newest load, consecutive). */
  chainLength: number;
  /** Days spanned by the evidence window. */
  spanDays: number;
  /** Weekly-best e1RM fit, %/week. */
  pctPerWeek: number;
  /** Relative drop from the recent peak, 0..1 (decline). */
  dropPct: number | null;
  /** Rep drop-off from first to last working set, newest exposure, 0..1. */
  dropOff: number | null;
  /** Hard sets of this lift per week over the last 4 weeks. */
  weeklySets: number;
  /** Sessions of this lift per week over the last 4 weeks. */
  sessionsPerWeek: number;
  /** Mean logged top-set RPE over the last 4 weeks, null if none logged. */
  avgTopRpe: number | null;
  /** Weekly best e1RM (oldest → newest) over the evidence window. */
  spark: number[];
  /** Exposures the signal was read from, newest first. */
  window: Exposure[];
}

export const GAP_DAYS = 14;
const SAME_LOAD_KG = 0.26;
const MIN_EASIER_SPAN_DAYS = 12;   // "≥3 exposures over ≥2 weeks" — 12 days covers Mon→Fri-of-next-week
const PLATEAU_MIN_WEEKS = 4;
const DECLINE_DROP = 0.03;         // newest week ≥3% under the recent peak

/** Whole days from `earlier` to `later` (YYYY-MM-DD): positive when `later`
 *  is after `earlier`. The one day-difference helper for log dates — named
 *  for its argument order so call sites can't read it backwards. */
export function daysFrom(earlier: string, later: string): number {
  return Math.round((Date.parse(`${later}T00:00:00Z`) - Date.parse(`${earlier}T00:00:00Z`)) / 86_400_000);
}

/** UTC date of `d`. Only a fallback anchor for pure callers/tests — log
 *  dates are the user's LOCAL date, so loaders pass a user-local `today`
 *  (services/localDate.ts todayForTz) to every function that takes one. */
export function dateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0;
}

function loadedSets(e: Exposure) {
  return e.sets.filter(s => s.weightKg != null);
}

/** Rep drop-off across working sets at the top load: (first − last) / first. */
export function repDropOff(e: Exposure): number | null {
  if (!e.top) return null;
  const atTop = e.sets.filter(s => s.weightKg != null && Math.abs(s.weightKg - e.top!.weightKg!) < SAME_LOAD_KG);
  if (atTop.length < 3 || atTop[0].reps <= 0) return null;
  return Math.max(0, (atTop[0].reps - atTop[atTop.length - 1].reps) / atTop[0].reps);
}

function emptySignal(key: string, name: string, list: Exposure[]): LiftSignal {
  const last = list[0];
  return {
    key, name, kind: 'insufficient', confidence: 0, rpeBased: false,
    lastLoadKg: last?.top?.weightKg ?? null,
    lastReps: last ? (last.top?.reps ?? Math.max(...last.sets.map(s => s.reps))) : 0,
    lastSets: last ? (loadedSets(last).length || last.sets.length) : 0,
    lastRpe: last?.top?.rpe ?? null,
    lastE1rmKg: last?.e1rmKg ?? 0,
    lastDate: last?.date ?? null,
    refLoadKg: null, refE1rmKg: null, gapDays: null, postGapSessions: null,
    rpeDelta: null, repsDelta: null, chainLength: 0, spanDays: 0, pctPerWeek: 0,
    dropPct: null, dropOff: last ? repDropOff(last) : null,
    weeklySets: 0, sessionsPerWeek: 0, avgTopRpe: null, spark: [], window: list,
  };
}

/**
 * What one lift's logs say. `exposures` newest first; `today` (the user's
 * local date; defaults to `now`'s UTC date) anchors the 4-week volume /
 * frequency window.
 */
export function detectLiftSignal(exposures: Exposure[], now: Date, today = dateStr(now)): LiftSignal {
  const key = exposures[0]?.key ?? '';
  const name = exposures[0]?.displayName ?? key;
  const loaded = exposures.filter(e => e.top && e.e1rmKg > 0);
  const sig = emptySignal(key, name, loaded.length ? loaded : exposures);
  if (loaded.length < 2) return sig;

  // 4-week volume / frequency / effort (all loaded exposures, gap or not).
  const last28 = loaded.filter(e => daysFrom(e.date, today) <= 28);
  const weeksCovered = last28.length
    ? Math.min(4, Math.max(1, Math.ceil((daysFrom(last28[last28.length - 1].date, today) + 1) / 7)))
    : 4;
  sig.weeklySets = Math.round((last28.reduce((s, e) => s + loadedSets(e).length, 0) / weeksCovered) * 10) / 10;
  sig.sessionsPerWeek = Math.round((last28.length / weeksCovered) * 10) / 10;
  const rpes = last28.map(e => e.top!.rpe).filter((r): r is number => r != null);
  sig.avgTopRpe = rpes.length ? Math.round(mean(rpes) * 10) / 10 : null;

  // ── Time off: the newest ≥14-day gap splits the history ─────────────────
  let gapIdx = -1;
  for (let i = 0; i < loaded.length - 1; i++) {
    if (daysFrom(loaded[i + 1].date, loaded[i].date) >= GAP_DAYS) { gapIdx = i; break; }
  }
  if (gapIdx >= 0) {
    const post = loaded.slice(0, gapIdx + 1);
    const pre = loaded.slice(gapIdx + 1);
    sig.gapDays = daysFrom(loaded[gapIdx + 1].date, loaded[gapIdx].date);
    sig.postGapSessions = post.length;
    if (post.length <= 2) {
      const refE1 = Math.max(...pre.slice(0, 3).map(e => e.e1rmKg));
      sig.refE1rmKg = refE1;
      sig.refLoadKg = pre[0].top!.weightKg;
      sig.window = loaded.slice(0, gapIdx + 2);
      if (post[0].e1rmKg < refE1 * 0.97) {
        sig.kind = 'detraining';
        sig.confidence = 0.75;
        sig.rpeBased = post[0].rpeLogged;
      }
      // Back at (or above) the old numbers: nothing to say yet — and above
      // all, not a plateau or a decline.
      return sig;
    }
    return classifyWindow(sig, post, today);
  }
  return classifyWindow(sig, loaded, today);
}

/** Trend + same-load analysis over a gap-free window (newest first). */
function classifyWindow(sig: LiftSignal, win: Exposure[], today: string): LiftSignal {
  // Trend detection looks at the last 8 weeks only.
  const newest = win[0].date;
  const recent = win.filter(e => daysFrom(e.date, newest) <= 56);
  sig.window = recent;
  sig.spanDays = daysFrom(recent[recent.length - 1].date, newest);
  const spark = weeklyBestSeries(recent, isoWeekKey).map(v => Math.round(v * 10) / 10);
  sig.spark = spark;
  const { trend, pctPerWeek } = classifyTrend(spark.slice(-6));
  sig.pctPerWeek = pctPerWeek;

  // Same-load chain: consecutive exposures at the newest top load.
  const load = recent[0].top!.weightKg!;
  const chain: Exposure[] = [];
  for (const e of recent) {
    if (Math.abs(e.top!.weightKg! - load) < SAME_LOAD_KG) chain.push(e); else break;
  }
  sig.chainLength = chain.length;
  const oldest = chain[chain.length - 1];
  const chainSpan = daysFrom(oldest.date, chain[0].date);
  const rpeDelta = chain[0].top!.rpe != null && oldest.top!.rpe != null && chain.length >= 2
    ? Math.round((chain[0].top!.rpe - oldest.top!.rpe) * 10) / 10 : null;
  const repsDelta = chain.length >= 2 ? chain[0].minReps - oldest.minReps : null;
  sig.rpeDelta = rpeDelta;
  sig.repsDelta = repsDelta;

  // ── Early fatigue (RPE creep): same load, same-or-fewer reps, RPE up ≥1.
  //    Checked before decline — the RPE-aware e1RM dips when RPE rises, but
  //    an unchanged load is fatigue, not lost strength. ─
  if (chain.length >= 3 && chainSpan >= MIN_EASIER_SPAN_DAYS && rpeDelta != null && rpeDelta >= 1 && (repsDelta ?? 0) <= 0) {
    sig.kind = 'early_fatigue';
    sig.rpeBased = true;
    sig.confidence = 0.75;
    return sig;
  }

  // ── Decline: weekly best falling over 2–3 weeks, ≥3% under the peak ─────
  const last4 = spark.slice(-4);
  if (last4.length >= 3 && recent.filter(e => daysFrom(e.date, newest) <= 28).length >= 3) {
    const n = last4.length;
    const peak = Math.max(...last4.slice(0, n - 2));
    if (last4[n - 2] < peak * 0.99 && last4[n - 1] < peak * (1 - DECLINE_DROP)) {
      sig.kind = 'decline';
      sig.dropPct = Math.round(((peak - last4[n - 1]) / peak) * 1000) / 1000;
      sig.rpeBased = recent.slice(0, 3).every(e => e.rpeLogged);
      sig.confidence = sig.rpeBased ? 0.8 : 0.65;
      return sig;
    }
  }

  // ── Early fatigue (drop-off): sets falling apart more than they used to ──
  const drops = recent.slice(0, 5).map(repDropOff);
  if (drops.length >= 3 && drops[0] != null && drops[1] != null) {
    const earlier = drops.slice(2).filter((d): d is number => d != null);
    const latestTwo = (drops[0] + drops[1]) / 2;
    if (earlier.length >= 1 && drops[0] >= 0.25 && latestTwo >= mean(earlier) + 0.15) {
      sig.kind = 'early_fatigue';
      sig.dropOff = drops[0];
      sig.rpeBased = false;
      sig.confidence = 0.6;
      return sig;
    }
  }

  // ── Getting easier: same load × reps at a falling RPE, or more reps at the
  //    same load. ≥3 exposures over ≥2 weeks. ─────────────────────────────
  if (chain.length >= 3 && chainSpan >= MIN_EASIER_SPAN_DAYS) {
    if (rpeDelta != null && rpeDelta <= -1 && (repsDelta ?? 0) >= 0) {
      sig.kind = 'easier'; sig.rpeBased = true; sig.confidence = 0.85;
      return sig;
    }
    if ((repsDelta ?? 0) >= 1 && (rpeDelta == null || rpeDelta <= 0)) {
      sig.kind = 'easier'; sig.rpeBased = rpeDelta != null; sig.confidence = rpeDelta != null ? 0.75 : 0.6;
      return sig;
    }
  }

  // ── Plateau: weekly best flat ≥4 weeks with regular exposure ────────────
  if (spark.length >= PLATEAU_MIN_WEEKS && trend === 'plateau') {
    const lastSix = recent.filter(e => daysFrom(e.date, today) <= 42);
    const weeksWithExposure = new Set(lastSix.map(e => isoWeekKey(e.date))).size;
    const s = spark.slice(-6);
    const noNewBest = Math.max(...s.slice(-2)) <= Math.max(...s.slice(0, -2)) * 1.01;
    if (weeksWithExposure >= PLATEAU_MIN_WEEKS && sig.spanDays >= 21 && noNewBest) {
      sig.kind = 'plateau';
      sig.rpeBased = lastSix.filter(e => e.rpeLogged).length >= lastSix.length / 2;
      sig.confidence = sig.rpeBased ? 0.8 : 0.65;
      return sig;
    }
  }

  // ── Steady: load × reps held at RPE 7–8 ────────────────────────────────
  if (chain.length >= 2 && repsDelta === 0) {
    const chainRpes = chain.map(e => e.top!.rpe).filter((r): r is number => r != null);
    if (chainRpes.length === chain.length) {
      if (chainRpes.every(r => r >= 7 && r <= 8.5)) {
        sig.kind = 'steady'; sig.rpeBased = true; sig.confidence = chain.length >= 3 ? 0.8 : 0.65;
        return sig;
      }
    } else if (chainRpes.length === 0) {
      sig.kind = 'steady'; sig.rpeBased = false; sig.confidence = chain.length >= 3 ? 0.55 : 0.45;
      return sig;
    }
  }

  if (trend === 'progressing') {
    sig.kind = 'progressing';
    sig.confidence = 0.7;
    return sig;
  }
  return sig;
}

// ─── Cross-lift detectors ────────────────────────────────────────────────────

export interface WellnessPoint { date: string; sleepHours: number; stress: number; energy?: number }

export interface SystemicFatigue {
  lifts: LiftSignal[];
  /** Plain-English wellness corroboration ("sleep averaging 5.9 h"). */
  wellnessFlags: string[];
  confidence: number;
}

/** Wellness flags over the last 14 days: poor sleep (<6.5 h) / high stress (≥7 of 10). */
export function wellnessFlags(wellness: WellnessPoint[], now: Date, today = dateStr(now)): string[] {
  const recent = wellness.filter(w => daysFrom(w.date, today) <= 14 && daysFrom(w.date, today) >= 0);
  if (recent.length < 3) return [];
  const flags: string[] = [];
  const sleep = recent.map(w => w.sleepHours).filter(h => h > 0);
  if (sleep.length >= 3 && mean(sleep) < 6.5) flags.push(`sleep averaging ${mean(sleep).toFixed(1)} h`);
  const stress = recent.map(w => w.stress).filter(s => s > 0);
  if (stress.length >= 3 && mean(stress) >= 7) flags.push(`stress check-ins averaging ${mean(stress).toFixed(1)}/10`);
  return flags;
}

/**
 * Several lifts sliding (or RPE creeping) at once points at recovery, not at
 * any one lift: ≥3 lifts, or ≥2 lifts plus poor sleep / high stress.
 */
export function detectSystemicFatigue(signals: LiftSignal[], wellness: WellnessPoint[], now: Date, today = dateStr(now)): SystemicFatigue | null {
  const lifts = signals.filter(s =>
    (s.kind === 'decline' || s.kind === 'early_fatigue') && s.lastDate != null && daysFrom(s.lastDate, today) <= 14);
  const flags = wellnessFlags(wellness, now, today);
  if (lifts.length >= 3 || (lifts.length >= 2 && flags.length >= 1)) {
    const confidence = Math.min(0.9, 0.55 + 0.1 * lifts.length + 0.1 * flags.length);
    return { lifts, wellnessFlags: flags, confidence: Math.round(confidence * 100) / 100 };
  }
  return null;
}

// ─── Volume / balance per muscle ─────────────────────────────────────────────

export const VOLUME_LOW = 10;
export const VOLUME_HIGH = 20;
const MAJOR_MUSCLES = new Set(['chest', 'back', 'quads', 'hamstrings', 'shoulders', 'glutes']);
const PUSH = new Set(['chest', 'shoulders', 'triceps']);
const PULL = new Set(['back', 'biceps']);

export interface VolumeFinding {
  muscle: string;
  currentSets: number;
  suggestedSets: number;
  direction: 'add' | 'reduce' | 'rebalance';
  /** Bigger = further outside the band. */
  severity: number;
  note: string;
}

export interface MuscleVolume { muscle: string; weeklySets: number }

/** Primary muscle for a logged name via the seed dictionary; null if unknown. */
export function primaryMuscleOf(name: string): string | null {
  return canonicalizeSync(name)?.primaryMuscle ?? null;
}

/**
 * Weekly hard sets per primary muscle over the last 3 weeks. A set counts as
 * hard unless its RPE was logged below 6. Each set credits the lift's primary
 * muscle in full (the way volume landmarks are usually counted), not the
 * fractional split the radar uses. Returns [] with under 2 weeks of history.
 */
export function weeklySetsByMuscle(exposuresByKey: Map<string, Exposure[]>, now: Date, muscleOf = primaryMuscleOf, today = dateStr(now)): MuscleVolume[] {
  let oldest: string | null = null;
  const sets = new Map<string, number>();
  for (const list of exposuresByKey.values()) {
    for (const e of list) {
      const age = daysFrom(e.date, today);
      if (age < 0 || age > 21) continue;
      if (!oldest || e.date < oldest) oldest = e.date;
      const m = muscleOf(e.displayName);
      if (!m) continue;
      const hard = e.sets.filter(s => s.rpe == null || s.rpe >= 6).length;
      sets.set(m, (sets.get(m) ?? 0) + hard);
    }
  }
  if (!oldest) return [];
  const span = daysFrom(oldest, today) + 1;
  if (span < 14) return [];
  const weeks = Math.min(3, span / 7);
  return [...sets.entries()].map(([muscle, n]) => ({ muscle, weeklySets: Math.round((n / weeks) * 10) / 10 }));
}

/** Out-of-band muscles and push/pull skew, most severe first. */
export function detectVolumeBalance(volumes: MuscleVolume[]): VolumeFinding[] {
  const out: VolumeFinding[] = [];
  for (const v of volumes) {
    // Only muscles trained on purpose (≥3 sets/wk) — incidental work isn't a target.
    if (v.weeklySets < 3) continue;
    if (v.weeklySets < VOLUME_LOW && MAJOR_MUSCLES.has(v.muscle)) {
      out.push({
        muscle: v.muscle, currentSets: v.weeklySets, suggestedSets: VOLUME_LOW, direction: 'add',
        severity: (VOLUME_LOW - v.weeklySets) / VOLUME_LOW,
        note: `${v.muscle} is getting ${v.weeklySets} hard sets a week — under the ~10–20 that most growth happens in.`,
      });
    } else if (v.weeklySets > VOLUME_HIGH) {
      out.push({
        muscle: v.muscle, currentSets: v.weeklySets, suggestedSets: 16, direction: 'reduce',
        severity: (v.weeklySets - VOLUME_HIGH) / VOLUME_HIGH,
        note: `${v.muscle} is getting ${v.weeklySets} hard sets a week — past ~20, extra sets add fatigue faster than growth.`,
      });
    }
  }
  const push = volumes.filter(v => PUSH.has(v.muscle)).reduce((s, v) => s + v.weeklySets, 0);
  const pull = volumes.filter(v => PULL.has(v.muscle)).reduce((s, v) => s + v.weeklySets, 0);
  const r1 = Math.round(push * 10) / 10, r2 = Math.round(pull * 10) / 10;
  if (push >= 10 && push >= pull * 1.5) {
    out.push({
      muscle: 'back', currentSets: r2, suggestedSets: Math.round(push / 1.2), direction: 'rebalance',
      severity: push / Math.max(1, pull) - 1,
      note: `Pushing ${r1} sets a week vs pulling ${r2} — a skew that tends to round the shoulders forward over time.`,
    });
  } else if (pull >= 10 && pull >= push * 1.5) {
    out.push({
      muscle: 'chest', currentSets: r1, suggestedSets: Math.round(pull / 1.2), direction: 'rebalance',
      severity: pull / Math.max(1, push) - 1,
      note: `Pulling ${r2} sets a week vs pushing ${r1} — pressing is lagging behind.`,
    });
  }
  return out.sort((a, b) => b.severity - a.severity);
}
