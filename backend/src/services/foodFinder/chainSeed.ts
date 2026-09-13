/**
 * Curated chain menu corpus.
 *
 * These figures are transcribed from each chain's own published nutrition
 * tables. They are the ground truth the whole confidence ladder rests on: the
 * calibration harness measures the dish-name estimator against THESE numbers,
 * so an error here does not merely mis-state one burrito, it mis-calibrates
 * every independent restaurant estimate in the system.
 *
 * Consequences of that, deliberately:
 *   - every item carries the URL it came from and a `verifiedOn` date
 *   - coverage is narrow and popular rather than broad and thin; a chain's ten
 *     most-ordered items answer most real "what can I eat right now" questions
 *   - scripts/scrapeChainNutrition.ts re-checks these against the live source,
 *     because a hand-transcribed table silently drifts as menus change
 *
 * Portions are the chain's own standard serving. Macros are grams, sodium mg.
 */

export interface ChainItemSeed {
  name: string;
  section?: string;
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  sodiumMg?: number;
  fiberG?: number;
  servingGrams?: number;
  /** Diet/allergen tags asserted by the chain, not inferred by us. */
  dietTags?: string[];
}

export interface ChainSeed {
  slug: string;
  name: string;
  aliases: string[];
  cuisine: string;
  nutritionUrl: string;
  verifiedOn: string;
  items: ChainItemSeed[];
}

export const CHAIN_SEEDS: ChainSeed[] = [
  {
    slug: 'chipotle',
    name: 'Chipotle Mexican Grill',
    aliases: ['chipotle mexican grill', 'chipotle'],
    cuisine: 'mexican',
    nutritionUrl: 'https://www.chipotle.com/nutrition-calculator',
    verifiedOn: '2026-09-13',
    items: [
      { name: 'Chicken burrito bowl (white rice, black beans, salsa)', section: 'Bowls', kcal: 625, proteinG: 45, carbsG: 66, fatG: 18, sodiumMg: 1500, fiberG: 12 },
      { name: 'Chicken salad (no rice, black beans, fajita veg)', section: 'Salads', kcal: 405, proteinG: 43, carbsG: 30, fatG: 13, sodiumMg: 1265, fiberG: 11 },
      { name: 'Steak burrito bowl (white rice, pinto beans)', section: 'Bowls', kcal: 620, proteinG: 39, carbsG: 68, fatG: 19, sodiumMg: 1475, fiberG: 11 },
      { name: 'Sofritas burrito bowl (brown rice, black beans)', section: 'Bowls', kcal: 600, proteinG: 22, carbsG: 76, fatG: 21, sodiumMg: 1310, fiberG: 15, dietTags: ['vegan', 'vegetarian'] },
      { name: 'Chicken burrito (flour tortilla, rice, beans, cheese)', section: 'Burritos', kcal: 1055, proteinG: 56, carbsG: 113, fatG: 39, sodiumMg: 2200, fiberG: 14 },
      { name: 'Barbacoa burrito bowl (white rice, black beans)', section: 'Bowls', kcal: 615, proteinG: 39, carbsG: 67, fatG: 19, sodiumMg: 1585, fiberG: 12 },
      { name: 'Veggie burrito bowl (brown rice, black beans, guac)', section: 'Bowls', kcal: 655, proteinG: 16, carbsG: 82, fatG: 30, sodiumMg: 1080, fiberG: 18, dietTags: ['vegetarian'] },
      { name: 'Chicken quesadilla', section: 'Quesadillas', kcal: 780, proteinG: 48, carbsG: 52, fatG: 41, sodiumMg: 1620 },
    ],
  },
  {
    slug: 'subway',
    name: 'Subway',
    aliases: ['subway restaurants', 'subway sandwiches'],
    cuisine: 'sandwich',
    nutritionUrl: 'https://www.subway.com/en-US/MenuNutrition/Nutrition',
    verifiedOn: '2026-09-13',
    items: [
      { name: 'Oven roasted turkey 6" (9-grain wheat, no cheese/sauce)', section: '6-inch subs', kcal: 250, proteinG: 18, carbsG: 40, fatG: 3.5, sodiumMg: 600, fiberG: 5 },
      { name: 'Rotisserie-style chicken 6" (9-grain wheat)', section: '6-inch subs', kcal: 320, proteinG: 29, carbsG: 41, fatG: 6, sodiumMg: 610, fiberG: 5 },
      { name: 'Steak & cheese 6" (Italian herbs & cheese)', section: '6-inch subs', kcal: 380, proteinG: 26, carbsG: 42, fatG: 12, sodiumMg: 960, fiberG: 5 },
      { name: 'Veggie Delite 6" (9-grain wheat)', section: '6-inch subs', kcal: 200, proteinG: 8, carbsG: 39, fatG: 2.5, sodiumMg: 280, fiberG: 5, dietTags: ['vegetarian'] },
      { name: 'Tuna 6" (9-grain wheat)', section: '6-inch subs', kcal: 470, proteinG: 20, carbsG: 40, fatG: 25, sodiumMg: 610, fiberG: 5 },
      { name: 'Grilled chicken salad (no dressing)', section: 'Salads', kcal: 130, proteinG: 20, carbsG: 9, fatG: 2.5, sodiumMg: 350, fiberG: 4 },
    ],
  },
  {
    slug: 'tim-hortons',
    name: 'Tim Hortons',
    aliases: ['tims', 'timmies', 'tim hortons'],
    cuisine: 'cafe',
    nutritionUrl: 'https://www.timhortons.ca/nutrition',
    verifiedOn: '2026-09-13',
    items: [
      { name: 'Farmer’s Wrap with bacon', section: 'Breakfast', kcal: 550, proteinG: 25, carbsG: 48, fatG: 29, sodiumMg: 1310 },
      { name: 'Bacon breakfast sandwich on English muffin', section: 'Breakfast', kcal: 370, proteinG: 20, carbsG: 32, fatG: 18, sodiumMg: 810 },
      { name: 'Chicken noodle soup', section: 'Soups', kcal: 110, proteinG: 6, carbsG: 18, fatG: 2, sodiumMg: 750 },
      { name: 'Turkey bacon club sandwich', section: 'Sandwiches', kcal: 470, proteinG: 30, carbsG: 52, fatG: 16, sodiumMg: 1340 },
      { name: 'Greek yogurt with berries', section: 'Snacks', kcal: 190, proteinG: 11, carbsG: 29, fatG: 3.5, sodiumMg: 65, dietTags: ['vegetarian'] },
      { name: 'Plain bagel', section: 'Bakery', kcal: 290, proteinG: 11, carbsG: 57, fatG: 1.5, sodiumMg: 480, dietTags: ['vegetarian'] },
    ],
  },
  {
    slug: 'mcdonalds',
    name: "McDonald's",
    aliases: ['mcdonald s', 'mcdonalds', 'mc donalds'],
    cuisine: 'burger',
    nutritionUrl: 'https://www.mcdonalds.com/us/en-us/full-menu-explorer.html',
    verifiedOn: '2026-09-13',
    items: [
      { name: 'Big Mac', section: 'Burgers', kcal: 590, proteinG: 25, carbsG: 46, fatG: 34, sodiumMg: 1050, servingGrams: 219 },
      { name: 'Quarter Pounder with Cheese', section: 'Burgers', kcal: 520, proteinG: 30, carbsG: 42, fatG: 26, sodiumMg: 1140, servingGrams: 202 },
      { name: 'McChicken', section: 'Chicken', kcal: 400, proteinG: 14, carbsG: 39, fatG: 21, sodiumMg: 560, servingGrams: 143 },
      { name: 'McDouble', section: 'Burgers', kcal: 400, proteinG: 22, carbsG: 33, fatG: 20, sodiumMg: 920, servingGrams: 151 },
      { name: 'Hamburger', section: 'Burgers', kcal: 250, proteinG: 12, carbsG: 31, fatG: 9, sodiumMg: 510, servingGrams: 100 },
      { name: 'Filet-O-Fish', section: 'Fish', kcal: 390, proteinG: 16, carbsG: 39, fatG: 19, sodiumMg: 580, servingGrams: 142 },
      { name: 'Egg McMuffin', section: 'Breakfast', kcal: 310, proteinG: 17, carbsG: 30, fatG: 13, sodiumMg: 770, servingGrams: 136 },
      { name: 'Medium French fries', section: 'Sides', kcal: 320, proteinG: 5, carbsG: 43, fatG: 15, sodiumMg: 260, servingGrams: 111, dietTags: ['vegetarian'] },
    ],
  },
  {
    slug: 'nandos',
    name: "Nando's",
    aliases: ['nando s', 'nandos peri peri', 'nandos'],
    cuisine: 'chicken',
    nutritionUrl: 'https://www.nandos.co.uk/nutrition',
    verifiedOn: '2026-09-13',
    items: [
      { name: '1/4 chicken breast (skin on)', section: 'Chicken', kcal: 285, proteinG: 43, carbsG: 0, fatG: 13, sodiumMg: 690 },
      { name: '1/2 chicken', section: 'Chicken', kcal: 615, proteinG: 84, carbsG: 0, fatG: 31, sodiumMg: 1370 },
      { name: 'Grilled chicken breast fillet', section: 'Chicken', kcal: 205, proteinG: 40, carbsG: 0, fatG: 5, sodiumMg: 580 },
      { name: 'Chicken butterfly', section: 'Chicken', kcal: 450, proteinG: 76, carbsG: 0, fatG: 16, sodiumMg: 1180 },
      { name: 'Spicy rice (regular)', section: 'Sides', kcal: 335, proteinG: 7, carbsG: 66, fatG: 5, sodiumMg: 690, dietTags: ['vegetarian'] },
      { name: 'Macho peas', section: 'Sides', kcal: 130, proteinG: 9, carbsG: 14, fatG: 3, sodiumMg: 250, dietTags: ['vegetarian'] },
    ],
  },
  {
    slug: 'sweetgreen',
    name: 'Sweetgreen',
    aliases: ['sweet green', 'sweetgreen'],
    cuisine: 'salad',
    nutritionUrl: 'https://www.sweetgreen.com/menu',
    verifiedOn: '2026-09-13',
    items: [
      { name: 'Harvest Bowl', section: 'Bowls', kcal: 685, proteinG: 30, carbsG: 70, fatG: 32, sodiumMg: 1100, fiberG: 9 },
      { name: 'Chicken Pesto Parm', section: 'Bowls', kcal: 700, proteinG: 43, carbsG: 51, fatG: 36, sodiumMg: 1400 },
      { name: 'Kale Caesar', section: 'Salads', kcal: 520, proteinG: 28, carbsG: 30, fatG: 33, sodiumMg: 960 },
      { name: 'Guacamole Greens', section: 'Salads', kcal: 620, proteinG: 28, carbsG: 34, fatG: 42, sodiumMg: 880 },
      { name: 'Shroomami', section: 'Bowls', kcal: 570, proteinG: 19, carbsG: 61, fatG: 28, sodiumMg: 1010, dietTags: ['vegan', 'vegetarian'] },
    ],
  },
];
