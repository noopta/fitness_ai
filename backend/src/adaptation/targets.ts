// Target-load math. Pure.
//
// A program exercise carries sets / reps ("6-8") / intensity ("RPE 7"). To
// say "you're ahead of plan" we need a load to be ahead OF — targetWeightKg.
// This module parses the plan, seeds a target from a lifter's history, and
// writes targets back into a program copy (never the original).

import { e1rmConfidence, e1rmWithRpe } from '../engine/e1rm.js';
import { KG_PER_LB, type UnitPreference } from '../services/weightUnits.js';
import type { Exposure, PlannedExercise, RepRange } from './types.js';
import type { KeyFn } from './history.js';

export function parseRepRange(reps: string | number | null | undefined): RepRange {
  if (typeof reps === 'number' && Number.isFinite(reps)) return { min: reps, max: reps };
  const s = String(reps ?? '').trim();
  const range = s.match(/(\d+)\s*[-–—to]+\s*(\d+)/i);
  if (range) {
    const a = parseInt(range[1], 10), b = parseInt(range[2], 10);
    return { min: Math.min(a, b), max: Math.max(a, b) };
  }
  const single = s.match(/(\d+)/);
  if (single) { const n = parseInt(single[1], 10); return { min: n, max: n }; }
  return { min: 8, max: 8 };
}

/** "RPE 7", "RPE 7-8", "@8", "RIR 2" → RPE number or null. */
export function parseTargetRPE(intensity: string | number | null | undefined): number | null {
  if (typeof intensity === 'number') return intensity >= 1 && intensity <= 10 ? intensity : null;
  const s = String(intensity ?? '').trim().toLowerCase();
  if (!s) return null;
  const rir = s.match(/rir\s*(\d+(?:\.\d+)?)/);
  if (rir) { const r = parseFloat(rir[1]); return r >= 0 && r <= 9 ? 10 - r : null; }
  const rpe = s.match(/(?:rpe|@)\s*(\d+(?:\.\d+)?)(?:\s*[-–]\s*(\d+(?:\.\d+)?))?/);
  if (rpe) {
    const a = parseFloat(rpe[1]);
    const b = rpe[2] ? parseFloat(rpe[2]) : a;
    const v = (a + b) / 2;
    return v >= 1 && v <= 10 ? v : null;
  }
  const pct = s.match(/(\d{2,3})\s*%/);
  if (pct) {
    // Rough %1RM → RPE bridge for a mid rep range; good enough as a target.
    const p = parseInt(pct[1], 10);
    if (p >= 90) return 9; if (p >= 80) return 8; if (p >= 70) return 7; return 6;
  }
  return null;
}

export type LoadClass = 'barbell' | 'dumbbell' | 'machine' | 'bodyweight';

export function classifyLoad(name: string): LoadClass {
  const s = name.toLowerCase();
  if (/\b(push[- ]?up|pull[- ]?up|chin[- ]?up|plank|dead ?bug|bird ?dog|crunch|sit[- ]?up|dip|inverted row|nordic|pistol)\b/.test(s) && !/weighted/.test(s)) return 'bodyweight';
  if (/\b(db|dumbbell|dumbbells|kettlebell|kb)\b/.test(s)) return 'dumbbell';
  if (/\b(machine|cable|pulldown|pressdown|pushdown|leg press|leg extension|leg curl|hack squat|smith|pec deck|fly|flye|face pull|seated row|lat pull|hip abduction|hip adduction|calf raise)\b/.test(s)) return 'machine';
  return 'barbell';
}

/** Smallest sensible load step for this lift in the user's display unit, in kg. */
export function loadIncrementKg(name: string, pref: UnitPreference): number {
  const cls = classifyLoad(name);
  const lower = /\b(squat|deadlift|rdl|romanian|hip thrust|leg press|hack|lunge|split squat|trap bar|good morning)\b/.test(name.toLowerCase());
  if (pref === 'imperial') {
    const lb = cls === 'machine' ? 10 : cls === 'dumbbell' ? 5 : lower ? 10 : 5;
    return lb * KG_PER_LB;
  }
  if (cls === 'machine') return 5;
  if (cls === 'dumbbell') return 2;
  return lower ? 5 : 2.5;
}

/** Round a kg load to the nearest step in the user's unit; returns kg. */
export function roundToIncrement(kg: number, name: string, pref: UnitPreference): number {
  const step = loadIncrementKg(name, pref);
  const rounded = Math.round(kg / step) * step;
  return Math.round(rounded * 100) / 100;
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  // Even count → the LOWER middle: conservative, one heavy day never sets the target.
  return s.length % 2 === 1 ? s[mid] : s[mid - 1];
}

/** Inverse RPE-aware Epley: load that yields `reps` at `rpe` given an e1RM. */
export function loadForReps(e1rmKg: number, reps: number, rpe: number | null): number {
  if (e1rmKg <= 0 || reps <= 0) return 0;
  const rir = rpe != null ? Math.max(0, 10 - rpe) : 2;
  const eff = Math.min(reps + rir, 12);
  return e1rmKg / (1 + eff / 30);
}

export interface SeededTarget {
  targetWeightKg: number;
  confidence: number;
  basis: 'history' | 'e1rm';
  medianTopWeightKg: number;
  medianE1rmKg: number;
}

/**
 * Seed a target load for a planned exercise from recent exposures (newest
 * first). Uses the median top-set weight when the lifter has been working in
 * the program's rep range; otherwise derives from median e1RM. Null when
 * there's no loaded history.
 */
export function seedTargetFromExposures(
  exposures: Exposure[],
  repRange: RepRange,
  targetRPE: number | null,
  name: string,
  pref: UnitPreference,
  take = 4,
): SeededTarget | null {
  const recent = exposures.filter(e => e.top && e.e1rmKg > 0).slice(0, take);
  if (recent.length === 0) return null;
  const weights = recent.map(e => e.top!.weightKg!);
  const e1s = recent.map(e => e.e1rmKg);
  const medW = median(weights);
  const medE1 = median(e1s);
  const repsMid = Math.round((repRange.min + repRange.max) / 2);
  const inRange = recent.filter(e => e.top!.reps >= repRange.min - 1 && e.top!.reps <= repRange.max + 1).length >= Math.ceil(recent.length / 2);
  const countFactor = recent.length >= 3 ? 1 : recent.length === 2 ? 0.85 : 0.7;
  const conf = Math.round(
    (recent.reduce((s, e) => s + e.confidence, 0) / recent.length) * countFactor * 100,
  ) / 100;
  if (inRange) {
    return { targetWeightKg: roundToIncrement(medW, name, pref), confidence: conf, basis: 'history', medianTopWeightKg: medW, medianE1rmKg: medE1 };
  }
  const derived = loadForReps(medE1, repsMid, targetRPE);
  return {
    targetWeightKg: roundToIncrement(derived, name, pref),
    confidence: Math.round(conf * 0.9 * 100) / 100,
    basis: 'e1rm',
    medianTopWeightKg: medW,
    medianE1rmKg: medE1,
  };
}

/** Walk the saved program and list every planned exercise (deduped by key). */
export function extractPlannedExercises(program: any, keyFn: KeyFn): PlannedExercise[] {
  const byKey = new Map<string, PlannedExercise>();
  const phases: any[] = program?.phases ?? [];
  phases.forEach((phase, phaseIndex) => {
    const days: any[] = phase?.trainingDays ?? phase?.days ?? [];
    days.forEach((day, dayIndex) => {
      const exs: any[] = day?.exercises ?? day?.sessions ?? [];
      for (const ex of exs) {
        const name = String(ex?.exercise ?? ex?.name ?? '').trim();
        if (!name) continue;
        const key = keyFn(name);
        if (!key) continue;
        const existing = byKey.get(key);
        const loc = { phaseIndex, dayIndex, day: String(day?.day ?? `Day ${dayIndex + 1}`) };
        if (existing) { existing.locations.push(loc); continue; }
        byKey.set(key, {
          key,
          exercise: name,
          sets: Number(ex?.sets) || 3,
          repRange: parseRepRange(ex?.reps),
          repsRaw: String(ex?.reps ?? ''),
          targetRPE: typeof ex?.targetRPE === 'number' ? ex.targetRPE : parseTargetRPE(ex?.intensity ?? ex?.rpe),
          targetWeightKg: typeof ex?.targetWeightKg === 'number' && ex.targetWeightKg > 0 ? ex.targetWeightKg : null,
          locations: [loc],
        });
      }
    });
  });
  return [...byKey.values()];
}

export interface TargetWrite {
  key: string;
  targetWeightKg: number | null;
  targetRPE?: number | null;
  confidence?: number | null;
  basis?: string | null;
}

/**
 * Return a DEEP COPY of the program with targets written onto every exercise
 * whose key matches, plus the previous values so the change can be undone.
 */
export function applyTargetsToProgram(
  program: any,
  targets: TargetWrite[],
  keyFn: KeyFn,
  setAt: string,
): { program: any; previous: TargetWrite[]; touched: number } {
  const copy = JSON.parse(JSON.stringify(program ?? {}));
  const wanted = new Map(targets.map(t => [t.key, t]));
  const previous = new Map<string, TargetWrite>();
  let touched = 0;
  for (const phase of copy?.phases ?? []) {
    for (const day of phase?.trainingDays ?? phase?.days ?? []) {
      for (const ex of day?.exercises ?? day?.sessions ?? []) {
        const name = String(ex?.exercise ?? ex?.name ?? '').trim();
        const key = keyFn(name);
        const t = wanted.get(key);
        if (!t) continue;
        if (!previous.has(key)) {
          previous.set(key, {
            key,
            targetWeightKg: typeof ex.targetWeightKg === 'number' ? ex.targetWeightKg : null,
            targetRPE: typeof ex.targetRPE === 'number' ? ex.targetRPE : null,
            confidence: typeof ex.targetConfidence === 'number' ? ex.targetConfidence : null,
            basis: ex.targetBasis ?? null,
          });
        }
        if (t.targetWeightKg == null) {
          delete ex.targetWeightKg; delete ex.targetConfidence; delete ex.targetBasis; delete ex.targetSetAt;
        } else {
          ex.targetWeightKg = t.targetWeightKg;
          if (t.confidence != null) ex.targetConfidence = t.confidence;
          if (t.basis) ex.targetBasis = t.basis;
          ex.targetSetAt = setAt;
        }
        if (t.targetRPE !== undefined) {
          if (t.targetRPE == null) delete ex.targetRPE; else ex.targetRPE = t.targetRPE;
        }
        touched += 1;
      }
    }
  }
  return { program: copy, previous: [...previous.values()], touched };
}

/** Bump helper used by load_change: current → current + one increment. */
export function nextLoad(currentKg: number, name: string, pref: UnitPreference): number {
  const step = loadIncrementKg(name, pref);
  return Math.round((roundToIncrement(currentKg, name, pref) + step) * 100) / 100;
}

/** e1RM helpers re-exported for rules that want them without importing engine/. */
export { e1rmWithRpe, e1rmConfidence };
