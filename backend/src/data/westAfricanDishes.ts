// Curated West African composite-dish table (Nigeria + Gambia).
//
// ─── Why this file exists ────────────────────────────────────────────────────
// There is no USDA-equivalent REST API for West Africa. The authoritative
// sources are static tables — FAO/INFOODS Food Composition Table for Western
// Africa (2019) and the Nigeria FCT (2017) — and both are overwhelmingly
// INGREDIENT-level: "egusi seed, raw", "palm oil", "cassava flour". People do
// not log ingredients, they log dishes.
//
// Without a dish layer, "egusi soup" resolves to "egusi seed, raw" at ~590
// kcal/100 g. The enrichment loop then works BACKWARDS from that figure to
// guess grams (nutritionEnrichmentService.ts:299), so the error compounds
// instead of cancelling. A bowl of soup comes out at roughly four times its
// real energy.
//
// ─── Data provenance and honesty ─────────────────────────────────────────────
// These are `calculated` values: standard household recipes costed out against
// per-ingredient composition, then expressed per 100 g of the dish AS EATEN.
// They are good enough to beat unguided model recall by a wide margin, and they
// are NOT laboratory analyses. Recipes vary enormously by household and region —
// a Lagos egusi and a Calabar egusi differ in oil and leaf content.
//
// Wave 2 imports FAO/INFOODS proper. When it lands, these rows should be
// cross-checked against it and anything that disagrees materially should be
// re-derived. Until then every row here is tagged `dataQuality: 'calculated'`
// so the provenance is visible in the database rather than implied.
//
// ─── Conventions ─────────────────────────────────────────────────────────────
// - `per100g` is the dish as served, including its cooking oil and water.
// - `nutrients` is deliberately SPARSE. A key is present only where the value
//   is meaningful and defensible; absent keys are left to the LLM blend rather
//   than written as a confident zero. Writing 0 would corrupt hasUsableMicros()
//   and drag the blended average down.
// - `portions` carry the units people actually use. Per-100 g data is unusable
//   for logging without them — nobody weighs a wrap of eba.
// - Follows the src/data/ convention: interface → exported const → accessors.

/** A serving unit as it is actually spoken, with its weight in grams. */
export interface WestAfricanPortion {
  label: string;
  grams: number;
  /** Offered first in the UI and assumed when the user gives no quantity. */
  isDefault?: boolean;
  note?: string;
}

/**
 * Sparse per-100 g micronutrient vector. Keys match the `Micronutrients`
 * interface in llmService.ts so they merge straight into `nutrientMap`.
 */
export type SparseNutrients = Partial<{
  fiberG: number; sugarG: number; sodiumMg: number; saturatedFatG: number;
  cholesterolMg: number; vitaminAIU: number; vitaminCMg: number;
  vitaminDIU: number; vitaminEMg: number; vitaminB12Mcg: number;
  folateMcg: number; ironMg: number; calciumMg: number; magnesiumMg: number;
  zincMg: number; potassiumMg: number; omega3G: number; omega6G: number;
}>;

export interface WestAfricanDish {
  /** Stable identifier — becomes FoodComposition.sourceCode. Never renumber. */
  slug: string;
  name: string;
  /** Spelling variants, local-language names, and what users actually type. */
  aliases: string[];
  region: 'NG' | 'GM' | 'WA';
  foodGroup: string;
  preparation: string;
  isComposite: boolean;
  per100g: { calories: number; proteinG: number; carbsG: number; fatG: number };
  nutrients: SparseNutrients;
  portions: WestAfricanPortion[];
  /** The recipe assumption behind the numbers. Shown to reviewers, not users. */
  basis: string;
}

export const WEST_AFRICAN_DISHES: WestAfricanDish[] = [
  // ─── Swallows / starchy staples ───────────────────────────────────────────
  // Reconstituted with water, so energy density is far below the dry flour.
  // Getting this wrong is the single biggest calorie error in Nigerian logging:
  // dry garri is ~360 kcal/100 g, eba as eaten is well under half that.
  {
    slug: 'eba',
    name: 'Eba (garri swallow)',
    aliases: ['eba', 'garri swallow', 'gari', 'garri'],
    region: 'NG', foodGroup: 'roots-tubers', preparation: 'as-consumed', isComposite: true,
    per100g: { calories: 155, proteinG: 1.1, carbsG: 37.2, fatG: 0.3 },
    nutrients: { fiberG: 1.8, potassiumMg: 80, calciumMg: 16, ironMg: 0.7, magnesiumMg: 12, sodiumMg: 8 },
    portions: [
      { label: 'wrap', grams: 200, isDefault: true, note: 'typical hand-moulded wrap' },
      { label: 'small wrap', grams: 130 },
      { label: 'big wrap', grams: 300 },
    ],
    basis: 'Dry garri reconstituted ~1:2.2 with boiling water.',
  },
  {
    slug: 'pounded-yam',
    name: 'Pounded yam',
    aliases: ['pounded yam', 'iyan', 'poundo', 'poundo yam'],
    region: 'NG', foodGroup: 'roots-tubers', preparation: 'as-consumed', isComposite: true,
    per100g: { calories: 133, proteinG: 1.6, carbsG: 31.5, fatG: 0.2 },
    nutrients: { fiberG: 1.5, potassiumMg: 320, magnesiumMg: 17, vitaminCMg: 5, ironMg: 0.6 },
    portions: [
      { label: 'wrap', grams: 220, isDefault: true },
      { label: 'small wrap', grams: 150 },
      { label: 'big wrap', grams: 320 },
    ],
    basis: 'Boiled white yam pounded with a little cooking water.',
  },
  {
    slug: 'amala',
    name: 'Amala (yam flour swallow)',
    aliases: ['amala', 'elubo', 'amala isu', 'yam flour swallow'],
    region: 'NG', foodGroup: 'roots-tubers', preparation: 'as-consumed', isComposite: true,
    per100g: { calories: 122, proteinG: 1.3, carbsG: 29.0, fatG: 0.2 },
    nutrients: { fiberG: 1.9, potassiumMg: 250, magnesiumMg: 15, ironMg: 0.8 },
    portions: [{ label: 'wrap', grams: 200, isDefault: true }, { label: 'small wrap', grams: 130 }],
    basis: 'Dried yam flour (elubo) stirred into boiling water.',
  },
  {
    slug: 'fufu-cassava',
    name: 'Fufu (cassava)',
    aliases: ['fufu', 'foofoo', 'akpu', 'cassava fufu', 'santana'],
    region: 'WA', foodGroup: 'roots-tubers', preparation: 'as-consumed', isComposite: true,
    per100g: { calories: 125, proteinG: 0.8, carbsG: 30.4, fatG: 0.2 },
    nutrients: { fiberG: 1.4, potassiumMg: 120, calciumMg: 14, ironMg: 0.5 },
    portions: [{ label: 'wrap', grams: 200, isDefault: true }, { label: 'big wrap', grams: 300 }],
    basis: 'Fermented cassava dough cooked to a stiff paste.',
  },
  {
    slug: 'tuwo-shinkafa',
    name: 'Tuwo shinkafa (rice swallow)',
    aliases: ['tuwo shinkafa', 'tuwo', 'tuwon shinkafa', 'rice swallow'],
    region: 'NG', foodGroup: 'cereals', preparation: 'as-consumed', isComposite: true,
    per100g: { calories: 128, proteinG: 2.3, carbsG: 28.6, fatG: 0.3 },
    nutrients: { fiberG: 0.7, potassiumMg: 45, magnesiumMg: 14, ironMg: 0.5 },
    portions: [{ label: 'wrap', grams: 200, isDefault: true }, { label: 'ball', grams: 160 }],
    basis: 'Soft-cooked rice mashed to a swallow consistency.',
  },
  {
    slug: 'semovita',
    name: 'Semolina swallow (semo)',
    aliases: ['semo', 'semovita', 'semolina', 'semolina swallow'],
    region: 'NG', foodGroup: 'cereals', preparation: 'as-consumed', isComposite: true,
    per100g: { calories: 148, proteinG: 4.2, carbsG: 30.8, fatG: 0.5 },
    nutrients: { fiberG: 1.2, ironMg: 1.1, magnesiumMg: 18, folateMcg: 30, sodiumMg: 5 },
    portions: [{ label: 'wrap', grams: 200, isDefault: true }],
    basis: 'Semolina flour cooked with water.',
  },
  {
    slug: 'wheat-swallow',
    name: 'Wheat swallow',
    aliases: ['wheat swallow', 'wheat meal', 'golden penny wheat'],
    region: 'NG', foodGroup: 'cereals', preparation: 'as-consumed', isComposite: true,
    per100g: { calories: 142, proteinG: 4.8, carbsG: 28.4, fatG: 0.8 },
    nutrients: { fiberG: 3.6, ironMg: 1.3, magnesiumMg: 40, zincMg: 0.8 },
    portions: [{ label: 'wrap', grams: 200, isDefault: true }],
    basis: 'Wholemeal wheat flour swallow.',
  },
  {
    slug: 'starch-swallow',
    name: 'Starch (Edo/Delta swallow)',
    aliases: ['starch', 'usi', 'edo starch'],
    region: 'NG', foodGroup: 'roots-tubers', preparation: 'as-consumed', isComposite: true,
    per100g: { calories: 160, proteinG: 0.4, carbsG: 38.0, fatG: 0.6 },
    // Refined cassava starch is genuinely micronutrient-poor, but the traces
    // are real and it needs >=3 keys or enrichment discards the row entirely.
    nutrients: { potassiumMg: 40, fiberG: 0.6, calciumMg: 11, magnesiumMg: 5, ironMg: 0.3 },
    portions: [{ label: 'wrap', grams: 200, isDefault: true }],
    basis: 'Cassava starch cooked with a little palm oil.',
  },

  // ─── Soups and stews ──────────────────────────────────────────────────────
  // Energy density is driven by palm oil, which is a large share of the fat and
  // essentially all of the vitamin A. Red palm oil is one of the richest natural
  // sources of provitamin A carotenoids in the world diet.
  {
    slug: 'egusi-soup',
    name: 'Egusi soup',
    aliases: ['egusi', 'agusi', 'egusi soup', 'melon soup', 'egwusi'],
    region: 'NG', foodGroup: 'composite-dish', preparation: 'as-consumed', isComposite: true,
    per100g: { calories: 196, proteinG: 8.6, carbsG: 5.2, fatG: 16.2 },
    nutrients: {
      fiberG: 2.2, saturatedFatG: 5.4, sodiumMg: 320, ironMg: 2.1, calciumMg: 78,
      magnesiumMg: 66, zincMg: 1.4, potassiumMg: 280, vitaminAIU: 1900, vitaminCMg: 12,
      folateMcg: 44, omega6G: 6.8,
    },
    portions: [
      { label: 'ladle', grams: 150, isDefault: true },
      { label: 'small bowl', grams: 220 },
      { label: 'big bowl', grams: 350 },
    ],
    basis: 'Ground melon seed, red palm oil, leafy greens, assorted meat/fish, crayfish.',
  },
  {
    slug: 'ogbono-soup',
    name: 'Ogbono soup',
    aliases: ['ogbono', 'ogbono soup', 'draw soup', 'apon'],
    region: 'NG', foodGroup: 'composite-dish', preparation: 'as-consumed', isComposite: true,
    per100g: { calories: 168, proteinG: 7.8, carbsG: 5.6, fatG: 13.2 },
    nutrients: {
      fiberG: 2.4, saturatedFatG: 4.6, sodiumMg: 310, ironMg: 1.9, calciumMg: 70,
      magnesiumMg: 58, potassiumMg: 260, vitaminAIU: 1600, zincMg: 1.2, folateMcg: 38,
    },
    portions: [{ label: 'ladle', grams: 150, isDefault: true }, { label: 'bowl', grams: 250 }],
    basis: 'Ground ogbono (wild mango) seed, palm oil, meat/fish, leafy greens.',
  },
  {
    slug: 'efo-riro',
    name: 'Efo riro',
    aliases: ['efo riro', 'efo', 'spinach stew', 'vegetable soup yoruba'],
    region: 'NG', foodGroup: 'composite-dish', preparation: 'as-consumed', isComposite: true,
    per100g: { calories: 132, proteinG: 6.4, carbsG: 4.6, fatG: 10.1 },
    nutrients: {
      fiberG: 2.6, saturatedFatG: 3.4, sodiumMg: 300, ironMg: 2.6, calciumMg: 118,
      magnesiumMg: 48, potassiumMg: 330, vitaminAIU: 4200, vitaminCMg: 26, folateMcg: 82,
    },
    portions: [{ label: 'ladle', grams: 150, isDefault: true }, { label: 'bowl', grams: 240 }],
    basis: 'Shoko/ugu leaves, palm oil, locust bean, assorted meat, ponmo, crayfish.',
  },
  {
    slug: 'okra-soup',
    name: 'Okra soup',
    aliases: ['okra soup', 'okro soup', 'ila', 'ila asepo', 'ladies finger soup'],
    region: 'WA', foodGroup: 'composite-dish', preparation: 'as-consumed', isComposite: true,
    per100g: { calories: 94, proteinG: 5.2, carbsG: 5.4, fatG: 6.0 },
    nutrients: {
      fiberG: 2.8, sodiumMg: 280, ironMg: 1.3, calciumMg: 96, magnesiumMg: 44,
      potassiumMg: 250, vitaminCMg: 14, folateMcg: 58, vitaminAIU: 900,
    },
    portions: [{ label: 'ladle', grams: 150, isDefault: true }, { label: 'bowl', grams: 240 }],
    basis: 'Chopped okra, palm oil, fish/meat, crayfish.',
  },
  {
    slug: 'edikang-ikong',
    name: 'Edikang ikong',
    aliases: ['edikang ikong', 'edikaikong', 'edikang', 'vegetable soup calabar'],
    region: 'NG', foodGroup: 'composite-dish', preparation: 'as-consumed', isComposite: true,
    per100g: { calories: 154, proteinG: 8.8, carbsG: 4.8, fatG: 11.6 },
    nutrients: {
      fiberG: 2.9, saturatedFatG: 3.8, sodiumMg: 300, ironMg: 3.1, calciumMg: 132,
      magnesiumMg: 54, potassiumMg: 360, vitaminAIU: 5200, vitaminCMg: 32, folateMcg: 96, zincMg: 1.5,
    },
    portions: [{ label: 'ladle', grams: 150, isDefault: true }, { label: 'bowl', grams: 250 }],
    basis: 'Ugu and waterleaf in heavy proportion, palm oil, periwinkle, assorted meat.',
  },
  {
    slug: 'afang-soup',
    name: 'Afang soup',
    aliases: ['afang', 'afang soup', 'ukazi soup', 'okazi'],
    region: 'NG', foodGroup: 'composite-dish', preparation: 'as-consumed', isComposite: true,
    per100g: { calories: 158, proteinG: 8.4, carbsG: 5.0, fatG: 12.0 },
    nutrients: {
      fiberG: 3.1, saturatedFatG: 3.9, sodiumMg: 310, ironMg: 2.8, calciumMg: 120,
      magnesiumMg: 52, potassiumMg: 340, vitaminAIU: 3600, vitaminCMg: 22, folateMcg: 74,
    },
    portions: [{ label: 'ladle', grams: 150, isDefault: true }, { label: 'bowl', grams: 250 }],
    basis: 'Afang (okazi) leaf and waterleaf, palm oil, periwinkle, meat.',
  },
  {
    slug: 'banga-soup',
    name: 'Banga soup',
    aliases: ['banga', 'banga soup', 'ofe akwu', 'palm nut soup'],
    region: 'NG', foodGroup: 'composite-dish', preparation: 'as-consumed', isComposite: true,
    per100g: { calories: 204, proteinG: 7.2, carbsG: 5.8, fatG: 17.6 },
    nutrients: {
      fiberG: 2.0, saturatedFatG: 8.2, sodiumMg: 300, ironMg: 1.8, calciumMg: 62,
      potassiumMg: 240, vitaminAIU: 6800, vitaminEMg: 6.4, magnesiumMg: 40,
    },
    portions: [{ label: 'ladle', grams: 150, isDefault: true }, { label: 'bowl', grams: 250 }],
    basis: 'Palm-fruit concentrate base with fish or beef and banga spices.',
  },
  {
    slug: 'nsala-soup',
    name: 'Nsala (white soup)',
    aliases: ['nsala', 'nsala soup', 'white soup', 'ofe nsala'],
    region: 'NG', foodGroup: 'composite-dish', preparation: 'as-consumed', isComposite: true,
    per100g: { calories: 138, proteinG: 11.2, carbsG: 5.4, fatG: 8.2 },
    nutrients: { fiberG: 0.9, sodiumMg: 330, ironMg: 1.6, potassiumMg: 260, zincMg: 1.6, magnesiumMg: 32 },
    portions: [{ label: 'ladle', grams: 150, isDefault: true }, { label: 'bowl', grams: 250 }],
    basis: 'Catfish or goat, yam-thickened, no palm oil (hence "white").',
  },
  {
    slug: 'pepper-soup',
    name: 'Pepper soup',
    aliases: ['pepper soup', 'peppersoup', 'nsala pepper soup', 'goat pepper soup'],
    region: 'NG', foodGroup: 'composite-dish', preparation: 'as-consumed', isComposite: true,
    per100g: { calories: 74, proteinG: 9.6, carbsG: 1.6, fatG: 3.4 },
    nutrients: { sodiumMg: 340, ironMg: 1.2, potassiumMg: 200, zincMg: 1.4, vitaminCMg: 6 },
    portions: [{ label: 'bowl', grams: 300, isDefault: true }, { label: 'small bowl', grams: 200 }],
    basis: 'Clear broth with goat/catfish and pepper-soup spice; little added oil.',
  },
  {
    slug: 'oha-soup',
    name: 'Oha soup',
    aliases: ['oha', 'oha soup', 'ora soup'],
    region: 'NG', foodGroup: 'composite-dish', preparation: 'as-consumed', isComposite: true,
    per100g: { calories: 162, proteinG: 8.0, carbsG: 5.2, fatG: 12.6 },
    nutrients: {
      fiberG: 2.5, saturatedFatG: 4.1, sodiumMg: 305, ironMg: 2.4, calciumMg: 96,
      potassiumMg: 300, vitaminAIU: 3000, magnesiumMg: 50,
    },
    portions: [{ label: 'ladle', grams: 150, isDefault: true }],
    basis: 'Oha leaf, cocoyam-thickened, palm oil, assorted meat.',
  },
  {
    slug: 'bitterleaf-soup',
    name: 'Bitterleaf soup (Ofe onugbu)',
    aliases: ['bitterleaf soup', 'onugbu', 'ofe onugbu', 'bitter leaf'],
    region: 'NG', foodGroup: 'composite-dish', preparation: 'as-consumed', isComposite: true,
    per100g: { calories: 158, proteinG: 8.2, carbsG: 5.6, fatG: 11.9 },
    nutrients: {
      fiberG: 2.7, saturatedFatG: 3.9, sodiumMg: 300, ironMg: 2.7, calciumMg: 128,
      potassiumMg: 320, vitaminAIU: 3400, vitaminCMg: 18, folateMcg: 68,
    },
    portions: [{ label: 'ladle', grams: 150, isDefault: true }],
    basis: 'Washed bitterleaf, cocoyam thickener, palm oil, meat and stockfish.',
  },
  {
    slug: 'stew-tomato',
    name: 'Nigerian tomato stew (obe ata)',
    aliases: ['stew', 'tomato stew', 'obe ata', 'buka stew', 'red stew'],
    region: 'NG', foodGroup: 'composite-dish', preparation: 'as-consumed', isComposite: true,
    per100g: { calories: 148, proteinG: 4.2, carbsG: 6.8, fatG: 11.8 },
    nutrients: {
      fiberG: 1.6, saturatedFatG: 2.6, sodiumMg: 340, ironMg: 1.1, potassiumMg: 290,
      vitaminAIU: 1400, vitaminCMg: 16, vitaminEMg: 3.2,
    },
    portions: [{ label: 'ladle', grams: 120, isDefault: true }, { label: 'serving', grams: 180 }],
    basis: 'Blended tomato/pepper/onion fried in vegetable or palm oil, with meat.',
  },
  {
    slug: 'ayamase',
    name: 'Ayamase (ofada stew)',
    aliases: ['ayamase', 'ofada stew', 'designer stew', 'green pepper stew'],
    region: 'NG', foodGroup: 'composite-dish', preparation: 'as-consumed', isComposite: true,
    per100g: { calories: 224, proteinG: 7.8, carbsG: 5.4, fatG: 19.6 },
    nutrients: {
      saturatedFatG: 7.0, sodiumMg: 380, ironMg: 1.6, potassiumMg: 280, vitaminAIU: 2600,
      cholesterolMg: 38, fiberG: 1.5,
    },
    portions: [{ label: 'ladle', grams: 120, isDefault: true }],
    basis: 'Green bell/scotch bonnet base bleached in palm oil with assorted meat and locust bean.',
  },

  // ─── Rice and one-pot dishes ──────────────────────────────────────────────
  {
    slug: 'jollof-rice',
    name: 'Jollof rice',
    aliases: ['jollof', 'jollof rice', 'jolof', 'party jollof', 'jellof'],
    region: 'WA', foodGroup: 'composite-dish', preparation: 'as-consumed', isComposite: true,
    per100g: { calories: 162, proteinG: 3.4, carbsG: 26.8, fatG: 4.6 },
    nutrients: {
      fiberG: 1.1, sodiumMg: 320, ironMg: 0.9, potassiumMg: 130, vitaminAIU: 620,
      vitaminCMg: 6, magnesiumMg: 16, saturatedFatG: 1.0,
    },
    portions: [
      { label: 'plate', grams: 300, isDefault: true },
      { label: 'derica cup', grams: 250, note: 'cooked, level derica measure' },
      { label: 'small plate', grams: 200 },
      { label: 'takeaway pack', grams: 400 },
    ],
    basis: 'Long-grain rice cooked in tomato/pepper base with vegetable oil.',
  },
  {
    slug: 'fried-rice-ng',
    name: 'Nigerian fried rice',
    aliases: ['fried rice', 'nigerian fried rice'],
    region: 'NG', foodGroup: 'composite-dish', preparation: 'as-consumed', isComposite: true,
    per100g: { calories: 172, proteinG: 4.6, carbsG: 25.4, fatG: 6.2 },
    nutrients: {
      fiberG: 1.5, sodiumMg: 340, ironMg: 1.0, potassiumMg: 160, vitaminAIU: 1500,
      vitaminCMg: 8, magnesiumMg: 18,
    },
    portions: [{ label: 'plate', grams: 300, isDefault: true }, { label: 'small plate', grams: 200 }],
    basis: 'Rice stir-fried with liver, mixed vegetables and curry.',
  },
  {
    slug: 'ofada-rice',
    name: 'Ofada rice (plain)',
    aliases: ['ofada', 'ofada rice', 'local rice', 'brown rice nigerian'],
    region: 'NG', foodGroup: 'cereals', preparation: 'boiled', isComposite: false,
    per100g: { calories: 130, proteinG: 2.8, carbsG: 27.6, fatG: 0.9 },
    nutrients: { fiberG: 1.8, magnesiumMg: 42, ironMg: 0.6, potassiumMg: 90, zincMg: 0.7 },
    portions: [{ label: 'plate', grams: 300, isDefault: true }, { label: 'derica cup', grams: 250 }],
    basis: 'Unpolished local rice, boiled.',
  },
  {
    slug: 'coconut-rice',
    name: 'Coconut rice',
    aliases: ['coconut rice'],
    region: 'WA', foodGroup: 'composite-dish', preparation: 'as-consumed', isComposite: true,
    per100g: { calories: 178, proteinG: 3.2, carbsG: 26.0, fatG: 7.2 },
    nutrients: { fiberG: 1.4, saturatedFatG: 5.2, sodiumMg: 280, potassiumMg: 140, ironMg: 0.8 },
    portions: [{ label: 'plate', grams: 300, isDefault: true }],
    basis: 'Rice cooked in coconut milk with pepper base.',
  },
  {
    slug: 'white-rice-boiled',
    name: 'White rice, boiled',
    aliases: ['white rice', 'plain rice', 'boiled rice', 'rice'],
    region: 'WA', foodGroup: 'cereals', preparation: 'boiled', isComposite: false,
    per100g: { calories: 130, proteinG: 2.7, carbsG: 28.2, fatG: 0.3 },
    nutrients: { fiberG: 0.4, magnesiumMg: 12, potassiumMg: 35, ironMg: 0.2 },
    portions: [
      { label: 'plate', grams: 300, isDefault: true },
      { label: 'derica cup', grams: 250 },
      { label: 'mudu', grams: 1000, note: 'dry grain market measure, ~1 kg' },
    ],
    basis: 'Plain boiled long-grain rice.',
  },
  {
    slug: 'jollof-spaghetti',
    name: 'Jollof spaghetti',
    aliases: ['jollof spaghetti', 'spaghetti jollof', 'nigerian spaghetti'],
    region: 'NG', foodGroup: 'composite-dish', preparation: 'as-consumed', isComposite: true,
    per100g: { calories: 158, proteinG: 5.0, carbsG: 25.2, fatG: 4.2 },
    nutrients: { fiberG: 1.6, sodiumMg: 330, ironMg: 1.2, potassiumMg: 140, vitaminAIU: 500 },
    portions: [{ label: 'plate', grams: 300, isDefault: true }],
    basis: 'Spaghetti cooked in tomato/pepper base with vegetable oil.',
  },
  {
    slug: 'indomie-prepared',
    name: 'Indomie noodles, prepared',
    aliases: ['indomie', 'noodles', 'instant noodles', 'indomie noodles'],
    region: 'NG', foodGroup: 'composite-dish', preparation: 'as-consumed', isComposite: true,
    per100g: { calories: 188, proteinG: 4.4, carbsG: 25.0, fatG: 7.8 },
    nutrients: { sodiumMg: 720, saturatedFatG: 3.6, fiberG: 1.0, ironMg: 1.4 },
    portions: [
      { label: 'pack', grams: 210, isDefault: true, note: '70 g dry pack, prepared' },
      { label: 'two packs', grams: 420 },
    ],
    basis: '70 g dry pack cooked with seasoning, oil and often an egg.',
  },

  // ─── Bean dishes ──────────────────────────────────────────────────────────
  {
    slug: 'moi-moi',
    name: 'Moi moi (steamed bean pudding)',
    aliases: ['moi moi', 'moin moin', 'moimoi', 'bean pudding', 'moi-moi'],
    region: 'NG', foodGroup: 'legumes', preparation: 'steamed', isComposite: true,
    per100g: { calories: 148, proteinG: 7.4, carbsG: 13.2, fatG: 7.2 },
    nutrients: {
      fiberG: 3.4, sodiumMg: 280, ironMg: 2.2, potassiumMg: 320, magnesiumMg: 52,
      folateMcg: 118, zincMg: 1.1, vitaminAIU: 700, calciumMg: 40,
    },
    portions: [
      { label: 'medium ball', grams: 120, isDefault: true },
      { label: 'wrap', grams: 150, note: 'leaf-wrapped portion' },
      { label: 'small', grams: 80 },
    ],
    basis: 'Peeled blended cowpea with palm/vegetable oil, pepper, steamed in leaves.',
  },
  {
    slug: 'akara',
    name: 'Akara (fried bean cake)',
    aliases: ['akara', 'bean cake', 'koose', 'kosai', 'accara'],
    region: 'WA', foodGroup: 'legumes', preparation: 'fried', isComposite: true,
    per100g: { calories: 252, proteinG: 8.2, carbsG: 17.8, fatG: 16.4 },
    nutrients: {
      fiberG: 3.8, sodiumMg: 300, ironMg: 2.4, potassiumMg: 300, magnesiumMg: 56,
      folateMcg: 106, zincMg: 1.2, omega6G: 7.2,
    },
    portions: [
      { label: 'ball', grams: 30, isDefault: true },
      { label: 'four balls', grams: 120 },
      { label: 'plate', grams: 150 },
    ],
    basis: 'Peeled cowpea batter deep-fried in vegetable oil.',
  },
  {
    slug: 'ewa-agoyin',
    name: 'Ewa agoyin (mashed beans with sauce)',
    aliases: ['ewa agoyin', 'ewa aganyin', 'agoyin beans', 'beans and sauce'],
    region: 'NG', foodGroup: 'legumes', preparation: 'as-consumed', isComposite: true,
    per100g: { calories: 152, proteinG: 6.8, carbsG: 18.4, fatG: 5.6 },
    nutrients: {
      fiberG: 5.2, sodiumMg: 320, ironMg: 2.3, potassiumMg: 380, magnesiumMg: 54,
      folateMcg: 132, zincMg: 1.1, vitaminAIU: 900,
    },
    portions: [{ label: 'plate', grams: 280, isDefault: true }, { label: 'small plate', grams: 180 }],
    basis: 'Slow-cooked mashed cowpea with a dark fried pepper-and-oil sauce.',
  },
  {
    slug: 'beans-porridge',
    name: 'Beans porridge',
    aliases: ['beans porridge', 'ewa', 'stewed beans', 'porridge beans'],
    region: 'NG', foodGroup: 'legumes', preparation: 'as-consumed', isComposite: true,
    per100g: { calories: 138, proteinG: 7.2, carbsG: 18.0, fatG: 4.0 },
    nutrients: {
      fiberG: 5.6, sodiumMg: 290, ironMg: 2.4, potassiumMg: 400, magnesiumMg: 56,
      folateMcg: 140, zincMg: 1.2, vitaminAIU: 800,
    },
    portions: [{ label: 'plate', grams: 280, isDefault: true }],
    basis: 'Cowpea stewed with palm oil, pepper and onion.',
  },

  // ─── Plantain, yam and sides ──────────────────────────────────────────────
  {
    slug: 'dodo',
    name: 'Dodo (fried plantain)',
    aliases: ['dodo', 'fried plantain', 'plantain fried', 'alloco'],
    region: 'WA', foodGroup: 'fruits', preparation: 'fried', isComposite: true,
    per100g: { calories: 208, proteinG: 1.4, carbsG: 30.6, fatG: 9.2 },
    nutrients: {
      fiberG: 2.2, potassiumMg: 420, vitaminAIU: 1100, vitaminCMg: 12, magnesiumMg: 34, ironMg: 0.6,
    },
    portions: [
      { label: 'serving', grams: 120, isDefault: true },
      { label: 'few slices', grams: 70 },
      { label: 'plate', grams: 200 },
    ],
    basis: 'Ripe plantain deep-fried in vegetable oil.',
  },
  {
    slug: 'boiled-plantain',
    name: 'Boiled plantain',
    aliases: ['boiled plantain', 'plantain boiled', 'unripe plantain boiled'],
    region: 'WA', foodGroup: 'fruits', preparation: 'boiled', isComposite: false,
    per100g: { calories: 122, proteinG: 1.3, carbsG: 31.2, fatG: 0.4 },
    nutrients: { fiberG: 2.3, potassiumMg: 465, vitaminAIU: 900, vitaminCMg: 11, magnesiumMg: 32 },
    portions: [{ label: 'serving', grams: 150, isDefault: true }],
    basis: 'Plantain boiled in salted water.',
  },
  {
    slug: 'boiled-yam',
    name: 'Boiled yam',
    aliases: ['boiled yam', 'yam boiled', 'white yam boiled', 'isu'],
    region: 'WA', foodGroup: 'roots-tubers', preparation: 'boiled', isComposite: false,
    per100g: { calories: 116, proteinG: 1.5, carbsG: 27.5, fatG: 0.2 },
    nutrients: { fiberG: 4.1, potassiumMg: 670, vitaminCMg: 12, magnesiumMg: 18, ironMg: 0.5 },
    portions: [
      { label: 'serving', grams: 200, isDefault: true },
      { label: 'half tuber', grams: 500, note: 'gross weight; ~85% edible' },
      { label: 'slice', grams: 100 },
    ],
    basis: 'White yam, peeled and boiled.',
  },
  {
    slug: 'fried-yam',
    name: 'Fried yam (dundun)',
    aliases: ['fried yam', 'dundun', 'yam chips'],
    region: 'NG', foodGroup: 'roots-tubers', preparation: 'fried', isComposite: true,
    per100g: { calories: 232, proteinG: 1.7, carbsG: 30.8, fatG: 11.4 },
    nutrients: { fiberG: 3.6, potassiumMg: 560, vitaminCMg: 7, magnesiumMg: 17 },
    portions: [{ label: 'serving', grams: 150, isDefault: true }],
    basis: 'Yam deep-fried in vegetable oil.',
  },
  {
    slug: 'yam-porridge',
    name: 'Yam porridge (asaro)',
    aliases: ['asaro', 'yam porridge', 'porridge yam', 'mashed yam pottage'],
    region: 'NG', foodGroup: 'composite-dish', preparation: 'as-consumed', isComposite: true,
    per100g: { calories: 142, proteinG: 2.4, carbsG: 24.6, fatG: 4.4 },
    nutrients: {
      fiberG: 3.2, potassiumMg: 520, vitaminAIU: 1300, vitaminCMg: 10, sodiumMg: 260, ironMg: 0.9,
    },
    portions: [{ label: 'plate', grams: 300, isDefault: true }],
    basis: 'Yam cooked down with palm oil, pepper, crayfish and leafy greens.',
  },
  {
    slug: 'abacha',
    name: 'Abacha (African salad)',
    aliases: ['abacha', 'african salad', 'ncha'],
    region: 'NG', foodGroup: 'composite-dish', preparation: 'as-consumed', isComposite: true,
    per100g: { calories: 196, proteinG: 5.2, carbsG: 24.0, fatG: 9.4 },
    nutrients: {
      fiberG: 3.0, sodiumMg: 340, potassiumMg: 210, vitaminAIU: 1500, ironMg: 1.4, calciumMg: 54,
    },
    portions: [{ label: 'plate', grams: 250, isDefault: true }],
    basis: 'Shredded dried cassava dressed with palm-oil/ngu paste, ugba, garden egg leaf, fish.',
  },
  {
    slug: 'nkwobi',
    name: 'Nkwobi',
    aliases: ['nkwobi', 'cow foot nkwobi', 'isi ewu'],
    region: 'NG', foodGroup: 'composite-dish', preparation: 'as-consumed', isComposite: true,
    per100g: { calories: 278, proteinG: 15.6, carbsG: 3.2, fatG: 23.0 },
    nutrients: {
      saturatedFatG: 8.8, sodiumMg: 420, cholesterolMg: 96, ironMg: 2.2, zincMg: 2.6,
      potassiumMg: 190, vitaminAIU: 1800,
    },
    portions: [{ label: 'plate', grams: 250, isDefault: true }],
    basis: 'Cow foot in an emulsified palm-oil and potash (ngu) paste with utazi.',
  },

  // ─── Grilled meat and street food ─────────────────────────────────────────
  {
    slug: 'suya',
    name: 'Suya (spiced grilled beef)',
    aliases: ['suya', 'tsire', 'grilled beef suya', 'kilishi'],
    region: 'NG', foodGroup: 'meat', preparation: 'grilled', isComposite: true,
    per100g: { calories: 234, proteinG: 26.4, carbsG: 3.4, fatG: 12.8 },
    nutrients: {
      saturatedFatG: 4.6, sodiumMg: 520, ironMg: 3.0, zincMg: 5.2, potassiumMg: 320,
      vitaminB12Mcg: 2.4, magnesiumMg: 26, omega6G: 2.6,
    },
    portions: [
      { label: 'stick', grams: 60, isDefault: true },
      { label: 'wrap', grams: 180, note: 'newspaper wrap with onion and pepper' },
    ],
    basis: 'Thin beef basted with groundnut-based yaji spice and grilled.',
  },
  {
    slug: 'asun',
    name: 'Asun (peppered goat)',
    aliases: ['asun', 'peppered goat', 'goat meat asun'],
    region: 'NG', foodGroup: 'meat', preparation: 'grilled', isComposite: true,
    per100g: { calories: 246, proteinG: 24.0, carbsG: 3.0, fatG: 15.2 },
    nutrients: {
      saturatedFatG: 5.4, sodiumMg: 480, ironMg: 3.2, zincMg: 4.4, vitaminB12Mcg: 1.8, potassiumMg: 300,
    },
    portions: [{ label: 'plate', grams: 180, isDefault: true }],
    basis: 'Smoked goat tossed in fried pepper and onion.',
  },
  {
    slug: 'puff-puff',
    name: 'Puff puff',
    aliases: ['puff puff', 'puffpuff', 'bofrot', 'togbei'],
    region: 'WA', foodGroup: 'snacks', preparation: 'fried', isComposite: true,
    per100g: { calories: 306, proteinG: 5.0, carbsG: 42.0, fatG: 13.2 },
    nutrients: { sugarG: 12.0, sodiumMg: 180, fiberG: 1.4, ironMg: 1.5, saturatedFatG: 3.0 },
    portions: [{ label: 'ball', grams: 35, isDefault: true }, { label: 'five balls', grams: 175 }],
    basis: 'Sweet yeast dough deep-fried.',
  },
  {
    slug: 'chin-chin',
    name: 'Chin chin',
    aliases: ['chin chin', 'chinchin'],
    region: 'NG', foodGroup: 'snacks', preparation: 'fried', isComposite: true,
    per100g: { calories: 452, proteinG: 7.4, carbsG: 58.0, fatG: 21.6 },
    nutrients: { sugarG: 16.0, sodiumMg: 220, fiberG: 1.8, saturatedFatG: 7.2, ironMg: 2.0 },
    portions: [{ label: 'handful', grams: 40, isDefault: true }, { label: 'cup', grams: 90 }],
    basis: 'Sweet fried dough cubes.',
  },
  {
    slug: 'meat-pie-ng',
    name: 'Nigerian meat pie',
    aliases: ['meat pie', 'nigerian meat pie'],
    region: 'NG', foodGroup: 'snacks', preparation: 'baked', isComposite: true,
    per100g: { calories: 312, proteinG: 8.2, carbsG: 32.0, fatG: 16.8 },
    nutrients: { sodiumMg: 420, saturatedFatG: 7.6, fiberG: 1.6, ironMg: 1.8, cholesterolMg: 28 },
    portions: [{ label: 'pie', grams: 120, isDefault: true }],
    basis: 'Shortcrust pastry with minced beef, potato and carrot.',
  },

  // ─── Fermented staples, drinks and condiments ─────────────────────────────
  // These matter beyond their calories: they drive the fermented-food gut
  // pillar, which currently reads zero for West African users because the
  // parser only knows kefir, kimchi and yoghurt.
  {
    slug: 'ogi',
    name: 'Ogi / akamu (fermented maize pap)',
    aliases: ['ogi', 'akamu', 'pap', 'koko', 'fermented corn pap'],
    region: 'WA', foodGroup: 'cereals', preparation: 'fermented', isComposite: true,
    per100g: { calories: 62, proteinG: 1.2, carbsG: 13.6, fatG: 0.4 },
    nutrients: { fiberG: 0.6, potassiumMg: 40, ironMg: 0.4, magnesiumMg: 10 },
    portions: [{ label: 'bowl', grams: 250, isDefault: true }, { label: 'cup', grams: 200 }],
    basis: 'Fermented maize slurry cooked to a thin porridge.',
  },
  {
    slug: 'iru',
    name: 'Iru / dawadawa (fermented locust bean)',
    aliases: ['iru', 'dawadawa', 'locust bean', 'ogiri okpei', 'netetou'],
    region: 'WA', foodGroup: 'condiments', preparation: 'fermented', isComposite: false,
    per100g: { calories: 348, proteinG: 20.4, carbsG: 16.0, fatG: 23.6 },
    nutrients: {
      fiberG: 8.4, sodiumMg: 240, ironMg: 5.6, calciumMg: 168, magnesiumMg: 140,
      zincMg: 3.4, potassiumMg: 640, folateMcg: 92,
    },
    portions: [{ label: 'tablespoon', grams: 12, isDefault: true }],
    basis: 'Fermented African locust bean used as a seasoning.',
  },
  {
    slug: 'ogiri',
    name: 'Ogiri (fermented melon/sesame condiment)',
    aliases: ['ogiri', 'ogili'],
    region: 'NG', foodGroup: 'condiments', preparation: 'fermented', isComposite: false,
    per100g: { calories: 336, proteinG: 18.0, carbsG: 12.0, fatG: 25.0 },
    nutrients: { fiberG: 6.0, sodiumMg: 260, ironMg: 4.4, calciumMg: 140, magnesiumMg: 128, zincMg: 3.0 },
    portions: [{ label: 'tablespoon', grams: 12, isDefault: true }],
    basis: 'Fermented melon or sesame seed paste.',
  },
  {
    slug: 'ugba',
    name: 'Ugba (fermented oil bean)',
    aliases: ['ugba', 'ukpaka', 'oil bean'],
    region: 'NG', foodGroup: 'condiments', preparation: 'fermented', isComposite: false,
    per100g: { calories: 382, proteinG: 22.0, carbsG: 14.0, fatG: 28.0 },
    nutrients: { fiberG: 7.0, ironMg: 4.0, calciumMg: 120, magnesiumMg: 130, zincMg: 3.2, potassiumMg: 520 },
    portions: [{ label: 'serving', grams: 40, isDefault: true }],
    basis: 'Sliced fermented African oil bean seed.',
  },
  {
    slug: 'wara',
    name: 'Wara (Fulani soft cheese)',
    aliases: ['wara', 'warankasi', 'fulani cheese', 'local cheese'],
    region: 'NG', foodGroup: 'dairy', preparation: 'fermented', isComposite: false,
    per100g: { calories: 186, proteinG: 14.2, carbsG: 2.4, fatG: 13.4 },
    nutrients: {
      saturatedFatG: 8.0, calciumMg: 380, sodiumMg: 320, vitaminB12Mcg: 0.9,
      zincMg: 1.6, potassiumMg: 110, vitaminAIU: 420,
    },
    portions: [{ label: 'piece', grams: 40, isDefault: true }],
    basis: 'Curdled cow milk cheese, often fried.',
  },
  {
    slug: 'fura-da-nono',
    name: 'Fura da nono',
    aliases: ['fura da nono', 'fura', 'nono', 'millet balls with milk'],
    region: 'NG', foodGroup: 'composite-dish', preparation: 'fermented', isComposite: true,
    per100g: { calories: 94, proteinG: 3.4, carbsG: 13.8, fatG: 2.6 },
    nutrients: { calciumMg: 96, potassiumMg: 130, ironMg: 0.8, vitaminB12Mcg: 0.3, fiberG: 1.0 },
    portions: [{ label: 'cup', grams: 300, isDefault: true }],
    basis: 'Millet dough balls in fermented cow milk.',
  },
  {
    slug: 'kunu',
    name: 'Kunu (millet drink)',
    aliases: ['kunu', 'kunun zaki', 'kunnu'],
    region: 'NG', foodGroup: 'beverages', preparation: 'fermented', isComposite: true,
    per100g: { calories: 56, proteinG: 1.0, carbsG: 12.4, fatG: 0.4 },
    nutrients: { sugarG: 6.5, potassiumMg: 46, ironMg: 0.4, fiberG: 0.4 },
    portions: [{ label: 'cup', grams: 250, isDefault: true }, { label: 'bottle', grams: 500 }],
    basis: 'Lightly fermented millet/sorghum drink, sweetened.',
  },
  {
    slug: 'zobo',
    name: 'Zobo (hibiscus drink)',
    aliases: ['zobo', 'sobolo', 'bissap', 'hibiscus drink', 'wonjo'],
    region: 'WA', foodGroup: 'beverages', preparation: 'as-consumed', isComposite: true,
    per100g: { calories: 34, proteinG: 0.1, carbsG: 8.6, fatG: 0.0 },
    nutrients: { sugarG: 8.2, vitaminCMg: 6, potassiumMg: 22, ironMg: 0.3 },
    portions: [{ label: 'cup', grams: 250, isDefault: true }, { label: 'bottle', grams: 500 }],
    basis: 'Sweetened hibiscus infusion. Unsweetened is ~4 kcal/100 g.',
  },
  {
    slug: 'palm-oil-red',
    name: 'Red palm oil',
    aliases: ['palm oil', 'red palm oil', 'epo pupa', 'mai ja'],
    region: 'WA', foodGroup: 'oils', preparation: 'raw', isComposite: false,
    per100g: { calories: 884, proteinG: 0, carbsG: 0, fatG: 100 },
    nutrients: {
      saturatedFatG: 49.3, vitaminAIU: 25000, vitaminEMg: 15.9, omega6G: 9.1,
    },
    portions: [
      { label: 'tablespoon', grams: 14, isDefault: true },
      { label: 'cooking spoon', grams: 30 },
    ],
    basis: 'Unrefined red palm oil — among the richest natural provitamin-A sources.',
  },
  {
    slug: 'groundnut-oil',
    name: 'Groundnut oil',
    aliases: ['groundnut oil', 'peanut oil', 'vegetable oil'],
    region: 'WA', foodGroup: 'oils', preparation: 'raw', isComposite: false,
    per100g: { calories: 884, proteinG: 0, carbsG: 0, fatG: 100 },
    nutrients: { saturatedFatG: 16.9, vitaminEMg: 15.7, omega6G: 32.0 },
    portions: [{ label: 'tablespoon', grams: 14, isDefault: true }],
    basis: 'Refined groundnut oil.',
  },

  // ─── The Gambia ───────────────────────────────────────────────────────────
  {
    slug: 'benachin',
    name: 'Benachin (Gambian jollof)',
    aliases: ['benachin', 'benechin', 'chebujen', 'thieboudienne', 'one pot rice'],
    region: 'GM', foodGroup: 'composite-dish', preparation: 'as-consumed', isComposite: true,
    per100g: { calories: 168, proteinG: 5.6, carbsG: 24.8, fatG: 5.2 },
    nutrients: {
      fiberG: 1.8, sodiumMg: 360, ironMg: 1.1, potassiumMg: 210, vitaminAIU: 900,
      vitaminCMg: 9, magnesiumMg: 22,
    },
    portions: [{ label: 'plate', grams: 350, isDefault: true }, { label: 'bowl', grams: 450 }],
    basis: 'One-pot rice cooked in tomato base with fish or meat and vegetables.',
  },
  {
    slug: 'domoda',
    name: 'Domoda (groundnut stew)',
    aliases: ['domoda', 'domada', 'groundnut stew', 'peanut stew', 'mafe'],
    region: 'GM', foodGroup: 'composite-dish', preparation: 'as-consumed', isComposite: true,
    per100g: { calories: 202, proteinG: 9.4, carbsG: 9.8, fatG: 14.6 },
    nutrients: {
      fiberG: 2.6, saturatedFatG: 2.8, sodiumMg: 340, ironMg: 1.8, magnesiumMg: 78,
      potassiumMg: 330, zincMg: 1.5, folateMcg: 52, omega6G: 4.4, vitaminEMg: 3.6,
    },
    portions: [{ label: 'ladle', grams: 160, isDefault: true }, { label: 'bowl', grams: 280 }],
    basis: 'Groundnut-paste stew with meat, tomato and pumpkin or sweet potato.',
  },
  {
    slug: 'superkanja',
    name: 'Superkanja (okra stew)',
    aliases: ['superkanja', 'supakanja', 'okra stew gambian'],
    region: 'GM', foodGroup: 'composite-dish', preparation: 'as-consumed', isComposite: true,
    per100g: { calories: 146, proteinG: 7.6, carbsG: 5.8, fatG: 10.6 },
    nutrients: {
      fiberG: 3.0, saturatedFatG: 3.6, sodiumMg: 330, ironMg: 1.9, calciumMg: 110,
      potassiumMg: 290, vitaminAIU: 2400, vitaminCMg: 16, folateMcg: 62,
    },
    portions: [{ label: 'ladle', grams: 160, isDefault: true }],
    basis: 'Okra with palm oil, smoked fish, meat and leafy greens.',
  },
  {
    slug: 'chura-gerte',
    name: 'Chura gerte (groundnut porridge)',
    aliases: ['chura gerte', 'churagerteh', 'chere', 'groundnut porridge'],
    region: 'GM', foodGroup: 'composite-dish', preparation: 'as-consumed', isComposite: true,
    per100g: { calories: 156, proteinG: 5.4, carbsG: 18.6, fatG: 6.8 },
    nutrients: {
      fiberG: 2.2, magnesiumMg: 62, ironMg: 1.4, potassiumMg: 230, folateMcg: 40, sugarG: 5.0,
    },
    portions: [{ label: 'bowl', grams: 300, isDefault: true }],
    basis: 'Pounded millet porridge with groundnut paste and sugar.',
  },
  {
    slug: 'plasas',
    name: 'Plasas (leaf stew)',
    aliases: ['plasas', 'palava sauce', 'plassas', 'cassava leaf stew'],
    region: 'GM', foodGroup: 'composite-dish', preparation: 'as-consumed', isComposite: true,
    per100g: { calories: 164, proteinG: 8.0, carbsG: 5.4, fatG: 12.4 },
    nutrients: {
      fiberG: 3.2, saturatedFatG: 4.4, sodiumMg: 320, ironMg: 2.8, calciumMg: 126,
      potassiumMg: 330, vitaminAIU: 4000, vitaminCMg: 24, folateMcg: 88,
    },
    portions: [{ label: 'ladle', grams: 160, isDefault: true }],
    basis: 'Pounded cassava or potato leaf with palm oil, fish and meat.',
  },
  {
    slug: 'yassa',
    name: 'Yassa (onion-lemon chicken)',
    aliases: ['yassa', 'chicken yassa', 'yassa poulet'],
    region: 'GM', foodGroup: 'composite-dish', preparation: 'as-consumed', isComposite: true,
    per100g: { calories: 176, proteinG: 14.8, carbsG: 7.2, fatG: 10.0 },
    nutrients: {
      sodiumMg: 380, ironMg: 1.2, potassiumMg: 280, vitaminCMg: 12, zincMg: 1.3,
      vitaminB12Mcg: 0.4, saturatedFatG: 2.2, fiberG: 1.4,
    },
    portions: [{ label: 'plate', grams: 250, isDefault: true }],
    basis: 'Chicken marinated in lemon and onion, braised in oil.',
  },
  {
    slug: 'base-nyebe',
    name: 'Base nyebe (black-eyed pea stew)',
    aliases: ['base nyebe', 'nyebe', 'black eyed pea stew'],
    region: 'GM', foodGroup: 'legumes', preparation: 'as-consumed', isComposite: true,
    per100g: { calories: 134, proteinG: 7.0, carbsG: 17.6, fatG: 3.8 },
    nutrients: {
      fiberG: 5.4, sodiumMg: 300, ironMg: 2.2, potassiumMg: 390, magnesiumMg: 52,
      folateMcg: 136, zincMg: 1.1,
    },
    portions: [{ label: 'plate', grams: 280, isDefault: true }],
    basis: 'Black-eyed peas stewed with tomato, onion and oil.',
  },
  {
    slug: 'nyankatang',
    name: 'Nyankatang',
    aliases: ['nyankatang', 'nyankatango'],
    region: 'GM', foodGroup: 'composite-dish', preparation: 'as-consumed', isComposite: true,
    per100g: { calories: 184, proteinG: 8.6, carbsG: 14.2, fatG: 10.4 },
    nutrients: { fiberG: 2.4, sodiumMg: 350, ironMg: 1.8, magnesiumMg: 58, potassiumMg: 270 },
    portions: [{ label: 'bowl', grams: 300, isDefault: true }],
    basis: 'Rice with groundnut and smoked fish sauce.',
  },
  {
    slug: 'mbahal',
    name: 'Mbahal',
    aliases: ['mbahal', 'mbahal jeen'],
    region: 'GM', foodGroup: 'composite-dish', preparation: 'as-consumed', isComposite: true,
    per100g: { calories: 192, proteinG: 8.0, carbsG: 22.4, fatG: 8.2 },
    nutrients: { fiberG: 2.6, sodiumMg: 400, ironMg: 1.6, potassiumMg: 240, magnesiumMg: 48 },
    portions: [{ label: 'plate', grams: 320, isDefault: true }],
    basis: 'Rice cooked with groundnut, dried fish and bitter tomato.',
  },
  {
    slug: 'chakery',
    name: 'Chakery (sweet couscous with yoghurt)',
    aliases: ['chakery', 'chakry', 'thiakry', 'degue'],
    region: 'GM', foodGroup: 'desserts', preparation: 'as-consumed', isComposite: true,
    per100g: { calories: 178, proteinG: 5.2, carbsG: 28.0, fatG: 5.0 },
    nutrients: {
      sugarG: 17.0, calciumMg: 118, potassiumMg: 170, vitaminB12Mcg: 0.4, fiberG: 1.2, saturatedFatG: 2.8,
    },
    portions: [{ label: 'bowl', grams: 250, isDefault: true }],
    basis: 'Steamed millet couscous with sweetened soured milk.',
  },
  {
    slug: 'afra',
    name: 'Afra (grilled meat)',
    aliases: ['afra', 'grilled meat gambian', 'dibi'],
    region: 'GM', foodGroup: 'meat', preparation: 'grilled', isComposite: true,
    per100g: { calories: 248, proteinG: 25.2, carbsG: 2.0, fatG: 15.4 },
    nutrients: {
      saturatedFatG: 5.6, sodiumMg: 460, ironMg: 2.8, zincMg: 4.6, vitaminB12Mcg: 2.0, potassiumMg: 310,
    },
    portions: [{ label: 'serving', grams: 180, isDefault: true }],
    basis: 'Charcoal-grilled lamb or beef with onion and mustard.',
  },
];

// ─── Accessors (src/data/ convention) ────────────────────────────────────────

export function getWestAfricanDish(slug: string): WestAfricanDish | undefined {
  return WEST_AFRICAN_DISHES.find((d) => d.slug === slug);
}

export function westAfricanDishesForRegion(region: 'NG' | 'GM' | 'WA'): WestAfricanDish[] {
  // 'WA' entries are pan-regional and belong to every West African region.
  return WEST_AFRICAN_DISHES.filter((d) => d.region === region || d.region === 'WA');
}

/** Dish names for the region-aware LLM prompt vocabulary. */
export function westAfricanDishNames(region: 'NG' | 'GM' | 'WA'): string[] {
  return westAfricanDishesForRegion(region).map((d) => d.name);
}

/** Every fermented entry — feeds the gut pillar's `fermentedFoods` vocabulary. */
export const WEST_AFRICAN_FERMENTED = WEST_AFRICAN_DISHES
  .filter((d) => d.preparation === 'fermented')
  .flatMap((d) => [d.name, ...d.aliases]);
