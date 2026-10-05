// Web lookup for a barcode that neither OpenFoodFacts nor our community table
// has — Gemini with Google Search grounding finds the product page and reads
// its nutrition panel.
//
// A web match can be confidently wrong (a low-thinking probe on 5 Oct 2026
// returned a sibling product of the same brand), so nothing here is trusted
// on its own:
//   - the answer must be grounded in at least one cited source,
//   - the source has to state the values per 100 g, or per serving with the
//     serving weight, so per-100 g can be derived,
//   - the macros must roughly add up to the calories,
//   - and the user confirms the product before it is logged or cached for
//     anyone else (see confirmWebProduct in the route).
//
// Temperature stays at the Gemini 3 default (lowering it loops/degrades).

import { GoogleGenAI, Type } from '@google/genai';
import { coerceNutritionLabel, type CoercedLabel } from './communityProduct.js';
import { LruCache } from './mealPhotoCache.js';

export const WEB_FOOD_MODEL = process.env.WEB_FOOD_SEARCH_MODEL || 'gemini-3-flash-preview';
const TIMEOUT_MS = Number(process.env.WEB_FOOD_SEARCH_TIMEOUT_MS) || 45_000;

export interface WebSource { title: string | null; uri: string }

export interface WebProduct extends CoercedLabel {
  sources: WebSource[];
}

export type WebLookup =
  | { kind: 'found'; product: WebProduct }
  | { kind: 'not_found'; reason: string }
  | { kind: 'unavailable'; reason: string };

/** Raw structured answer from the model (before any checks). */
export interface RawWebAnswer {
  found?: unknown;
  name?: unknown;
  brand?: unknown;
  basis?: unknown;          // 'per_100g' | 'per_serving'
  servingSize?: unknown;
  servingGrams?: unknown;
  calories?: unknown;
  proteinG?: unknown;
  carbsG?: unknown;
  fatG?: unknown;
}

export const WEB_ANSWER_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    found: { type: Type.BOOLEAN },
    name: { type: Type.STRING, nullable: true },
    brand: { type: Type.STRING, nullable: true },
    basis: { type: Type.STRING, nullable: true, description: "'per_100g' or 'per_serving' — how the source states the values" },
    servingSize: { type: Type.STRING, nullable: true, description: 'Serving size text as printed, e.g. "1/3 package (52g)"' },
    servingGrams: { type: Type.NUMBER, nullable: true, description: 'Serving weight in grams, if stated' },
    calories: { type: Type.NUMBER, nullable: true },
    proteinG: { type: Type.NUMBER, nullable: true },
    carbsG: { type: Type.NUMBER, nullable: true },
    fatG: { type: Type.NUMBER, nullable: true },
  },
  required: ['found'],
  propertyOrdering: ['found', 'name', 'brand', 'basis', 'servingSize', 'servingGrams', 'calories', 'proteinG', 'carbsG', 'fatG'],
};

export function buildWebPrompt(code: string): string {
  return `Use Google Search to find the packaged food product with the barcode (GTIN / EAN / UPC) ${code}.

Rules:
- Only report a product if a search result explicitly ties this exact barcode number to it (a product database page, retailer listing, or the manufacturer's page). A product of the same brand or a similar name is NOT a match — set found=false.
- Report the nutrition values exactly as that source states them. Do not estimate or fill gaps from general knowledge.
- basis: "per_100g" if the source gives values per 100 g, otherwise "per_serving" with servingSize as printed and servingGrams as the serving weight in grams.
- If you are not certain, set found=false.`;
}

function num(v: unknown): number | null {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * Checks + per-100 g conversion. Pure; exported for tests. Returns the reason
 * a grounded answer was rejected so the log says why.
 */
export function validateWebAnswer(raw: RawWebAnswer | null, sources: WebSource[]): WebLookup {
  if (!raw || raw.found !== true) return { kind: 'not_found', reason: 'model_not_found' };
  if (!sources.length) return { kind: 'not_found', reason: 'ungrounded' };
  const name = String(raw.name ?? '').trim();
  if (!name) return { kind: 'not_found', reason: 'no_name' };

  const kcal = num(raw.calories);
  if (!kcal) return { kind: 'not_found', reason: 'no_calories' };
  const p = num(raw.proteinG) ?? 0, c = num(raw.carbsG) ?? 0, f = num(raw.fatG) ?? 0;

  // Macros vs calories: fibre, alcohol and label rounding allow some slack,
  // but a wildly mismatched panel means a misread or a mixed-up product.
  const fromMacros = 4 * p + 4 * c + 9 * f;
  if (fromMacros > 0 && Math.abs(fromMacros - kcal) / kcal > 0.35) return { kind: 'not_found', reason: 'macros_mismatch' };

  const servingGrams = num(raw.servingGrams);
  let factor: number;
  if (raw.basis === 'per_100g') factor = 1;
  else if (servingGrams && servingGrams > 0) factor = 100 / servingGrams;
  else return { kind: 'not_found', reason: 'no_serving_weight' };

  const coerced = coerceNutritionLabel({
    name,
    brand: raw.brand,
    caloriesPer100g: kcal * factor,
    proteinG: p * factor,
    carbsG: c * factor,
    fatG: f * factor,
    servingSize: raw.servingSize,
    servingQuantityG: servingGrams,
  });
  if (!coerced) return { kind: 'not_found', reason: 'unreadable' };
  const round1 = (x: number) => Math.round(x * 10) / 10;
  return {
    kind: 'found',
    product: {
      ...coerced,
      caloriesPer100g: Math.round(coerced.caloriesPer100g),
      proteinG: round1(coerced.proteinG),
      carbsG: round1(coerced.carbsG),
      fatG: round1(coerced.fatG),
      sources: sources.slice(0, 3),
    },
  };
}

export function sourcesFrom(response: any): WebSource[] {
  const chunks: any[] = response?.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
  const out: WebSource[] = [];
  for (const ch of chunks) {
    const uri = ch?.web?.uri;
    if (typeof uri === 'string' && uri) out.push({ title: typeof ch.web.title === 'string' ? ch.web.title : null, uri });
  }
  return out;
}

type Generate = (args: { model: string; contents: string; config: any }) => Promise<any>;

let client: GoogleGenAI | null = null;
function defaultGenerate(): Generate {
  client ??= new GoogleGenAI({
    vertexai: true,
    project: process.env.GCP_PROJECT_NUMBER ?? '656267185967',
    location: process.env.GCP_LOCATION ?? 'global',
  });
  return (args) => client!.models.generateContent(args);
}

// One search per barcode per day — misses included, so a user re-scanning an
// unknown product doesn't buy a fresh grounded call each time.
const cache = new LruCache<WebLookup>(500, 24 * 60 * 60 * 1000);

/** The last web answer for a code (what confirm persists — never client numbers). */
export function cachedWebLookup(code: string): WebLookup | undefined {
  return cache.get(code);
}

export function _resetWebLookupCache(): void {
  cache.clear();
}

export async function webLookupBarcode(code: string, generate: Generate = defaultGenerate()): Promise<WebLookup> {
  const hit = cache.get(code);
  if (hit) return hit;
  let response: any;
  try {
    response = await Promise.race([
      generate({
        model: WEB_FOOD_MODEL,
        contents: buildWebPrompt(code),
        config: { tools: [{ googleSearch: {} }], responseMimeType: 'application/json', responseSchema: WEB_ANSWER_SCHEMA },
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), TIMEOUT_MS)),
    ]);
  } catch (err: any) {
    // Not cached: an outage shouldn't hide the product for a day.
    return { kind: 'unavailable', reason: err?.message === 'timeout' ? 'timeout' : 'model_error' };
  }
  let raw: RawWebAnswer | null = null;
  try { raw = JSON.parse(String(response?.text ?? '').trim()); } catch { raw = null; }
  const result = validateWebAnswer(raw, sourcesFrom(response));
  cache.set(code, result);
  return result;
}
