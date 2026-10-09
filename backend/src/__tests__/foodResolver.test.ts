// The resolver ladder: your scans → verified records → food databases → web
// (gated) → estimate, and the gate that keeps vague text off the web.

import { describe, it, expect, vi } from 'vitest';

vi.mock('@prisma/client', () => ({ PrismaClient: vi.fn(function (this: any) { this.mealEntry = { findMany: vi.fn().mockResolvedValue([]) }; this.productBarcode = { findMany: vi.fn().mockResolvedValue([]) }; }) }));
vi.mock('@google/genai', () => ({ GoogleGenAI: vi.fn() }));

import { resolveItem, webGate, isSpecific, isKnownChain, clarifyQuestion, asksForLookup, countryKey, type ResolverDeps, type ResolveEvent } from '../services/food/foodResolver.js';
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
