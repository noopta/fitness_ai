// Training summary for the agent (contract 7) — the compact "what has this
// lifter actually been doing" block injected into the coach's context, so
// "how am I doing?" and "adjust my training" are answered from the log, not
// from a guess. Before this the agent context carried no workout history.
//
// Sections, each optional: last 14 days of sessions, per-lift trends (the
// adaptation engine's classifyTrend over weekly best e1RM), strength-profile
// highlights (wins / imbalances / neglected / stalled — the cached athlete
// model, never recomputed inline), the effective training phase, and pending
// adaptation proposals. Weights render in the user's unit.
//
// Budget ≤ ~1,200 chars: every token is paid on every turn. Fails soft — any
// error returns null and chat carries on without it.

import { PrismaClient } from '@prisma/client';
import { buildExposures, weeklyBestSeries, type RawWorkout } from '../adaptation/history.js';
import { classifyTrend, type Trend } from '../adaptation/rules/retrofit.js';
import { daysFrom } from '../adaptation/detectors.js';
import type { Exposure, PhaseResult } from '../adaptation/types.js';
import { isoWeekKey } from './muscleLedgerService.js';
import { liftResolver, loadNormRows, type CanonicalMeta } from './liftCanonical.js';
import { formatWeight, normalizePreference, type UnitPreference } from './weightUnits.js';
import { cacheGet, cacheSet } from './cacheService.js';
import { todayForTz } from './localDate.js';
import { freestyleAvailableFor, logAdaptationAvailableFor, phaseInferenceAvailableFor } from './featureFlags.js';

const prisma = new PrismaClient();

export const SUMMARY_MAX_CHARS = 1200;
const SESSION_WINDOW_DAYS = 14;
const TREND_WINDOW_WEEKS = 12;
const MAX_TRENDS = 6;
/** Built once per user per 5 minutes; a logged workout drops it (strength.ts). */
const SUMMARY_CACHE_TTL_MS = 5 * 60 * 1000;
export function trainingSummaryCacheKey(userId: string): string { return `training:summary:${userId}`; }

/** Contract 7 gate: the summary rides on the freestyle / log-adaptation flags. */
export function trainingSummaryEnabledFor(userId: string, email?: string | null): boolean {
  return freestyleAvailableFor(userId, email) || logAdaptationAvailableFor(userId, email);
}

// ─── History ─────────────────────────────────────────────────────────────────

export interface ParsedWorkout { id: string; date: string; title: string | null; exercises: any[] }

export interface TrainingHistory {
  workouts: ParsedWorkout[];                 // ascending by date
  exposures: Map<string, Exposure[]>;        // canonical key → newest first
  displayName: (key: string) => string;      // canonical display name for a key
  meta: (key: string) => CanonicalMeta | null;  // category / muscle / compound, when known
  names: ReturnType<typeof liftResolver>;
}

/** Parse rows + key every exercise through the adaptation engine's key fn. Pure. */
export function historyFromRows(
  rows: Array<{ id: string; date: string; title?: string | null; exercises: string; programDayRef?: string | null }>,
  normRows: Parameters<typeof liftResolver>[0] = [],
): TrainingHistory {
  const names = liftResolver(normRows);
  const workouts: ParsedWorkout[] = [];
  for (const r of rows) {
    let list: any[] = [];
    try { const p = JSON.parse(r.exercises); if (Array.isArray(p)) list = p.filter((e) => e && typeof e.name === 'string' && e.name.trim()); } catch { continue; }
    workouts.push({ id: r.id, date: r.date, title: r.title ?? null, exercises: list });
  }
  workouts.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  // Register display names first so every spelling of a key shows one name.
  const display = new Map<string, string>();
  const metaByKey = new Map<string, CanonicalMeta>();
  for (const w of workouts) for (const ex of w.exercises) {
    const { key, canonical, meta } = names.of(ex.name);
    display.set(key, canonical);
    if (meta && !metaByKey.has(key)) metaByKey.set(key, meta);
  }
  const raw: RawWorkout[] = workouts.map((w) => ({ id: w.id, date: w.date, exercises: w.exercises }));
  const exposures = buildExposures(raw, (n) => names.of(n).key);
  return { workouts, exposures, displayName: (k) => display.get(k) ?? k, meta: (k) => metaByKey.get(k) ?? null, names };
}

/** The user's workouts (all of them, or from `sinceDate` on), keyed canonically. */
export async function loadTrainingHistory(userId: string, sinceDate?: string): Promise<TrainingHistory> {
  const rows = await prisma.workoutLog.findMany({
    where: sinceDate ? { userId, date: { gte: sinceDate } } : { userId },
    orderBy: { date: 'asc' },
    select: { id: true, date: true, title: true, exercises: true, programDayRef: true },
  });
  const rawNames = new Set<string>();
  for (const r of rows) {
    try { for (const ex of JSON.parse(r.exercises) ?? []) if (ex?.name) rawNames.add(String(ex.name).trim()); } catch { /* skip */ }
  }
  return historyFromRows(rows, await loadNormRows(prisma, rawNames));
}

// ─── Pure summary pieces ─────────────────────────────────────────────────────

function shiftDay(date: string, days: number): string {
  const d = new Date(date + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function shortDate(date: string): string {
  const d = new Date(date + 'T00:00:00Z');
  return Number.isNaN(d.getTime()) ? date : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}
export function topSetLabel(top: { weightKg: number | null; reps: number } | null, unit: UnitPreference): string | null {
  if (!top) return null;
  const w = top.weightKg != null ? formatWeight(top.weightKg, unit, unit === 'metric' ? 1 : 0) : null;
  return w ? `${w}×${top.reps}` : `BW×${top.reps}`;
}

export interface SessionLine { date: string; title: string | null; lifts: string[]; more: number }
export interface LiftTrendLine { name: string; trend: Trend; pctPerWeek: number; weeks: number; last: string | null; lastDate: string }

/** Sessions in the last 14 days, newest first, each with its top lifts. */
export function recentSessions(h: TrainingHistory, today: string, unit: UnitPreference, days = SESSION_WINDOW_DAYS): SessionLine[] {
  const from = shiftDay(today, -(days - 1));
  const byWorkout = new Map<string, Exposure[]>();
  for (const list of h.exposures.values()) for (const e of list) {
    if (e.date < from || e.date > today) continue;
    const arr = byWorkout.get(e.workoutId) ?? [];
    arr.push(e);
    byWorkout.set(e.workoutId, arr);
  }
  return h.workouts
    .filter((w) => w.date >= from && w.date <= today)
    .reverse()
    .map((w) => {
      const exps = (byWorkout.get(w.id) ?? []).sort((a, b) => b.e1rmKg - a.e1rmKg);
      const lifts = exps.slice(0, 3).map((e) => {
        const set = topSetLabel(e.top ?? e.sets[0] ?? null, unit);
        return `${h.displayName(e.key)}${set ? ` ${set}` : ''}`;
      });
      return { date: w.date, title: w.title, lifts, more: Math.max(0, exps.length - lifts.length) };
    });
}

/** Per-lift trends for the lifts trained most and most recently. */
export function liftTrends(h: TrainingHistory, today: string, unit: UnitPreference, limit = MAX_TRENDS): LiftTrendLine[] {
  const since = shiftDay(today, -TREND_WINDOW_WEEKS * 7);
  const scored: Array<{ key: string; loaded: Exposure[]; score: number }> = [];
  for (const [key, list] of h.exposures) {
    const loaded = list.filter((e) => e.e1rmKg > 0 && e.date >= since && e.date <= today);
    if (loaded.length === 0) continue;
    const recent8 = loaded.filter((e) => e.date >= shiftDay(today, -56)).length;
    const ago = daysFrom(loaded[0].date, today);
    scored.push({ key, loaded, score: (recent8 + 0.25 * loaded.length) / (1 + ago / 7) });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map(({ key, loaded }) => {
    const series = weeklyBestSeries(loaded, isoWeekKey);
    const { trend, pctPerWeek } = classifyTrend(series);
    return { name: h.displayName(key), trend, pctPerWeek, weeks: series.length, last: topSetLabel(loaded[0].top, unit), lastDate: loaded[0].date };
  });
}

export interface ProfileHighlights { wins: string[]; imbalances: string[]; neglected: string[]; stalled: string[] }

/** Wins / imbalances / neglected / stalled from the athlete model's ranked insights. */
export function profileHighlights(profile: any): ProfileHighlights | null {
  const insights: any[] = profile?.athleteModel?.insights ?? [];
  if (!Array.isArray(insights) || insights.length === 0) return null;
  const pick = (kind: string) => insights.filter((i) => i?.kind === kind && i.title).slice(0, 2).map((i) => String(i.title));
  const h = { wins: pick('win'), imbalances: pick('imbalance'), neglected: pick('neglect'), stalled: pick('stagnation') };
  return h.wins.length + h.imbalances.length + h.neglected.length + h.stalled.length ? h : null;
}

export const PHASE_LABEL: Record<string, string> = {
  building_strength: 'building strength', cutting: 'cutting', cut_too_aggressive: 'cutting too aggressively',
  building_muscle: 'building muscle', recomp: 'recomp', plateau: 'plateau', rebuilding_consistency: 'rebuilding consistency', unknown: 'unclear',
};

export interface SummaryData {
  unit: UnitPreference;
  today: string;
  hasProgram: boolean;
  totalWorkouts: number;
  sessions: SessionLine[];
  trends: LiftTrendLine[];
  highlights: ProfileHighlights | null;
  phase: Pick<PhaseResult, 'effective' | 'inferred' | 'confidence' | 'confirmed' | 'statedGoalMismatch'> | null;
  pending: string[];
}

/** Render within the char budget, shedding detail (old sessions, then trends) first. Pure. */
export function renderTrainingSummary(d: SummaryData, max = SUMMARY_MAX_CHARS): string | null {
  if (d.totalWorkouts === 0) return null;
  const build = (sessionCap: number, trendCap: number): string => {
    const lines: string[] = [];
    const n = d.sessions.length;
    lines.push(`## Training log — ${n ? `${n} session${n === 1 ? '' : 's'} in the last 14 days` : 'nothing logged in the last 14 days'}${d.hasProgram ? '' : ' (no saved program: trains freestyle)'}`);
    for (const s of d.sessions.slice(0, sessionCap)) {
      const lifts = s.lifts.length ? `${s.lifts.join(', ')}${s.more ? `, +${s.more} more` : ''}` : 'no loaded sets';
      lines.push(`- ${shortDate(s.date)}${s.title ? ` ${s.title.slice(0, 28)}` : ''}: ${lifts}`);
    }
    if (n > sessionCap) lines.push(`- +${n - sessionCap} earlier`);
    const t = d.trends.slice(0, trendCap);
    if (t.length) {
      lines.push(`Lift trends (weekly best e1RM): ${t.map((x) => {
        const how = x.trend === 'insufficient' ? `${x.weeks} wk of data` : `${x.trend} ${x.pctPerWeek > 0 ? '+' : ''}${x.pctPerWeek}%/wk over ${x.weeks} wk`;
        return `${x.name} ${how}${x.last ? ` (last ${x.last}, ${shortDate(x.lastDate)})` : ''}`;
      }).join('; ')}.`);
    }
    const h = d.highlights;
    if (h) {
      const parts = [
        h.wins.length ? `wins: ${h.wins.join(', ')}` : '',
        h.imbalances.length ? `imbalances: ${h.imbalances.join(', ')}` : '',
        h.neglected.length ? `neglected: ${h.neglected.join(', ')}` : '',
        h.stalled.length ? `stalled: ${h.stalled.join(', ')}` : '',
      ].filter(Boolean);
      lines.push(`Strength profile — ${parts.join('; ')}.`);
    }
    if (d.phase) {
      const p = d.phase;
      const src = p.confirmed ? `confirmed by the user` : p.effective === 'unknown' ? `best guess ${PHASE_LABEL[p.inferred] ?? p.inferred}, ${Math.round(p.confidence * 100)}% confidence` : `inferred, ${Math.round(p.confidence * 100)}% confidence`;
      lines.push(`Training phase — ${PHASE_LABEL[p.effective] ?? p.effective} (${src}).${p.statedGoalMismatch ? ` Goal mismatch: ${p.statedGoalMismatch}` : ''}`);
    }
    if (d.pending.length) lines.push(`Pending adaptation proposals: ${d.pending.map((x) => `"${x.slice(0, 70)}"`).join('; ')}.`);
    return lines.join('\n');
  };
  for (const [s, t] of [[8, MAX_TRENDS], [5, 5], [3, 4], [2, 3], [0, 3], [0, 2]] as const) {
    const out = build(s, t);
    if (out.length <= max) return out;
  }
  const out = build(0, 1);
  return out.length <= max ? out : `${out.slice(0, max - 1)}…`;
}

// ─── Assembly ────────────────────────────────────────────────────────────────

export interface SummaryDeps {
  inferPhase?: (userId: string) => Promise<PhaseResult>;
  listPendingTitles?: (userId: string) => Promise<string[]>;
  /** Pending titles the caller already fetched (agent context) — skips the read. */
  pendingTitles?: string[];
  cachedProfile?: (userId: string) => any;
  now?: Date;
  /** Read/write the 5-minute per-user cache. Default true. */
  useCache?: boolean;
}

const warming = new Set<string>();
/** The cached strength profile; on a miss, warm it in the background (once). */
function cachedStrengthProfile(userId: string): any {
  const hit = cacheGet<any>(`strength:profile:${userId}`);
  if (hit) return hit;
  if (!warming.has(userId)) {
    warming.add(userId);
    import('../routes/strength.js')
      .then((m) => m.getStrengthProfileCached(userId))
      .catch(() => { /* best-effort */ })
      .finally(() => warming.delete(userId));
  }
  return null;
}

async function defaultInferPhase(userId: string): Promise<PhaseResult> {
  // The cached path: phase inference is ~4 reads, and its own cache is
  // dropped when a workout is logged.
  const { inferPhaseDetailed } = await import('./phaseInference.js');
  const { signals: _signals, ...result } = await inferPhaseDetailed(userId, new Date(), { useCache: true });
  return result;
}
async function defaultPendingTitles(userId: string): Promise<string[]> {
  const { listPending } = await import('../adaptation/proposalService.js');
  return (await listPending(userId)).map((p) => p.title).filter(Boolean);
}

/**
 * Contract 7. Compact text for the agent context, or null (no history, or
 * anything failed). Callers gate on trainingSummaryEnabledFor.
 */
export async function buildTrainingSummary(userId: string, deps: SummaryDeps = {}): Promise<string | null> {
  const useCache = deps.useCache !== false;
  if (useCache) {
    const hit = cacheGet<{ text: string | null }>(trainingSummaryCacheKey(userId));
    if (hit) return hit.text;
  }
  try {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { unitPreference: true, savedProgram: true, email: true, timezone: true } });
    if (!user) return null;
    const unit = normalizePreference(user.unitPreference);
    const now = deps.now ?? new Date();
    // Log dates are the user's local dates.
    const today = todayForTz(user.timezone, now);

    const soft = async <T>(fn: () => Promise<T>, fallback: T): Promise<T> => { try { return await fn(); } catch { return fallback; } };
    // Only the window the summary reads (trends look back 12 weeks; sessions 14 days).
    const [history, phase, pending] = await Promise.all([
      loadTrainingHistory(userId, shiftDay(today, -TREND_WINDOW_WEEKS * 7)),
      phaseInferenceAvailableFor(userId, user.email)
        ? soft(() => (deps.inferPhase ?? defaultInferPhase)(userId), null as PhaseResult | null)
        : Promise.resolve(null),
      deps.pendingTitles
        ? Promise.resolve(deps.pendingTitles.filter(Boolean))
        : soft(() => (deps.listPendingTitles ?? defaultPendingTitles)(userId), [] as string[]),
    ]);
    // Nothing in the window: still a summary ("nothing logged lately") for a
    // lifter with older history; null only for someone who never logged.
    const totalWorkouts = history.workouts.length
      || await Promise.resolve().then(() => prisma.workoutLog.count({ where: { userId } })).catch(() => 0);
    if (totalWorkouts === 0) {
      if (useCache) cacheSet(trainingSummaryCacheKey(userId), { text: null }, SUMMARY_CACHE_TTL_MS);
      return null;
    }
    const profile = (deps.cachedProfile ?? cachedStrengthProfile)(userId);

    const text = renderTrainingSummary({
      unit,
      today,
      hasProgram: !!user.savedProgram,
      totalWorkouts,
      sessions: recentSessions(history, today, unit),
      trends: liftTrends(history, today, unit),
      highlights: profileHighlights(profile),
      phase: phase && phase.effective ? phase : null,
      pending: pending.slice(0, 3),
    });
    if (useCache) cacheSet(trainingSummaryCacheKey(userId), { text }, SUMMARY_CACHE_TTL_MS);
    return text;
  } catch (err: any) {
    console.warn('[trainingSummary] failed:', err?.message ?? err);
    return null;
  }
}
