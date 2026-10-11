// Micronutrients travel with every v2 log. The server stores whatever arrives
// under `nutrients`; a log that sends none is saved as all zeros, so a barcode,
// a saved food or "the usual" must carry the micros it already has.

const KEYS = ['fiberG', 'sugarG', 'sodiumMg', 'saturatedFatG', 'cholesterolMg', 'vitaminAIU', 'vitaminCMg', 'vitaminDIU', 'vitaminEMg', 'vitaminB12Mcg', 'folateMcg', 'ironMg', 'calciumMg', 'magnesiumMg', 'zincMg', 'potassiumMg', 'omega3G', 'omega6G'] as const;

/** The known micro keys from `src`, times `k` (servings, or grams/100 for per-100 g values). Empty when there are none. */
export function scaleMicros(src: Record<string, unknown> | null | undefined, k = 1): Record<string, number> {
  const out: Record<string, number> = {};
  if (!src || typeof src !== 'object' || !(k > 0)) return out;
  for (const key of KEYS) {
    const v = Number((src as any)[key]);
    if ((src as any)[key] != null && Number.isFinite(v) && v >= 0) out[key] = Math.round(v * k * 10) / 10;
  }
  return out;
}

/** `{ nutrients }` to spread into a logMeal body, or nothing when there are no micros. */
export function microFields(src: Record<string, unknown> | null | undefined, k = 1): { nutrients?: Record<string, number> } {
  const n = scaleMicros(src, k);
  return Object.keys(n).length ? { nutrients: n } : {};
}
