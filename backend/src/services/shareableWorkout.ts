// Builds the immutable `ShareableWorkout` object the mobile celebration sheet
// consumes after a workout is logged (see "Shareable Workout Log — Mobile Spec"
// §4 · Data contract). It is the single source of truth for the share cards:
// PR-led vs. fallback rendering is driven entirely by whether `pr` is null.
//
// Volume is reported in lb for this release (matches the logging unit); the
// number is carried raw and the client formats the thousands separator.

import type { DetectedPR } from './progressService.js';
import { kgToLb, lbToKg } from './weightUnits.js';

interface LoggedSetEntry {
  weightKg?: number | null;
  reps: number;
  rpe?: number | null;
}

interface LoggedExercise {
  name: string;
  sets: number;
  reps: string | number;
  weightKg?: number | null;
  rpe?: number | null;
  bodyweight?: boolean;
  setEntries?: LoggedSetEntry[] | null;
}

/** Mirrors the `ShareableWorkout` interface in mobileAlt's share types. */
export interface ShareableWorkout {
  title: string;
  loggedAt: string;        // ISO 8601
  durationMin: number;
  sets: number;            // total working sets
  volumeLb: number;        // total load × reps, lbs (raw number, legacy)
  volumeKg: number;        // total load × reps, kg (raw, canonical)
  // `detail` stays lb-formatted for older clients; the structured fields let
  // newer clients format cleanly in the sharer's unit (no string re-parsing).
  exercises: {
    name: string;
    detail: string;
    sets: number;
    reps: string;
    weightKg: number | null; // null for bodyweight / unloaded
    bodyweight: boolean;
  }[];
  pr: null | {
    lift: string;
    metric: string;        // e.g. "e1RM"
    value: string;         // e.g. "215" (legacy, lb)
    unit: string;          // e.g. "lb" (legacy)
    delta: string;         // e.g. "+5 lb" (legacy)
    valueKg: number;       // canonical e1RM in kg
    deltaKg: number;       // canonical delta in kg
  };
}

function toLb(kg: number): number {
  return Math.round(kgToLb(kg));
}

/** First integer in a rep string ("6-8" → 6, "8" → 8). */
function lowerRep(reps: string | number): number | null {
  if (typeof reps === 'number') return Number.isFinite(reps) ? reps : null;
  const m = String(reps).trim().match(/^(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

function setsOf(ex: LoggedExercise): number {
  if (ex.setEntries && ex.setEntries.length > 0) return ex.setEntries.length;
  return Math.max(Number(ex.sets) || 1, 1);
}

/** "5 × 5 · 185 lb" for loaded lifts; "5 × 12" for bodyweight / unloaded. */
function formatDetail(ex: LoggedExercise): string {
  const sets = setsOf(ex);
  const reps = String(ex.reps ?? '').trim() || '—';
  if (ex.bodyweight || ex.weightKg == null || ex.weightKg <= 0) {
    return `${sets} × ${reps}`;
  }
  return `${sets} × ${reps} · ${toLb(ex.weightKg)} lb`;
}

/**
 * Total external-load volume in canonical kg (bodyweight movements contribute 0).
 * Callers derive the lb figure via kgToLb so both units come from one computation.
 */
function totalVolumeKg(exercises: LoggedExercise[]): number {
  let vol = 0;
  for (const ex of exercises) {
    if (ex.setEntries && ex.setEntries.length > 0) {
      for (const s of ex.setEntries) {
        if (s.weightKg && s.weightKg > 0 && s.reps > 0) vol += s.weightKg * s.reps;
      }
      continue;
    }
    if (ex.bodyweight || !ex.weightKg || ex.weightKg <= 0) continue;
    const reps = lowerRep(ex.reps) ?? 0;
    const sets = Math.max(Number(ex.sets) || 1, 1);
    if (reps > 0) vol += ex.weightKg * reps * sets;
  }
  return vol;
}

/**
 * Assemble the share payload from the just-logged exercises and the PRs detected
 * against the user's history. `prs` is expected most-improved-first; the top one
 * leads the card. Pass `[]` for a no-PR session (every template falls back).
 */
export function buildShareableWorkout(
  input: {
    title?: string | null;
    exercises: LoggedExercise[];
    durationMin?: number | null;
    loggedAt: string | Date;
  },
  prs: DetectedPR[],
): ShareableWorkout {
  const exercises = input.exercises ?? [];
  const top = prs.length > 0 ? prs[0] : null;
  const loggedAt =
    typeof input.loggedAt === 'string' ? input.loggedAt : input.loggedAt.toISOString();

  const volumeKg = totalVolumeKg(exercises);

  return {
    title: (input.title || '').trim() || 'Workout',
    loggedAt,
    durationMin: Math.max(Math.round(Number(input.durationMin) || 0), 0),
    sets: exercises.reduce((n, ex) => n + setsOf(ex), 0),
    volumeKg: Math.round(volumeKg),
    volumeLb: Math.round(kgToLb(volumeKg)),
    exercises: exercises.map((ex) => {
      const loaded = !ex.bodyweight && ex.weightKg != null && ex.weightKg > 0;
      return {
        name: ex.name.trim(),
        detail: formatDetail(ex),
        sets: setsOf(ex),
        reps: String(ex.reps ?? '').trim() || '—',
        weightKg: loaded ? ex.weightKg! : null,
        bodyweight: !loaded,
      };
    }),
    pr: top
      ? {
          lift: top.displayName,
          metric: 'e1RM',
          value: String(top.e1RMLbs),
          unit: 'lb',
          delta: `+${top.deltaLbs} lb`,
          valueKg: Math.round(lbToKg(top.e1RMLbs)),
          deltaKg: Math.round(lbToKg(top.deltaLbs)),
        }
      : null,
  };
}
