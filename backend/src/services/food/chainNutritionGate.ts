// The one rule every chain item must pass before anyone logs it (Oct 2026).
// A Burger King Double Whopper went live as 1,010 kcal with 0 g protein, carbs
// and fat, and 543 of 10,402 imported chain items had calories with no macros
// or macros that couldn't make their calories. The import gate only warned.
//
//   - calories, protein, carbs and fat all stated
//   - real food (> 50 kcal) can't be 0 / 0 / 0
//   - 4P + 4C + 9F within 25% (and 40 kcal) of the stated calories — alcohol
//     adds calories the macros don't count, so an alcoholic drink may be
//     higher, never lower
//
// Used by the importer (scripts/chains/writeMenu.mjs mirrors it) and by the
// runtime menu loader, so a bad item is never served even before re-import.

export interface NutritionFacts { calories?: number | null; proteinG?: number | null; carbsG?: number | null; fatG?: number | null }

const ALCOHOL = /\b(beer|lager|ale|ipa|stout|wine|sangria|mimosa|margarita|martini|mojito|cocktail|caesar\b(?!\s*salad)|bellini|spritz|sour|daiquiri|whisk(?:e)?y|vodka|rum|tequila|gin|bourbon|sake|soju|seltzer|cider|punch|negroni|paloma|pi[nñ]a colada|mule|old fashioned|long island|bloody mary)\b/i;

export const isAlcoholic = (name: string) => ALCOHOL.test(name);

/** Pure: why an item's numbers can't be used, or null when they're sound. */
export function nutritionProblem(f: NutritionFacts, name = ''): 'incomplete' | 'calories_only' | 'macros_mismatch' | null {
  const k = f.calories, p = f.proteinG, c = f.carbsG, fat = f.fatG;
  if (k == null || p == null || c == null || fat == null) return 'incomplete';
  const atwater = 4 * p + 4 * c + 9 * fat;
  if (k > 50 && atwater === 0) return 'calories_only';
  if (k >= 40 && Math.abs(atwater - k) / k > 0.25 && Math.abs(atwater - k) > 40) {
    if (isAlcoholic(name) && atwater < k) return null;
    return 'macros_mismatch';
  }
  return null;
}
