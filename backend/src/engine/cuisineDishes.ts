// Typical dishes per cuisine, for the takeout half of the food finder.
//
// THE HONESTY CONSTRAINT. Google Places gives us a restaurant's name, type,
// and location — it does NOT give us their menu. So we must never claim "their
// chicken bowl has 42 g of protein". What we CAN say, and what this table
// encodes, is "a chicken bowl at a Mexican place is typically ~42 g of
// protein" — a claim about the cuisine, attached to a real nearby restaurant
// that plausibly serves it.
//
// Every consumer must phrase these as typical, and every candidate built from
// this table carries confidence: 'estimated' so the ranker discounts it
// against USDA-grounded whole foods. See dishCandidates() for the phrasing.
//
// Figures are conservative mid-range values for a single standard portion,
// drawn from chain nutrition disclosures where a category has them (bowls,
// subs, poke) and from USDA composites otherwise. Sodium is included wherever
// the category is typically salty — a takeout ranker that ignores sodium will
// confidently recommend the worst thing on the menu.

export interface CuisineDish {
  /** Dish name as it would appear to the user. */
  name: string;
  kcal: number;
  /** Nutrient key → amount per portion, same convention as FOOD_SOURCES. */
  provides: Record<string, number>;
  /** Rough portion description, e.g. "1 bowl". */
  portion: string;
  /** True when the dish is a reliably lean/high-protein pick for that cuisine. */
  lean?: boolean;
}

/**
 * Places `primaryType` (falling back to `types`) → typical dishes.
 *
 * Keys are Places API (New) type strings. Only cuisines with a reasonably
 * predictable "what a fit person orders here" are listed: a generic
 * `restaurant` with no cuisine signal is deliberately absent, because
 * inventing a dish for an unknown restaurant is exactly the fabrication this
 * table exists to avoid.
 */
export const CUISINE_DISHES: Record<string, CuisineDish[]> = {
  mexican_restaurant: [
    { name: 'Chicken burrito bowl', portion: '1 bowl', kcal: 620, lean: true, provides: { proteinG: 45, carbsG: 62, fatG: 19, fiberG: 12, ironMg: 3.5, potassiumMg: 1100, sodiumMg: 1500 } },
    { name: 'Carnitas salad bowl', portion: '1 bowl', kcal: 540, provides: { proteinG: 34, carbsG: 30, fatG: 28, fiberG: 10, sodiumMg: 1400, saturatedFatG: 9 } },
  ],
  japanese_restaurant: [
    { name: 'Salmon poke bowl', portion: '1 bowl', kcal: 580, lean: true, provides: { proteinG: 38, carbsG: 60, fatG: 18, omega3G: 1.8, vitaminDIU: 450, vitaminB12Mcg: 4, sodiumMg: 1200 } },
    { name: 'Salmon & tuna sashimi', portion: '8 pieces', kcal: 260, lean: true, provides: { proteinG: 40, fatG: 10, omega3G: 2.2, vitaminDIU: 500, vitaminB12Mcg: 6, sodiumMg: 300 } },
  ],
  sushi_restaurant: [
    { name: 'Salmon & tuna sashimi', portion: '8 pieces', kcal: 260, lean: true, provides: { proteinG: 40, fatG: 10, omega3G: 2.2, vitaminDIU: 500, vitaminB12Mcg: 6, sodiumMg: 300 } },
    { name: 'Salmon poke bowl', portion: '1 bowl', kcal: 580, lean: true, provides: { proteinG: 38, carbsG: 60, fatG: 18, omega3G: 1.8, vitaminDIU: 450, vitaminB12Mcg: 4, sodiumMg: 1200 } },
  ],
  mediterranean_restaurant: [
    { name: 'Chicken shawarma plate', portion: '1 plate', kcal: 700, provides: { proteinG: 48, carbsG: 55, fatG: 30, fiberG: 9, ironMg: 4, sodiumMg: 1600 } },
    { name: 'Falafel & hummus bowl', portion: '1 bowl', kcal: 610, provides: { proteinG: 20, carbsG: 62, fatG: 30, fiberG: 14, folateMcg: 200, ironMg: 5, sodiumMg: 1100 } },
  ],
  greek_restaurant: [
    { name: 'Chicken souvlaki plate', portion: '1 plate', kcal: 650, lean: true, provides: { proteinG: 50, carbsG: 48, fatG: 26, calciumMg: 200, sodiumMg: 1300 } },
  ],
  middle_eastern_restaurant: [
    { name: 'Chicken shawarma plate', portion: '1 plate', kcal: 700, provides: { proteinG: 48, carbsG: 55, fatG: 30, fiberG: 9, ironMg: 4, sodiumMg: 1600 } },
  ],
  indian_restaurant: [
    { name: 'Tandoori chicken', portion: '1 portion', kcal: 420, lean: true, provides: { proteinG: 46, carbsG: 8, fatG: 22, ironMg: 3, zincMg: 4, sodiumMg: 1100 } },
    { name: 'Chana masala with rice', portion: '1 plate', kcal: 640, provides: { proteinG: 20, carbsG: 92, fatG: 20, fiberG: 15, folateMcg: 250, ironMg: 5, sodiumMg: 1200 } },
  ],
  thai_restaurant: [
    { name: 'Chicken larb salad', portion: '1 plate', kcal: 480, lean: true, provides: { proteinG: 38, carbsG: 22, fatG: 26, vitaminCMg: 30, sodiumMg: 1500 } },
    { name: 'Green curry with chicken', portion: '1 bowl', kcal: 700, provides: { proteinG: 32, carbsG: 60, fatG: 38, saturatedFatG: 20, vitaminAIU: 4000, sodiumMg: 1700 } },
  ],
  vietnamese_restaurant: [
    { name: 'Beef pho', portion: '1 large bowl', kcal: 520, provides: { proteinG: 34, carbsG: 70, fatG: 10, ironMg: 4, zincMg: 5, sodiumMg: 2000 } },
    { name: 'Grilled chicken vermicelli bowl', portion: '1 bowl', kcal: 560, lean: true, provides: { proteinG: 36, carbsG: 68, fatG: 14, vitaminCMg: 25, sodiumMg: 1300 } },
  ],
  korean_restaurant: [
    { name: 'Bibimbap', portion: '1 bowl', kcal: 680, provides: { proteinG: 32, carbsG: 88, fatG: 22, ironMg: 5, vitaminAIU: 6000, fiberG: 8, sodiumMg: 1500 } },
  ],
  chinese_restaurant: [
    { name: 'Steamed chicken & broccoli', portion: '1 plate', kcal: 480, lean: true, provides: { proteinG: 44, carbsG: 30, fatG: 18, vitaminCMg: 90, fiberG: 7, sodiumMg: 1600 } },
  ],
  american_restaurant: [
    { name: 'Grilled chicken salad', portion: '1 large', kcal: 480, lean: true, provides: { proteinG: 42, carbsG: 20, fatG: 26, fiberG: 7, vitaminAIU: 6000, sodiumMg: 1100 } },
  ],
  steak_house: [
    { name: 'Sirloin with vegetables', portion: '8 oz', kcal: 620, provides: { proteinG: 58, carbsG: 18, fatG: 34, ironMg: 4.5, zincMg: 11, vitaminB12Mcg: 4, saturatedFatG: 13, sodiumMg: 900 } },
  ],
  seafood_restaurant: [
    { name: 'Grilled salmon plate', portion: '1 plate', kcal: 560, lean: true, provides: { proteinG: 44, carbsG: 30, fatG: 28, omega3G: 2.4, vitaminDIU: 700, vitaminB12Mcg: 5, sodiumMg: 800 } },
  ],
  sandwich_shop: [
    { name: 'Turkey sub (no mayo)', portion: '6 inch', kcal: 380, lean: true, provides: { proteinG: 26, carbsG: 48, fatG: 8, fiberG: 5, sodiumMg: 1300 } },
  ],
  breakfast_restaurant: [
    { name: 'Egg white omelette & fruit', portion: '1 plate', kcal: 420, lean: true, provides: { proteinG: 32, carbsG: 40, fatG: 14, cholineMg: 200, vitaminCMg: 50, sodiumMg: 800 } },
  ],
  vegetarian_restaurant: [
    { name: 'Tofu grain bowl', portion: '1 bowl', kcal: 600, provides: { proteinG: 26, carbsG: 70, fatG: 24, fiberG: 14, ironMg: 5, calciumMg: 400, magnesiumMg: 130, sodiumMg: 1000 } },
  ],
  vegan_restaurant: [
    { name: 'Tempeh & greens bowl', portion: '1 bowl', kcal: 620, provides: { proteinG: 30, carbsG: 62, fatG: 28, fiberG: 16, ironMg: 6, magnesiumMg: 150, folateMcg: 260, sodiumMg: 950 } },
  ],
  juice_shop: [
    { name: 'Protein smoothie', portion: '16 oz', kcal: 340, lean: true, provides: { proteinG: 26, carbsG: 44, fatG: 6, calciumMg: 300, potassiumMg: 700, vitaminCMg: 60 } },
  ],
};

/**
 * Which Places types we're willing to treat as a takeout candidate source.
 * Used as the `includedTypes` for the restaurant nearby search, so we never pay
 * for results we have no dish mapping for.
 */
export const DISH_PLACE_TYPES = Object.keys(CUISINE_DISHES);

/**
 * Resolve a place to its dish list. Prefers `primaryType`, then scans `types`
 * — Places often files a poke shop as primaryType `restaurant` with
 * `japanese_restaurant` further down the list.
 *
 * Returns [] for restaurants we can't type confidently. That is the honest
 * outcome: no dish claim at all beats a fabricated one.
 */
export function dishesForPlace(place: { primaryType: string | null; types: string[] }): CuisineDish[] {
  if (place.primaryType && CUISINE_DISHES[place.primaryType]) {
    return CUISINE_DISHES[place.primaryType];
  }
  for (const t of place.types) {
    if (CUISINE_DISHES[t]) return CUISINE_DISHES[t];
  }
  return [];
}
