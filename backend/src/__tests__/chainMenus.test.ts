// Chain menus: an order is a base item in a size plus modifiers, priced from
// the chain's published menu; unpublished add-ons are estimated and flagged.
// Fixture values are illustrative, not real menu data.

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@prisma/client', () => ({ PrismaClient: vi.fn(function (this: any) { this.mealEntry = { findMany: vi.fn().mockResolvedValue([]) }; this.productBarcode = { findMany: vi.fn().mockResolvedValue([]) }; }) }));
vi.mock('@google/genai', () => ({ GoogleGenAI: vi.fn() }));

import { _setChainDataForTests, findChain, isOfficial, lookupChainMenu, modifierQuantity, type ChainMenu } from '../services/food/chainMenus.js';
import { resolveItem } from '../services/food/foodResolver.js';
import { recordOverride, findOverride, singleLookedUpItem, _resetOverridesForTests } from '../services/food/foodOverrides.js';

const REGISTRY = [
  { id: 'starbucks', name: 'Starbucks', aliases: ['sbux', 'starbucks coffee'], countries: ['US', 'CA'], officialDomains: { US: ['starbucks.com'], CA: ['starbucks.ca'] } },
  { id: 'tim-hortons', name: 'Tim Hortons', aliases: ['tims', 'timmies'], countries: ['CA', 'US'], officialDomains: { CA: ['timhortons.ca'] } },
];
const MENU: ChainMenu = {
  chain: 'starbucks', country: 'CA', defaultSize: 'grande', source: { url: 'https://www.starbucks.ca/menu', fetchedAt: '2026-10-09' },
  items: [
    { id: 'caffe-latte', name: 'Caffè Latte', aliases: ['latte'], sizes: [
      { size: 'tall', calories: 150, proteinG: 10, carbsG: 15, fatG: 6 },
      { size: 'grande', calories: 190, proteinG: 13, carbsG: 19, fatG: 7, micros: { sodiumMg: 170 } },
    ] },
    { id: 'caffe-mocha', name: 'Caffè Mocha', defaults: ['whipped-cream'], sizes: [{ size: 'grande', calories: 370, proteinG: 13, carbsG: 44, fatG: 15, includes: { syrup: 4 } }] },
    { id: 'caramel-protein-latte', name: 'Caramel Protein Latte', sizes: [{ size: 'grande', calories: 320, proteinG: 27, carbsG: 38, fatG: 7 }] },
  ],
  modifiers: [
    { id: 'hazelnut-syrup', name: 'Hazelnut Syrup', aliases: ['hazelnut', 'hazelnut shot'], group: 'syrup', per: { calories: 20, proteinG: 0, carbsG: 5, fatG: 0, micros: { sugarG: 5 } } },
    { id: 'whipped-cream', name: 'Whipped Cream', aliases: ['whip'], group: 'whip', per: { calories: 80, proteinG: 0, carbsG: 3, fatG: 7 } },
    { id: 'oat-milk', name: 'Oat Milk', aliases: ['oat'], group: 'milk', bySize: { grande: { calories: 10, proteinG: -9, carbsG: 7, fatG: 0 } } },
  ],
};

beforeEach(() => _setChainDataForTests(REGISTRY as any, [MENU]));

describe('finding the chain', () => {
  it('knows names and nicknames', () => {
    expect(findChain('Starbucks Coffee')?.id).toBe('starbucks');
    expect(findChain('timmies')?.id).toBe('tim-hortons');
    expect(findChain('Corner Café')).toBeNull();
  });
  it('recognises the chain’s own sites', () => {
    const sb = findChain('starbucks')!;
    expect(isOfficial(sb, 'CA', 'https://www.starbucks.ca/menu/product/407')).toBe(true);
    expect(isOfficial(sb, 'CA', 'starbucks.com')).toBe(true);
    expect(isOfficial(sb, 'CA', 'nutrola.app')).toBe(false);
  });
});

describe('pricing an order', () => {
  it('takes the published size', () => {
    const m = lookupChainMenu({ brand: 'Starbucks', product: 'Caffe Latte', size: 'Grande' }, 'CA')!;
    expect(m.facts).toMatchObject({ calories: 190, proteinG: 13, micros: { sodiumMg: 170 } });
    expect(m.facts.sources[0]).toEqual({ title: 'starbucks.ca', uri: 'https://www.starbucks.ca/menu' });
  });
  it('uses the chain’s default size when none is given, and refuses a size it doesn’t sell', () => {
    expect(lookupChainMenu({ brand: 'Starbucks', product: 'latte', size: null }, 'CA')!.facts.calories).toBe(190);
    expect(lookupChainMenu({ brand: 'Starbucks', product: 'Caffe Latte', size: 'Venti' }, 'CA')).toBeNull();
  });
  it('adds published modifiers, size-specific ones by size', () => {
    const m = lookupChainMenu({ brand: 'Starbucks', product: 'Caramel Protein Latte', size: 'Grande', modifiers: ['add a hazelnut shot', 'oat milk'] }, 'CA')!;
    expect(m.facts.calories).toBe(320 + 20 + 10);
    expect(m.facts.proteinG).toBe(18);
    expect(m.applied.every((a) => a.official)).toBe(true);
  });
  it('counts pumps', () => {
    expect(modifierQuantity('2 pumps hazelnut')).toBe(2);
    expect(modifierQuantity('no whip')).toBe(-1);
    expect(lookupChainMenu({ brand: 'Starbucks', product: 'Caffè Latte', size: 'Grande', modifiers: ['3 pumps hazelnut'] }, 'CA')!.facts.calories).toBe(250);
  });
  it('removes what the item includes, and ignores removing what it doesn’t', () => {
    expect(lookupChainMenu({ brand: 'Starbucks', product: 'Caffe Mocha', size: 'Grande', modifiers: ['no whip'] }, 'CA')!.facts.calories).toBe(290);
    expect(lookupChainMenu({ brand: 'Starbucks', product: 'Caffe Latte', size: 'Grande', modifiers: ['no whip'] }, 'CA')!.facts.calories).toBe(190);
  });
  it('estimates add-ons the chain doesn’t publish, and says so', () => {
    const m = lookupChainMenu({ brand: 'Starbucks', product: 'Caffe Latte', size: 'Grande', modifiers: ['add cold foam', 'a pump of sugar free vanilla'] }, 'CA')!;
    expect(m.facts.calories).toBe(250);
    expect(m.applied.map((a) => [a.name, a.official])).toEqual([['cold foam', false], ['sugar-free syrup (pump)', false]]);
  });
  it('falls back to another country’s menu, flagged', () => {
    const m = lookupChainMenu({ brand: 'Starbucks', product: 'Caffe Latte', size: 'Grande' }, 'US')!;
    expect(m.foreign).toBe(true);
    expect(m.facts.sources[0].title).toBe('starbucks.ca (CA menu)');
  });
  it('returns nothing for items not on the menu', () => {
    expect(lookupChainMenu({ brand: 'Starbucks', product: 'Pumpkin Cream Cold Brew', size: 'Grande' }, 'CA')).toBeNull();
  });
});

describe('the resolver checks the menu first', () => {
  it('answers a chain order from the menu without any search', async () => {
    const web = vi.fn();
    const database = vi.fn();
    const r = await resolveItem({ brand: 'Starbucks', product: 'Caramel Protein Latte', size: 'Grande', servings: 1, modifiers: ['add a hazelnut shot'], estimate: { calories: 300, proteinG: 25, carbsG: 35, fatG: 7 } }, 0, { tz: 'America/Toronto', surface: 'chat', deps: { web, database, log: vi.fn(), correction: () => null } });
    expect(r.step).toBe('chain');
    expect(r.result.kind === 'found' && r.result.facts.calories).toBe(340);
    expect(web).not.toHaveBeenCalled();
    expect(database).not.toHaveBeenCalled();
  });
});

describe('user corrections', () => {
  beforeEach(() => { process.env.FOOD_OVERRIDES_PATH = '/tmp/axiom-test-overrides.json'; _resetOverridesForTests(); });
  it('reads the one looked-up item from a meal’s notes', () => {
    expect(singleLookedUpItem('Starbucks Caramel Protein Latte Grande: from starbucks.com (https://x) · Based on…')).toBe('Starbucks Caramel Protein Latte Grande');
    expect(singleLookedUpItem('A: from x; B: from y')).toBeNull();
  });
  it('a correction wins for that user only', async () => {
    recordOverride('u1', 'Starbucks Caramel Protein Latte Grande', { calories: 260, proteinG: 26, carbsG: 30, fatG: 6 });
    const order = { brand: 'Starbucks', product: 'Caramel Protein Latte', size: 'Grande' };
    expect(findOverride('u1', order)?.calories).toBe(260);
    expect(findOverride('u2', order)).toBeNull();
    const r = await resolveItem({ ...order, servings: 1, estimate: { calories: 300, proteinG: 25, carbsG: 35, fatG: 7 } }, 0, { userId: 'u1', tz: 'America/Toronto', surface: 'chat', deps: { log: vi.fn() } });
    expect(r.step).toBe('correction');
  });
});
