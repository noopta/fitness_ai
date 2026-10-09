// Typed meals: branded items go through the resolver and their published
// values replace the parser's estimate inside the meal totals; vague brands
// and unnamed restaurants come back as questions for chat to ask.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ chat: vi.fn(), resolve: vi.fn() }));
vi.mock('@prisma/client', () => ({ PrismaClient: vi.fn(function (this: any) { this.user = {}; }) }));
vi.mock('../services/chatClient.js', () => ({ chatComplete: h.chat }));
vi.mock('../services/ragService.js', () => ({ buildRAGContext: vi.fn(), retrieveProgramSources: vi.fn() }));

import { parseMealMacros } from '../services/llmService.js';

const reply = (o: unknown) => ({ choices: [{ message: { content: JSON.stringify(o) } }] });
const LATTE = { brand: 'Starbucks', product: 'Iced Sugar-Free Caramel Protein Latte', size: 'Grande', servings: 1, calories: 200, proteinG: 20, carbsG: 20, fatG: 5 };
const MEAL = {
  name: 'Kafta, potato and a protein latte', calories: 1000, proteinG: 70, carbsG: 80, fatG: 40, mealType: 'lunch', confidence: 'medium', notes: '',
  ingredients: [], tags: [], plants: [], fermentedFoods: [], ultraProcessed: false, nutrients: {},
  branded: [LATTE], clarify: [],
};
const FACTS = { name: 'Iced Sugar-Free Caramel Protein Latte', brand: 'Starbucks', servingSize: 'Grande', calories: 210, proteinG: 22, carbsG: 21, fatG: 4.5, sources: [{ title: 'starbucks.ca', uri: 'https://vertexaisearch.cloud.google.com/x' }] };
const resolved = (step: string, found = true) => ({ result: found ? { kind: 'found', facts: FACTS } : { kind: 'not_found', reason: 'gated:unknown_brand' }, step, web: step === 'web' ? 'used' : 'not_needed', ms: 5 });

beforeEach(() => { h.chat.mockReset(); h.resolve.mockReset(); delete process.env.WEB_FOOD_TEXT_LOOKUP; });

describe('parseMealMacros with the resolver', () => {
  it('swaps the latte estimate for the published values and records which check answered', async () => {
    h.chat.mockResolvedValue(reply(MEAL));
    h.resolve.mockResolvedValue([resolved('web')]);
    const d = await parseMealMacros('kafta, potato and a grande sf caramel protein latte from starbucks', 'global', { tz: 'America/Edmonton', userId: 'u1', surface: 'chat', resolveFn: h.resolve });
    expect(h.resolve.mock.calls[0][1]).toMatchObject({ tz: 'America/Edmonton', userId: 'u1', surface: 'chat' });
    expect(d.calories).toBe(1010);
    expect(d.proteinG).toBe(72);
    expect(d.lookups?.[0]).toMatchObject({ status: 'found', step: 'web', sourceDomain: 'starbucks.ca' });
    expect(d.notes).toMatch(/from starbucks\.ca/);
    expect(d.confidence).toBe('high');
  });

  it('keeps the estimate, labelled, when nothing confident was found', async () => {
    h.chat.mockResolvedValue(reply(MEAL));
    h.resolve.mockResolvedValue([resolved('estimate', false)]);
    const d = await parseMealMacros('…', 'global', { resolveFn: h.resolve });
    expect(d.calories).toBe(1000);
    expect(d.lookups?.[0]).toMatchObject({ status: 'estimated', step: 'estimate' });
  });

  it('does not resolve anything for generic food', async () => {
    h.chat.mockResolvedValue(reply({ ...MEAL, branded: [] }));
    const d = await parseMealMacros('2 eggs and toast', 'global', { resolveFn: h.resolve });
    expect(h.resolve).not.toHaveBeenCalled();
    expect(d.lookups).toBeUndefined();
    expect(d.brandedItems).toBeUndefined();
  });

  it('a lone branded item with no per-item estimate uses the meal totals as its estimate', async () => {
    h.chat.mockResolvedValue(reply({ ...MEAL, calories: 190, proteinG: 18, carbsG: 19, fatG: 5, branded: [{ brand: 'Starbucks', product: 'Iced Sugar-Free Caramel Protein Latte', size: 'Grande' }] }));
    h.resolve.mockResolvedValue([resolved('database')]);
    const d = await parseMealMacros('grande sf caramel protein latte starbucks', 'global', { resolveFn: h.resolve });
    expect(d.calories).toBe(210);
  });

  it('with lookup off, returns the estimate plus the items and questions to act on', async () => {
    h.chat.mockResolvedValue(reply({ ...MEAL, branded: [{ brand: 'Barebells', product: 'protein drink', size: null, servings: 1, calories: 200, proteinG: 20, carbsG: 20, fatG: 5 }], clarify: [{ item: 'medium pizza', question: 'Which pizza place was it?' }] }));
    const d = await parseMealMacros('a barebells protein drink and a medium pizza', 'global', { lookup: false, resolveFn: h.resolve });
    expect(h.resolve).not.toHaveBeenCalled();
    expect(d.brandedItems).toHaveLength(1);
    expect(d.clarify).toEqual(['Which Barebells protein drink was it — the flavour or exact name?', 'Which pizza place was it?']);
  });

  it('can be switched off', async () => {
    process.env.WEB_FOOD_TEXT_LOOKUP = '0';
    h.chat.mockResolvedValue(reply(MEAL));
    await parseMealMacros('…', 'global', { resolveFn: h.resolve });
    expect(h.resolve).not.toHaveBeenCalled();
  });
});
