import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runMealPhotoAnalysis, detailFromItems, _resetMealPhotoCache, type MealPhotoDeps } from '../services/food/mealPhotoPipeline.js';
import { _resetAddPhotoGrants, consumeAddPhotoGrant } from '../services/food/mealPhotoCache.js';
import type { MealPhotoV2Raw } from '../services/food/mealPhotoSchema.js';

const V2_RAW: MealPhotoV2Raw = {
  items: [
    { name: 'White rice', usdaQuery: 'rice, white, cooked', preparation: 'boiled', grams: 200, visibility: 'full', calories: 260, proteinG: 5, carbsG: 56, fatG: 0.6 },
    { name: 'Cooking oil', usdaQuery: 'oil, vegetable', preparation: null, grams: null, visibility: 'inferred', calories: 90, proteinG: 0, carbsG: 0, fatG: 14 },
  ],
  framingWarning: 'A bowl is cut off on the right — add a photo?',
  noFoodDetected: false,
  mealType: 'dinner',
  name: 'Rice dinner',
  confidence: 'high',
  notes: 'n',
  tags: ['whole-food'],
  plants: ['rice'],
  fermentedFoods: [],
  ultraProcessed: false,
};

const LEGACY = {
  name: 'Chicken bowl', calories: 600, proteinG: 40, carbsG: 60, fatG: 20, mealType: 'lunch' as const,
  confidence: 'high' as const, notes: '', ingredients: ['chicken', 'rice'], tags: [], plants: [], fermentedFoods: [],
  ultraProcessed: false, nutrientMap: {}, nutrients: {} as any,
};

const img = (s = 'photo-bytes') => ({ base64: Buffer.from(s).toString('base64'), mimeType: 'image/jpeg' });

function deps(over: Partial<MealPhotoDeps> = {}): MealPhotoDeps & { lines: any[] } {
  const lines: any[] = [];
  return {
    model: 'gemini-test',
    analyzeV2: vi.fn(async () => structuredClone(V2_RAW)),
    analyzeLegacy: vi.fn(async () => ({ ...LEGACY })),
    enrich: vi.fn(async (detail: any) => ({
      detail: { ...detail, nutrients: { ...detail.nutrients, potassiumMg: 99 } },
      meta: { provider: 'hybrid_llm_usda' as const, matchedIngredients: 0, totalIngredients: 0, usdaCoveragePct: 0, usedFallback: true },
    })),
    lookup: vi.fn(async (q: string) => (q.startsWith('rice') ? {
      fdcId: 1, description: 'Rice, white, cooked', dataType: 'SR Legacy',
      per100g: { calories: 130, proteinG: 2.7, carbsG: 28.2, fatG: 0.3 }, micros: { potassiumMg: 35 } as any,
    } : null)),
    log: (l: string) => lines.push(JSON.parse(l)),
    lines,
    ...over,
  };
}

beforeEach(() => { _resetMealPhotoCache(); _resetAddPhotoGrants(); });

describe('runMealPhotoAnalysis — v2', () => {
  it('prices items, sums totals, keeps legacy fields and logs one line', async () => {
    const d = deps();
    const r = await runMealPhotoAnalysis({ userId: 'u1', images: [img()], existingItems: [], region: 'global', v2: true }, d);
    expect(r.items).toHaveLength(2);
    expect(r.items[0]).toMatchObject({ source: 'usda', calories: 260, grams: 200 });
    expect(r.items[1]).toMatchObject({ source: 'model', calories: 126, per100g: null }); // 9×14 reconciled
    expect(r.calories).toBe(386);
    expect(r.fatG).toBe(14.6);
    // Legacy fields still present
    expect(r).toMatchObject({ name: 'Rice dinner', mealType: 'dinner', confidence: 'high', source: 'photo', ingredients: ['White rice', 'Cooking oil'], plants: ['rice'] });
    expect(r.nutrients.potassiumMg).toBe(99);
    expect(r.framingWarning).toMatch(/cut off/);
    expect(r.noFoodDetected).toBe(false);
    expect(typeof r.analysisId).toBe('string');
    // enrichment received the USDA micros of matched items (35 × 2)
    const enrichOpts = (d.enrich as any).mock.calls[0][1];
    expect(enrichOpts.usdaMicros).toMatchObject({ matched: 1, total: 2 });
    expect(enrichOpts.usdaMicros.micros.potassiumMg).toBe(70);
    expect(d.lines).toHaveLength(1);
    expect(d.lines[0]).toMatchObject({ userId: 'u1', model: 'gemini-test', flag: 'v2', images: 1, itemCount: 2, usdaHits: 1, cacheHit: false, existingItems: 0, framingWarning: true, noFood: false });
  });

  it('identical photo returns the identical result from the cache (new analysisId)', async () => {
    const d = deps();
    const req = { userId: 'u1', images: [img()], existingItems: [], region: 'global' as const, v2: true };
    const a = await runMealPhotoAnalysis(req, d);
    const b = await runMealPhotoAnalysis(req, d);
    expect(d.analyzeV2).toHaveBeenCalledTimes(1);
    const { analysisId: ida, ...ra } = a;
    const { analysisId: idb, ...rb } = b;
    expect(rb).toEqual(ra);
    expect(ida).not.toBe(idb);
    expect(d.lines[1]).toMatchObject({ cacheHit: true, usdaHits: 1 });
  });

  it('passes all images and existing items through, and registers an add-photo grant', async () => {
    const d = deps();
    const existing = [{ id: null, name: 'Chicken', grams: 150 }];
    const r = await runMealPhotoAnalysis({ userId: 'u1', images: [img('a'), img('b')], existingItems: existing, region: 'ng', v2: true }, d);
    expect((d.analyzeV2 as any).mock.calls[0][0]).toHaveLength(2);
    expect((d.analyzeV2 as any).mock.calls[0][1]).toEqual({ existingItems: existing, region: 'ng' });
    expect(d.lines[0]).toMatchObject({ images: 2, existingItems: 1 });
    // Item ids returned by this scan unlock a free add-photo for the same user.
    expect(consumeAddPhotoGrant('u1', [{ id: r.items[0].id, name: 'x', grams: null }])).not.toBeNull();
    expect(consumeAddPhotoGrant('u2', [{ id: r.items[0].id, name: 'x', grams: null }])).toBeNull();
  });

  it('no food → zero totals and noFoodDetected', async () => {
    const d = deps({ analyzeV2: vi.fn(async () => ({ ...V2_RAW, items: [], noFoodDetected: true, framingWarning: null })) });
    const r = await runMealPhotoAnalysis({ userId: 'u1', images: [img()], existingItems: [], region: 'global', v2: true }, d);
    expect(r).toMatchObject({ noFoodDetected: true, calories: 0, items: [], name: 'No food detected' });
    expect(d.lines[0]).toMatchObject({ noFood: true, itemCount: 0, framingWarning: false });
  });

  it('propagates analyzer failures (route returns 500) and caches nothing', async () => {
    const d = deps({ analyzeV2: vi.fn(async () => { throw new Error('quota'); }) });
    const req = { userId: 'u1', images: [img()], existingItems: [], region: 'global' as const, v2: true };
    await expect(runMealPhotoAnalysis(req, d)).rejects.toThrow('quota');
    await expect(runMealPhotoAnalysis(req, d)).rejects.toThrow('quota');
    expect(d.analyzeV2).toHaveBeenCalledTimes(2);
  });
});

describe('runMealPhotoAnalysis — flag off (legacy)', () => {
  it('runs the legacy analyzer on the first image and adds a single meal-level item', async () => {
    const d = deps();
    const r = await runMealPhotoAnalysis({ userId: 'u1', images: [img('first'), img('second')], existingItems: [], region: 'global', v2: false }, d);
    expect(d.analyzeV2).not.toHaveBeenCalled();
    expect((d.analyzeLegacy as any).mock.calls[0][0]).toBe(img('first').base64);
    expect(r).toMatchObject({ name: 'Chicken bowl', calories: 600, source: 'photo', framingWarning: null, noFoodDetected: false });
    expect(r.items).toEqual([expect.objectContaining({ name: 'Chicken bowl', calories: 600, grams: null, per100g: null, source: 'model' })]);
    expect(d.lines[0]).toMatchObject({ flag: 'legacy', itemCount: 1, usdaHits: 0, cacheHit: false });
  });

  it('legacy is never served from the v2 cache', async () => {
    const d = deps();
    const req = { userId: 'u1', images: [img()], existingItems: [], region: 'global' as const, v2: false };
    await runMealPhotoAnalysis(req, d);
    await runMealPhotoAnalysis(req, d);
    expect(d.analyzeLegacy).toHaveBeenCalledTimes(2);
  });
});

describe('detailFromItems', () => {
  it('builds legacy-shaped detail with totals = item sum and zeroed micros', () => {
    const d = detailFromItems(V2_RAW, [
      { id: 'a', name: 'A', preparation: null, grams: 1, visibility: 'full', calories: 10, proteinG: 1, carbsG: 1, fatG: 0, per100g: null, source: 'model' },
      { id: 'b', name: 'B', preparation: null, grams: 1, visibility: 'full', calories: 20, proteinG: 2, carbsG: 0, fatG: 1, per100g: null, source: 'model' },
    ]);
    expect(d).toMatchObject({ calories: 30, proteinG: 3, carbsG: 1, fatG: 1, ingredients: ['A', 'B'], name: 'Rice dinner' });
    expect(d.nutrients.fiberG).toBe(0);
  });
});
