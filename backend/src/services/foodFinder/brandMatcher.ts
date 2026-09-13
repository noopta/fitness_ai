/**
 * Match a Places listing to a known restaurant chain.
 *
 * This is what turns "a restaurant near you" into "a McDonald's near you, and
 * we know exactly what a McChicken contains". It is the single step that moves
 * a result from `estimated` (a cuisine guess) to `published` (a real nutrition
 * table), so a false positive here is expensive: it would attach McDonald's
 * macros to an unrelated diner.
 *
 * Matching is therefore conservative and deterministic — no fuzzy distance, no
 * model call. Places display names are messy in predictable ways ("McDonald's
 * #4412", "SUBWAY® Restaurants", "Tim Hortons - Queen St W"), so the work is
 * normalising that noise away and then requiring an exact hit on a known alias.
 */

import { fold } from '../../engine/dietaryFilter.js';

export interface BrandRecord {
  id: string;
  slug: string;
  name: string;
  aliases: string[];
}

/**
 * Strip the decoration Places listings carry around a brand name.
 *
 * Order matters: branch numbers and trailing location qualifiers go before
 * folding, because "Tim Hortons - Queen St W" must become "tim hortons" and not
 * "tim hortons queen st w".
 */
export function normaliseVenueName(raw: string): string {
  let s = raw
    .replace(/[®™©]/g, ' ')
    // "#4412", "Store 233", "No. 18". No leading \b before the '#': a word
    // boundary cannot exist between a space and a '#', since neither is a word
    // character, so anchoring there silently never matched.
    .replace(/(?:#\s*|\bno\.?\s*|\bstore\s*|\bunit\s*)\d+\b/gi, ' ')
    // Everything after a separator is a location qualifier, not the brand.
    .split(/\s+[-–—|]\s+/)[0]
    // "(Queen & Spadina)"
    .replace(/\([^)]*\)/g, ' ');

  s = fold(s);

  // Generic trailing words that are never part of the brand identity.
  const NOISE = /\b(restaurants?|cafes?|coffee|store|locations?|express|drive thru|drive through|canada|usa|uk)\b/g;
  s = s.replace(NOISE, ' ').replace(/\s+/g, ' ').trim();
  return s;
}

/**
 * Index brands by every alias, for O(1) exact lookup after normalisation.
 *
 * Built once per process from the brand table; the corpus is small and changes
 * only when the scraper runs.
 */
export function buildBrandIndex(brands: BrandRecord[]): Map<string, BrandRecord> {
  const index = new Map<string, BrandRecord>();
  for (const b of brands) {
    for (const alias of [b.name, b.slug.replace(/-/g, ' '), ...b.aliases]) {
      const key = normaliseVenueName(alias);
      if (!key) continue;
      // First writer wins, so an alias collision cannot silently reassign a
      // brand depending on table order.
      if (!index.has(key)) index.set(key, b);
    }
  }
  return index;
}

/**
 * Resolve a Places display name to a brand, or null.
 *
 * Null is the safe and common answer — most restaurants are independents, and
 * treating one as a chain would be worse than treating it as unknown.
 */
export function matchBrand(venueName: string, index: Map<string, BrandRecord>): BrandRecord | null {
  const key = normaliseVenueName(venueName);
  if (!key) return null;

  const exact = index.get(key);
  if (exact) return exact;

  /**
   * One controlled relaxation: a listing that STARTS with a known brand and adds
   * a location ("mcdonalds yonge dundas"). Requires a word boundary and a
   * minimum brand length, so "papa" cannot claim "papaya king".
   */
  for (const [alias, brand] of index) {
    if (alias.length < 5) continue;
    if (key === alias || key.startsWith(`${alias} `)) return brand;
  }
  return null;
}
