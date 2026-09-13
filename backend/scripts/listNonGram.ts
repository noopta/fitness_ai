import 'dotenv/config';
import { FOOD_SOURCES } from '../src/engine/nutritionRecommendations.js';
const CAD = 1.05 * 1.37;
for (const f of FOOD_SOURCES) {
  if (/^\d+(\.\d+)?\s*g\b/.test(f.serving)) continue;
  const usd = f.retail?.typicalPriceUsd;
  if (usd == null) continue;
  console.log(`  ${('$' + (usd * CAD).toFixed(2)).padStart(8)}  ${f.serving.padEnd(22)} ${f.name}`);
}
