/**
 * Price estimation, and the budget-comparability problem.
 *
 * There is no per-store grocery catalogue to buy, so a shelf price is not
 * obtainable. What IS obtainable is a metro-level price for a staple, scaled by
 * how expensive the specific store is (Places' price tier). That lands close
 * enough to be useful and is always labelled an estimate — see the honesty rule
 * in docs/food-finder-architecture.md D6.
 *
 * The subtler problem this module exists to solve is comparability. A $40
 * grocery basket and an $18 takeout order are not the same kind of number: one
 * buys four dinners and the other buys one. Ranking on the raw figure makes
 * groceries lose every time, which would quietly delete half the product.
 * Everything is therefore normalised to COST PER MEAL COVERED before it is
 * compared to a budget or fed to the ranker.
 */

import { PrismaClient } from '@prisma/client';
import { formatMoney } from '../../engine/currency.js';
import { type PricedAmount, tierMultiplier } from '../../engine/budget.js';

export { costPerMeal, budgetFactor, isOverBudget, tierMultiplier } from '../../engine/budget.js';
export type { PricedAmount, PriceConfidence } from '../../engine/budget.js';

const prisma = new PrismaClient();

// ---------------------------------------------------------------------------
// Staple price lookup
// ---------------------------------------------------------------------------

type PriceRow = { foldedName: string; priceCents: number; unitGrams: number | null; currency: string };

/**
 * Per-metro table, loaded once. The corpus is small (hundreds of rows per metro)
 * and changes weekly at most, so a process-lifetime map is the right cache; the
 * refresh job restarts the service.
 */
const metroTables = new Map<string, Map<string, PriceRow>>();

export async function loadMetroPrices(metro: string): Promise<Map<string, PriceRow>> {
  const cached = metroTables.get(metro);
  if (cached) return cached;
  const rows = await prisma.ingredientPrice.findMany({
    where: { metro },
    select: { foldedName: true, priceCents: true, unitGrams: true, currency: true },
  });
  const table = new Map<string, PriceRow>();
  for (const r of rows) table.set(r.foldedName, r);
  metroTables.set(metro, table);
  return table;
}

/** Drop the memoised table — used by the price seeder and by tests. */
export function clearPriceCache(metro?: string): void {
  if (metro) metroTables.delete(metro);
  else metroTables.clear();
}

/**
 * Price for a quantity of an ingredient at a particular store.
 *
 * Returns `unknown` rather than guessing when the staple is not in the table.
 * An absent price must not read as a cheap one — a missing number is excluded
 * from budget arithmetic entirely, and the UI says so.
 */
export async function priceForIngredient(params: {
  foldedName: string;
  /** Grams being proposed, when the candidate asserts a weight. */
  grams?: number | null;
  metro: string | null;
  currency: string;
  priceLevel?: string | null;
}): Promise<PricedAmount> {
  const { foldedName, grams, metro, currency, priceLevel } = params;
  const unknown: PricedAmount = { cents: 0, currency, confidence: 'unknown', display: 'price unknown' };
  if (!metro) return unknown;

  const table = await loadMetroPrices(metro);
  const row = table.get(foldedName);
  if (!row) return unknown;

  // Scale by weight only when BOTH sides assert one. Otherwise the stored price
  // already covers exactly the serving the finder is proposing, and inventing a
  // grams ratio would be fake precision.
  const scale = row.unitGrams && grams && grams > 0 ? grams / row.unitGrams : 1;
  const cents = Math.round(row.priceCents * scale * tierMultiplier(priceLevel));
  return {
    cents,
    currency: row.currency,
    confidence: 'estimated',
    display: `≈${formatMoney(cents, row.currency)}`,
  };
}

/** A menu item's listed price is a fact, not an estimate — no hedge on the display. */
export function priceFromMenu(priceCents: number | null | undefined, currency: string): PricedAmount {
  if (priceCents == null || priceCents <= 0) {
    return { cents: 0, currency, confidence: 'unknown', display: 'price unknown' };
  }
  return { cents: priceCents, currency, confidence: 'listed', display: formatMoney(priceCents, currency) };
}

