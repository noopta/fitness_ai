// RPE-aware estimated-1RM math.
//
// The plain Epley formula — weight × (1 + reps/30) — implicitly assumes the
// logged reps are the *most* reps possible (i.e. the set was taken to
// failure, RPE 10). Most working sets aren't to failure, so plain Epley
// systematically under-credits a lifter's true capacity.
//
// RPE (Rate of Perceived Exertion, 1-10) tells us how many reps were left
// in the tank: Reps In Reserve (RIR) = 10 - RPE. RPE 7 ≈ 3 RIR. Adding RIR
// to the logged reps gives "effective reps to failure", which feeds a far
// more accurate e1RM.
//
// When the user didn't log RPE we fall back to a rep-range-aware assumed
// RIR (lower-rep sets tend to be done closer to failure than higher-rep
// sets) rather than a flat constant. This is a systematic correction, so
// relative metrics (ratios, trends, muscle balance) are unaffected by the
// assumption; only absolute e1RM shifts, and it shifts toward the truth.

/**
 * Assumed reps-in-reserve when RPE wasn't logged. Rep-range aware: a heavy
 * triple is usually closer to failure than a set of 15.
 */
export function assumedRIR(reps: number): number {
  if (reps <= 2) return 1.5;
  if (reps <= 5) return 2;
  if (reps <= 10) return 2.5;
  return 3;
}

/**
 * Parse a logged RPE value (string or number) into a usable 1-10 number,
 * or null if absent / out of range. Accepts the common "RIR" mis-entry
 * gracefully is NOT attempted — we treat the field strictly as RPE.
 */
export function parseRPE(raw: unknown): number | null {
  if (raw == null || raw === '') return null;
  const n = typeof raw === 'number' ? raw : parseFloat(String(raw));
  if (!Number.isFinite(n)) return null;
  if (n < 1 || n > 10) return null;
  return n;
}

/**
 * Effective reps-to-failure for an e1RM estimate. RPE present → RIR = 10-RPE.
 * RPE absent → rep-range-aware assumed RIR. Never negative.
 */
export function effectiveReps(reps: number, rpe?: number | null): number {
  if (reps <= 0) return 0;
  const rir = rpe != null && rpe >= 1 && rpe <= 10 ? 10 - rpe : assumedRIR(reps);
  return reps + Math.max(0, rir);
}

/**
 * RPE-aware Epley e1RM in the same unit as `weight`.
 *
 * Effective reps are capped at 12 — beyond that the linear Epley model
 * loses accuracy badly, and a set that deep into the tank shouldn't be
 * driving a 1RM estimate anyway. Returns 0 for invalid input.
 */
export function e1rmWithRpe(weight: number, reps: number, rpe?: number | null): number {
  if (weight <= 0 || reps <= 0 || reps > 15) return 0;
  const eff = Math.min(effectiveReps(reps, rpe), 12);
  if (eff <= 1) return Math.round(weight);
  return Math.round(weight * (1 + eff / 30));
}

/**
 * Legacy plain-Epley e1RM (reps treated as max reps, i.e. assumed RPE 10).
 * Kept so callers can stay on the old behavior behind a feature flag while
 * the RPE-aware path is dogfooded.
 */
export function e1rmPlain(weight: number, reps: number): number {
  if (reps <= 0 || reps > 15 || weight <= 0) return 0;
  if (reps === 1) return Math.round(weight);
  return Math.round(weight * (1 + reps / 30));
}

/**
 * Confidence in an e1RM estimate, 0-1. Logged RPE → high confidence; assumed
 * RPE → lower. Very high rep counts erode confidence further (Epley is least
 * accurate there). Feeds the Athlete Model's overall confidence scoring.
 */
export function e1rmConfidence(reps: number, rpe?: number | null): number {
  let c = rpe != null ? 0.9 : 0.6;
  if (reps > 10) c -= 0.15;
  if (reps > 12) c -= 0.10;
  if (reps <= 5) c += 0.05; // Epley most accurate in the 1-5 range
  return Math.max(0.3, Math.min(1, c));
}
