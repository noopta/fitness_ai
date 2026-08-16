// Nutrition Profile engine — the deterministic core behind the effects-first
// Nutrition Profile screen (see "Axiom nutrition profiling designs" §8). It
// turns a day's logged meals into a body-system read: per-system status,
// contributing-nutrient coverage, a 0–100 profile score, and ranked
// recommendations to close the day's gaps.
//
// NO LLM here. This computes the numbers; the route layer hands them to the
// model only to phrase the headline/driver/why sentences, and those must stay
// grounded in these figures (§8 engine note: never a claim without a number).
//
// Everything is driven by the open nutrient registry — the number of tracked
// nutrients is not fixed anywhere in this file.

import {
  NUTRIENTS, BODY_SYSTEMS, driversForSystem, getNutrient,
  type BodySystemId, type NutrientDef,
} from './nutrientRegistry.js';

export type Status = 'ok' | 'warn' | 'low';

export interface ProfileEngineInput {
  // Summed nutrient totals for the day (open map, any keys).
  totals: Record<string, number>;
  bodyweightKg?: number | null;
  mealsLogged: number;
}

export interface NutrientCoverage {
  key: string;
  label: string;
  unit: string;
  amount: number;
  target: number;
  pct: number;       // 0..(capped 150) percent of target
  status: Status;
  ceiling: boolean;  // true when over-target is the bad direction
}

export interface SystemDriverLine {
  key: string;
  label: string;
  pct: number;
  status: Status;
  tracked: boolean;  // has a registry row → tappable to Nutrient Detail
}

export interface BodySystemScore {
  id: BodySystemId;
  name: string;
  status: Status;
  score: number;             // 0..100 for the system
  drivers: SystemDriverLine[];
  chips: string[];           // up to 3 "Label 52%" contributor chips
  topDriverKey: string | null;
}

export interface ProfileEngineOutput {
  kcalLogged: number;
  microCoveragePct: number;  // 0..100 across tracked floor nutrients
  profileScore: number;      // 0..100
  systems: BodySystemScore[];
  coverage: NutrientCoverage[];   // every tracked nutrient, sorted worst-first
  extras: { key: string; amount: number }[]; // logged nutrients with no registry row
}

// Effective daily target for a nutrient, applying the per-kg floor when set.
export function effectiveTarget(def: NutrientDef, bodyweightKg?: number | null): number {
  if (def.perKgTarget && bodyweightKg && bodyweightKg > 0) {
    return Math.max(def.target, def.perKgTarget * bodyweightKg);
  }
  return def.target;
}

// Percent-of-target for one nutrient, and its status. For ceiling nutrients
// (sodium, added sugar…) the semantics invert: at/under target is good, well
// over is low.
function scoreNutrient(def: NutrientDef, amount: number, bodyweightKg?: number | null): NutrientCoverage {
  const target = effectiveTarget(def, bodyweightKg);
  const isCeiling = def.drives.some(d => d.direction === 'ceiling');
  const rawPct = target > 0 ? (amount / target) * 100 : 0;
  const pct = Math.round(Math.min(rawPct, 150));

  let status: Status;
  if (isCeiling) {
    // Under target good; 100–150% warn; >150% low.
    if (rawPct <= 100) status = 'ok';
    else if (rawPct <= 150) status = 'warn';
    else status = 'low';
  } else {
    if (rawPct >= 90) status = 'ok';
    else if (rawPct >= 50) status = 'warn';
    else status = 'low';
  }

  return {
    key: def.key, label: def.label, unit: def.unit,
    amount: Math.round(amount * 100) / 100,
    target: Math.round(target * 100) / 100,
    pct, status, ceiling: isCeiling,
  };
}

// A nutrient's 0..1 contribution to a system score. Floors reward hitting the
// target (capped at 1); ceilings penalize overshoot.
function contribution(cov: NutrientCoverage): number {
  if (cov.ceiling) {
    if (cov.pct <= 100) return 1;
    if (cov.pct <= 150) return 0.5;
    return 0.15;
  }
  return Math.min(1, cov.pct / 100);
}

const STATUS_FROM_SCORE = (s: number): Status => (s >= 75 ? 'ok' : s >= 45 ? 'warn' : 'low');

export function runNutritionProfileEngine(input: ProfileEngineInput): ProfileEngineOutput {
  const { totals, bodyweightKg } = input;

  // Per-nutrient coverage for every registry nutrient present or targeted.
  const coverageByKey = new Map<string, NutrientCoverage>();
  for (const def of NUTRIENTS) {
    const amount = totals[def.key] ?? 0;
    coverageByKey.set(def.key, scoreNutrient(def, amount, bodyweightKg));
  }

  // Body-system rollup: weighted mean of each system's driver contributions.
  const systems: BodySystemScore[] = BODY_SYSTEMS.map(({ id, name }) => {
    const drivers = driversForSystem(id);
    let weightSum = 0;
    let acc = 0;
    const driverLines: SystemDriverLine[] = [];
    for (const { def, driver } of drivers) {
      const cov = coverageByKey.get(def.key)!;
      acc += contribution(cov) * driver.weight;
      weightSum += driver.weight;
      driverLines.push({
        key: def.key, label: def.label, pct: cov.pct, status: cov.status, tracked: true,
      });
    }
    const score = weightSum > 0 ? Math.round((acc / weightSum) * 100) : 0;
    // Worst floor-driver first for the chip/driver ordering (that's the lever).
    driverLines.sort((a, b) => a.pct - b.pct);
    const chips = driverLines
      .filter(d => {
        const def = getNutrient(d.key);
        return def && !def.drives.some(x => x.direction === 'ceiling');
      })
      .slice(0, 3)
      .map(d => `${getNutrient(d.key)?.label ?? d.label} ${d.pct}%`);
    return {
      id, name,
      status: STATUS_FROM_SCORE(score),
      score,
      drivers: driverLines,
      chips,
      topDriverKey: driverLines[0]?.key ?? null,
    };
  });

  // Micronutrient coverage %: mean percent-of-target across FLOOR nutrients
  // (ceilings aren't "coverage"), capped at 100 each so a mega-dose doesn't
  // mask a gap elsewhere.
  const floorCovs = [...coverageByKey.values()].filter(c => !c.ceiling);
  const microCoveragePct = floorCovs.length > 0
    ? Math.round(floorCovs.reduce((s, c) => s + Math.min(100, c.pct), 0) / floorCovs.length)
    : 0;

  // Profile score (spec §11 placeholder): coverage-weighted mean of system
  // scores, then capped by the worst system so one failing system can't hide
  // behind strong ones. Labeled as provisional in the API.
  const meanSystem = systems.length > 0
    ? Math.round(systems.reduce((s, sys) => s + sys.score, 0) / systems.length)
    : 0;
  const worstSystem = systems.length > 0 ? Math.min(...systems.map(s => s.score)) : 0;
  const profileScore = Math.round(meanSystem * 0.7 + worstSystem * 0.3);

  // Extras: nutrients the user logged that have no registry row yet — surfaced
  // so nothing relevant in their food is hidden (open-vector promise).
  const registryKeys = new Set(NUTRIENTS.map(n => n.key));
  const extras = Object.entries(totals)
    // `calories` is the synthetic day-total key, not a nutrient — never an extra.
    .filter(([k, v]) => k !== 'calories' && !registryKeys.has(k) && typeof v === 'number' && v > 0)
    .map(([key, amount]) => ({ key, amount: Math.round(amount * 100) / 100 }))
    .sort((a, b) => b.amount - a.amount);

  const coverage = [...coverageByKey.values()].sort((a, b) => a.pct - b.pct);

  return {
    kcalLogged: Math.round(totals.calories ?? 0),
    microCoveragePct,
    profileScore,
    systems,
    coverage,
    extras,
  };
}

// Sum an array of per-meal open nutrient maps into a single day total,
// including a synthetic `calories` key from the meal rows.
export function sumNutrientMaps(
  maps: Array<Record<string, number> | null | undefined>,
  calories: number[],
): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const map of maps) {
    if (!map) continue;
    for (const [key, value] of Object.entries(map)) {
      if (typeof value === 'number' && Number.isFinite(value)) totals[key] = (totals[key] ?? 0) + value;
    }
  }
  const kcal = calories.reduce((s, c) => s + (Number.isFinite(c) ? c : 0), 0);
  if (kcal > 0) totals.calories = kcal;
  return totals;
}

// Mean daily intake across a window's LOGGED days. The engine's targets are
// DAILY (see effectiveTarget), so a window has to be averaged, never summed —
// summing 30 days would put every floor nutrient at ~3000%, clamp to 150 in
// scoreNutrient, and pin every body system at 100.
//
// Divisor is the number of DAY totals passed in, not the number of keys and not
// the number of meals. Callers pass one entry per logged day; a nutrient absent
// from a given day counts as 0 for that day, which is deliberate — a day where
// only a coffee was logged really did contribute no protein.
export function averageNutrientMaps(
  dayTotals: Array<Record<string, number>>,
): Record<string, number> {
  const days = dayTotals.length;
  if (days === 0) return {};

  const sums: Record<string, number> = {};
  for (const day of dayTotals) {
    for (const [key, value] of Object.entries(day)) {
      if (typeof value === 'number' && Number.isFinite(value)) sums[key] = (sums[key] ?? 0) + value;
    }
  }

  const avg: Record<string, number> = {};
  for (const [key, total] of Object.entries(sums)) avg[key] = total / days;
  return avg;
}
