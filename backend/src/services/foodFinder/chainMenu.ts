/**
 * Turn nearby restaurants into menu candidates using each chain's menu
 * where the restaurant is a chain we know.
 *
 * This is the upgrade path for the takeout half of the finder. An unmatched
 * restaurant yields cuisine-typical dishes at `estimated` confidence (a 0.7
 * discount); a matched chain yields ITS OWN items at `published` (0.85), with
 * the chain's own allergen and diet tags rather than our keyword guesses.
 *
 * The corpus is small and changes only when a scrape runs, so it is loaded once
 * per process and held in memory. Every lookup after the first is a map hit,
 * which is what keeps the request path at its measured ~12 ms.
 */

import { PrismaClient } from '@prisma/client';
import type { Candidate } from '../../engine/foodFinderRanker.js';
import type { NearbyPlace } from '../places/placesClient.js';
import { buildBrandIndex, matchBrand, type BrandRecord } from './brandMatcher.js';

const prisma = new PrismaClient();

export interface ChainMenuItem {
  id: string;
  name: string;
  section: string | null;
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  nutrients: Record<string, number>;
  dietTags: string[];
  confidence: 'published' | 'inferred' | 'estimated';
  kcalErrPct: number | null;
  priceCents: number | null;
  currency: string | null;
  sourceUrl: string | null;
}

interface Corpus {
  index: Map<string, BrandRecord>;
  itemsByBrand: Map<string, ChainMenuItem[]>;
}

let _corpus: Corpus | null = null;
let _loading: Promise<Corpus> | null = null;

/** Drop the in-memory corpus — used after a scrape and by tests. */
export function clearChainCorpus(): void {
  _corpus = null;
  _loading = null;
}

async function loadCorpus(): Promise<Corpus> {
  if (_corpus) return _corpus;
  // Concurrent first requests must share one load, not race three of them.
  if (_loading) return _loading;

  _loading = (async () => {
    const brands = await prisma.foodBrand.findMany({
      select: { id: true, slug: true, name: true, aliasesJson: true },
    });
    const records: BrandRecord[] = brands.map(b => ({
      id: b.id,
      slug: b.slug,
      name: b.name,
      aliases: safeArray(b.aliasesJson),
    }));

    const rows = await prisma.menuItem.findMany({
      where: { brandId: { not: null } },
      select: {
        id: true, brandId: true, name: true, section: true,
        kcal: true, proteinG: true, carbsG: true, fatG: true,
        nutrientsJson: true, dietTagsJson: true, confidence: true,
        kcalErrPct: true, priceCents: true, currency: true, sourceUrl: true,
      },
    });

    const itemsByBrand = new Map<string, ChainMenuItem[]>();
    for (const r of rows) {
      if (!r.brandId) continue;
      const list = itemsByBrand.get(r.brandId) ?? [];
      list.push({
        id: r.id,
        name: r.name,
        section: r.section,
        kcal: r.kcal,
        proteinG: r.proteinG,
        carbsG: r.carbsG,
        fatG: r.fatG,
        nutrients: safeObject(r.nutrientsJson),
        dietTags: safeArray(r.dietTagsJson),
        confidence: (r.confidence as ChainMenuItem['confidence']) ?? 'estimated',
        kcalErrPct: r.kcalErrPct,
        priceCents: r.priceCents,
        currency: r.currency,
        sourceUrl: r.sourceUrl,
      });
      itemsByBrand.set(r.brandId, list);
    }

    _corpus = { index: buildBrandIndex(records), itemsByBrand };
    return _corpus;
  })();

  try {
    return await _loading;
  } finally {
    _loading = null;
  }
}

function safeArray(raw: string | null): string[] {
  if (!raw) return [];
  try { const v = JSON.parse(raw); return Array.isArray(v) ? v : []; } catch { return []; }
}
function safeObject(raw: string | null): Record<string, number> {
  if (!raw) return {};
  try { const v = JSON.parse(raw); return v && typeof v === 'object' ? v : {}; } catch { return {}; }
}

/**
 * Places types where chains actually live.
 *
 * Deliberately separate from CUISINE_DISHES' keys. That map answers "what dishes
 * can we guess for this kind of restaurant"; this one answers "where do branded
 * chains file themselves". They barely overlap — no chain is a
 * `mediterranean_restaurant`, and nothing in the cuisine table is a
 * `fast_food_restaurant` — which is why deriving the Places query from the
 * cuisine table alone returned zero chains even at Times Square.
 *
 * Every entry verified live via scripts/probePlaceTypes.ts. ONE invalid type
 * 400s the whole request, so nothing goes in here unguessed.
 */
export const CHAIN_PLACE_TYPES = [
  'fast_food_restaurant',
  'hamburger_restaurant',
  'chicken_restaurant',
  'sandwich_shop',
  'coffee_shop',
  'donut_shop',
  'pizza_restaurant',
] as const;

export interface ChainMatch {
  place: NearbyPlace;
  brand: BrandRecord;
  items: ChainMenuItem[];
}

/**
 * Which of these places are chains we have a menu for.
 *
 * Places with no match are simply absent from the result — the caller falls back
 * to cuisine defaults for those, which is the existing behaviour.
 */
export async function matchChains(places: NearbyPlace[]): Promise<ChainMatch[]> {
  if (places.length === 0) return [];
  const { index, itemsByBrand } = await loadCorpus();
  if (index.size === 0) return [];

  const out: ChainMatch[] = [];
  for (const place of places) {
    const brand = matchBrand(place.name, index);
    if (!brand) continue;
    const items = itemsByBrand.get(brand.id) ?? [];
    if (items.length === 0) continue;
    out.push({ place, brand, items });
  }
  return out;
}

const menuItemId = (place: NearbyPlace, item: ChainMenuItem) =>
  `menu:${place.id}:${item.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;

/**
 * Chain menu items as ranker candidates.
 *
 * Note what the copy can now say. For a cuisine guess the honest phrasing was
 * "typical for a Thai place — estimated, not their menu". For these it is the
 * chain's own published figure, so `note` names the source instead of hedging.
 */
export function chainCandidates(matches: ChainMatch[]): Candidate[] {
  const out: Candidate[] = [];
  for (const { place, brand, items } of matches) {
    for (const item of items) {
      out.push({
        id: menuItemId(place, item),
        name: item.name,
        kind: 'takeout',
        kcal: item.kcal,
        provides: {
          proteinG: item.proteinG,
          carbsG: item.carbsG,
          fatG: item.fatG,
          ...item.nutrients,
        },
        distanceM: place.distanceM,
        confidence: item.confidence,
        kcalErrPct: item.kcalErrPct,
        placeKey: place.id,
        price: null, // set by the pricing pass, which knows the request currency
        meta: {
          serving: item.section ?? 'menu item',
          category: 'Takeout',
          vendor: { id: place.id, name: place.name, distanceM: place.distanceM, openNow: place.openNow, rating: place.rating },
          brand: { slug: brand.slug, name: brand.name },
          priceLevel: place.priceLevel ?? null,
          dietTags: item.dietTags,
          priceCents: item.priceCents,
          sourceUrl: item.sourceUrl,
          // Consumed by the route: only a verified published figure goes
          // unhedged. The curated corpus is unverified and says so.
          published: item.confidence === 'published',
          chainMenu: true,
        },
      });
    }
  }
  return out;
}
