// Pure helpers for the community barcode cache (ProductBarcode).
//
// Extracted out of routes/nutrition.ts for the same reason recipes.ts is its
// own router: that module constructs OpenAI at import time and pulls in the
// engines, so nothing there can be unit-tested without dragging all of it in.
// These two functions carry the logic most likely to break silently, so they
// live where a test can reach them.

/** Row shape we need off ProductBarcode — narrower than the Prisma model. */
export interface CommunityProductRow {
  code: string;
  name: string;
  brand: string | null;
  caloriesPer100g: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  nutrientsJson: string | null;
  servingSize: string | null;
  servingQuantityG: number | null;
  verified: boolean;
}

/**
 * Shape a community row exactly like the OpenFoodFacts branch of
 * GET /nutrition/barcode/:code.
 *
 * Shape parity is the whole contract: app/barcode-confirm.tsx reads
 * `per100g.*`, `servingSize` and `servingQuantityG` without knowing or caring
 * where the product came from. If this drifts from the OFF response, the
 * confirm screen silently shows zeros for community products only — which
 * would look like "the label scan didn't work" rather than a shape bug.
 * `source` and `verified` are the only intended differences.
 */
export function serializeCommunityProduct(row: CommunityProductRow) {
  let nutrients: Record<string, unknown> = {};
  try {
    const parsed = row.nutrientsJson ? JSON.parse(row.nutrientsJson) : {};
    // A corrupt or non-object payload must not take the whole lookup down —
    // the macros are still perfectly usable on their own.
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      nutrients = parsed as Record<string, unknown>;
    }
  } catch {
    nutrients = {};
  }
  return {
    code: row.code,
    name: row.name,
    brand: row.brand,
    imageUrl: null as string | null,
    per100g: {
      calories: row.caloriesPer100g,
      proteinG: row.proteinG,
      carbsG: row.carbsG,
      fatG: row.fatG,
      ...nutrients,
    },
    servingSize: row.servingSize,
    servingQuantityG: row.servingQuantityG,
    source: 'community' as const,
    verified: row.verified,
  };
}

/** Raw shape the vision model returns for a nutrition panel. */
export interface RawLabelParse {
  name?: unknown;
  brand?: unknown;
  caloriesPer100g?: unknown;
  proteinG?: unknown;
  carbsG?: unknown;
  fatG?: unknown;
  servingSize?: unknown;
  servingQuantityG?: unknown;
}

export interface CoercedLabel {
  name: string;
  brand: string | null;
  caloriesPer100g: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  servingSize: string | null;
  servingQuantityG: number | null;
}

function toNumber(v: unknown): number {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/**
 * Clamp and type a raw label parse.
 *
 * Returns null when the panel could not be read — the caller turns that into a
 * 422 asking for a better photo rather than writing a junk row that every
 * future scanner of that barcode would then inherit.
 */
export function coerceNutritionLabel(raw: RawLabelParse | null | undefined): CoercedLabel | null {
  if (!raw || typeof raw !== 'object') return null;

  const calories = toNumber(raw.caloriesPer100g);
  if (calories <= 0) return null;

  return {
    name: String(raw.name ?? '').trim().slice(0, 200),
    brand: raw.brand ? String(raw.brand).trim().slice(0, 100) || null : null,
    // Nothing edible exceeds pure fat at ~900 kcal/100 g. A larger number means
    // the model read a per-pack total as per-100 g, so cap rather than trust it.
    caloriesPer100g: Math.min(calories, 900),
    proteinG: Math.min(toNumber(raw.proteinG), 100),
    carbsG: Math.min(toNumber(raw.carbsG), 100),
    fatG: Math.min(toNumber(raw.fatG), 100),
    servingSize: raw.servingSize ? String(raw.servingSize).trim().slice(0, 80) || null : null,
    servingQuantityG: toNumber(raw.servingQuantityG) > 0 ? toNumber(raw.servingQuantityG) : null,
  };
}
