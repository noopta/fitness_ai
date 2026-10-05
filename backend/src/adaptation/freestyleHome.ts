// Freestyle home (contract 3): recent sessions, per-lift trends, weekly
// session counts — the "log as you go" screen for users without a program.
// Pure shaping (buildFreestyleHome) + loader (loadFreestyleHome).

import { PrismaClient } from '@prisma/client';
import { isoWeekKey } from '../services/muscleLedgerService.js';
import { buildExposures, makeKeyFn, weeklyBestSeries, workingSets } from './history.js';
import { classifyTrend, type Trend } from './rules/retrofit.js';
import { parseSavedProgram } from '../services/programPhaseService.js';
import { daysFrom, dateStr } from './detectors.js';
import { todayForTz } from '../services/localDate.js';
import type { Exposure, PhaseResult } from './types.js';

const prisma = new PrismaClient();

export interface FreestyleSession { id: string; date: string; title: string | null; exerciseCount: number; setCount: number; topLifts: string[] }
export interface FreestyleLiftTrend {
  key: string; name: string; trend: Trend; pctPerWeek: number; spark: number[];
  lastTop: { weightKg: number | null; reps: number; rpe: number | null } | null; lastDate: string;
}
export interface FreestyleHome {
  enabled: boolean;
  hasProgram: boolean;
  recentSessions: FreestyleSession[];
  liftTrends: FreestyleLiftTrend[];
  phase: PhaseResult | null;
  pendingProposals: number;
  weeklySessions: number[];
}

export interface HomeWorkout { id: string; date: string; title: string | null; exercises: string; programDayRef?: string | null }

/** Last 10 sessions, newest first. topLifts = up to 3 names by top-set e1RM. */
export function shapeSessions(workouts: HomeWorkout[], exposuresByKey: Map<string, Exposure[]>): FreestyleSession[] {
  const byWorkout = new Map<string, Exposure[]>();
  for (const list of exposuresByKey.values()) for (const e of list) {
    const arr = byWorkout.get(e.workoutId) ?? []; arr.push(e); byWorkout.set(e.workoutId, arr);
  }
  return [...workouts].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)).slice(0, 10).map(w => {
    let list: any[] = [];
    try { list = JSON.parse(w.exercises); } catch { list = []; }
    if (!Array.isArray(list)) list = [];
    const setCount = list.reduce((s, ex) => s + (ex?.name ? workingSets(ex).length : 0), 0);
    const exps = (byWorkout.get(w.id) ?? []).slice().sort((a, b) => b.e1rmKg - a.e1rmKg);
    const topLifts = exps.length ? exps.slice(0, 3).map(e => e.displayName) : list.slice(0, 3).map(ex => String(ex?.name ?? '')).filter(Boolean);
    return { id: w.id, date: w.date, title: w.title ?? null, exerciseCount: list.filter(ex => ex?.name).length, setCount, topLifts };
  });
}

/** Top 6 lifts by recency × frequency over the last 8 weeks. */
export function shapeLiftTrends(exposuresByKey: Map<string, Exposure[]>, now: Date, today = dateStr(now)): FreestyleLiftTrend[] {
  const scored: Array<{ score: number; t: FreestyleLiftTrend }> = [];
  for (const [key, list] of exposuresByKey) {
    const recent = list.filter(e => daysFrom(e.date, today) <= 56 && daysFrom(e.date, today) >= 0);
    if (!recent.length) continue;
    const last = recent[0];
    const since = daysFrom(last.date, today);
    const score = recent.length / (1 + since / 7);
    const spark = weeklyBestSeries(recent, isoWeekKey).map(v => Math.round(v * 10) / 10);
    const { trend, pctPerWeek } = classifyTrend(spark);
    const lastTop = last.top
      ? { weightKg: last.top.weightKg, reps: last.top.reps, rpe: last.top.rpe }
      : last.sets.length ? (() => { const s = [...last.sets].sort((a, b) => b.reps - a.reps)[0]; return { weightKg: null, reps: s.reps, rpe: s.rpe }; })() : null;
    scored.push({ score, t: { key, name: last.displayName, trend, pctPerWeek, spark, lastTop, lastDate: last.date } });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, 6).map(s => s.t);
}

function shiftDay(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Distinct workout days per ISO week, last 8 weeks (ending at the user's local `today`), oldest → newest. */
export function shapeWeeklySessions(workouts: Array<{ date: string }>, now: Date, today = dateStr(now)): number[] {
  const weeks: string[] = [];
  for (let i = 7; i >= 0; i--) weeks.push(isoWeekKey(shiftDay(today, -i * 7)));
  const counts = new Map(weeks.map(w => [w, 0]));
  const seen = new Set<string>();
  for (const w of workouts) {
    if (seen.has(w.date)) continue;
    seen.add(w.date);
    const k = isoWeekKey(w.date);
    if (counts.has(k)) counts.set(k, counts.get(k)! + 1);
  }
  return weeks.map(w => counts.get(w)!);
}

export function buildFreestyleHome(input: {
  enabled: boolean; hasProgram: boolean; workouts: HomeWorkout[]; exposuresByKey: Map<string, Exposure[]>;
  phase: PhaseResult | null; pendingProposals: number; now: Date;
  /** The user's local date at `now`. Defaults to `now`'s UTC date. */
  today?: string;
}): FreestyleHome {
  const today = input.today ?? dateStr(input.now);
  return {
    enabled: input.enabled,
    hasProgram: input.hasProgram,
    recentSessions: shapeSessions(input.workouts, input.exposuresByKey),
    liftTrends: shapeLiftTrends(input.exposuresByKey, input.now, today),
    phase: input.phase,
    pendingProposals: input.pendingProposals,
    weeklySessions: shapeWeeklySessions(input.workouts, input.now, today),
  };
}

export async function loadFreestyleHome(
  userId: string,
  opts: { enabled: boolean; phase: (exposuresByKey: Map<string, Exposure[]>, dates: string[]) => Promise<PhaseResult | null>; now?: Date },
): Promise<FreestyleHome> {
  const now = opts.now ?? new Date();
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { savedProgram: true, timezone: true } });
  // Log dates are the user's local dates — anchor every window on their today.
  const today = todayForTz(user?.timezone, now);
  const since = shiftDay(today, -84);
  const [workouts, pending] = await Promise.all([
    prisma.workoutLog.findMany({ where: { userId, date: { gte: since } }, orderBy: { date: 'asc' }, select: { id: true, date: true, title: true, exercises: true, programDayRef: true } }),
    prisma.adaptationProposal.count({ where: { userId, status: 'pending' } }),
  ]);
  const raw = new Set<string>();
  for (const w of workouts) { try { for (const ex of JSON.parse(w.exercises) ?? []) if (ex?.name) raw.add(String(ex.name).trim()); } catch { /* skip */ } }
  const dbCanonical = new Map<string, string>();
  if (raw.size) {
    const rows = await prisma.exerciseNormalization.findMany({ where: { rawName: { in: [...raw] } }, select: { rawName: true, canonicalName: true } });
    for (const r of rows) dbCanonical.set(r.rawName, r.canonicalName);
  }
  const exposuresByKey = buildExposures(workouts, makeKeyFn(dbCanonical));
  const phase = await opts.phase(exposuresByKey, workouts.map(w => w.date)).catch(() => null);
  return buildFreestyleHome({
    enabled: opts.enabled, hasProgram: !!parseSavedProgram(user?.savedProgram ?? null), workouts, exposuresByKey, phase, pendingProposals: pending, now, today,
  });
}
