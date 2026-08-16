// Name folding for the GLOBAL food library (FoodComposition / FoodAlias /
// FoodPortion).
//
// ─── Why this is not `normalizeFoodName` ─────────────────────────────────────
// `normalizeFoodName` in services/nutritionShared.ts looks like the natural
// home for this, but it must NOT be changed. Its output is persisted as
// `SavedFood.normalizedName`, which carries `@@unique([userId, normalizedName])`
// and is the dedupe key that `POST /nutrition/meals` upserts against. Changing
// what it returns would orphan every existing row's key, and users would start
// accumulating duplicate saved foods for foods they already had.
//
// So folding lives here, applies only to the new global tables, and the two
// functions are free to diverge.
//
// ─── What folding has to survive ─────────────────────────────────────────────
// West African food names reach us with tone marks and dots-below from Yoruba
// and Igbo orthography (Ẹ̀bà, ọ̀gbọ̀nọ̀, ẹ̀fọ́ rírò), and users type them without
// any of that ("eba", "ogbono", "efo riro"). Both spellings must fold to the
// same key. Prisma `contains` on SQLite is also case-SENSITIVE, so every query
// term must go through the same function as the stored column — folding one
// side only silently returns nothing.

/**
 * Canonical search key for a food name.
 *
 * Ẹ̀bà → "eba" · "Moi-Moi" → "moi moi" · "Chúrà Gérteh" → "chura gerteh"
 *
 * NFD splits precomposed letters into base + combining mark so the marks can be
 * removed on their own; \p{Diacritic} covers both the Yoruba dot-below (U+0323)
 * and the tone accents (U+0300/U+0301).
 */
export function foldFoodName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    // Apostrophes are removed rather than spaced — they sit INSIDE a word
    // ("Chef's" → "chefs"), so spacing them would split it in two.
    .replace(/['’`]/g, '')
    // Hyphens and slashes separate words, so they become spaces: "Moi-Moi"
    // folds to "moi moi", which is how people actually type it.
    .replace(/[-–—/]/g, ' ')
    // Drop remaining punctuation. Digits are kept — some entries are legitimately
    // numbered (e.g. "Maggi 2-cube").
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

// Filler that carries no identifying information. Deliberately does NOT include
// preparation words: "boiled yam" (~116 kcal/100 g) and "fried yam" (~230) are
// genuinely different foods, and FoodComposition.preparation exists to tell them
// apart. Stripping them here would collapse rows that must stay distinct.
const NOISE_WORDS = new Set([
  'a', 'an', 'the', 'my', 'some', 'of', 'with', 'and', 'plus',
  'plate', 'plates', 'portion', 'portions', 'serving', 'servings',
  'bowl', 'bowls', 'dish', 'homemade', 'home', 'made', 'local', 'fresh',
]);

/**
 * Content tokens of a food name, filler removed.
 *
 * "a plate of jollof rice with chicken" → ["jollof", "rice", "chicken"]
 *
 * Used for two things: matching when the exact fold misses, and — in the Wave 2
 * fuzzy matcher — requiring the first token to match exactly before a fuzzy hit
 * is accepted. Short West African names collide badly under edit distance
 * (eba/ewa, iru/isu, ogi/ogbono), so fuzzy alone is not safe.
 */
export function foodNameTokens(name: string): string[] {
  return foldFoodName(name)
    .split(' ')
    .filter((t) => t.length > 0 && !NOISE_WORDS.has(t));
}

/** Folded name with filler removed — the second-chance lookup key. */
export function foldFoodNameStripped(name: string): string {
  return foodNameTokens(name).join(' ');
}
