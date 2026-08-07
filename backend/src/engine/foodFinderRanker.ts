// The situational ranker — decides whether this moment is about macros or
// micros, then ranks candidate foods against whatever it decided.
//
// The product rule is "macros first, then micros; but if macros are on track
// and micros are unbalanced, micros — it is situational". That is implemented
// as a BLEND (lambda), not a switch: even when macros dominate, micros still
// carry ~35% of the weight, so among the protein-dense options the iron-rich
// one wins. A hard switch would throw that away.
//
// Pure: no I/O, no Prisma, no LLM. Ingredient candidates and restaurant dishes
// arrive in the same shape and are scored by the same function, which is what
// lets them merge into one honest ranked list.

import { getNutrient } from './nutrientRegistry.js';
import { scoreAgainstGap, type GapVector } from './nutritionGap.js';
import type { DayRemaining, MacroKey, MicroRemaining } from '../services/nutritionRemaining.js';

export type FinderMode =
  | 'macro_priority'
  | 'balanced'
  | 'micro_priority'
  | 'tight_budget'
  | 'on_track';

export type Confidence = 'usda' | 'published' | 'estimated';

export interface Candidate {
  id: string;
  name: string;
  kind: 'ingredient' | 'takeout';
  /** Calories in the serving being proposed. */
  kcal: number;
  /** Nutrient key → amount in that serving. Macro keys included. */
  provides: Record<string, number>;
  /** Metres from the user. Null/undefined means "no distance known" → no penalty. */
  distanceM?: number | null;
  priceUsd?: number | null;
  confidence: Confidence;
  /** Opaque passthrough (vendor, serving text, source URL…). Never scored. */
  meta?: Record<string, unknown>;
}

export interface CloseLine {
  key: string;
  label: string;
  amount: number;
  unit: string;
  /** How much of the remaining gap this serving closes, 0..100. */
  pctOfRemaining: number;
}

export interface WarnLine {
  key: string;
  label: string;
  text: string;
}

export interface RankedCandidate extends Candidate {
  score: number;
  /** Score components, exposed so the replay script can explain a ranking. */
  gain: number;
  kcalFit: number;
  effort: number;
  overflow: number;
  confidenceFactor: number;
  closes: CloseLine[];
  warns: WarnLine[];
}

export interface Arbitration {
  mode: FinderMode;
  /** 0..1 weight on micros. 1-lambda goes to macros. */
  lambda: number;
  macroPressure: number;
  microPressure: number;
  /** True when calories are nearly spent but shortfalls remain. */
  leanOnly: boolean;
  /** One user-facing sentence explaining why this mode was chosen. */
  rationale: string;
}

// Protein is weighted hardest because it's the macro users actually miss and
// the one the coach cares about; carbs/fat are largely a consequence of the
// other three.
export const MACRO_W: Record<MacroKey, number> = {
  proteinG: 1.0,
  kcal: 0.7,
  carbsG: 0.4,
  fatG: 0.4,
};

const MACRO_W_SUM = Object.values(MACRO_W).reduce((a, b) => a + b, 0);

// Protein lives in BOTH the macro block and the nutrient registry. It is scored
// ONLY as a macro (the plan's coached target wins over the registry's per-kg
// floor), so it must be excluded from the micro half or it counts twice.
const MACRO_OWNED_KEYS = new Set<string>(['proteinG']);

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const clamp01 = (n: number) => clamp(n, 0, 1);
const round3 = (n: number) => Math.round(n * 1000) / 1000;

// ---------------------------------------------------------------------------
// Pressures
// ---------------------------------------------------------------------------

export function macroPressureOf(remaining: DayRemaining): number {
  let acc = 0;
  for (const key of Object.keys(MACRO_W) as MacroKey[]) {
    acc += MACRO_W[key] * remaining.macros[key].short;
  }
  const base = acc / MACRO_W_SUM;
  // A quarter of the day's protein still missing is a macro problem regardless
  // of how the other three look — without this floor, a user who has hit their
  // calories on low-protein food reads as "on track".
  const proteinShort = remaining.macros.proteinG.short;
  return proteinShort >= 0.25 ? Math.max(base, 0.6) : base;
}

/** Persistence- and focus-weighted urgency for one micronutrient. */
export function microWeightOf(m: MicroRemaining): number {
  return Math.min(3, 1 + (m.focus ? 1.0 : 0) + 0.15 * m.daysBelowTarget7d);
}

export function scorableMicros(remaining: DayRemaining): MicroRemaining[] {
  return remaining.micros.filter(m => !m.ceiling && !MACRO_OWNED_KEYS.has(m.key));
}

export function microPressureOf(remaining: DayRemaining): number {
  const micros = scorableMicros(remaining);
  if (micros.length === 0) return 0;

  let weighted = 0;
  let weightSum = 0;
  for (const m of micros) {
    // Normalise over the nutrients that are actually SHORT, not over all of
    // them. Averaging across the whole registry buries a single deep deficit:
    // one nutrient at zero among fifteen satisfied ones scored ~0.15 and could
    // never cross the micro-priority threshold, which is exactly the case the
    // feature exists to catch.
    if (m.short <= 0) continue;
    const w = microWeightOf(m);
    // The SQUARE is load-bearing. Nobody hits every RDA every day, so a broad
    // shallow shortfall is normal and should read as low pressure; one nutrient
    // at 20% is actionable and should dominate. Squaring gets that for free.
    weighted += w * m.short * m.short;
    weightSum += w;
  }
  return weightSum > 0 ? weighted / weightSum : 0;
}

// ---------------------------------------------------------------------------
// Arbitration
// ---------------------------------------------------------------------------

function rationaleFor(
  mode: FinderMode,
  remaining: DayRemaining,
  topMicros: MicroRemaining[],
): string {
  const kcalLeft = remaining.macros.kcal.remaining;
  const proteinLeft = remaining.macros.proteinG.remaining;
  const names = topMicros.slice(0, 2).map(m => m.label.toLowerCase());
  const microPhrase = names.length === 2 ? `${names[0]} and ${names[1]}` : names[0] ?? 'micronutrients';

  switch (mode) {
    case 'on_track':
      return 'Macros and micronutrients are both on track — nothing needs closing right now.';
    case 'tight_budget':
      return proteinLeft > 0
        ? `Only ${kcalLeft} kcal left but still ${proteinLeft} g of protein short — this needs lean, protein-dense food.`
        : `Only ${kcalLeft} kcal left, so this is about ${microPhrase} without spending calories.`;
    case 'macro_priority':
      return proteinLeft > 0
        ? `${proteinLeft} g of protein and ${kcalLeft} kcal still to go — macros lead.`
        : `${kcalLeft} kcal still to go — macros lead.`;
    case 'micro_priority':
      return `Macros are on pace, so this is about ${microPhrase}.`;
    default:
      return `Macros are partly closed — balancing what's left against ${microPhrase}.`;
  }
}

export function arbitrate(remaining: DayRemaining): Arbitration {
  const macroPressure = macroPressureOf(remaining);
  const microPressure = microPressureOf(remaining);

  let lambda = clamp(microPressure / (microPressure + macroPressure + 1e-6), 0.15, 0.85);
  let mode: FinderMode = 'balanced';

  if (macroPressure >= 0.35) {
    lambda = Math.min(lambda, 0.35);
    mode = 'macro_priority';
  }
  if (macroPressure < 0.15 && microPressure >= 0.25) {
    lambda = Math.max(lambda, 0.75);
    mode = 'micro_priority';
  }

  // Calories nearly spent but shortfalls remain — the case that makes a naive
  // ranker propose an 800 kcal burrito to close 40 g of protein.
  const kcalTarget = remaining.macros.kcal.target;
  const kcalLeft = remaining.macros.kcal.remaining;
  const leanOnly =
    kcalTarget > 0 &&
    kcalLeft < 0.15 * kcalTarget &&
    (remaining.macros.proteinG.short > 0.15 || microPressure > 0.2);
  if (leanOnly) mode = 'tight_budget';

  // Checked last so it wins: nothing meaningful is open, so the honest answer
  // is to recommend nothing at all.
  if (macroPressure < 0.12 && microPressure < 0.15) mode = 'on_track';

  const topMicros = [...scorableMicros(remaining)]
    .filter(m => m.short > 0)
    .sort((a, b) => microWeightOf(b) * b.short - microWeightOf(a) * a.short);

  return {
    mode,
    lambda: round3(lambda),
    macroPressure: round3(macroPressure),
    microPressure: round3(microPressure),
    leanOnly,
    rationale: rationaleFor(mode, remaining, topMicros),
  };
}

// ---------------------------------------------------------------------------
// Gap vector
// ---------------------------------------------------------------------------

/**
 * Blend macro and micro gaps into one vector the shared scorer understands.
 *
 * Macro weights are scaled by (1-lambda), micro weights by lambda, so the
 * arbitration decides what "closing a gap" is worth without the scorer needing
 * to know anything about modes.
 */
export function buildFinderGap(remaining: DayRemaining, arb: Arbitration): GapVector {
  const gap: GapVector = new Map();

  for (const key of Object.keys(MACRO_W) as MacroKey[]) {
    const m = remaining.macros[key];
    if (m.remaining <= 0 || m.short <= 0) continue;
    gap.set(key, {
      key,
      label: m.label,
      remaining: m.remaining,
      weight: (1 - arb.lambda) * MACRO_W[key] * m.short,
    });
  }

  const micros = scorableMicros(remaining);
  const weightSum = micros.reduce((s, m) => s + microWeightOf(m), 0) || 1;
  for (const m of micros) {
    if (m.remaining <= 0 || m.short <= 0) continue;
    gap.set(m.key, {
      key: m.key,
      label: m.label,
      remaining: m.remaining,
      weight: arb.lambda * (microWeightOf(m) / weightSum) * m.short,
    });
  }

  return gap;
}

// ---------------------------------------------------------------------------
// Calorie fit
// ---------------------------------------------------------------------------

/**
 * How well a candidate fits the calories that are actually left.
 *
 * A MULTIPLIER, not an additive penalty — that is the whole point. An additive
 * term can be out-argued by a large nutrient gain, so a 900 kcal burrito would
 * still win when 200 kcal remain. As a multiplier it cannot: with 200 kcal left,
 * a 900 kcal item scores ~0.035x while a 120 kcal item scores 1.0x.
 *
 * With no calories left the curve switches to pure kcal-efficiency rather than
 * returning 0 for everything — the user still has to eat something to close a
 * protein or iron gap, and we should rank the cheapest way to do it.
 */
export function fitCurve(kcal: number, remainingKcal: number): number {
  if (!Number.isFinite(kcal) || kcal <= 0) return 1;
  if (remainingKcal <= 0) return 1 / (1 + kcal / 150);
  const r = kcal / remainingKcal;
  if (r <= 1.0) return 1;
  if (r <= 1.25) return 0.7; // a modest overshoot is a real option, not a failure
  return 0.7 / (r * r);
}

const CONFIDENCE_FACTOR: Record<Confidence, number> = {
  usda: 1.0,
  published: 0.85,
  estimated: 0.7,
};

/** Distance decay. 3 km is the half-ish point; unknown distance is not penalised. */
export function effortFactor(distanceM?: number | null): number {
  if (distanceM == null || !Number.isFinite(distanceM) || distanceM <= 0) return 1;
  return 1 / (1 + distanceM / 3000);
}

// ---------------------------------------------------------------------------
// Ceilings
// ---------------------------------------------------------------------------

/**
 * Penalty for what a candidate spends of the day's remaining ceiling headroom.
 *
 * This is the takeout path's guardrail. Restaurant food is the sodium problem,
 * and the legacy recommender simply skips ceiling nutrients — a scorer that
 * ignores sodium will confidently recommend the worst item on the menu. The
 * weight scales with how little headroom is left, so it is near-zero at
 * breakfast and severe at 2,100 of 2,300 mg.
 */
export function overflowOf(
  provides: Record<string, number>,
  remaining: DayRemaining,
): { overflow: number; warns: WarnLine[] } {
  let overflow = 0;
  const warns: WarnLine[] = [];

  for (const m of remaining.micros) {
    if (!m.ceiling) continue;
    const amount = provides[m.key];
    if (!Number.isFinite(amount) || !amount || amount <= 0) continue;

    const headroom = m.headroom;
    const target = m.target || 1;
    // Burden is measured against the DAILY CAP, not against remaining headroom.
    // Using headroom made trivially-small amounts look catastrophic once the cap
    // was nearly spent — 90 mg of sodium against 100 mg of headroom scored as
    // "90% of what's left" and buried a genuinely clean option. Absolute burden
    // is the honest quantity; scarcity only amplifies it.
    const burden = amount / target;
    const scarcity = clamp01(1 - headroom / target);
    overflow += burden * (1 + 2 * scarcity);

    const pctOfCap = Math.round((amount / target) * 100);
    if (headroom <= 0) {
      warns.push({
        key: m.key,
        label: m.label,
        text: `Already over your ${m.label.toLowerCase()} cap for today — this adds ${Math.round(amount)} ${m.unit} more.`,
      });
    } else if (amount >= headroom * 0.5) {
      warns.push({
        key: m.key,
        label: m.label,
        text: `~${Math.round(amount)} ${m.unit} ${m.label.toLowerCase()} — ${pctOfCap}% of your daily cap, and most of what you have left.`,
      });
    }
  }

  return { overflow, warns };
}

const CEILING_WEIGHT = 0.35;

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

function closeLinesFor(
  provides: Record<string, number>,
  gap: GapVector,
  limit = 3,
): CloseLine[] {
  const lines: (CloseLine & { contribution: number })[] = [];
  for (const [key, amount] of Object.entries(provides)) {
    const g = gap.get(key);
    if (!g || !Number.isFinite(amount) || amount <= 0) continue;
    const frac = Math.min(1, amount / g.remaining);
    const def = getNutrient(key);
    lines.push({
      key,
      label: g.label,
      amount: Math.round(amount * 10) / 10,
      unit: def?.unit ?? (key === 'kcal' ? 'kcal' : 'g'),
      pctOfRemaining: Math.round(frac * 100),
      contribution: frac * g.weight,
    });
  }
  return lines
    .sort((a, b) => b.contribution - a.contribution)
    .slice(0, limit)
    .map(({ contribution: _c, ...line }) => line);
}

export function scoreCandidate(
  candidate: Candidate,
  gap: GapVector,
  remaining: DayRemaining,
  _arb: Arbitration,
): RankedCandidate {
  // Calories participate in the gain term (being 1,200 kcal short is a real gap)
  // while fitCurve independently punishes overshoot. The two are complementary,
  // not redundant: gain rewards filling the hole, fit forbids blowing past it.
  const provides = { ...candidate.provides };
  if (candidate.kcal > 0 && provides.kcal == null) provides.kcal = candidate.kcal;

  const { score: gain } = scoreAgainstGap(provides, gap);
  const kcalFit = fitCurve(candidate.kcal, remaining.macros.kcal.remaining);
  const effort = effortFactor(candidate.distanceM);
  const confidenceFactor = CONFIDENCE_FACTOR[candidate.confidence] ?? 0.7;
  const { overflow, warns } = overflowOf(provides, remaining);

  const score = gain * kcalFit * effort * confidenceFactor - CEILING_WEIGHT * overflow;

  return {
    ...candidate,
    score: round3(score),
    gain: round3(gain),
    kcalFit: round3(kcalFit),
    effort: round3(effort),
    overflow: round3(overflow),
    confidenceFactor,
    closes: closeLinesFor(provides, gap),
    warns,
  };
}

// ---------------------------------------------------------------------------
// Diversity + ranking
// ---------------------------------------------------------------------------

const signatureOf = (c: RankedCandidate): string =>
  `${c.kind}:${c.closes.map(l => l.key).sort().join(',')}`;

/**
 * Drop near-duplicates, then guarantee both paths are represented.
 *
 * Without the second step a strong takeout list crowds out groceries entirely
 * (or vice versa), which defeats the point — the user asked for both to coexist,
 * not to pick a lane up front.
 */
export function diversify(
  ranked: RankedCandidate[],
  limit: number,
  guaranteeBothKinds = true,
): RankedCandidate[] {
  const seen = new Set<string>();
  const picked: RankedCandidate[] = [];

  for (const c of ranked) {
    const sig = signatureOf(c);
    if (seen.has(sig)) continue;
    seen.add(sig);
    picked.push(c);
    if (picked.length >= limit) break;
  }

  if (guaranteeBothKinds && picked.length >= 2) {
    const kinds = new Set(picked.map(c => c.kind));
    const missing = (['ingredient', 'takeout'] as const).find(k => !kinds.has(k));
    if (missing) {
      const best = ranked.find(c => c.kind === missing && !picked.includes(c));
      // Displace the weakest pick rather than growing past the caller's limit.
      if (best) picked.splice(picked.length - 1, 1, best);
    }
  }

  return picked;
}

export interface RankOptions {
  limit?: number;
  /** Skip the both-kinds guarantee when the caller asked for a single path. */
  guaranteeBothKinds?: boolean;
}

export interface RankResult {
  arbitration: Arbitration;
  results: RankedCandidate[];
}

export function rankCandidates(
  candidates: Candidate[],
  remaining: DayRemaining,
  opts: RankOptions = {},
): RankResult {
  const limit = clamp(opts.limit ?? 6, 1, 20);
  const arbitration = arbitrate(remaining);

  // A recommender that knows when to shut up is the differentiator, not a bug —
  // the previous suggestion surface was deleted for being noisy.
  if (arbitration.mode === 'on_track') return { arbitration, results: [] };

  const gap = buildFinderGap(remaining, arbitration);
  if (gap.size === 0) return { arbitration, results: [] };

  const scored = candidates
    .map(c => scoreCandidate(c, gap, remaining, arbitration))
    .filter(c => c.score > 0)
    .sort((a, b) => b.score - a.score);

  return {
    arbitration,
    results: diversify(scored, limit, opts.guaranteeBothKinds ?? true),
  };
}
