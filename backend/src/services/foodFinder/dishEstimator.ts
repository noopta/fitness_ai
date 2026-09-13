/**
 * Estimate macros for a dish we know only by name.
 *
 * This is the engine behind `inferred` confidence: a parsed menu gives us a dish
 * name, a description and a price, but no restaurant publishes grams of protein,
 * and most do not know. So the number is a model estimate, and the honest thing
 * is to treat it as one — measured, discounted, and labelled.
 *
 * Two properties matter more than accuracy here:
 *
 *   1. DETERMINISM BY NAME. The same dish name must produce the same answer
 *      every time, or the finder contradicts itself between refreshes and the
 *      calibration numbers mean nothing. Results are cached by folded name,
 *      permanently — see the cache tier table in the architecture doc.
 *   2. CALIBRATABILITY. The estimator must be runnable over chain items whose
 *      real macros we hold, so its error can be MEASURED rather than assumed.
 *      That is what scripts/calibrateDishEstimator.ts does.
 */

import { PrismaClient } from '@prisma/client';
import { client, SAFETY_SETTINGS } from '../geminiService.js';
import { fold } from '../../engine/dietaryFilter.js';
import calibration from './calibration.json' with { type: 'json' };

const prisma = new PrismaClient();

const MODEL = process.env.FOOD_FINDER_ESTIMATOR_MODEL ?? 'gemini-2.5-flash';

export interface DishEstimate {
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  sodiumMg?: number;
  fiberG?: number;
  /** The model's own confidence that the portion is typical, 0..1. */
  portionConfidence: number;
  /** Measured median absolute error for this cuisine, from calibration. */
  errPct?: number;
  /** True when a measured bias correction was applied to the raw model output. */
  corrected?: boolean;
}

interface Correction { biasPct: number; errPct: number; n: number }
const CORRECTIONS = (calibration.corrections ?? {}) as Record<string, Correction>;
/** Below this many measured items a cuisine's correction is noise, not signal. */
const MIN_CALIBRATION_N = 4;

/**
 * Apply the measured bias correction for a cuisine.
 *
 * Calibration against chain ground truth found the raw estimator runs hot — it
 * over-estimates, badly for some cuisines (cafe items by ~56%, burgers by ~5%).
 * Shipping that uncorrected would systematically tell a user a dish is larger
 * than it is, and someone with 600 kcal left would skip food that actually fit.
 *
 * The correction divides out the measured median bias. It is deliberately only
 * applied when a cuisine has enough measured items to mean anything, and the
 * global figure is the fallback rather than a per-cuisine guess.
 */
export function applyCorrection(raw: DishEstimate, cuisine?: string | null): DishEstimate {
  const key = cuisine ?? 'unknown';
  const c = CORRECTIONS[key];
  const usable = c && c.n >= MIN_CALIBRATION_N ? c : null;
  const biasPct = usable ? usable.biasPct : (calibration.globalBiasPct ?? 0);
  const errPct = usable ? usable.errPct : undefined;

  if (!biasPct) return { ...raw, errPct, corrected: false };

  const factor = 1 / (1 + biasPct / 100);
  return {
    ...raw,
    kcal: Math.round(raw.kcal * factor),
    proteinG: Math.round(raw.proteinG * factor * 10) / 10,
    carbsG: Math.round(raw.carbsG * factor * 10) / 10,
    fatG: Math.round(raw.fatG * factor * 10) / 10,
    sodiumMg: raw.sodiumMg != null ? Math.round(raw.sodiumMg * factor) : undefined,
    fiberG: raw.fiberG != null ? Math.round(raw.fiberG * factor * 10) / 10 : undefined,
    errPct,
    corrected: true,
  };
}

const SCHEMA = {
  type: 'object',
  properties: {
    kcal: { type: 'number' },
    proteinG: { type: 'number' },
    carbsG: { type: 'number' },
    fatG: { type: 'number' },
    sodiumMg: { type: 'number' },
    fiberG: { type: 'number' },
    portionConfidence: { type: 'number' },
  },
  required: ['kcal', 'proteinG', 'carbsG', 'fatG', 'portionConfidence'],
} as const;

const SYSTEM = `You estimate the nutrition of a single restaurant menu item from its name and description.

Rules:
- Estimate ONE standard restaurant portion as actually served, not a 100g reference amount.
- Restaurant food carries more oil, butter and salt than a home version of the same dish. Account for that.
- Return grams for macros, milligrams for sodium.
- portionConfidence: 0.9 when the name pins the portion ("6-inch sub", "1/4 chicken"),
  0.5 when the dish is standard but the portion is not stated, 0.3 when the name is vague.
- Do not refuse and do not explain. Return only the JSON object.`;

/**
 * Estimate one dish, using the permanent cache when we have seen the name.
 *
 * `cuisine` is a hint, not a filter — "pad thai" at a Thai place and at a food
 * court are the same dish, and pretending otherwise would multiply cache misses
 * for no accuracy gain.
 */
export async function estimateDish(
  name: string,
  opts: {
    description?: string | null;
    cuisine?: string | null;
    useCache?: boolean;
    /** Skip bias correction. Only the calibration harness should set this. */
    raw?: boolean;
  } = {},
): Promise<DishEstimate | null> {
  const folded = fold(name);
  if (!folded) return null;

  if (opts.useCache !== false) {
    const hit = await prisma.menuItem.findFirst({
      where: { foldedName: folded, source: 'DISH_ESTIMATOR_V1' },
      select: { kcal: true, proteinG: true, carbsG: true, fatG: true, nutrientsJson: true },
    });
    if (hit) {
      const extra = safeObject(hit.nutrientsJson);
      return {
        kcal: hit.kcal, proteinG: hit.proteinG, carbsG: hit.carbsG, fatG: hit.fatG,
        sodiumMg: extra.sodiumMg, fiberG: extra.fiberG,
        portionConfidence: extra.portionConfidence ?? 0.5,
      };
    }
  }

  const prompt = [
    `Dish: ${name}`,
    opts.description ? `Description: ${opts.description}` : null,
    opts.cuisine ? `Cuisine: ${opts.cuisine}` : null,
  ].filter(Boolean).join('\n');

  try {
    const res = await client().models.generateContent({
      model: MODEL,
      config: {
        systemInstruction: SYSTEM,
        responseMimeType: 'application/json',
        responseSchema: SCHEMA as unknown as Record<string, unknown>,
        safetySettings: SAFETY_SETTINGS,
        temperature: 0,
      },
      contents: prompt,
    });
    const parsed = JSON.parse(res.text ?? '{}') as DishEstimate;
    if (!Number.isFinite(parsed.kcal) || parsed.kcal <= 0) return null;
    // The calibration harness measures the RAW estimator, so it must be able to
    // ask for uncorrected output — otherwise it would be measuring its own
    // correction and converge on reporting zero error.
    return opts.raw ? parsed : applyCorrection(parsed, opts.cuisine);
  } catch (err) {
    // A failed estimate degrades this dish to a cuisine default; it is never
    // allowed to fail the request the user is waiting on.
    console.warn(`[dishEstimator] ${name}: ${(err as Error).message}`);
    return null;
  }
}

function safeObject(raw: string | null): Record<string, number> {
  if (!raw) return {};
  try { const v = JSON.parse(raw); return v && typeof v === 'object' ? v : {}; } catch { return {}; }
}

/** Persist an estimate so the same dish name never costs a second model call. */
export async function cacheEstimate(name: string, est: DishEstimate): Promise<void> {
  const folded = fold(name);
  try {
    const existing = await prisma.menuItem.findFirst({
      where: { foldedName: folded, source: 'DISH_ESTIMATOR_V1' },
      select: { id: true },
    });
    const data = {
      name,
      foldedName: folded,
      kcal: est.kcal, proteinG: est.proteinG, carbsG: est.carbsG, fatG: est.fatG,
      nutrientsJson: JSON.stringify({
        ...(est.sodiumMg != null ? { sodiumMg: est.sodiumMg } : {}),
        ...(est.fiberG != null ? { fiberG: est.fiberG } : {}),
        portionConfidence: est.portionConfidence,
      }),
      confidence: 'inferred',
      source: 'DISH_ESTIMATOR_V1',
    };
    if (existing) await prisma.menuItem.update({ where: { id: existing.id }, data });
    else await prisma.menuItem.create({ data });
  } catch (err) {
    console.warn(`[dishEstimator] cache write failed for ${name}: ${(err as Error).message}`);
  }
}
