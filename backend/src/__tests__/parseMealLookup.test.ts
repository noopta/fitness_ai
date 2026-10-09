// Typed meals: branded items are looked up on the web and their published
// values replace the parser's estimate inside the meal totals.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ chat: vi.fn(), lookupAll: vi.fn() }));
vi.mock('@prisma/client', () => ({ PrismaClient: vi.fn(function (this: any) { this.user = {}; }) }));
vi.mock('../services/chatClient.js', () => ({ chatComplete: h.chat }));
vi.mock('../services/ragService.js', () => ({ buildRAGContext: vi.fn(), retrieveProgramSources: vi.fn() }));
vi.mock('../services/food/brandedLookup.js', async (orig) => ({ ...(await orig<any>()), lookupAll: h.lookupAll }));

import { parseMealMacros } from '../services/llmService.js';

const reply = (o: unknown) => ({ choices: [{ message: { content: JSON.stringify(o) } }] });
const MEAL = {
  name: 'Kafta, potato and a protein latte', calories: 1000, proteinG: 70, carbsG: 80, fatG: 40, mealType: 'lunch', confidence: 'medium', notes: '',
  ingredients: [], tags: [], plants: [], fermentedFoods: [], ultraProcessed: false, nutrients: {},
  branded: [{ brand: 'Starbucks', product: 'Iced Sugar-Free Caramel Protein Latte', size: 'Grande', servings: 1, calories: 200, proteinG: 20, carbsG: 20, fatG: 5 }],
};
const FOUND = { kind: 'found', facts: { name: 'Iced Sugar-Free Caramel Protein Latte', brand: 'Starbucks', servingSize: 'Grande', calories: 210, proteinG: 22, carbsG: 21, fatG: 4.5, sources: [{ title: 'starbucks.ca', uri: 'https://vertexaisearch.cloud.google.com/x' }] } };

beforeEach(() => { h.chat.mockReset(); h.lookupAll.mockReset(); delete process.env.WEB_FOOD_TEXT_LOOKUP; });

describe('parseMealMacros with lookups', () => {
  it('swaps the latte estimate for the published values and says where they came from', async () => {
    h.chat.mockResolvedValue(reply(MEAL));
    h.lookupAll.mockResolvedValue([FOUND]);
    const d = await parseMealMacros('kafta, baked potato and a grande sf caramel protein latte from starbucks', 'global', { tz: 'America/Edmonton' });
    expect(h.lookupAll.mock.calls[0][1]).toMatchObject({ tz: 'America/Edmonton' });
    expect(d.calories).toBe(1010);
    expect(d.proteinG).toBe(72);
    expect(d.lookups?.[0]).toMatchObject({ status: 'found', sourceDomain: 'starbucks.ca' });
    expect(d.notes).toMatch(/from starbucks\.ca/);
    expect(d.confidence).toBe('high');
  });

  it('keeps the estimate, labelled, when the lookup finds nothing', async () => {
    h.chat.mockResolvedValue(reply(MEAL));
    h.lookupAll.mockResolvedValue([{ kind: 'not_found', reason: 'size_mismatch' }]);
    const d = await parseMealMacros('…');
    expect(d.calories).toBe(1000);
    expect(d.lookups?.[0].status).toBe('estimated');
  });

  it('does not search for generic food', async () => {
    h.chat.mockResolvedValue(reply({ ...MEAL, branded: [] }));
    const d = await parseMealMacros('2 eggs and toast');
    expect(h.lookupAll).not.toHaveBeenCalled();
    expect(d.lookups).toBeUndefined();
  });

  it('a lone branded item with no per-item estimate uses the meal totals as its estimate', async () => {
    h.chat.mockResolvedValue(reply({ ...MEAL, calories: 190, proteinG: 18, carbsG: 19, fatG: 5, branded: [{ brand: 'Starbucks', product: 'Iced Sugar-Free Caramel Protein Latte', size: 'Grande' }] }));
    h.lookupAll.mockResolvedValue([FOUND]);
    const d = await parseMealMacros('grande sf caramel protein latte starbucks');
    expect(d.calories).toBe(210);
  });

  it('can be switched off', async () => {
    process.env.WEB_FOOD_TEXT_LOOKUP = '0';
    h.chat.mockResolvedValue(reply(MEAL));
    await parseMealMacros('…');
    expect(h.lookupAll).not.toHaveBeenCalled();
  });
});
