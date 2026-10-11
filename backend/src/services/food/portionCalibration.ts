// Portion calibration for meal photos. The photo model recognises foods well
// but misjudges weight in systematic ways (Nutrition5k, Oct 2026: 12 of 40
// dishes >25% off on grams; recognition was not the problem). Each priced
// item gets a per-food-type factor learned from weighed dishes in the
// Nutrition5k TRAIN split, scored on held-out TEST dishes.
//
// Factors live in data (PORTION_FACTORS below, refit with
// scripts/fitPortionCalibration.mjs), are shrunk toward 1 and clamped, and
// MEAL_PHOTO_CALIBRATION=0 switches the whole thing off.

export type FoodGroup = 'grain' | 'protein' | 'vegetable' | 'fruit' | 'fat_sauce' | 'dairy' | 'sweet' | 'drink' | 'other';
export const FOOD_GROUPS: FoodGroup[] = ['grain', 'protein', 'vegetable', 'fruit', 'fat_sauce', 'dairy', 'sweet', 'drink', 'other'];

const RULES: Array<[FoodGroup, RegExp]> = [
  ['fat_sauce', /\b(oil|butter|margarine|mayo|mayonnaise|dressing|vinaigrette|sauce|gravy|aioli|pesto|ketchup|catsup|mustard|salsa|hummus|guacamole|syrup|honey|jam|spread|dip|ghee|lard|tahini|glaze|drizzle)\b/i],
  ['drink', /\b(juice|soda|cola|latte|coffee|tea|milkshake|smoothie|beer|wine|drink|lemonade|kombucha)\b/i],
  ['sweet', /\b(cake|cookie|brownie|donut|doughnut|muffin|pastry|pie|ice cream|chocolate|candy|dessert|pudding|croissant|cinnamon roll|scone|tart)\b/i],
  ['dairy', /\b(cheese|yogurt|yoghurt|milk|cream|feta|mozzarella|parmesan|cheddar|cottage|ricotta|kefir)\b/i],
  ['protein', /\b(chicken|beef|pork|steak|lamb|turkey|ham|bacon|sausage|salmon|tuna|fish|cod|tilapia|shrimp|prawn|crab|egg|eggs|tofu|tempeh|meat|meatball|patty|burger|kafta|kebab|chop|fillet|filet|duck|veal|bean|beans|lentil|lentils|chickpea|chickpeas|edamame|seitan|jerky|scallop|mussel|clam|squid|anchov)\w*\b/i],
  ['grain', /\b(rice|pasta|spaghetti|noodle|bread|toast|bun|bagel|tortilla|wrap|pita|naan|quinoa|couscous|oat|oats|oatmeal|cereal|granola|potato|potatoes|fries|wedge|hash brown|corn|polenta|cracker|pizza|crust|dumpling|barley|bulgur|farro|sweet potato|yam|cassava|plantain)\w*\b/i],
  ['fruit', /\b(apple|banana|orange|berry|berries|strawberr|blueberr|raspberr|grape|melon|watermelon|cantaloupe|honeydew|pineapple|mango|kiwi|peach|pear|plum|cherry|cherries|citrus|clementine|papaya|date|dates|fig|avocado|raisin)\w*\b/i],
  ['vegetable', /\b(salad|lettuce|spinach|kale|broccoli|cauliflower|carrot|pepper|tomato|cucumber|onion|garlic|mushroom|zucchini|squash|asparagus|green bean|pea|peas|cabbage|slaw|celery|beet|radish|arugula|greens|vegetable|veggie|eggplant|brussels|leek|okra|sprout|herb|parsley|cilantro|basil)\w*\b/i],
];

/** Coarse food type from the item name and its USDA query. */
export function foodGroup(name: string, usdaQuery?: string | null): FoodGroup {
  const text = `${name} ${usdaQuery ?? ''}`;
  for (const [g, re] of RULES) if (re.test(text)) return g;
  return 'other';
}

/**
 * Half-strength factors fitted 11 Oct 2026 on 189 Nutrition5k TRAIN dishes for
 * gemini-3.8-flash (scripts/fitPortionCalibration.py). Full-strength factors
 * were {"grain": 0.9, "protein": 0.72, "vegetable": 1.0, "fruit": 0.98, "fat_sauce": 0.84, "dairy": 0.92, "sweet": 1.0, "drink": 1.0, "other": 0.98};
 * 3.1-pro learned nearly the same (meat ~0.7), so the bias is real — but full
 * strength undercounted by ~10%, so half is used.
 * 40 held-out TEST dishes: calorie MAPE 32.1% → 29.3%, bias +8.0% → −0.9%.
 */
export const PORTION_FACTORS: Record<FoodGroup, number> = {grain: 0.95, protein: 0.86, vegetable: 1.0, fruit: 0.99, fat_sauce: 0.92, dairy: 0.96, sweet: 1.0, drink: 1.0, other: 0.99};

/** The model the factors were fitted for — other models get no correction. */
export const CALIBRATED_MODEL = 'gemini-3.8-flash';

export const CALIBRATION_ON = () => process.env.MEAL_PHOTO_CALIBRATION !== '0';

/** Scale one item's grams and macros by its group's factor. Brand-priced items are left alone. Pure. */
export function calibrateItem<T extends { name: string; grams: number | null; calories: number; proteinG: number; carbsG: number; fatG: number; source?: string }>(
  item: T, usdaQuery: string | null | undefined, factors: Record<FoodGroup, number> = PORTION_FACTORS,
): T {
  if (item.source === 'brand') return item;
  const f = factors[foodGroup(item.name, usdaQuery)] ?? 1;
  if (!Number.isFinite(f) || f === 1) return item;
  const r1 = (x: number) => Math.round(x * 10) / 10;
  return {
    ...item,
    grams: item.grams != null ? Math.round(item.grams * f) : item.grams,
    calories: Math.round(item.calories * f), proteinG: r1(item.proteinG * f), carbsG: r1(item.carbsG * f), fatG: r1(item.fatG * f),
  };
}
