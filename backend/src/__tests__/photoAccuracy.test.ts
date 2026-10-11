// Photo accuracy additions: the user's usual foods as hints, and branded
// items (logo, cup, wrapper) swapped for the brand's own numbers.

import { describe, it, expect, vi } from 'vitest';

vi.mock('@prisma/client', () => ({ PrismaClient: vi.fn(function (this: any) { this.savedFood = { findMany: vi.fn() }; this.mealEntry = { findMany: vi.fn() }; }) }));

import { pickHints } from '../services/food/userFoodHints.js';
import { buildMealPhotoV2Prompt, coerceRawItem } from '../services/food/mealPhotoSchema.js';
import { applyBrandedItems } from '../services/food/mealPhotoPipeline.js';

describe('user food hints', () => {
  it('ranks saved foods and repeated meals, dedupes, drops one-offs and long names', () => {
    const hints = pickHints(
      [{ name: 'Beef kafta', useCount: 6 }, { name: 'Barebells Cookies & Cream · Barebells', useCount: 2 }],
      [{ name: 'beef kafta' }, { name: 'Baked potato' }, { name: 'Baked potato' }, { name: 'One-off tasting menu at a restaurant downtown with friends' }, { name: 'Samosa' }],
    );
    expect(hints).toEqual(['Beef kafta', 'Barebells Cookies & Cream', 'Baked potato']);
  });
  it('goes in the prompt with a rule never to add items from it', () => {
    const p = buildMealPhotoV2Prompt({ imageCount: 1, userFoods: ['Beef kafta', 'Baked potato'] });
    expect(p).toMatch(/FOODS THIS PERSON LOGS OFTEN.*Beef kafta; Baked potato/);
    expect(p).toMatch(/Never add an item because it is on this list/);
    expect(buildMealPhotoV2Prompt({ imageCount: 1 })).not.toMatch(/LOGS OFTEN/);
  });
});

describe('branded items in photos', () => {
  it('reads a brand only when one is given', () => {
    expect(coerceRawItem({ name: 'Big Mac', brand: "McDonald's", usdaQuery: 'x', grams: 210 })?.brand).toBe("McDonald's");
    expect(coerceRawItem({ name: 'Burger', brand: 'null', usdaQuery: 'x' })?.brand).toBeUndefined();
  });
  it('asks for a branded menu item as one item', () => {
    expect(buildMealPhotoV2Prompt({ imageCount: 1 })).toMatch(/do not split it into bun, patty/);
  });
  it('swaps a branded item for the brand numbers and keeps the rest', async () => {
    const raw: any = { items: [{ name: 'Big Mac', brand: "McDonald's" }, { name: 'Ketchup' }] };
    const items: any[] = [
      { id: 'a', name: 'Big Mac', calories: 557, proteinG: 25, carbsG: 45, fatG: 30, source: 'usda', per100g: {} },
      { id: 'b', name: 'Ketchup', calories: 20, proteinG: 0, carbsG: 5, fatG: 0, source: 'usda', per100g: {} },
    ];
    const resolveBranded = vi.fn().mockResolvedValue([{ calories: 570, proteinG: 24, carbsG: 46, fatG: 32, site: 'mcdonalds.com', url: 'https://www.mcdonalds.com/ca/en-ca/product/big-mac.html' }]);
    expect(await applyBrandedItems(raw, items, 'u1', { resolveBranded })).toBe(1);
    expect(resolveBranded.mock.calls[0][0]).toEqual([{ brand: "McDonald's", product: 'Big Mac', estimate: { calories: 557, proteinG: 25, carbsG: 45, fatG: 30 } }]);
    expect(items[0]).toMatchObject({ calories: 570, source: 'brand', per100g: null, lookupSource: { site: 'mcdonalds.com' } });
    expect(items[1].calories).toBe(20);
  });
  it('keeps the estimate when the lookup finds nothing or fails', async () => {
    const raw: any = { items: [{ name: 'Mystery latte', brand: 'Corner Cafe' }] };
    const items: any[] = [{ name: 'Mystery latte', calories: 200, proteinG: 8, carbsG: 20, fatG: 8, source: 'model' }];
    expect(await applyBrandedItems(raw, items, 'u1', { resolveBranded: vi.fn().mockResolvedValue([null]) })).toBe(0);
    expect(await applyBrandedItems(raw, items, 'u1', { resolveBranded: vi.fn().mockRejectedValue(new Error('x')) })).toBe(0);
    expect(items[0].calories).toBe(200);
  });
});
