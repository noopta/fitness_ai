/**
 * A false positive here attaches McDonald's macros to an unrelated diner, so
 * these tests lean on the cases where a looser matcher would be wrong.
 */
import { describe, it, expect } from 'vitest';
import { normaliseVenueName, buildBrandIndex, matchBrand } from '../services/foodFinder/brandMatcher.js';

const BRANDS = [
  { id: 'b1', slug: 'mcdonalds', name: "McDonald's", aliases: ['mcdonalds', 'mc donalds'] },
  { id: 'b2', slug: 'subway', name: 'Subway', aliases: ['subway restaurants'] },
  { id: 'b3', slug: 'tim-hortons', name: 'Tim Hortons', aliases: ['tims', 'timmies'] },
  { id: 'b4', slug: 'nandos', name: "Nando's", aliases: ['nandos peri peri'] },
];
const index = buildBrandIndex(BRANDS);

describe('normaliseVenueName', () => {
  it('strips the decoration Places listings carry', () => {
    expect(normaliseVenueName("McDonald's #4412")).toBe('mcdonald s');
    expect(normaliseVenueName('SUBWAY® Restaurants')).toBe('subway');
    expect(normaliseVenueName('Tim Hortons - Queen St W')).toBe('tim hortons');
    expect(normaliseVenueName('Tim Hortons (Queen & Spadina)')).toBe('tim hortons');
    expect(normaliseVenueName('Starbucks Store 233')).toBe('starbucks');
  });

  it('keeps a location qualifier from becoming part of the brand', () => {
    expect(normaliseVenueName('Nando’s — Soho')).toBe('nando s');
  });
});

describe('matchBrand', () => {
  it('matches the messy real-world spellings', () => {
    expect(matchBrand("McDonald's #4412", index)?.slug).toBe('mcdonalds');
    expect(matchBrand('SUBWAY® Restaurants', index)?.slug).toBe('subway');
    expect(matchBrand('Tim Hortons - Queen St W', index)?.slug).toBe('tim-hortons');
    expect(matchBrand('Timmies', index)?.slug).toBe('tim-hortons');
  });

  it('matches a brand followed by a location', () => {
    expect(matchBrand('McDonalds Yonge and Dundas', index)?.slug).toBe('mcdonalds');
  });

  it('returns null for an independent, which is the common case', () => {
    expect(matchBrand('Bestco Fresh Foods Downtown', index)).toBeNull();
    expect(matchBrand('Joe’s Diner', index)).toBeNull();
    expect(matchBrand('', index)).toBeNull();
  });

  it('will not let a short prefix hijack an unrelated restaurant', () => {
    // The failure that makes this module conservative: a sloppy startsWith
    // would claim "Subway Sandwich Artistry Ltd" fine, but must NOT claim a
    // restaurant that merely begins with the same few letters.
    const narrow = buildBrandIndex([{ id: 'x', slug: 'papa', name: 'Papa', aliases: [] }]);
    expect(matchBrand('Papaya King', narrow)).toBeNull();
  });

  it('does not match a brand name buried mid-string', () => {
    // "Not McDonalds Cafe" is not a McDonald's.
    expect(matchBrand('Not McDonalds Cafe', index)).toBeNull();
  });
});
