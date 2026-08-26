// Planned-vs-actual scoring for one exposure against its planned exercise.
// Pure. This is the raw signal every rule consumes.

import type { Exposure, PlannedExercise } from './types.js';

export type SessionResult = 'exceeded' | 'hit' | 'missed' | 'unloaded' | 'unknown';

export interface SessionScore {
  result: SessionResult;
  /** All loaded working sets reached the top of the rep range. */
  toppedRange: boolean;
  /** Any loaded set fell below the bottom of the range. */
  belowRange: boolean;
  /** Top-set RPE minus target RPE (positive = harder than planned). Null if either absent. */
  rpeDelta: number | null;
  /** Top-set load vs target load, kg (positive = heavier than planned). Null if either absent. */
  loadDeltaKg: number | null;
  note: string;
}

export function scoreExposure(planned: PlannedExercise, exposure: Exposure): SessionScore {
  const loaded = exposure.sets.filter(s => s.weightKg != null);
  if (loaded.length === 0 || !exposure.top) {
    return { result: 'unloaded', toppedRange: false, belowRange: false, rpeDelta: null, loadDeltaKg: null, note: 'No load logged' };
  }
  const { min, max } = planned.repRange;
  const toppedRange = loaded.every(s => s.reps >= max);
  const belowRange = loaded.some(s => s.reps < min);
  const rpeDelta = exposure.top.rpe != null && planned.targetRPE != null ? Math.round((exposure.top.rpe - planned.targetRPE) * 10) / 10 : null;
  const loadDeltaKg = planned.targetWeightKg != null ? Math.round((exposure.top.weightKg! - planned.targetWeightKg) * 100) / 100 : null;

  let result: SessionResult = 'unknown';
  let note = '';
  const atOrAboveTarget = loadDeltaKg == null || loadDeltaKg >= -0.01;
  const grinding = rpeDelta != null && rpeDelta >= 1;
  if (belowRange || (loadDeltaKg != null && loadDeltaKg < -0.01)) {
    result = 'missed';
    note = belowRange ? 'Fell below the rep range' : 'Below target load';
  } else if (toppedRange && atOrAboveTarget && !grinding) {
    result = 'exceeded';
    note = 'Every set at the top of the range';
  } else {
    result = 'hit';
    note = grinding ? 'Hit, but harder than planned' : 'Within the plan';
  }
  return { result, toppedRange, belowRange, rpeDelta, loadDeltaKg, note };
}
