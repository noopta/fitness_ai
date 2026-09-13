import 'dotenv/config';
import { composeMeals, servingText } from '../src/engine/mealComposer.js';
import { buildFinderGap, arbitrate } from '../src/engine/foodFinderRanker.js';
import type { DayRemaining } from '../src/services/nutritionRemaining.js';

const remaining = {
  macros: {
    kcal:     { target: 2600, consumed: 540, remaining: 2060, short: 0.79 },
    proteinG: { target: 200,  consumed: 0,   remaining: 200,  short: 1 },
    carbsG:   { target: 200,  consumed: 0,   remaining: 200,  short: 1 },
    fatG:     { target: 60,   consumed: 0,   remaining: 60,   short: 1 },
  },
  micros: [],
} as unknown as DayRemaining;

const arb = arbitrate(remaining);
const gap = buildFinderGap(remaining, arb);
const meals = composeMeals(gap, { kcalBudget: 900 });

console.log(`mode=${arb.mode}  ${meals.length} meals composed\n`);
for (const m of meals) {
  console.log(`${m.name}  —  ${m.kcal} kcal, ${m.prepMinutes} min`);
  for (const c of m.components) console.log(`    ${servingText(c.food, c.multiplier).padEnd(18)} ${c.food.name}`);
  console.log(`    P${Math.round(m.provides.proteinG ?? 0)} C${Math.round(m.provides.carbsG ?? 0)} F${Math.round(m.provides.fatG ?? 0)}`);
  m.steps.forEach((s, i) => console.log(`      ${i + 1}. ${s}`));
  console.log();
}
