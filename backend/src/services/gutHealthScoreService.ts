// Five-pillar gut-health scoring — pure and deterministic, like the
// diagnostic engine. Callers assemble the week's logged data (a loader in
// the routes layer does prisma work); this module only computes.
//
// Pillars (universal baseline, goal-independent):
//   fiber   — average daily fiber vs personal target
//   plants  — distinct plant species this week vs 30 (American Gut Project)
//   ferment — fermented-food servings this week vs 7 (~1/day, Stanford 2021)
//   avoid   — share of meals flagged ultra-processed (lower is better)
//   rhythm  — day coverage: days with ≥2 logged meals out of 7
import type { MicroStatus } from './microTargetsService.js';

export interface GutWeekInput {
  days: number;                    // days observed (≤7; partial weeks OK)
  avgDailyFiberG: number;
  fiberTargetG: number;
  distinctPlants: string[];        // normalized plant names seen this week
  fermentedServings: number;
  mealsLogged: number;
  ultraProcessedMeals: number;
  daysWithTwoPlusMeals: number;
}

export interface GutPillar {
  key: 'fiber' | 'plants' | 'ferment' | 'avoid' | 'rhythm';
  label: string;
  score: number;         // 0–100
  status: MicroStatus;
  detail: string;        // short, user-facing ("19 / 30 plants")
}

export interface GutWeekResult {
  pillars: GutPillar[];
  overall: number;       // 0–100 weighted
  plantCount: number;
  plantTarget: number;
  plants: string[];
}

export const PLANT_TARGET = 30;
export const FERMENT_TARGET = 7;

function clamp(v: number, lo = 0, hi = 100): number {
  return Math.max(lo, Math.min(hi, v));
}

function bandFor(score: number): MicroStatus {
  if (score >= 70) return 'ok';
  if (score >= 40) return 'low';
  return 'vlow';
}

export function scoreGutWeek(input: GutWeekInput): GutWeekResult {
  const days = Math.max(1, Math.min(7, input.days));
  // Scale weekly targets to the observed window so a Tuesday check-in
  // doesn't read as failure against a full-week bar.
  const windowScale = days / 7;
  const plantTarget = Math.max(1, Math.round(PLANT_TARGET * windowScale));
  const fermentTarget = Math.max(1, Math.round(FERMENT_TARGET * windowScale));

  const fiberScore = clamp(
    input.fiberTargetG > 0 ? (input.avgDailyFiberG / input.fiberTargetG) * 100 : 0,
  );
  const plantCount = input.distinctPlants.length;
  const plantScore = clamp((plantCount / plantTarget) * 100);
  const fermentScore = clamp((input.fermentedServings / fermentTarget) * 100);
  const processedShare =
    input.mealsLogged > 0 ? input.ultraProcessedMeals / input.mealsLogged : 0;
  // ≤20% ultra-processed scores 100; 60%+ scores 0.
  const avoidScore = clamp(((0.6 - processedShare) / 0.4) * 100);
  const rhythmScore = clamp((input.daysWithTwoPlusMeals / days) * 100);

  const pillars: GutPillar[] = [
    {
      key: 'fiber', label: 'Fiber', score: Math.round(fiberScore), status: bandFor(fiberScore),
      detail: `${Math.round(input.avgDailyFiberG)}g avg / ${Math.round(input.fiberTargetG)}g target`,
    },
    {
      key: 'plants', label: 'Plants', score: Math.round(plantScore), status: bandFor(plantScore),
      detail: `${plantCount} / ${plantTarget} plants`,
    },
    {
      key: 'ferment', label: 'Fermented', score: Math.round(fermentScore), status: bandFor(fermentScore),
      detail: `${input.fermentedServings} / ${fermentTarget} servings`,
    },
    {
      key: 'avoid', label: 'Whole foods', score: Math.round(avoidScore), status: bandFor(avoidScore),
      detail: `${Math.round(processedShare * 100)}% ultra-processed`,
    },
    {
      key: 'rhythm', label: 'Rhythm', score: Math.round(rhythmScore), status: bandFor(rhythmScore),
      detail: `${input.daysWithTwoPlusMeals} / ${days} days logged fully`,
    },
  ];

  // Fiber and plants carry the most evidence weight.
  const overall = Math.round(
    fiberScore * 0.3 + plantScore * 0.3 + fermentScore * 0.2 + avoidScore * 0.1 + rhythmScore * 0.1,
  );

  return {
    pillars,
    overall,
    plantCount,
    plantTarget: PLANT_TARGET,
    plants: input.distinctPlants,
  };
}

// ── Plant normalization ────────────────────────────────────────────────────
// Distinct-species counting needs light canonicalization so "cherry
// tomatoes", "tomato" and "Tomatoes" count once. Deliberately simple:
// lowercase, trim, singularize the final word, collapse known aliases.
const PLANT_ALIASES: Record<string, string> = {
  'scallion': 'green onion', 'spring onion': 'green onion',
  'cilantro': 'coriander', 'garbanzo bean': 'chickpea', 'garbanzo': 'chickpea',
  'rocket': 'arugula', 'courgette': 'zucchini', 'aubergine': 'eggplant',
  'sweet potatoe': 'sweet potato', 'romaine lettuce': 'romaine',
};

export function normalizePlant(raw: string): string {
  let s = raw.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!s) return s;
  // naive singularization of the last word: tomatoes→tomato, berries→berry
  s = s.replace(/ies$/, 'y').replace(/oes$/, 'o').replace(/([^s])s$/, '$1');
  const stripped = s.replace(/^(fresh|organic|raw|baby|cherry|wild|frozen) /, '');
  return PLANT_ALIASES[stripped] ?? PLANT_ALIASES[s] ?? stripped;
}

export function distinctPlants(lists: string[][]): string[] {
  const seen = new Set<string>();
  for (const list of lists) {
    for (const raw of list) {
      const p = normalizePlant(raw);
      if (p) seen.add(p);
    }
  }
  return [...seen].sort();
}
