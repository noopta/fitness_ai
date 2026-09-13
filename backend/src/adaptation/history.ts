// Turn raw WorkoutLog rows into per-lift exposures. Pure.
//
// Matching logged names to program names is the whole game for existing
// users ("Standing calf raise" vs "Standing Calf Raise" vs "Calf Raise"), so
// every name goes through the same liftKey(): DB normalization row if the
// caller loaded one, else the seed dictionary, else a lowercase collapse.

import { canonicalizeSync } from '../services/exerciseCanonical.js';
import { e1rmWithRpe, e1rmConfidence, parseRPE } from '../engine/e1rm.js';
import type { Exposure, LoggedSet, ProgramDayRef } from './types.js';

export type KeyFn = (name: string) => string;

function collapse(name: string): string {
  return (name ?? '')
    .toLowerCase()
    .replace(/[—–]/g, '-')
    .replace(/[^a-z0-9\- ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Build a key function. `dbCanonical` maps raw logged names (as stored in
 * ExerciseNormalization) → canonical names; it wins over the seed so LLM
 * classifications of odd names are honoured.
 */
export function makeKeyFn(dbCanonical?: Map<string, string>): KeyFn {
  const cache = new Map<string, string>();
  return (name: string) => {
    // Collapse internal whitespace BEFORE any lookup so "Cable  Crunch" and
    // "cable crunch" hit the same dictionary entry.
    const raw = (name ?? '').replace(/\s+/g, ' ').trim();
    if (!raw) return '';
    const hit = cache.get(raw);
    if (hit) return hit;
    const fromDb = dbCanonical?.get(raw) ?? dbCanonical?.get((name ?? '').trim());
    const canonical = fromDb ?? canonicalizeSync(raw)?.canonicalName ?? null;
    const key = collapse(canonical ?? raw);
    cache.set(raw, key);
    return key;
  };
}

interface RawLoggedExercise {
  name: string;
  sets?: number;
  reps?: number | string;
  weightKg?: number | null;
  rpe?: number | string | null;
  bodyweight?: boolean;
  setEntries?: Array<{ weightKg?: number | null; reps: number; rpe?: number | null }> | null;
}

export interface RawWorkout {
  id: string;
  date: string;
  exercises: string | RawLoggedExercise[];
  programDayRef?: string | null;
}

function lowerRep(reps: number | string | undefined): number {
  if (typeof reps === 'number') return Number.isFinite(reps) ? reps : 0;
  const m = String(reps ?? '').trim().match(/^(\d+)/);
  return m ? parseInt(m[1], 10) : 0;
}

/** Expand a logged exercise into working sets (canonical kg). */
export function workingSets(ex: RawLoggedExercise): LoggedSet[] {
  if (ex.setEntries && ex.setEntries.length > 0) {
    return ex.setEntries
      .filter(s => s && s.reps > 0)
      .map(s => ({
        weightKg: s.weightKg != null && s.weightKg > 0 ? s.weightKg : null,
        reps: s.reps,
        rpe: parseRPE(s.rpe),
      }));
  }
  const reps = lowerRep(ex.reps);
  const n = Math.max(1, Math.min(ex.sets ?? 1, 20));
  if (reps <= 0) return [];
  const weightKg = ex.weightKg != null && ex.weightKg > 0 && !ex.bodyweight ? ex.weightKg : null;
  const rpe = parseRPE(ex.rpe);
  return Array.from({ length: n }, () => ({ weightKg, reps, rpe }));
}

export function parseProgramDayRef(raw: string | null | undefined): ProgramDayRef | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw);
    if (o && typeof o.phaseIndex === 'number' && typeof o.dayIndex === 'number') {
      return { phaseIndex: o.phaseIndex, dayIndex: o.dayIndex, weekNumber: Number(o.weekNumber) || 1, day: o.day };
    }
  } catch { /* ignore */ }
  return null;
}

/**
 * Exposures for every lift across the given workouts. Result map values are
 * sorted NEWEST FIRST. Workouts with unparseable JSON are skipped.
 */
export function buildExposures(workouts: RawWorkout[], keyFn: KeyFn): Map<string, Exposure[]> {
  const out = new Map<string, Exposure[]>();
  for (const w of workouts) {
    let list: RawLoggedExercise[];
    try {
      list = typeof w.exercises === 'string' ? JSON.parse(w.exercises) : w.exercises;
    } catch { continue; }
    if (!Array.isArray(list)) continue;
    const ref = parseProgramDayRef(w.programDayRef);
    for (const ex of list) {
      if (!ex || !ex.name) continue;
      const key = keyFn(ex.name);
      if (!key) continue;
      const sets = workingSets(ex);
      if (sets.length === 0) continue;
      const loaded = sets.filter(s => s.weightKg != null);
      let top: LoggedSet | null = null;
      let topE1 = 0;
      for (const s of loaded) {
        const e = e1rmWithRpe(s.weightKg!, s.reps, s.rpe);
        if (e > topE1) { topE1 = e; top = s; }
      }
      const exposure: Exposure = {
        key,
        displayName: ex.name.trim(),
        date: w.date,
        workoutId: w.id,
        sets,
        top,
        minReps: loaded.length ? Math.min(...loaded.map(s => s.reps)) : Math.min(...sets.map(s => s.reps)),
        maxWeightKg: loaded.length ? Math.max(...loaded.map(s => s.weightKg!)) : 0,
        e1rmKg: topE1,
        confidence: top ? e1rmConfidence(top.reps, top.rpe) : 0.3,
        rpeLogged: top?.rpe != null,
        programDayRef: ref,
      };
      const arr = out.get(key) ?? [];
      arr.push(exposure);
      out.set(key, arr);
    }
  }
  for (const arr of out.values()) arr.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return out;
}

/** Weekly best e1RM series (oldest → newest) for a sparkline / trend fit. */
export function weeklyBestSeries(exposures: Exposure[], isoWeekKey: (d: string) => string): number[] {
  const byWeek = new Map<string, number>();
  for (const e of exposures) {
    if (e.e1rmKg <= 0) continue;
    const wk = isoWeekKey(e.date);
    byWeek.set(wk, Math.max(byWeek.get(wk) ?? 0, e.e1rmKg));
  }
  return [...byWeek.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([, v]) => v);
}
