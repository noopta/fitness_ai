/**
 * Money types and the pure budget arithmetic the ranker needs.
 *
 * Split out of services/foodFinder/pricing.ts so that the scoring engine never
 * imports a module that opens a database connection. Everything here is a pure
 * function of its arguments; the lookups live in the service.
 */

import { formatMoney } from './currency.js';

export type PriceConfidence = 'listed' | 'estimated' | 'unknown';

export interface PricedAmount {
  cents: number;
  currency: string;
  confidence: PriceConfidence;
  /** What the user sees, already carrying its own hedge where needed. */
  display: string;
}

/**
 * Places price tiers → multiplier on the metro staple price.
 *
 * These are store-level tiers, so they move the whole basket, not one item. The
 * spread is deliberately narrow: a discount grocer and a premium one differ on
 * staples by far less than their tier badge suggests, and an aggressive spread
 * produces confidently wrong numbers.
 */
const PRICE_TIER_MULTIPLIER: Record<string, number> = {
  PRICE_LEVEL_FREE: 1,
  PRICE_LEVEL_INEXPENSIVE: 0.85,
  PRICE_LEVEL_MODERATE: 1.0,
  PRICE_LEVEL_EXPENSIVE: 1.25,
  PRICE_LEVEL_VERY_EXPENSIVE: 1.5,
};

export const tierMultiplier = (priceLevel?: string | null): number =>
  (priceLevel && PRICE_TIER_MULTIPLIER[priceLevel]) || 1;


/**
 * Normalise a price to what this eating occasion actually costs.
 *
 * A takeout dish is one meal, so cost per meal is the price. A grocery
 * ingredient comes in a pack that outlives the meal: buying 500 g of chicken to
 * eat 200 g of it tonight costs the basket 500 g, but costs THIS MEAL 200 g.
 * `servingsYielded` carries that ratio.
 */
export function costPerMeal(total: PricedAmount, servingsYielded: number): PricedAmount {
  if (total.confidence === 'unknown') return total;
  const n = Math.max(1, servingsYielded);
  if (n === 1) return total;
  const cents = Math.round(total.cents / n);
  return {
    cents,
    currency: total.currency,
    confidence: total.confidence,
    display: total.confidence === 'estimated' ? `\u2248${formatMoney(cents, total.currency)}` : formatMoney(cents, total.currency),
  };
}

/**
 * Budget fit as a MULTIPLIER, matching how the ranker treats calorie fit.
 *
 * The reasoning is identical: an additive penalty can be out-argued by a big
 * nutrient gain, so a $45 steak would still win a $15 budget. As a multiplier it
 * cannot. Slightly over budget is a real option a person might stretch for, so
 * the curve is soft to 1.15x and collapses past that.
 *
 * An unknown price is NOT penalised. We have no evidence it breaks the budget,
 * and penalising unknowns would systematically bury every independent whose menu
 * we could not parse — punishing the user for a gap in our data.
 */
export function budgetFactor(price: PricedAmount | null | undefined, budgetCents: number | null): number {
  if (!price || !budgetCents || budgetCents <= 0) return 1;
  if (price.confidence === 'unknown') return 1;
  const r = price.cents / budgetCents;
  if (r <= 1) return 1;
  if (r <= 1.15) return 0.8;
  return 0.8 / (r * r);
}

/** True when a priced option is over budget by enough to warn about it. */
export const isOverBudget = (price: PricedAmount | null | undefined, budgetCents: number | null): boolean =>
  !!price && !!budgetCents && budgetCents > 0 && price.confidence !== 'unknown' && price.cents > budgetCents;

// ---------------------------------------------------------------------------
// Restaurant price bands
// ---------------------------------------------------------------------------

/**
 * Typical cost of one main dish, by the restaurant's Places price tier.
 *
 * We have no menu for an independent, so there is no listed price to quote. But
 * Places does tell us the tier, and "a moderate sushi place in Guelph" bounds a
 * dish far better than showing nothing — which is what we were doing, leaving
 * Cherry Blossom and Kenzo with a blank where a number should be.
 *
 * Presented as a RANGE, never a point. A single number implies we looked at
 * their menu; a range says what it is — a bracket derived from how expensive
 * the restaurant is. Budget scoring uses the midpoint.
 *
 * Denominated per currency rather than converted, for the same reason the
 * grocery table is: no exchange rate is allowed in the request path.
 */
const DISH_BANDS: Record<string, Record<string, [number, number]>> = {
  USD: {
    PRICE_LEVEL_INEXPENSIVE: [1000, 1600],
    PRICE_LEVEL_MODERATE: [1600, 2800],
    PRICE_LEVEL_EXPENSIVE: [2800, 4500],
    PRICE_LEVEL_VERY_EXPENSIVE: [4500, 8000],
  },
  CAD: {
    PRICE_LEVEL_INEXPENSIVE: [1400, 2200],
    PRICE_LEVEL_MODERATE: [2200, 3800],
    PRICE_LEVEL_EXPENSIVE: [3800, 6000],
    PRICE_LEVEL_VERY_EXPENSIVE: [6000, 11000],
  },
  GBP: {
    PRICE_LEVEL_INEXPENSIVE: [800, 1300],
    PRICE_LEVEL_MODERATE: [1300, 2200],
    PRICE_LEVEL_EXPENSIVE: [2200, 3600],
    PRICE_LEVEL_VERY_EXPENSIVE: [3600, 6500],
  },
};

export interface BandedPrice extends PricedAmount {
  /** Present when the figure is a tier-derived bracket rather than a listed price. */
  band?: { lowCents: number; highCents: number };
}

/**
 * A dish price bracket from the restaurant's price tier.
 *
 * Returns `unknown` when Places gives no tier, or the currency has no band
 * table — an absent price must never read as a cheap one.
 */
export function dishPriceBand(priceLevel: string | null | undefined, currency: string): BandedPrice {
  const unknown: BandedPrice = { cents: 0, currency, confidence: 'unknown', display: 'price unknown' };
  if (!priceLevel) return unknown;
  const table = DISH_BANDS[currency];
  const band = table?.[priceLevel];
  if (!band) return unknown;

  const [low, high] = band;
  const mid = Math.round((low + high) / 2);
  return {
    cents: mid,
    currency,
    confidence: 'estimated',
    // Symbol once: "$22–38", not "$22–$38".
    display: `≈${formatMoney(low, currency)}–${formatMoney(high, currency).replace(/^[^0-9]+/, '')}`,
    band: { lowCents: low, highCents: high },
  };
}
