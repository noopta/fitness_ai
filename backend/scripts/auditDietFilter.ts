/**
 * What each restriction lets through from the whole-food catalogue.
 *
 * Meals are composed from the diet-filtered catalogue, so a food the term lists
 * miss (kefir is dairy, whey is dairy) goes straight onto a plate. Eyeball this
 * whenever a food or a restriction is added.
 */
import { FOOD_SOURCES } from '../src/engine/nutritionRecommendations.js';
import { checkCandidate, emptyProfile } from '../src/engine/dietaryFilter.js';

const cases: Array<[string, Partial<ReturnType<typeof emptyProfile>>]> = [
  ['vegan', { restrictions: ['vegan'] }],
  ['vegetarian', { restrictions: ['vegetarian'] }],
  ['dairy-free', { restrictions: ['dairy-free'] }],
  ['gluten-free', { restrictions: ['gluten-free'] }],
  ['halal', { restrictions: ['halal'] }],
  ['kosher', { restrictions: ['kosher'] }],
  ['allergy: fish', { allergies: ['fish'] }],
  ['allergy: tree-nut', { allergies: ['tree-nut'] }],
];
for (const [label, over] of cases) {
  const p = { ...emptyProfile(), ...over };
  const allowed = FOOD_SOURCES.filter(f => checkCandidate({ name: f.name, description: f.category, confidence: 'usda' }, p).verdict !== 'exclude');
  console.log(`\n${label} — allows ${allowed.length}/${FOOD_SOURCES.length}:`);
  console.log('  ' + allowed.map(f => `${f.name} [${f.category}]`).join(' · '));
}
