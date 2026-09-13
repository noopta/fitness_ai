// The nearby half of the food finder: turn a location into ranked candidates
// from BOTH paths — whole foods attached to a store that plausibly stocks
// them, and typical dishes at a real nearby restaurant — then hand the merged
// list to the same ranker Phase 1 built.
//
// Both paths produce the same Candidate shape on purpose. That is what lets
// "grab salmon at the Loblaws 300 m away" and "get the poke bowl next door"
// compete on one honest scale instead of living in separate tabs the user has
// to arbitrate between.

import {
  FOOD_SOURCES,
  foodSourceCandidates,
  type FoodSource,
  type RetailAvailability,
} from '../../engine/nutritionRecommendations.js';
import { dishesForPlace, DISH_PLACE_TYPES, type CuisineDish } from '../../engine/cuisineDishes.js';
import { filterCandidates, type DietProfile, emptyProfile, hasAnyRestriction, fold } from '../../engine/dietaryFilter.js';
import { type ShownRecord } from '../../engine/foodVariety.js';
import { priceForIngredient, priceFromMenu } from './pricing.js';
import { matchChains, chainCandidates } from './chainMenu.js';
import calibration from './calibration.json' with { type: 'json' };
import { calibrationKeyFor } from '../../engine/cuisineDishes.js';
import { rankCandidates, type Candidate, type RankResult } from '../../engine/foodFinderRanker.js';
import type { DayRemaining } from '../nutritionRemaining.js';
import { searchNearby, type NearbyPlace } from '../places/placesClient.js';

// Grocery-ish Places types, grouped by how specialised the shop is. A food
// tagged `specialty` (beef liver, oysters) may only be claimed at a shop that
// plausibly carries it — promising liver at a corner convenience store is the
// kind of small lie that costs trust in the whole feature.
// The tiers must stay nested (specialty ⊂ large_grocer ⊂ any_grocer in terms of
// how easy the shop is to find), otherwise the distinction buys nothing.
// `specialty` deliberately EXCLUDES plain supermarkets: a big supermarket
// sometimes stocks beef liver, and "sometimes" is not a claim worth making.
// It is still coarse — a butcher is a weak match for oysters — which is why the
// copy says "usually carried at", never "in stock".
const STORE_TYPES: Record<RetailAvailability, string[]> = {
  any_grocer: ['supermarket', 'grocery_store', 'asian_grocery_store', 'market', 'convenience_store'],
  large_grocer: ['supermarket', 'grocery_store', 'asian_grocery_store', 'market'],
  specialty: ['asian_grocery_store', 'health_food_store', 'butcher_shop', 'market'],
};

/**
 * A place must clear this gate on its PRIMARY type before any tier matching.
 *
 * Learned from real data, not guessed. Google tags `food_store` onto coffee
 * shops, gelaterias, bakeries, a Dollarama and a Petro-Canada — so matching on
 * the `types` array alone recommended buying turkey breast and lentils at
 * "Dineen Coffee Co.". primaryType is the trustworthy signal, and every genuine
 * grocer in the sample carried a correct one.
 *
 * The gate is separate from the tier lists on purpose: Whole Foods has
 * primaryType `grocery_store` but lists `health_food_store` in its types, and
 * it IS where you'd buy the specialty items — so once a place is known to be a
 * real food retailer, its secondary types are informative again.
 */
const GENUINE_RETAILER_PRIMARY = new Set([
  'supermarket', 'grocery_store', 'asian_grocery_store', 'market',
  'health_food_store', 'butcher_shop', 'convenience_store',
]);

/**
 * Places type strings verified to be accepted by searchNearby.
 *
 * This list is load-bearing, not documentation: Places rejects the ENTIRE
 * request with 400 "Unsupported types" if a single entry is invalid, so one
 * typo silently removes the whole grocery or takeout path in production rather
 * than degrading it. `seafood_market` looked obvious and is not a real type.
 * Anything added here must be confirmed against the live API first.
 */
export const VERIFIED_PLACE_TYPES = new Set([
  'supermarket', 'grocery_store', 'asian_grocery_store', 'food_store', 'market',
  'convenience_store', 'health_food_store', 'butcher_shop',
]);

/** Every grocery type we're willing to search for, deduped. */
export const GROCERY_PLACE_TYPES = [...new Set(Object.values(STORE_TYPES).flat())];

export interface NearbyOptions {
  lat: number;
  lng: number;
  /** Metro slug for the staple price table. Null = quote no grocery prices. */
  metro?: string | null;
  /** Currency of this location, already resolved from the coordinates. */
  currency?: string;
  /** Per-outing budget in minor units of `currency`. */
  budgetCents?: number | null;
  /** Hard dietary filters. Applied BEFORE ranking, never as a weight. */
  diet?: DietProfile;
  /** What this user was shown recently, for the recency penalty. */
  history?: ShownRecord[];
  /** Search radius in metres. */
  radiusM?: number;
  limit?: number;
  /** Skip the restaurant path (e.g. the user only wants to cook). */
  includeTakeout?: boolean;
  /** Skip the grocery path. */
  includeGroceries?: boolean;
  /** Only propose places Places says are open now. */
  openNowOnly?: boolean;
}

const DEFAULT_RADIUS_M = 2500;

/**
 * Can this store plausibly stock this food?
 *
 * Deliberately a type check, not an inventory claim — we have no stock feed.
 * The strongest honest statement is "this kind of shop carries this kind of
 * food", which is why the copy downstream says "available at" and never
 * "in stock at".
 */
export function storeCarries(food: FoodSource, place: NearbyPlace): boolean {
  // Gate first: is this a real food retailer at all?
  if (!place.primaryType || !GENUINE_RETAILER_PRIMARY.has(place.primaryType)) return false;

  const allowed = STORE_TYPES[food.retail.availability];
  if (allowed.includes(place.primaryType)) return true;
  return place.types.some(t => allowed.includes(t));
}

/** Nearest store that plausibly carries the food, or null. */
export function bestStoreFor(food: FoodSource, stores: NearbyPlace[]): NearbyPlace | null {
  let best: NearbyPlace | null = null;
  for (const s of stores) {
    if (!storeCarries(food, s)) continue;
    if (!best || s.distanceM < best.distanceM) best = s;
  }
  return best;
}

/**
 * Whole foods, each attached to the nearest store that plausibly carries it.
 *
 * Foods with no plausible nearby store keep their place in the list but stay
 * unattached — "eggs" is still the right answer even when we can't name a shop,
 * and dropping it would make the finder worse the further you are from a
 * supermarket.
 */
export function groceryCandidates(stores: NearbyPlace[], sources: FoodSource[] = FOOD_SOURCES): Candidate[] {
  const byName = new Map(sources.map(f => [f.name, f]));
  return foodSourceCandidates(sources).map(c => {
    const food = byName.get(c.name);
    const store = food ? bestStoreFor(food, stores) : null;
    return {
      ...c,
      distanceM: store?.distanceM ?? null,
      meta: {
        ...c.meta,
        store: store
          ? { id: store.id, name: store.name, distanceM: store.distanceM, openNow: store.openNow }
          : null,
      },
    };
  });
}

const dishId = (place: NearbyPlace, dish: CuisineDish) =>
  `dish:${place.id}:${dish.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;

/**
 * Typical dishes at each nearby restaurant we can type confidently.
 *
 * confidence is always 'estimated' — the ranker's 0.7 factor is what keeps a
 * guessed 45 g of protein from outranking a known 46 g. That discount is the
 * whole reason the two paths can share a scale.
 */
export function takeoutCandidates(restaurants: NearbyPlace[]): Candidate[] {
  const out: Candidate[] = [];
  for (const place of restaurants) {
    for (const dish of dishesForPlace(place)) {
      out.push({
        id: dishId(place, dish),
        name: dish.name,
        kind: 'takeout',
        kcal: dish.kcal,
        provides: dish.provides,
        distanceM: place.distanceM,
        confidence: 'estimated',
        // Measured error for this kind of restaurant, where calibration has
        // seen enough of them. The ranker prefers this over the class default,
        // so a cuisine we know we estimate badly is discounted by evidence
        // rather than by a constant — and one we estimate well is not
        // over-penalised. Undefined means unmeasured, which keeps the default.
        kcalErrPct: measuredErrPctFor(place.primaryType),
        placeKey: place.id,
        meta: {
          serving: dish.portion,
          category: 'Takeout',
          vendor: { id: place.id, name: place.name, distanceM: place.distanceM, openNow: place.openNow, rating: place.rating },
          lean: dish.lean ?? false,
          // Consumed by the route to build copy that never overclaims.
          typicalFor: place.primaryType ?? 'restaurant',
        },
      });
    }
  }
  return out;
}

export interface NearbyResult extends RankResult {
  storesFound: number;
  restaurantsFound: number;
  /** How many candidates a dietary restriction removed, so the UI can say so. */
  dietExcluded: number;
  /** Candidate id -> the caveat to show alongside it. */
  dietWarnings: Record<string, string>;
  /** Nearby restaurants we hold a published menu for. */
  chainsMatched: number;
  /** True when Places returned nothing — the client should say so plainly. */
  degraded: boolean;
}

/**
 * Full nearby find: two Places queries in parallel, both paths built, one
 * ranked list out.
 *
 * Places failures degrade to an ingredient-only list rather than an error —
 * the day's gaps are still worth answering without location.
 */
export async function findNearby(
  remaining: DayRemaining,
  opts: NearbyOptions,
): Promise<NearbyResult> {
  const radiusM = opts.radiusM ?? DEFAULT_RADIUS_M;
  const wantGroceries = opts.includeGroceries ?? true;
  const wantTakeout = opts.includeTakeout ?? true;

  const [stores, restaurants] = await Promise.all([
    wantGroceries
      ? searchNearby({ lat: opts.lat, lng: opts.lng, radiusM, includedTypes: GROCERY_PLACE_TYPES, maxResults: 20 })
      : Promise.resolve([]),
    wantTakeout
      ? searchNearby({ lat: opts.lat, lng: opts.lng, radiusM, includedTypes: DISH_PLACE_TYPES, maxResults: 20 })
      : Promise.resolve([]),
  ]);

  // openNow is null when Places has no hours for a place. Treat unknown as
  // open — dropping every place with missing hours would quietly gut the list.
  const openFilter = (p: NearbyPlace) => !opts.openNowOnly || p.openNow !== false;
  const openStores = stores.filter(openFilter);
  const openRestaurants = restaurants.filter(openFilter);

  // Chains we hold a published menu for replace the cuisine guess entirely for
  // those places: a real nutrition table beats a typical-for-this-cuisine
  // estimate, and offering both would put two contradictory answers for the
  // same restaurant in one list.
  const chainMatches = wantTakeout ? await matchChains(openRestaurants) : [];
  const chainedPlaceIds = new Set(chainMatches.map(m => m.place.id));
  const unchainedRestaurants = openRestaurants.filter(p => !chainedPlaceIds.has(p.id));

  const raw: Candidate[] = [
    ...(wantGroceries ? groceryCandidates(openStores) : []),
    ...(wantTakeout ? chainCandidates(chainMatches) : []),
    ...(wantTakeout ? takeoutCandidates(unchainedRestaurants) : []),
  ];

  // Price before ranking, because budget is a scoring input rather than a
  // post-filter — an option the user cannot afford should lose, not be hidden
  // after the fact with a gap where it used to be.
  const priced = await attachPrices(raw, opts);

  // Dietary filtering happens BEFORE ranking and is never traded against score.
  const diet = opts.diet ?? emptyProfile();
  const kept = filterCandidates(priced, dietFactsFor, diet);
  const dietExcluded = priced.length - kept.length;
  const dietWarnings: Record<string, string> = {};
  for (const { item, decision } of kept) {
    if (decision.verdict === 'unverifiable' && decision.reason) dietWarnings[item.id] = decision.reason;
  }

  const survivors = kept.map(k => k.item);
  const ranked = rankCandidates(survivors, remaining, {
    limit: opts.limit ?? 8,
    // Only promise both paths when we actually searched for both AND something
    // from each survived the diet filter — otherwise the guarantee would
    // resurrect an item the user cannot eat.
    guaranteeBothKinds:
      wantGroceries && wantTakeout &&
      survivors.some(c => c.kind === 'takeout') && survivors.some(c => c.kind === 'ingredient'),
    budgetCents: opts.budgetCents ?? null,
    history: opts.history,
  });

  return {
    ...ranked,
    storesFound: openStores.length,
    restaurantsFound: openRestaurants.length,
    degraded: stores.length === 0 && restaurants.length === 0,
    dietExcluded,
    dietWarnings,
    chainsMatched: chainMatches.length,
  };
}


// ---------------------------------------------------------------------------
// Pricing + diet glue
// ---------------------------------------------------------------------------

/**
 * What the dietary filter needs to know about a candidate.
 *
 * Ingredients are USDA compositions, so their confidence is real knowledge of
 * what the food IS. A takeout dish is a cuisine guess attached to a real place,
 * which is exactly the case the filter must refuse to certify.
 */
function dietFactsFor(c: Candidate) {
  const meta = c.meta ?? {};
  return {
    name: c.name,
    description: [meta.category, meta.serving].filter(Boolean).join(' ') || null,
    tags: Array.isArray(meta.dietTags) ? (meta.dietTags as string[]) : null,
    confidence: c.confidence,
  };
}

/**
 * Attach a price to every candidate.
 *
 * Groceries are priced from the metro staple table, scaled by how expensive the
 * attached store is. Takeout keeps whatever the menu listed, and stays `unknown`
 * when we have not parsed a menu for that place — an unknown price is excluded
 * from budget scoring entirely rather than guessed at.
 *
 * `placeKey` is set here too: it is what stops the list piling every option onto
 * the single nearest grocer.
 */
async function attachPrices(candidates: Candidate[], opts: NearbyOptions): Promise<Candidate[]> {
  const currency = opts.currency ?? 'USD';
  const out: Candidate[] = [];

  for (const c of candidates) {
    const meta = (c.meta ?? {}) as Record<string, any>;
    if (c.kind === 'ingredient') {
      const store = meta.store as { id: string; name: string } | null | undefined;
      const price = await priceForIngredient({
        foldedName: fold(c.name),
        metro: opts.metro ?? null,
        currency,
        priceLevel: meta.priceLevel ?? null,
      });
      out.push({ ...c, price, placeKey: store?.id ?? null });
    } else {
      const vendor = meta.vendor as { id: string } | null | undefined;
      out.push({
        ...c,
        price: priceFromMenu(meta.priceCents ?? null, currency),
        placeKey: vendor?.id ?? null,
      });
    }
  }
  return out;
}

export { hasAnyRestriction };


/**
 * Measured kcal error for a Places cuisine type, or undefined when we have not
 * measured enough of that kind of restaurant to say anything.
 *
 * Undefined rather than a global fallback: the ranker's class default already
 * IS the "we don't know" answer, and substituting a global figure would pretend
 * to a precision we did not earn for this cuisine.
 */
const MIN_N = 4;
function measuredErrPctFor(primaryType: string | null | undefined): number | undefined {
  const key = calibrationKeyFor(primaryType);
  const c = (calibration.corrections as Record<string, { errPct: number; n: number }>)[key];
  return c && c.n >= MIN_N ? c.errPct : undefined;
}
