// Training-phase inference (Freestyle release, contract 6).
//
// "What is this lifter actually doing right now?" — building strength,
// cutting, cutting too hard, building muscle, recomping, stuck, or getting
// back into it. Read from what the logs show, not from what the profile says:
//
//   strength   weekly-best e1RM trend across the main lifts
//   bodyweight %/week from BodyWeightLog (canonical kg) — the scale beats
//              self-reported calories, so it carries the most weight
//   intake     daily kcal from MealEntry (NutritionLog as fallback)
//   maintenance adaptive: avg intake − (Δweight_kg × 7700) / days over ≥14
//              days with enough logged days; else Mifflin-St Jeor via the
//              nutrition engine ("formula")
//   rep mix    share of working sets ≤6 reps (strength) vs ≥8 (hypertrophy)
//   frequency  sessions/week and gaps
//   stated goal coachGoal / coachProfile.primaryGoal — only used to flag a
//              mismatch, never to override the evidence
//
// classifyPhase is pure (unit-tested with synthetic inputs); inferPhase
// loads the rows. The confirmed phase lives in coachProfile.trainingPhase and
// always wins; otherwise the inference only becomes `effective` at ≥0.6
// confidence. Missing bodyweight or intake lowers confidence rather than
// guessing.

import { PrismaClient } from '@prisma/client';
import { runNutritionEngine } from '../engine/nutritionEngine.js';
import { buildExposures, makeKeyFn, weeklyBestSeries } from '../adaptation/history.js';
import { classifyTrend } from '../adaptation/rules/retrofit.js';
import { daysFrom, dateStr } from '../adaptation/detectors.js';
import { isoWeekKey } from './muscleLedgerService.js';
import { bodyWeightKg, formatWeight, normalizePreference, type UnitPreference } from './weightUnits.js';
import { cacheDelete, cacheGet, cacheSet } from './cacheService.js';
import { todayForTz } from './localDate.js';
import { TRAINING_PHASES, type ConfirmedPhase, type Exposure, type PhaseResult, type TrainingPhase } from '../adaptation/types.js';

export type { PhaseResult, TrainingPhase, ConfirmedPhase };

const prisma = new PrismaClient();

export const KCAL_PER_KG = 7700;
export const EFFECTIVE_CONFIDENCE = 0.6;
/** A logged day under this is treated as partial logging and left out of intake averages. */
const MIN_DAY_KCAL = 800;

// ─── Inputs ──────────────────────────────────────────────────────────────────

export type StatedGoal = 'cut' | 'bulk' | 'strength' | 'recomp' | null;

export interface PhaseInput {
  now: Date;
  unitPref: UnitPreference;
  strength: { pctPerWeek: number | null; lifts: number; trend: 'progressing' | 'flat' | 'declining' | 'insufficient'; weeks: number; since: string | null };
  bodyweight: { pctPerWeek: number | null; points: number; spanDays: number; startKg: number | null; endKg: number | null; since: string | null };
  intake: { avgKcal: number | null; loggedDays: number };
  maintenance: { kcal: number | null; source: 'adaptive' | 'formula' | null };
  repMix: { lowShare: number; highShare: number; sets: number };
  frequency: { sessionsPerWeek: number; prevSessionsPerWeek: number; daysSinceLast: number | null; returnedOn: string | null; gapDays: number | null };
  statedGoal: StatedGoal;
  confirmed: ConfirmedPhase | null;
}

/** Extra numbers the phase rules need that aren't part of the public contract. */
export interface PhaseSignals {
  bwPctPerWeek: number | null;
  avgIntakeKcal: number | null;
  loggedDays: number;
}

// ─── Pure helpers ────────────────────────────────────────────────────────────

function olsSlope(xs: number[], ys: number[]): number {
  const n = xs.length;
  if (n < 2) return 0;
  const mx = xs.reduce((s, x) => s + x, 0) / n;
  const my = ys.reduce((s, y) => s + y, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) { num += (xs[i] - mx) * (ys[i] - my); den += (xs[i] - mx) ** 2; }
  return den === 0 ? 0 : num / den;
}

export interface BwPoint { date: string; kg: number }

/** Bodyweight trend over the last `windowDays`: least-squares slope as %/week. */
export function summarizeBodyweight(points: BwPoint[], now: Date, windowDays = 35, today = dateStr(now)): PhaseInput['bodyweight'] {
  const pts = points
    .filter(p => p.kg > 0 && daysFrom(p.date, today) >= 0 && daysFrom(p.date, today) <= windowDays)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (pts.length < 3) return { pctPerWeek: null, points: pts.length, spanDays: 0, startKg: pts[0]?.kg ?? null, endKg: pts[pts.length - 1]?.kg ?? null, since: null };
  const spanDays = daysFrom(pts[0].date, pts[pts.length - 1].date);
  if (spanDays < 10) return { pctPerWeek: null, points: pts.length, spanDays, startKg: pts[0].kg, endKg: pts[pts.length - 1].kg, since: null };
  const xs = pts.map(p => daysFrom(pts[0].date, p.date));
  const ys = pts.map(p => p.kg);
  const slopePerDay = olsSlope(xs, ys);
  const meanKg = ys.reduce((s, y) => s + y, 0) / ys.length;
  const pct = (slopePerDay * 7 / meanKg) * 100;
  return {
    pctPerWeek: Math.round(pct * 100) / 100, points: pts.length, spanDays,
    startKg: Math.round((ys[0]) * 10) / 10, endKg: Math.round(ys[ys.length - 1] * 10) / 10, since: pts[0].date,
  };
}

export interface IntakeDay { date: string; kcal: number }

export function summarizeIntake(days: IntakeDay[], now: Date, windowDays = 28, today = dateStr(now)): PhaseInput['intake'] {
  const full = days.filter(d => d.kcal >= MIN_DAY_KCAL && daysFrom(d.date, today) >= 0 && daysFrom(d.date, today) <= windowDays);
  if (full.length === 0) return { avgKcal: null, loggedDays: 0 };
  return { avgKcal: Math.round(full.reduce((s, d) => s + d.kcal, 0) / full.length), loggedDays: full.length };
}

/**
 * Adaptive maintenance: what intake would have held weight flat. Needs ≥14
 * days spanned, ≥10 fully-logged days and ≥3 weigh-ins; null otherwise.
 */
export function adaptiveMaintenance(days: IntakeDay[], points: BwPoint[], now: Date, windowDays = 28, today = dateStr(now)): number | null {
  const within = (d: string) => daysFrom(d, today) >= 0 && daysFrom(d, today) <= windowDays;
  const intake = days.filter(d => d.kcal >= MIN_DAY_KCAL && within(d.date));
  const pts = points.filter(p => p.kg > 0 && within(p.date)).sort((a, b) => a.date.localeCompare(b.date));
  if (intake.length < 10 || pts.length < 3) return null;
  const span = daysFrom(pts[0].date, pts[pts.length - 1].date);
  if (span < 14) return null;
  const avg = intake.reduce((s, d) => s + d.kcal, 0) / intake.length;
  const slopeKgPerDay = olsSlope(pts.map(p => daysFrom(pts[0].date, p.date)), pts.map(p => p.kg));
  const m = avg - slopeKgPerDay * KCAL_PER_KG;
  return m > 1000 && m < 6000 ? Math.round(m / 10) * 10 : null;
}

/** Median weekly e1RM trend across the main lifts (≥4 exposures in 8 weeks, top 5 by count). */
export function summarizeStrength(exposuresByKey: Map<string, Exposure[]>, now: Date, today = dateStr(now)): PhaseInput['strength'] {
  const candidates: Array<{ count: number; pct: number; since: string; weeks: number }> = [];
  for (const list of exposuresByKey.values()) {
    const recent = list.filter(e => e.e1rmKg > 0 && daysFrom(e.date, today) <= 56 && daysFrom(e.date, today) >= 0);
    if (recent.length < 4) continue;
    const series = weeklyBestSeries(recent, isoWeekKey);
    const t = classifyTrend(series);
    if (t.trend === 'insufficient') continue;
    candidates.push({ count: recent.length, pct: t.pctPerWeek, since: recent[recent.length - 1].date, weeks: series.length });
  }
  candidates.sort((a, b) => b.count - a.count);
  const top = candidates.slice(0, 5);
  if (top.length === 0) return { pctPerWeek: null, lifts: 0, trend: 'insufficient', weeks: 0, since: null };
  const pcts = top.map(c => c.pct).sort((a, b) => a - b);
  const median = pcts.length % 2 ? pcts[(pcts.length - 1) / 2] : (pcts[pcts.length / 2 - 1] + pcts[pcts.length / 2]) / 2;
  const trend = median >= 0.5 ? 'progressing' : median <= -0.3 ? 'declining' : 'flat';
  return {
    pctPerWeek: Math.round(median * 10) / 10, lifts: top.length, trend,
    weeks: Math.max(...top.map(c => c.weeks)), since: top.map(c => c.since).sort()[0] ?? null,
  };
}

/** Share of loaded working sets in the last 4 weeks at ≤6 reps / ≥8 reps. */
export function summarizeRepMix(exposuresByKey: Map<string, Exposure[]>, now: Date, today = dateStr(now)): PhaseInput['repMix'] {
  let low = 0, high = 0, total = 0;
  for (const list of exposuresByKey.values())
    for (const e of list) {
      if (daysFrom(e.date, today) > 28 || daysFrom(e.date, today) < 0) continue;
      for (const s of e.sets) {
        if (s.weightKg == null) continue;
        total++;
        if (s.reps <= 6) low++;
        else if (s.reps >= 8) high++;
      }
    }
  return total ? { lowShare: Math.round((low / total) * 100) / 100, highShare: Math.round((high / total) * 100) / 100, sets: total } : { lowShare: 0, highShare: 0, sets: 0 };
}

/** Sessions/week (last 4 vs prior 4 weeks), days since the last session, and a recent return from ≥14 days off. */
export function summarizeFrequency(workoutDates: string[], now: Date, today = dateStr(now)): PhaseInput['frequency'] {
  const dates = [...new Set(workoutDates)].filter(d => daysFrom(d, today) >= 0).sort().reverse();
  const inRange = (lo: number, hi: number) => dates.filter(d => { const a = daysFrom(d, today); return a >= lo && a < hi; }).length;
  let returnedOn: string | null = null, gapDays: number | null = null;
  for (let i = 0; i < dates.length - 1; i++) {
    if (daysFrom(dates[i], today) > 21) break;
    const g = daysFrom(dates[i + 1], dates[i]);
    if (g >= 14) { returnedOn = dates[i]; gapDays = g; }
  }
  return {
    sessionsPerWeek: Math.round((inRange(0, 28) / 4) * 10) / 10,
    prevSessionsPerWeek: Math.round((inRange(28, 56) / 4) * 10) / 10,
    daysSinceLast: dates.length ? daysFrom(dates[0], today) : null,
    returnedOn, gapDays,
  };
}

export function statedGoalOf(coachGoal: string | null | undefined, profile: any): StatedGoal {
  const s = `${coachGoal ?? ''} ${profile?.primaryGoal ?? ''} ${profile?.bodyCompositionGoal ?? ''}`.toLowerCase();
  if (/recomp/.test(s)) return 'recomp';
  if (/\b(cut|cutting|lose|losing|fat loss|lean(er)? out|shred|weight loss|deficit)\b/.test(s)) return 'cut';
  if (/\b(bulk|bulking|gain|mass|muscle|hypertrophy|size|surplus)\b/.test(s)) return 'bulk';
  if (/\b(strength|stronger|powerlifting|strong)\b/.test(s)) return 'strength';
  return null;
}

export function parseConfirmedPhase(profile: any): ConfirmedPhase | null {
  const t = profile?.trainingPhase;
  if (!t || typeof t !== 'object') return null;
  if (!TRAINING_PHASES.includes(t.phase)) return null;
  const source = t.source === 'user_set' ? 'user_set' : 'confirmed';
  return { phase: t.phase, confirmedAt: String(t.confirmedAt ?? ''), source };
}

// ─── Classification ──────────────────────────────────────────────────────────

const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n)}`;

/** Pure: evidence → phase, confidence and the lines that explain it. */
export function classifyPhase(input: PhaseInput): PhaseResult & { signals: PhaseSignals } {
  const { strength, bodyweight: bw, intake, maintenance, repMix, frequency: freq, statedGoal, unitPref } = input;
  const fmt = (kg: number | null) => formatWeight(kg, unitPref, 1) ?? '—';
  const evidence: Array<{ label: string; value: string }> = [];
  const bwKnown = bw.pctPerWeek != null;
  const intakeKnown = intake.avgKcal != null && intake.loggedDays >= 10;
  const p = bw.pctPerWeek ?? 0;

  if (bwKnown) evidence.push({ label: 'Bodyweight', value: `${signed(p)}%/wk over ${Math.max(1, Math.round(bw.spanDays / 7))} wks (${fmt(bw.startKg)} → ${fmt(bw.endKg)})` });
  if (intake.avgKcal != null) evidence.push({ label: 'Avg intake', value: `${intake.avgKcal.toLocaleString('en-US')} kcal/day (${intake.loggedDays} days logged)` });
  if (maintenance.kcal != null) evidence.push({ label: 'Maintenance', value: `~${maintenance.kcal.toLocaleString('en-US')} kcal (${maintenance.source === 'adaptive' ? 'from your intake + weight trend' : 'estimated from your stats'})` });
  if (strength.pctPerWeek != null) evidence.push({ label: 'Strength', value: `${signed(strength.pctPerWeek)}%/wk across ${strength.lifts} main lift${strength.lifts === 1 ? '' : 's'}` });
  if (repMix.sets >= 10) evidence.push({ label: 'Rep mix', value: `${Math.round(repMix.lowShare * 100)}% of sets at 6 reps or fewer` });
  evidence.push({ label: 'Sessions', value: `${freq.sessionsPerWeek}/wk (last 4 wks)` });

  let inferred: TrainingPhase = 'unknown';
  let confidence = 0.5;
  let since: string | null = null;
  let cap = 0.95;

  const comingBack = freq.returnedOn != null || (freq.daysSinceLast != null && freq.daysSinceLast >= 14)
    || (freq.sessionsPerWeek < 1 && freq.prevSessionsPerWeek >= 2);
  if (comingBack) {
    inferred = 'rebuilding_consistency';
    confidence = freq.returnedOn ? 0.75 : 0.65;
    since = freq.returnedOn;
    if (freq.daysSinceLast != null && freq.daysSinceLast >= 14) evidence.push({ label: 'Time off', value: `${freq.daysSinceLast} days since your last session` });
    else if (freq.gapDays) evidence.push({ label: 'Time off', value: `${freq.gapDays}-day break before ${freq.returnedOn}` });
  } else if (strength.lifts === 0 && !bwKnown && !intakeKnown) {
    inferred = 'unknown';
    confidence = 0.2;
  } else {
    const fromStrength = (): TrainingPhase => {
      if (strength.trend === 'progressing') return repMix.lowShare >= 0.4 ? 'building_strength' : (bwKnown ? 'recomp' : 'building_muscle');
      if (strength.trend === 'flat' || strength.trend === 'declining') return strength.weeks >= 4 ? 'plateau' : 'unknown';
      return 'unknown';
    };
    if (bwKnown) {
      since = bw.since;
      if (p <= -1.0 && (strength.trend === 'declining' || p <= -1.25)) inferred = 'cut_too_aggressive';
      else if (p <= -0.25) inferred = 'cutting';
      else if (p >= 0.25) inferred = 'building_muscle';
      else { inferred = fromStrength(); since = strength.since; }
      confidence += 0.15;
      if (bw.points >= 6 && bw.spanDays >= 21) confidence += 0.1;
    } else {
      confidence -= 0.1;
      if (intakeKnown && maintenance.kcal != null) {
        const diff = intake.avgKcal! - maintenance.kcal;
        inferred = diff <= -300 ? 'cutting' : diff >= 250 ? 'building_muscle' : fromStrength();
        cap = 0.6;
      } else {
        inferred = fromStrength();
        cap = 0.5;
      }
      since = strength.since;
    }
    // Intake corroboration.
    if (intakeKnown && maintenance.kcal != null) {
      const diff = intake.avgKcal! - maintenance.kcal;
      confidence += 0.05;
      const cutLike = inferred === 'cutting' || inferred === 'cut_too_aggressive';
      if ((cutLike && diff < -150) || (inferred === 'building_muscle' && diff > 100)) confidence += 0.1;
      else if ((cutLike && diff > 150) || (inferred === 'building_muscle' && diff < -150)) confidence -= 0.1;
    } else {
      confidence -= 0.05;
    }
    // Strength corroboration.
    if (strength.lifts >= 2) {
      confidence += 0.05;
      const agrees =
        ((inferred === 'cutting') && strength.trend !== 'progressing') ||
        (inferred === 'cut_too_aggressive' && strength.trend === 'declining') ||
        ((inferred === 'building_muscle' || inferred === 'building_strength' || inferred === 'recomp') && strength.trend === 'progressing') ||
        (inferred === 'plateau' && strength.trend !== 'progressing');
      if (agrees) confidence += 0.1;
    }
    const goalAgrees =
      (statedGoal === 'cut' && (inferred === 'cutting' || inferred === 'cut_too_aggressive')) ||
      (statedGoal === 'bulk' && inferred === 'building_muscle') ||
      (statedGoal === 'strength' && inferred === 'building_strength') ||
      (statedGoal === 'recomp' && inferred === 'recomp');
    if (goalAgrees) confidence += 0.05;
    if (inferred === 'cut_too_aggressive' && p <= -1.25 && bw.points >= 4) confidence = Math.max(confidence, 0.65);
    if (inferred === 'unknown') confidence = Math.min(confidence, 0.4);
  }
  confidence = Math.round(Math.max(0.05, Math.min(cap, confidence)) * 100) / 100;

  // Stated goal vs evidence.
  let statedGoalMismatch: string | null = null;
  const weeks = Math.max(1, Math.round(bw.spanDays / 7));
  if (statedGoal === 'bulk' && bwKnown && p <= -0.25 && bw.spanDays >= 14) {
    statedGoalMismatch = `You said bulk, but bodyweight has fallen for ${weeks} weeks`;
  } else if (statedGoal === 'cut' && bwKnown && p >= 0.25 && bw.spanDays >= 14) {
    statedGoalMismatch = `You said cut, but bodyweight has risen for ${weeks} weeks`;
  } else if (statedGoal === 'bulk' && intakeKnown && maintenance.kcal != null && intake.avgKcal! < maintenance.kcal - 200) {
    statedGoalMismatch = `You said bulk, but you're eating about ${Math.round((maintenance.kcal - intake.avgKcal!) / 10) * 10} kcal under maintenance`;
  }

  const confirmed = input.confirmed;
  const effective: TrainingPhase = confirmed?.phase ?? (confidence >= EFFECTIVE_CONFIDENCE ? inferred : 'unknown');
  return {
    inferred, confidence, evidence, since, confirmed, effective,
    maintenanceKcal: maintenance.kcal, maintenanceSource: maintenance.source,
    statedGoalMismatch,
    signals: { bwPctPerWeek: bw.pctPerWeek, avgIntakeKcal: intake.avgKcal, loggedDays: intake.loggedDays },
  };
}

// ─── Loader ──────────────────────────────────────────────────────────────────

function ageYears(dob: Date | null | undefined, now: Date): number | null {
  if (!dob) return null;
  const a = (now.getTime() - new Date(dob).getTime()) / (365.25 * 86_400_000);
  return a > 10 && a < 100 ? Math.floor(a) : null;
}

const CACHE_TTL_MS = 30 * 60 * 1000;
export function phaseCacheKey(userId: string): string { return `phase:${userId}`; }

/** Load everything and classify. `exposuresByKey` lets a caller that already built them skip the workout read. */
export async function inferPhaseDetailed(
  userId: string,
  now = new Date(),
  opts: { exposuresByKey?: Map<string, Exposure[]>; workoutDates?: string[]; useCache?: boolean } = {},
): Promise<PhaseResult & { signals: PhaseSignals }> {
  if (opts.useCache) {
    const hit = cacheGet<PhaseResult & { signals: PhaseSignals }>(phaseCacheKey(userId));
    if (hit) return hit;
  }
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { coachProfile: true, coachGoal: true, weightKg: true, heightCm: true, dateOfBirth: true, unitPreference: true, timezone: true },
  });
  // Log / meal / weigh-in dates are the user's local dates.
  const today = todayForTz(user?.timezone, now);
  const since = (days: number) => { const d = new Date(`${today}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - days); return d.toISOString().slice(0, 10); };
  let profile: any = {};
  try { profile = user?.coachProfile ? JSON.parse(user.coachProfile) : {}; } catch { profile = {}; }

  let exposuresByKey = opts.exposuresByKey;
  let workoutDates = opts.workoutDates;
  if (!exposuresByKey || !workoutDates) {
    const workouts = await prisma.workoutLog.findMany({
      where: { userId, date: { gte: since(84), lte: today } },
      orderBy: { date: 'asc' },
      select: { id: true, date: true, exercises: true, programDayRef: true },
    });
    exposuresByKey = exposuresByKey ?? buildExposures(workouts, makeKeyFn());
    workoutDates = workoutDates ?? workouts.map(w => w.date);
  }

  const [bwRows, meals, legacy] = await Promise.all([
    prisma.bodyWeightLog.findMany({ where: { userId, date: { gte: since(42) } }, select: { date: true, weightKg: true, weightLbs: true } }),
    prisma.mealEntry.findMany({ where: { userId, date: { gte: since(28) } }, select: { date: true, calories: true } }),
    prisma.nutritionLog.findMany({ where: { userId, date: { gte: since(28) } }, select: { date: true, calories: true } }),
  ]);
  const bwPoints: BwPoint[] = [];
  for (const r of bwRows) { const kg = bodyWeightKg(r); if (kg != null) bwPoints.push({ date: r.date, kg }); }
  const byDay = new Map<string, number>();
  for (const m of meals) byDay.set(m.date, (byDay.get(m.date) ?? 0) + (m.calories || 0));
  for (const l of legacy) if (!byDay.has(l.date)) byDay.set(l.date, (byDay.get(l.date) ?? 0) + (l.calories || 0));
  const intakeDays: IntakeDay[] = [...byDay.entries()].map(([date, kcal]) => ({ date, kcal }));

  const frequency = summarizeFrequency(workoutDates, now, today);
  let maintenanceKcal = adaptiveMaintenance(intakeDays, bwPoints, now, 28, today);
  let maintenanceSource: 'adaptive' | 'formula' | null = maintenanceKcal != null ? 'adaptive' : null;
  if (maintenanceKcal == null) {
    try {
      const latestBw = [...bwPoints].sort((a, b) => b.date.localeCompare(a.date))[0]?.kg ?? user?.weightKg ?? null;
      const g = String(profile?.gender ?? profile?.sex ?? '').toLowerCase();
      const out = runNutritionEngine({
        user: {
          weightKg: latestBw, heightCm: user?.heightCm ?? null, ageYears: ageYears(user?.dateOfBirth, now),
          sex: g.startsWith('m') ? 'male' : g.startsWith('f') ? 'female' : 'unknown',
          trainingAge: null, bodyCompTag: null, goal: null, primaryLift: null,
          trainingDaysPerWeek: Math.round(frequency.sessionsPerWeek),
        },
        dailyMacros: [], mealTimings: [], wellnessPoints: [],
      });
      if (out.tdee) { maintenanceKcal = out.tdee; maintenanceSource = 'formula'; }
    } catch { /* no formula either */ }
  }

  const result = classifyPhase({
    now,
    unitPref: normalizePreference(user?.unitPreference),
    strength: summarizeStrength(exposuresByKey, now, today),
    bodyweight: summarizeBodyweight(bwPoints, now, 35, today),
    intake: summarizeIntake(intakeDays, now, 28, today),
    maintenance: { kcal: maintenanceKcal, source: maintenanceSource },
    repMix: summarizeRepMix(exposuresByKey, now, today),
    frequency,
    statedGoal: statedGoalOf(user?.coachGoal, profile),
    confirmed: parseConfirmedPhase(profile),
  });
  cacheSet(phaseCacheKey(userId), result, CACHE_TTL_MS);
  return result;
}

/** Contract 6: the public PhaseResult (no internal signals). */
export async function inferPhase(userId: string, now = new Date()): Promise<PhaseResult> {
  const { signals: _signals, ...result } = await inferPhaseDetailed(userId, now);
  return result;
}

/** POST /training/phase: set (`user_set`) or clear ('auto') the confirmed phase. */
export async function setConfirmedPhase(userId: string, phase: TrainingPhase | 'auto', source: 'user_set' | 'confirmed' = 'user_set', now = new Date()): Promise<ConfirmedPhase | null> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { coachProfile: true } });
  let profile: any = {};
  try { profile = user?.coachProfile ? JSON.parse(user.coachProfile) : {}; } catch { profile = {}; }
  const previous = parseConfirmedPhase(profile);
  if (phase === 'auto') delete profile.trainingPhase;
  else profile.trainingPhase = { phase, confirmedAt: now.toISOString(), source };
  await prisma.user.update({ where: { id: userId }, data: { coachProfile: JSON.stringify(profile) } });
  cacheDelete(phaseCacheKey(userId));
  cacheDelete(`userctx:${userId}`);
  return previous;
}

/** Restore a previous confirmed phase exactly (undo of phase_confirm). */
export async function restoreConfirmedPhase(userId: string, previous: ConfirmedPhase | null): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { coachProfile: true } });
  let profile: any = {};
  try { profile = user?.coachProfile ? JSON.parse(user.coachProfile) : {}; } catch { profile = {}; }
  if (previous) profile.trainingPhase = previous; else delete profile.trainingPhase;
  await prisma.user.update({ where: { id: userId }, data: { coachProfile: JSON.stringify(profile) } });
  cacheDelete(phaseCacheKey(userId));
  cacheDelete(`userctx:${userId}`);
}
