/**
 * Per-kilo reference prices for staples.
 *
 * WHY THIS EXISTS. The food catalogue carries a `typicalPriceUsd` per serving,
 * and those figures are unsourced round numbers — $1, $2 and $3 account for 27
 * of the 62 foods. Promoted into user-facing prices they implied $105/kg wild
 * salmon, $58/kg ground beef and $43/kg beef liver, which are 2-4x real
 * supermarket retail. An audit (scripts/auditPrices.ts) is what surfaced it.
 *
 * Groceries are priced per kilo, so that is the unit a reference table should
 * use. A serving price is then perKg x servingGrams, which stays consistent when
 * a portion is scaled — the per-serving figures did not.
 *
 * WHAT THESE NUMBERS ARE. Typical US supermarket shelf prices for the ordinary
 * form of each food (frozen where that is how people buy it, dry for legumes
 * and grains). They are ESTIMATES. Unlike the dish estimator, there is no
 * ground truth to calibrate against — no free per-store grocery feed exists —
 * so nothing here has a measured error bar, and the UI must keep quoting these
 * with a hedge. They are defensible as a bracket, not as a shelf price.
 *
 * Foods absent from this table keep their per-serving catalogue figure, which
 * is the right fallback for count-priced items ("1 medium avocado").
 */

/** USD per kilogram, for the form the food is normally bought in. */
export const PRICE_PER_KG_USD: Record<string, number> = {
  // --- Protein -------------------------------------------------------------
  'wild salmon': 26,           // frozen fillet; fresh runs higher
  'farmed salmon': 18,
  'cod fillet': 20,
  mackerel: 14,
  herring: 12,
  sardines: 13,
  'canned tuna in water': 14,
  shrimp: 22,
  mussels: 9,
  'chicken breast': 13,
  'turkey breast': 15,
  'lean ground beef 90 10': 12,
  'pork tenderloin': 13,
  'rotisserie chicken': 11,
  'beef liver': 9,
  'whole eggs': 5,
  'firm tofu': 6,
  tempeh: 13,
  edamame: 7,

  // --- Dairy ---------------------------------------------------------------
  'greek yogurt': 6,
  skyr: 8,
  'cottage cheese': 6,
  kefir: 5,
  'cheddar cheese': 14,

  // --- Legumes, grains, starch (dry weight) --------------------------------
  lentils: 4,
  chickpeas: 4,
  'black beans': 4,
  'kidney beans': 4,
  'rolled oats': 4,
  quinoa: 8,
  'brown rice': 4,
  'whole grain bread': 6,
  'sweet potato': 3,
  'baked potato': 2,

  // --- Nuts, seeds, fats ---------------------------------------------------
  almonds: 16,
  walnuts: 18,
  'pumpkin seeds': 14,
  'sunflower seeds': 8,
  'chia seeds': 13,
  'ground flaxseed': 9,
  'peanut butter': 9,
  'dark chocolate 85': 24,

  // --- Produce -------------------------------------------------------------
  spinach: 7,
  kale: 6,
  broccoli: 5,
  'brussels sprouts': 6,
  'red bell pepper': 7,
  mushrooms: 8,
  'uv exposed mushrooms': 11,
  beets: 4,
  'pumpkin cooked': 4,
  strawberries: 9,
  blueberries: 12,
  hummus: 9,
  sauerkraut: 7,
  kimchi: 11,
};
