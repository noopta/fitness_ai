// Your foods by barcode (Portion sheet handoff, Nov 2026). Every scanned food is
// remembered with what the label says and the amount last eaten, so the next scan
// of that code starts there, and chat can answer "log it again, 200 g". Pure.

export interface PortionInput { grams: number; unit: string; unitLabel: string }

const MAX_BASIS_CHARS = 8000;
const BASIS_KEYS = ['name', 'brand', 'imageUrl', 'per100g', 'nutrients', 'servingSize', 'servingQuantityG', 'servingSizeG', 'servingGrams', 'serving', 'source'] as const;
const MACROS = new Set(['calories', 'kcal', 'proteinG', 'carbsG', 'fatG']);

const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;
const num = (v: unknown): number | null => { const n = Number(v); return v != null && v !== '' && Number.isFinite(n) ? n : null; };

function parseBasis(json: string | null | undefined): Record<string, any> | null {
  if (!json) return null;
  try {
    const b = JSON.parse(json);
    return b && typeof b === 'object' && b.per100g && typeof b.per100g === 'object' ? b : null;
  } catch {
    return null;
  }
}

/** The product as the lookup answered it, keeping its real origin. Oversized or empty answers aren't kept. */
export function basisJsonFrom(product: Record<string, unknown> | null | undefined): string | null {
  if (!product?.per100g) return null;
  const kept: Record<string, unknown> = {};
  for (const k of BASIS_KEYS) if (product[k] != null) kept[k] = product[k];
  if (kept.source === 'your_foods') kept.source = product.originalSource ?? null;
  const json = JSON.stringify(kept);
  return json.length <= MAX_BASIS_CHARS ? json : null;
}

/** The SavedFood columns for a log that came with a barcode and a portion; none without both. */
export function yourFoodFields(
  data: { barcode?: string; portion?: PortionInput; foodBasis?: Record<string, unknown> },
  now: Date = new Date(),
): { barcode: string; lastGrams: number; lastLoggedAt: Date; basisJson?: string } | null {
  if (!data.barcode || !data.portion || !(data.portion.grams > 0)) return null;
  const basisJson = basisJsonFrom(data.foodBasis);
  return { barcode: data.barcode, lastGrams: data.portion.grams, lastLoggedAt: now, ...(basisJson ? { basisJson } : {}) };
}

/** A remembered row as a barcode answer: the same shape as any lookup, plus what they had last time. */
export function yourFoodProduct(
  row: { name: string; basisJson?: string | null; lastGrams?: number | null; lastLoggedAt?: Date | string | null },
  code: string,
): Record<string, unknown> | null {
  const basis = parseBasis(row.basisJson);
  if (!basis) return null;
  const at = row.lastLoggedAt ? new Date(row.lastLoggedAt) : null;
  return {
    ...basis,
    code,
    name: basis.name ?? row.name,
    source: 'your_foods',
    originalSource: basis.source ?? null,
    yourFood: { lastGrams: row.lastGrams ?? null, lastLoggedAt: at && Number.isFinite(at.getTime()) ? at.toISOString() : null },
  };
}

/** Macros and micros for `grams` of a remembered label, or null when there is no label to scale from. */
export function portionFromBasis(basisJson: string | null | undefined, grams: number) {
  const basis = parseBasis(basisJson);
  if (!basis || !(grams > 0)) return null;
  const per100 = basis.per100g as Record<string, unknown>;
  const f = grams / 100;
  const nutrients: Record<string, number> = {};
  for (const src of [basis.nutrients, per100] as (Record<string, unknown> | null | undefined)[]) {
    for (const [k, v] of Object.entries(src ?? {})) {
      const n = num(v);
      if (!MACROS.has(k) && n != null && n >= 0) nutrients[k] = r2(n * f);
    }
  }
  return {
    calories: Math.round((num(per100.calories ?? per100.kcal) ?? 0) * f),
    proteinG: r1((num(per100.proteinG) ?? 0) * f),
    carbsG: r1((num(per100.carbsG) ?? 0) * f),
    fatG: r1((num(per100.fatG) ?? 0) * f),
    nutrients,
  };
}
