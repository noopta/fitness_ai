// The resolver ladder: your scans → verified records → food databases → web
// (gated) → estimate, and the gate that keeps vague text off the web.

import { describe, it, expect, vi } from 'vitest';

vi.mock('@prisma/client', () => ({ PrismaClient: vi.fn(function (this: any) { this.mealEntry = { findMany: vi.fn().mockResolvedValue([]) }; this.productBarcode = { findMany: vi.fn().mockResolvedValue([]) }; }) }));
vi.mock('@google/genai', () => ({ GoogleGenAI: vi.fn() }));

import { _resetFoodRecordsForTests, resolveItem, webGate, isSpecific, isKnownChain, clarifyQuestion, asksForLookup, countryKey, plausible, type ResolverDeps, type ResolveEvent } from '../services/food/foodResolver.js';
import type { BrandedItem } from '../services/food/brandedLookup.js';

const item = (o: Partial<BrandedItem> = {}): BrandedItem => ({ brand: 'Barebells', product: 'Cookies & Cream protein bar', size: null, servings: 1, estimate: { calories: 200, proteinG: 20, carbsG: 18, fatG: 8 }, ...o });
const FACTS = (title: string) => ({ name: 'x', brand: 'Barebells', servingSize: '55 g', calories: 199, proteinG: 20, carbsG: 17, fatG: 7.5, sources: [{ title, uri: '' }] });

function deps(o: Partial<ResolverDeps> = {}): Partial<ResolverDeps> {
  return {
    history: vi.fn().mockResolvedValue(null),
    records: vi.fn().mockResolvedValue(null),
    database: vi.fn().mockResolvedValue({ kind: 'not_found', reason: 'no_brand_match', brandSeen: false }),
    web: vi.fn().mockResolvedValue({ kind: 'found', facts: FACTS('barebells.com') }),
    remember: vi.fn().mockResolvedValue(undefined),
    log: vi.fn(),
    ...o,
  };
}

describe('the gate', () => {
  it('knows chains, and needs a specific product for packaged brands', () => {
    expect(isKnownChain('Tim Hortons')).toBe(true);
    expect(isKnownChain("McDonald's")).toBe(true);
    expect(isKnownChain('Barebells')).toBe(false);
    expect(isSpecific(item())).toBe(true);
    expect(isSpecific(item({ product: 'protein drink' }))).toBe(false);
    expect(isSpecific(item({ brand: 'Tim Hortons', product: 'Protein Iced Latte', size: 'Medium' }))).toBe(true);
    expect(isSpecific(item({ brand: 'Tim Hortons', product: 'Tim Hortons' }))).toBe(false);
  });

  it('allows the web for chains and database brands; blocks vague, small and unknown', () => {
    expect(webGate(item({ brand: 'Starbucks', product: 'Caffè Latte', size: 'Grande' }), { brandSeen: false })).toEqual({ allowed: true, reason: 'chain' });
    expect(webGate(item(), { brandSeen: true })).toEqual({ allowed: true, reason: 'brand_in_database' });
    expect(webGate(item(), { brandSeen: false })).toEqual({ allowed: false, reason: 'unknown_brand' });
    expect(webGate(item({ product: 'protein bar' }), { brandSeen: true })).toEqual({ allowed: false, reason: 'not_specific' });
    expect(webGate(item({ estimate: { calories: 60, proteinG: 0, carbsG: 15, fatG: 0 } }), { brandSeen: true })).toEqual({ allowed: false, reason: 'small_item' });
    expect(webGate(item({ product: 'protein bar' }), { brandSeen: false, explicit: true }).allowed).toBe(true);
  });

  it('asks about a vague brand worth asking about', () => {
    expect(clarifyQuestion(item({ product: 'protein drink' }))).toBe('Which Barebells protein drink was it — the flavour or exact name?');
    expect(clarifyQuestion(item())).toBeNull();
    expect(clarifyQuestion(item({ product: 'gum', estimate: { calories: 5, proteinG: 0, carbsG: 1, fatG: 0 } }))).toBeNull();
  });

  it('spots a request to look it up', () => {
    expect(asksForLookup('a big mac, look it up')).toBe(true);
    expect(asksForLookup('https://www.barebells.com/products/x')).toBe(true);
    expect(asksForLookup('a big mac')).toBe(false);
  });

  it('groups zones by country for shared records', () => {
    expect(countryKey('America/Edmonton')).toBe('CA');
    expect(countryKey('America/Chicago')).toBe('US');
    expect(countryKey('Europe/Paris')).toBe('Europe');
  });
});

describe('eval fixes (9 Oct 2026)', () => {
  it('treats flavours as specific and "any flavor" or a size alone as vague', () => {
    expect(isSpecific(item({ product: 'Chocolate Protein Drink' }))).toBe(true);
    expect(isSpecific(item({ brand: 'Clif Bar', product: 'Chocolate Chip' }))).toBe(true);
    expect(isSpecific(item({ product: 'Protein Drink (any flavor)' }))).toBe(false);
    expect(isSpecific(item({ product: 'protein drink', size: '330 ml' }))).toBe(false);
    // The real parser output that got logged as specific on 9 Oct 2026.
    expect(isSpecific(item({ product: 'Protein Drink (any flavor, e.g., Caramel Cashew, Chocolate)', size: '330ml' }))).toBe(false);
    expect(clarifyQuestion(item({ product: 'Protein Drink (any flavor, e.g., Caramel Cashew, Chocolate)' }))).toBe('Which Barebells protein drink was it — the flavour or exact name?');
    expect(isSpecific(item({ brand: 'Chick-fil-A', product: 'Chicken Sandwich (original)' }))).toBe(true);
    expect(isSpecific(item({ product: 'Protein Bar, e.g. Salty Peanut' }))).toBe(false);
  });
  it('asks without repeating the brand', () => {
    expect(clarifyQuestion(item({ brand: 'Barebells', product: 'Barebells protein drink' }))).toBe('Which Barebells protein drink was it — the flavour or exact name?');
  });
  it('rejects matches far from the estimate', () => {
    const facts = (calories: number) => ({ name: 'x', brand: 'Starbucks', servingSize: null, calories, proteinG: 0, carbsG: 0, fatG: 0, sources: [] });
    expect(plausible(item({ estimate: { calories: 220, proteinG: 12, carbsG: 19, fatG: 7 } }), facts(3888))).toBe(false);
    expect(plausible(item({ estimate: { calories: 400, proteinG: 12, carbsG: 19, fatG: 7 } }), facts(174))).toBe(true);
  });
  it('sends a chain menu item past the databases to the web', async () => {
    const d = deps();
    const r = await resolveItem(item({ brand: 'Starbucks', product: 'Caffè Latte', size: 'Grande' }), 0, { surface: 'chat', deps: d });
    expect(d.database).not.toHaveBeenCalled();
    expect(r.step).toBe('web');
  });
  it('drops an implausible database match and keeps going', async () => {
    const d = deps({ database: vi.fn().mockResolvedValue({ kind: 'found', db: 'off', facts: { ...FACTS('Open Food Facts'), calories: 3888 } }) });
    const r = await resolveItem(item(), 0, { surface: 'chat', deps: d });
    expect(r.step).toBe('web');
  });
});

describe('resolveItem', () => {
  it('stops at your own scan', async () => {
    const d = deps({ history: vi.fn().mockResolvedValue(FACTS('your scan on 6 Oct')) });
    const r = await resolveItem(item(), 0, { userId: 'u1', surface: 'describe', deps: d });
    expect(r.step).toBe('history');
    expect(d.database).not.toHaveBeenCalled();
    expect(d.web).not.toHaveBeenCalled();
  });

  it('uses verified records before the databases', async () => {
    const d = deps({ records: vi.fn().mockResolvedValue(FACTS('a scanned label')) });
    expect((await resolveItem(item(), 0, { surface: 'chat', deps: d })).step).toBe('records');
    expect(d.database).not.toHaveBeenCalled();
  });

  it('takes a database match, remembers it, and never searches the web', async () => {
    const d = deps({ database: vi.fn().mockResolvedValue({ kind: 'found', db: 'off', facts: FACTS('Open Food Facts') }) });
    const r = await resolveItem(item(), 0, { surface: 'chat', deps: d });
    expect(r).toMatchObject({ step: 'database', web: 'not_needed' });
    expect(d.remember).toHaveBeenCalled();
    expect(d.web).not.toHaveBeenCalled();
  });

  it('searches the web only through the gate, and logs the decision', async () => {
    const d = deps({ database: vi.fn().mockResolvedValue({ kind: 'not_found', reason: 'no_product_match', brandSeen: true }) });
    const events: ResolveEvent[] = [];
    const r = await resolveItem(item(), 0, { userId: 'u1', surface: 'describe', deps: d, onEvent: (e) => events.push(e) });
    expect(r).toMatchObject({ step: 'web', web: 'used', gateReason: 'brand_in_database' });
    expect(events.map((e) => `${e.phase}:${e.state}`)).toEqual(['history:checking', 'database:checking', 'web:checking', 'web:found']);
    expect((d.log as any).mock.calls[0][0]).toMatchObject({ surface: 'describe', step: 'web', webCalls: 1 });
  });

  it('estimates an unknown brand without a web search', async () => {
    const d = deps();
    const r = await resolveItem(item({ brand: 'Corner Bakery Of Nowhere' }), 0, { surface: 'chat', deps: d });
    expect(r).toMatchObject({ step: 'estimate', web: 'gated', gateReason: 'unknown_brand' });
    expect(d.web).not.toHaveBeenCalled();
  });

  it('falls back to the estimate when the web finds nothing', async () => {
    const d = deps({ web: vi.fn().mockResolvedValue({ kind: 'not_found', reason: 'size_mismatch' }) });
    const r = await resolveItem(item({ brand: 'Starbucks', product: 'Caffè Latte', size: 'Venti' }), 0, { surface: 'chat', deps: d });
    expect(r).toMatchObject({ step: 'estimate', web: 'used' });
  });
});

describe('verified records survive the parser rewording a product', () => {
  it('reuses a match for the same drink, but not for a different one', async () => {
    process.env.FOOD_RECORDS_PATH = '/tmp/axiom-test-food-records.json';
    _resetFoodRecordsForTests();
    const latte = (product: string) => item({ brand: 'Starbucks', product, size: 'Grande', estimate: { calories: 250, proteinG: 20, carbsG: 20, fatG: 8 } });
    const web = vi.fn().mockResolvedValue({ kind: 'found', facts: { ...FACTS('starbucks.com'), brand: 'Starbucks', calories: 230 } });
    const base = { history: vi.fn().mockResolvedValue(null), database: vi.fn(), log: vi.fn() };
    expect((await resolveItem(latte('Caramel Protein Latte'), 0, { tz: 'America/Toronto', surface: 'chat', deps: { ...base, web } })).step).toBe('web');
    await new Promise((r) => setTimeout(r, 0));
    const again = await resolveItem(latte('Caramel Protein Latte (custom order)'), 0, { tz: 'America/Toronto', surface: 'chat', deps: { ...base, web } });
    expect(again.step).toBe('records');
    const other = await resolveItem(latte('Sugar-Free Caramel Protein Latte'), 0, { tz: 'America/Toronto', surface: 'chat', deps: { ...base, web } });
    expect(other.step).toBe('web');
    expect(web).toHaveBeenCalledTimes(2);
  });
});
