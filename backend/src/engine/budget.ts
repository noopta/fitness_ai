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
