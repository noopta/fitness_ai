// Derived strength metrics — the diagnostic layer of the Athlete Model.
// Turns a user's lift e1RMs + bodyweight into the science-backed numbers a
// good coach computes automatically: strength ratios with healthy bands,
// relative-strength standards, and antagonist balance. The Insight Engine
// (Phase 4) consumes these to flag what's out of band.
//
// Pure + deterministic. Caller supplies e1RMs (kg) keyed by canonical lift.

export interface LiftE1rm {
  canonicalName: string;
  e1rmKg: number;
}

// ─── Strength ratio catalog ──────────────────────────────────────────────────
// Each ratio names two lifts, a healthy band, and a one-line fix. Bands are
// drawn from strength-standard literature (these aren't proprietary — they're
// the conventional balanced-development targets coaches use).

interface RatioDef {
  id: string;
  name: string;
  numerator: string;    // canonical lift
  denominator: string;  // canonical lift
  band: [number, number];
  /** What it means + the fix when the ratio drifts ABOVE the band. */
  highDrift: string;
  /** What it means + the fix when the ratio drifts BELOW the band. */
  lowDrift: string;
}

const RATIO_CATALOG: RatioDef[] = [
  {
    id: 'bench-row',
    name: 'Bench : Row',
    numerator: 'Bench Press', denominator: 'Barbell Row',
    band: [1.0, 1.1],
    highDrift: 'Pressing has outpaced pulling — add a row variation, your posterior shoulder is at risk.',
    lowDrift: 'Pulling is ahead of pressing — uncommon, but fine; no action needed.',
  },
  {
    id: 'bench-ohp',
    name: 'Bench : Overhead Press',
    numerator: 'Bench Press', denominator: 'Overhead Press',
    band: [1.45, 1.55],
    highDrift: 'Horizontal press has outpaced vertical — add overhead work; likely upper-back / mobility limited.',
    lowDrift: 'Overhead press is strong relative to bench — keep it up, this is a healthy shoulder pattern.',
  },
  {
    id: 'squat-deadlift',
    name: 'Squat : Deadlift',
    numerator: 'Squat', denominator: 'Deadlift',
    band: [0.8, 0.85],
    highDrift: 'Squat is high relative to deadlift — your posterior chain may be the lagging link.',
    lowDrift: 'Deadlift dominates the squat — hip-dominant build, or quads are lagging. Add front-loaded squats.',
  },
  {
    id: 'frontsquat-backsquat',
    name: 'Front Squat : Back Squat',
    numerator: 'Front Squat', denominator: 'Squat',
    band: [0.8, 0.85],
    highDrift: 'Front squat unusually close to back squat — strong upper back, nothing to fix.',
    lowDrift: 'Front squat lags — thoracic / upper-back is the limiter. Add front-rack work.',
  },
  {
    id: 'rdl-deadlift',
    name: 'Romanian DL : Deadlift',
    numerator: 'Romanian Deadlift', denominator: 'Deadlift',
    band: [0.7, 0.8],
    highDrift: 'RDL very close to deadlift — strong hamstrings, healthy.',
    lowDrift: "You're a hinge avoider — hamstring strength lags. Add RDLs twice a week.",
  },
];

export type RatioStatus = 'in-band' | 'high' | 'low' | 'no-data';

export interface RatioResult {
  id: string;
  name: string;
  value: number | null;
  band: [number, number];
  status: RatioStatus;
  /** Severity 0-1 — how far outside the band (0 = in band). */
  severity: number;
  note: string;
}

function e1rmOf(lifts: Map<string, number>, name: string): number {
  return lifts.get(name) ?? 0;
}

/** Compute every ratio in the catalog against the user's e1RMs. */
export function computeRatios(e1rms: LiftE1rm[]): RatioResult[] {
  const map = new Map(e1rms.map((l) => [l.canonicalName, l.e1rmKg]));
  return RATIO_CATALOG.map((def) => {
    const num = e1rmOf(map, def.numerator);
    const den = e1rmOf(map, def.denominator);
    if (num <= 0 || den <= 0) {
      return {
        id: def.id, name: def.name, value: null, band: def.band,
        status: 'no-data' as const, severity: 0,
        note: `Log ${num <= 0 ? def.numerator : def.denominator} to unlock this ratio.`,
      };
    }
    const value = Math.round((num / den) * 100) / 100;
    const [lo, hi] = def.band;
    let status: RatioStatus = 'in-band';
    let severity = 0;
    let note = 'In the balanced range — no action needed.';
    if (value > hi) {
      status = 'high';
      severity = Math.min(1, (value - hi) / hi);
      note = def.highDrift;
    } else if (value < lo) {
      status = 'low';
      severity = Math.min(1, (lo - value) / lo);
      note = def.lowDrift;
    }
    return { id: def.id, name: def.name, value, band: def.band, status, severity, note };
  });
}

// ─── Relative strength ───────────────────────────────────────────────────────
// e1RM as a multiple of bodyweight, with rough proficiency tiers. Tiers are
// directional, not gospel — surfaced so a user sees "1.5× BW bench" framed
// against a standard rather than as a bare number.

interface RelStrengthDef {
  lift: string;
  // [novice, intermediate, advanced, elite] BW multiples
  tiers: [number, number, number, number];
}

const REL_STRENGTH: RelStrengthDef[] = [
  { lift: 'Bench Press', tiers: [0.75, 1.0, 1.5, 2.0] },
  { lift: 'Squat',       tiers: [1.0, 1.5, 2.0, 2.5] },
  { lift: 'Deadlift',    tiers: [1.25, 1.75, 2.5, 3.0] },
  { lift: 'Overhead Press', tiers: [0.45, 0.65, 0.9, 1.1] },
];

export type RelStrengthTier = 'untested' | 'novice' | 'intermediate' | 'advanced' | 'elite';

export interface RelStrengthResult {
  lift: string;
  ratioToBw: number | null;
  tier: RelStrengthTier;
}

export function computeRelativeStrength(e1rms: LiftE1rm[], bodyweightKg: number): RelStrengthResult[] {
  const map = new Map(e1rms.map((l) => [l.canonicalName, l.e1rmKg]));
  return REL_STRENGTH.map((def) => {
    const e1rm = map.get(def.lift) ?? 0;
    if (e1rm <= 0 || bodyweightKg <= 0) {
      return { lift: def.lift, ratioToBw: null, tier: 'untested' as const };
    }
    const ratio = Math.round((e1rm / bodyweightKg) * 100) / 100;
    const [n, i, a, e] = def.tiers;
    let tier: RelStrengthTier = 'novice';
    if (ratio >= e) tier = 'elite';
    else if (ratio >= a) tier = 'advanced';
    else if (ratio >= i) tier = 'intermediate';
    else if (ratio >= n) tier = 'novice';
    else tier = 'novice';
    return { lift: def.lift, ratioToBw: ratio, tier };
  });
}

// ─── Antagonist balance ──────────────────────────────────────────────────────
// Without per-side logging we can't do true left/right symmetry, so "balance"
// here is the strength match across antagonist muscle pairs. A pair badly
// out of balance is an injury-risk + plateau signal.

interface BalancePairDef {
  id: string;
  name: string;
  muscleA: string;  // MuscleGroup name
  muscleB: string;
  /** Healthy A:B score ratio band. */
  band: [number, number];
}

const BALANCE_PAIRS: BalancePairDef[] = [
  { id: 'push-pull-delt', name: 'Front vs Rear Delt', muscleA: 'Front Delt', muscleB: 'Rear Delt', band: [0.85, 1.3] },
  { id: 'quad-ham', name: 'Quads vs Hamstrings', muscleA: 'Quads', muscleB: 'Hamstrings', band: [1.0, 1.4] },
  { id: 'chest-back', name: 'Chest vs Mid-back', muscleA: 'Chest', muscleB: 'Mid-back', band: [0.85, 1.2] },
];

export interface BalanceResult {
  id: string;
  name: string;
  ratio: number | null;
  band: [number, number];
  status: RatioStatus;
  severity: number;
}

export function computeBalance(muscleScores: Record<string, number>): BalanceResult[] {
  return BALANCE_PAIRS.map((def) => {
    const a = muscleScores[def.muscleA] ?? 0;
    const b = muscleScores[def.muscleB] ?? 0;
    if (a <= 0 || b <= 0) {
      return { id: def.id, name: def.name, ratio: null, band: def.band, status: 'no-data' as const, severity: 0 };
    }
    const ratio = Math.round((a / b) * 100) / 100;
    const [lo, hi] = def.band;
    let status: RatioStatus = 'in-band';
    let severity = 0;
    if (ratio > hi) { status = 'high'; severity = Math.min(1, (ratio - hi) / hi); }
    else if (ratio < lo) { status = 'low'; severity = Math.min(1, (lo - ratio) / lo); }
    return { id: def.id, name: def.name, ratio, band: def.band, status, severity };
  });
}
