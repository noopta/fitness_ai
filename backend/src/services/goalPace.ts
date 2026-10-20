// Weight goals: the safest route that gets there, and what each pace costs
// (Oct 2026). Every user with a weight goal and a date gets the optimal route
// first, with an accurate timeline. A faster route the user prefers is allowed
// with one clear warning as long as it's safe; anything unsafe is never
// offered — with the earliest safe date instead ("30 lb in 3 days" gets "about
// 15 weeks at a safe pace").
//
// Rates are % of body weight per week, the unit the evidence uses:
//   ≤ 0.7%   recommended — keeps lean mass and power (Garthe et al. 2011:
//            ~0.7%/wk preserved LBM and power in elite athletes; ~1.4%/wk lost both)
//   ≤ 1.0%   acceptable — the upper end of the sports-nutrition consensus
//            for athletes (Helms et al. 2014; Reale et al. 2017, combat sports)
//   ≤ 1.5%   aggressive — only against a real deadline, with a warning:
//            expect some strength/power, recovery and hunger cost
//   > 1.5%   unsafe — not offered
// Combat sports: the acute cut before weigh-in (water/sodium/gut content) is
// kept ≤ 5% of body weight when the weigh-in is the day before; 5–8% gets a
// warning; > 8% is unsafe (Reale et al. 2017; Barley et al. 2019).
// Energy: ~7,700 kcal per kg of tissue lost; intake never goes under the
// calorie floor (nutritionSafety), whatever the pace.

export type PaceBand = 'recommended' | 'acceptable' | 'aggressive' | 'unsafe';
export const BAND_MAX: Record<Exclude<PaceBand, 'unsafe'>, number> = { recommended: 0.007, acceptable: 0.01, aggressive: 0.015 };
export const KCAL_PER_KG = 7700;
export const ACUTE = { ok: 0.05, warn: 0.08 } as const;

const DAY = 86_400_000;
const t = (d: string) => Date.parse(`${d}T12:00:00Z`);
export const addDays = (d: string, n: number) => new Date(t(d) + n * DAY).toISOString().slice(0, 10);
export const weeksBetween = (a: string, b: string) => Math.max(0, (t(b) - t(a)) / (7 * DAY));

export function bandFor(pctPerWeek: number): PaceBand {
  const p = Math.abs(pctPerWeek);
  if (p <= BAND_MAX.recommended + 1e-9) return 'recommended';
  if (p <= BAND_MAX.acceptable + 1e-9) return 'acceptable';
  if (p <= BAND_MAX.aggressive + 1e-9) return 'aggressive';
  return 'unsafe';
}

export interface PaceInput {
  today: string;
  currentKg: number;
  /** The weight to reach by `byDate` (for a weigh-in: the walk-around target before the acute cut). */
  targetKg: number;
  byDate: string;
  /** Estimated maintenance intake (kcal/day). */
  tdee: number;
  /** Calorie floor (kcal/day) — never planned under. */
  floorKcal: number;
  /** Weigh-in sports: the limit, so the acute cut each route leaves can be shown. */
  weighIn?: { limitKg: number; date: string } | null;
}

export interface PaceOption {
  band: PaceBand;
  label: string;
  /** % of body weight per week (negative = loss). */
  pctPerWeek: number;
  kgPerWeek: number;
  kcal: number;
  /** The intake the pace needs is under the floor: planned at the floor instead, and the pace is slower. */
  floored: boolean;
  /** Projected weight on byDate at this pace. */
  kgOnDate: number;
  /** When the target is reached at this pace. */
  reachesOn: string;
  /** Weigh-in sports: the acute cut left on the day, as a fraction of body weight. */
  acuteFraction?: number;
}

export interface PacePlan {
  direction: 'loss' | 'gain' | 'hold';
  weeks: number;
  /** The pace the target and date require. */
  required: { pctPerWeek: number; kgPerWeek: number; band: PaceBand };
  /** The best safe route: the slowest band that still meets the target on time, else the fastest safe one. */
  recommended: PaceOption;
  /** Every safe option, slowest first (unsafe ones are never listed). */
  options: PaceOption[];
  /** The target can't be reached by the date at a safe pace. */
  unreachableSafely: boolean;
  /** Earliest date the target is reached at the acceptable pace (the honest timeline when it isn't safe by the date). */
  earliestSafeDate: string;
  /** One-line verdicts the agent words for the user. */
  notes: string[];
}

const r1 = (v: number) => Math.round(v * 10) / 10;

/** Pure: plan a weight goal. */
export function planPace(i: PaceInput): PacePlan {
  const weeks = weeksBetween(i.today, i.byDate);
  const delta = i.targetKg - i.currentKg;
  const direction: PacePlan['direction'] = Math.abs(delta) < 0.25 ? 'hold' : delta < 0 ? 'loss' : 'gain';
  const sign = delta < 0 ? -1 : 1;
  const reqKgWk = weeks > 0 ? delta / weeks : delta * 1e6;
  const reqPct = reqKgWk / i.currentKg;
  const reqBand: PaceBand = weeks <= 0 && direction !== 'hold' ? 'unsafe' : direction === 'gain' ? (Math.abs(reqPct) <= 0.005 ? 'recommended' : Math.abs(reqPct) <= 0.0075 ? 'acceptable' : 'unsafe') : bandFor(reqPct);

  const option = (band: PaceBand, label: string, pct: number): PaceOption => {
    let kgWk = pct * i.currentKg;
    let kcal = Math.round(i.tdee + (kgWk * KCAL_PER_KG) / 7);
    let floored = false;
    if (kcal < i.floorKcal) { floored = true; kcal = i.floorKcal; kgWk = ((kcal - i.tdee) * 7) / KCAL_PER_KG; pct = kgWk / i.currentKg; }
    const kgOnDate = direction === 'hold' ? i.currentKg : sign < 0 ? Math.max(i.targetKg, i.currentKg + kgWk * weeks) : Math.min(i.targetKg, i.currentKg + kgWk * weeks);
    const wksToTarget = kgWk !== 0 ? (i.targetKg - i.currentKg) / kgWk : Infinity;
    const o: PaceOption = { band, label, pctPerWeek: Math.round(pct * 10000) / 10000, kgPerWeek: r1(kgWk), kcal, floored, kgOnDate: r1(kgOnDate), reachesOn: Number.isFinite(wksToTarget) && wksToTarget >= 0 ? addDays(i.today, Math.ceil(wksToTarget * 7)) : i.byDate };
    if (i.weighIn) o.acuteFraction = Math.max(0, Math.round(((kgOnDate - i.weighIn.limitKg) / kgOnDate) * 1000) / 1000);
    return o;
  };

  const options: PaceOption[] = [];
  if (direction === 'loss') {
    options.push(option('recommended', 'Recommended (~0.7%/wk)', -BAND_MAX.recommended));
    options.push(option('acceptable', 'Faster (~1%/wk)', -BAND_MAX.acceptable));
    options.push(option('aggressive', 'Aggressive (~1.5%/wk, deadline only)', -BAND_MAX.aggressive));
  } else if (direction === 'gain') {
    options.push(option('recommended', 'Lean gain (~0.25%/wk)', 0.0025));
    options.push(option('acceptable', 'Faster gain (~0.5%/wk)', 0.005));
  } else {
    options.push(option('recommended', 'Maintain', 0));
  }
  // The exact pace the date needs, when that's safe and between the fixed bands.
  if (direction !== 'hold' && reqBand !== 'unsafe') {
    const exact = option(reqBand, 'Exactly on time', reqPct);
    if (!options.some((o) => Math.abs(o.pctPerWeek - exact.pctPerWeek) < 0.0005)) options.push(exact);
  }
  options.sort((a, b) => Math.abs(a.pctPerWeek) - Math.abs(b.pctPerWeek));

  const meets = (o: PaceOption) => Math.abs(o.kgOnDate - i.targetKg) < 0.3;
  const onTime = options.filter(meets);
  const recommended = onTime[0] ?? options[options.length - 1];
  const unreachableSafely = direction !== 'hold' && !onTime.length;

  const accKgWk = (direction === 'gain' ? 0.005 : -BAND_MAX.acceptable) * i.currentKg;
  const earliestSafeDate = direction === 'hold' ? i.today : addDays(i.today, Math.ceil(((i.targetKg - i.currentKg) / accKgWk) * 7));

  const notes: string[] = [];
  if (unreachableSafely) notes.push(`Not safely reachable by ${i.byDate}: it needs ${r1(Math.abs(reqPct) * 100)}% of body weight a week. At a safe pace it's about ${earliestSafeDate}.`);
  else if (recommended.band === 'aggressive') notes.push('Only reachable at an aggressive pace — workable against a real deadline, but expect some strength, power and recovery cost; protein high, training kept heavy.');
  if (recommended.floored) notes.push('The intake this pace needs is under the safe calorie floor, so it is planned at the floor and runs slower — more training output or a later date closes the gap.');
  if (i.weighIn && recommended.acuteFraction != null) {
    const a = recommended.acuteFraction;
    if (a > ACUTE.warn) notes.push(`That leaves a ${r1(a * 100)}% acute cut for the weigh-in — over the ~8% limit; lose more before fight week or move up a class.`);
    else if (a > ACUTE.ok) notes.push(`That leaves a ${r1(a * 100)}% acute cut — above the ~5% that's manageable with a day-before weigh-in. Losing a little more beforehand makes fight week safer.`);
  }
  return { direction, weeks: r1(weeks), required: { pctPerWeek: Math.round(reqPct * 10000) / 10000, kgPerWeek: r1(reqKgWk), band: reqBand }, recommended, options, unreachableSafely, earliestSafeDate, notes };
}

/** Pure: where a daily intake lands by a date (kg), given maintenance. */
export function projectKg(currentKg: number, kcal: number, tdee: number, today: string, byDate: string): number {
  return r1(currentKg + (((kcal - tdee) * 7) / KCAL_PER_KG) * weeksBetween(today, byDate));
}
