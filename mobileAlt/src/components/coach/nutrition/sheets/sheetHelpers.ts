// Tiny helpers shared by the Nutrition sheets. Lives here so the sheet
// implementations stay focused on their own UI / state.

export type MealSlotApi = 'breakfast' | 'lunch' | 'dinner' | 'snack' | 'meal';

/** YYYY-MM-DD local date string (matches the backend's expectation). */
export function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Pick a sensible default meal slot for "right now". Backend's enum is
 * lowercase; the timeline's display labels are uppercase, so this is the
 * lowercase API form. We never default to "meal" — that's a fallback for
 * old logs without a slot.
 */
export function slotForNow(): MealSlotApi {
  const h = new Date().getHours();
  if (h < 10) return 'breakfast';
  if (h < 15) return 'lunch';
  if (h < 17) return 'snack';
  if (h < 21) return 'dinner';
  return 'snack';
}

/**
 * Pull the rich nutrient fields out of a parse/photo response so they can be
 * forwarded on logMeal. Without this the app logs only name + 4 macros and the
 * Nutrition Profile effects engine has nothing to read. Everything here is
 * optional on the backend, so a sparse response degrades gracefully.
 */
export function richLogFields(
  raw: any,
  source: 'text' | 'photo' | 'manual' | 'saved_food',
): {
  ingredients?: string[];
  tags?: string[];
  nutrients?: Record<string, unknown>;
  nutrientMap?: Record<string, number>;
  ingredientNutrients?: Array<{ name: string; nutrients: Record<string, number> }>;
  source: 'text' | 'photo' | 'manual' | 'saved_food';
  parseConfidence?: 'high' | 'medium' | 'low';
} {
  const meal = raw?.meal ?? raw ?? {};
  const out: any = { source };
  if (Array.isArray(meal.ingredients)) out.ingredients = meal.ingredients;
  if (Array.isArray(meal.tags)) out.tags = meal.tags;
  if (meal.nutrients && typeof meal.nutrients === 'object') out.nutrients = meal.nutrients;
  if (meal.nutrientMap && typeof meal.nutrientMap === 'object') out.nutrientMap = meal.nutrientMap;
  if (Array.isArray(meal.ingredientDetails)) {
    out.ingredientNutrients = meal.ingredientDetails
      .filter((d: any) => d?.name && d?.nutrients)
      .map((d: any) => ({ name: String(d.name), nutrients: d.nutrients }));
  }
  if (meal.confidence === 'high' || meal.confidence === 'medium' || meal.confidence === 'low') {
    out.parseConfidence = meal.confidence;
  }
  return out;
}
