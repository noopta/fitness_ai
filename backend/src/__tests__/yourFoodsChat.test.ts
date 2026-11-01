// "Log it again, 200 g": chat logs a scanned food at any amount from its remembered label.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { basisJsonFrom } from '../services/food/yourFoods.js';

const db: Record<string, any[]> = { savedFood: [], mealEntry: [], user: [], agentChange: [], agentCard: [] };
const match = (row: any, where: any = {}) => Object.entries(where).every(([k, v]) => row[k] === v);
function model(name: string) {
  return {
    create: async ({ data }: any) => { const row = { id: `${name}-${db[name].length + 1}`, createdAt: new Date(), status: 'applied', ...data }; db[name].push(row); return { ...row }; },
    update: async ({ where, data }: any) => { const row = db[name].find((r) => r.id === where.id); Object.assign(row ?? {}, data); return { ...row }; },
    updateMany: async () => ({ count: 0 }),
    findFirst: async ({ where }: any = {}) => { const r = db[name].find((row) => match(row, where)); return r ? { ...r } : null; },
    findUnique: async ({ where }: any) => { const r = db[name].find((row) => match(row, where)); return r ? { ...r } : null; },
    findMany: async ({ where }: any = {}) => db[name].filter((row) => match(row, where)).map((r) => ({ ...r })),
    count: async () => 0,
  };
}
vi.mock('@prisma/client', () => ({ PrismaClient: vi.fn(function (this: any) { for (const k of Object.keys(db)) this[k] = model(k); }) }));
vi.mock('../services/cacheService.js', () => ({ cacheDelete: vi.fn(), cacheClearByPrefix: vi.fn(), cacheGet: vi.fn(), cacheSet: vi.fn(), cacheMarkStale: vi.fn() }));
const logged: any[] = [];
vi.mock('../services/mealLogService.js', async (orig) => ({
  ...(await orig() as object),
  createMealEntry: vi.fn(async (_u: string, input: any) => { logged.push(input); return { entry: { id: 'm1', ...input }, moment: null }; }),
}));
const foods = vi.hoisted(() => ({ list: [] as any[] }));
vi.mock('../agent/loopback.js', () => ({ callApi: vi.fn(async () => ({ foods: foods.list })) }));

process.env.OPENAI_API_KEY ||= 'test';
process.env.OPENROUTER_API_KEY ||= 'test';
const { NUTRITION_TOOLS } = await import('../agent/toolkits/nutrition.js');
const tool = NUTRITION_TOOLS.find((t: any) => t.name === 'log_saved_food')!;

const U = 'u1';
const yogurt = {
  id: 'f1', userId: U, name: 'Greek yogurt · Oikos', barcode: '064420051124', calories: 159, proteinG: 22.7, carbsG: 10.2, fatG: 2.8, lastGrams: 170,
  ingredientsJson: null, tagsJson: null, nutrientsJson: null,
  basisJson: basisJsonFrom({ name: 'Greek yogurt', per100g: { calories: 93.3, proteinG: 13.3, carbsG: 6, fatG: 1.7, calciumMg: 133 }, servingQuantityG: 150, source: 'openfoodfacts' }),
};

beforeEach(() => {
  for (const k of Object.keys(db)) db[k] = [];
  logged.length = 0;
  foods.list = [];
  db.user = [{ id: U, timezone: 'America/New_York' }];
  db.savedFood = [yogurt];
});

describe('log_saved_food with a scanned food', () => {
  it('by barcode at a new amount: every number comes from the label, and the amount is remembered', async () => {
    await tool.execute({ barcode: '0 64420 05112 4', grams: 200 }, U);
    expect(logged[0]).toMatchObject({
      name: 'Greek yogurt · Oikos', calories: 187, proteinG: 26.6, carbsG: 12, fatG: 3.4,
      barcode: '064420051124', portion: { grams: 200, unit: 'g', unitLabel: 'g' }, ingredients: ['Greek yogurt · Oikos (200 g)'],
    });
    expect(logged[0].nutrients).toEqual({ calciumMg: 266 });
  });

  it('by name at a new amount', async () => {
    foods.list = [yogurt];
    await tool.execute({ name: 'greek yogurt', grams: 100 }, U);
    expect(logged[0]).toMatchObject({ calories: 93, proteinG: 13.3, barcode: '064420051124' });
  });

  it('by barcode with no amount repeats what they had last time', async () => {
    await tool.execute({ barcode: '064420051124' }, U);
    expect(logged[0]).toMatchObject({ calories: 159, proteinG: 22.7 });
    expect(logged[0].portion).toBeUndefined();
  });

  it('a barcode they never scanned asks them to scan it, and logs nothing', async () => {
    await expect(tool.execute({ barcode: '111111111111', grams: 200 }, U)).rejects.toThrow(/scan it/);
    expect(logged).toHaveLength(0);
  });

  it('grams on a food with no label is refused rather than guessed', async () => {
    foods.list = [{ ...yogurt, name: 'Mum’s stew', basisJson: null, barcode: null }];
    await expect(tool.execute({ name: 'stew', grams: 200 }, U)).rejects.toThrow(/don’t have a label/);
    expect(logged).toHaveLength(0);
  });

  it('a saved food without grams works as it always did', async () => {
    foods.list = [{ ...yogurt, name: 'Toast', basisJson: null, barcode: null, calories: 100, proteinG: 4, carbsG: 18, fatG: 1 }];
    await tool.execute({ name: 'toast', servings: 2 }, U);
    expect(logged[0]).toMatchObject({ name: 'Toast', calories: 200, proteinG: 8 });
    expect(logged[0].barcode).toBeUndefined();
  });
});
