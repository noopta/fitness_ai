// Body systems radar stuck at the centre (21 Oct 2026): the photo/typed open
// map carries micros only, so protein read 0%; leucine/tryptophan/choline were
// never estimated and scored 0% — every system was pinned low.
import { describe, it, expect } from 'vitest';
import { mealRowToNutrientMap } from '../services/nutritionWindow.js';
import { runNutritionProfileEngine } from '../engine/nutritionProfileEngine.js';

describe('mealRowToNutrientMap', () => {
  it('always counts the macro columns, and derives leucine/tryptophan from protein', () => {
    const m = mealRowToNutrientMap({ date: '2026-10-21', calories: 693, proteinG: 74, carbsG: 60, fatG: 15, nutrientMapJson: JSON.stringify({ ironMg: 5, zincMg: 3 }) });
    expect(m).toMatchObject({ proteinG: 74, carbsG: 60, fatG: 15, ironMg: 5, leucineG: 5.92, tryptophanG: 0.888 });
  });
  it('keeps amino acids the meal stated', () => {
    const m = mealRowToNutrientMap({ date: 'd', calories: 300, proteinG: 30, nutrientMapJson: JSON.stringify({ leucineG: 3.1 }) });
    expect(m.leucineG).toBe(3.1);
  });
});

describe('unknown is not zero', () => {
  it('a nutrient no meal estimated is left out of the system score', () => {
    const totals = { proteinG: 140, leucineG: 11, ironMg: 18, magnesiumMg: 400, zincMg: 11, vitaminB12Mcg: 3, omega3G: 1.6, tryptophanG: 1.5, calciumMg: 1000, vitaminDIU: 600, potassiumMg: 3400, folateMcg: 400, vitaminCMg: 90, fiberG: 30 };
    const known = runNutritionProfileEngine({ totals, mealsLogged: 3 });
    const fair = runNutritionProfileEngine({ totals, mealsLogged: 3, unknownKeys: ['cholineMg'] });
    const cog = (o: typeof known) => o.systems.find((s) => s.id === 'cognition')!;
    expect(cog(fair).score).toBeGreaterThan(cog(known).score);
    expect(cog(fair).drivers.find((d) => d.key === 'cholineMg')?.unknown).toBe(true);
    expect(cog(fair).chips.join(' ')).not.toMatch(/Choline/);
  });
});
