/**
 * Seed per-metro staple prices from the curated food catalogue.
 *
 * The catalogue already carries `typicalPriceUsd` for each of its 62 whole foods
 * — a US-average price for the serving it proposes. This turns that single
 * number into a per-metro, local-currency table.
 *
 *     local price = typicalPriceUsd x grocery cost index x FX
 *
 * FX is applied HERE, once, at seed time, and the rate is recorded in `source`.
 * The request path never converts currency: a budget in CAD is only ever
 * compared against prices already denominated in CAD. That is the whole reason
 * this is a seeded table rather than a runtime calculation — an exchange rate
 * that moves under a user mid-session is a bug, and a stale rate baked into a
 * price we label "estimated" is not.
 *
 * Idempotent: re-running replaces its own rows and touches nothing else.
 *
 *   npx tsx scripts/seedIngredientPrices.ts [--metro toronto-on-ca] [--dry]
 */

import { PrismaClient } from '@prisma/client';
import { FOOD_SOURCES } from '../src/engine/nutritionRecommendations.js';
import { METROS } from '../src/engine/currency.js';
import { fold } from '../src/engine/dietaryFilter.js';
import { PRICE_PER_KG_USD } from '../src/services/foodFinder/staplePrices.js';

const prisma = new PrismaClient();

/**
 * Grocery cost relative to the US city average, and the FX rate used to get
 * into the metro's currency.
 *
 * These are coarse by design. Grocery baskets differ between cities by far less
 * than rents do, and a wide spread would produce confidently wrong numbers. Any
 * metro added here needs a row, or it inherits nothing and quotes no prices —
 * which is the correct failure, not a silent US price in the wrong currency.
 */
const METRO_INDEX: Record<string, { groceryIndex: number; fxFromUsd: number; rateNote: string }> = {
  'toronto-on-ca':     { groceryIndex: 1.05, fxFromUsd: 1.37, rateNote: 'USD/CAD 1.37' },
  'vancouver-bc-ca':   { groceryIndex: 1.10, fxFromUsd: 1.37, rateNote: 'USD/CAD 1.37' },
  'montreal-qc-ca':    { groceryIndex: 0.98, fxFromUsd: 1.37, rateNote: 'USD/CAD 1.37' },
  'new-york-ny-us':    { groceryIndex: 1.20, fxFromUsd: 1.00, rateNote: 'USD base' },
  'los-angeles-ca-us': { groceryIndex: 1.08, fxFromUsd: 1.00, rateNote: 'USD base' },
  'chicago-il-us':     { groceryIndex: 1.00, fxFromUsd: 1.00, rateNote: 'USD base' },
  'austin-tx-us':      { groceryIndex: 0.95, fxFromUsd: 1.00, rateNote: 'USD base' },
  'london-uk':         { groceryIndex: 1.02, fxFromUsd: 0.79, rateNote: 'USD/GBP 0.79' },
};

const SOURCE_TAG = 'CATALOGUE_V1';

async function main() {
  const args = process.argv.slice(2);
  const only = args.includes('--metro') ? args[args.indexOf('--metro') + 1] : null;
  const dry = args.includes('--dry');

  const metros = METROS.filter(m => !only || m.slug === only);
  if (metros.length === 0) {
    console.error(`No metro matched ${only}. Known: ${METROS.map(m => m.slug).join(', ')}`);
    process.exit(1);
  }

  let written = 0;
  for (const metro of metros) {
    const idx = METRO_INDEX[metro.slug];
    if (!idx) {
      console.warn(`! ${metro.slug}: no cost index — skipped, so it quotes no prices at all`);
      continue;
    }
    const source = `${SOURCE_TAG} idx=${idx.groceryIndex} ${idx.rateNote}`;

    for (const food of FOOD_SOURCES) {
      const foldedName = fold(food.name);

      // Prefer a per-kilo reference where we have one and the serving is
      // gram-denominated: that is the unit groceries are actually priced in,
      // and it stays correct when a portion is scaled. The per-serving
      // catalogue figures are unsourced round numbers and ran 2-4x high.
      const perKg = PRICE_PER_KG_USD[foldedName];
      const gramsMatch = /^(\d+(?:\.\d+)?)\s*g\b/.exec(food.serving);
      const usd = perKg != null && gramsMatch
        ? perKg * (Number(gramsMatch[1]) / 1000)
        : food.retail?.typicalPriceUsd;
      if (usd == null || !(usd > 0)) continue;
      const priceCents = Math.round(usd * idx.groceryIndex * idx.fxFromUsd * 100);

      if (dry) {
        console.log(`  ${metro.slug}  ${foldedName.padEnd(28)} ${(priceCents / 100).toFixed(2)} ${metro.currency}`);
      } else {
        await prisma.ingredientPrice.upsert({
          where: { foldedName_metro: { foldedName, metro: metro.slug } },
          create: { foldedName, metro: metro.slug, currency: metro.currency, priceCents, unitGrams: null, source },
          update: { currency: metro.currency, priceCents, unitGrams: null, source },
        });
      }
      written++;
    }
    console.log(`${dry ? '[dry] ' : ''}${metro.slug}: ${FOOD_SOURCES.length} foods -> ${metro.currency}`);
  }

  console.log(`${dry ? '[dry] would write' : 'wrote'} ${written} price rows across ${metros.length} metros`);
  await prisma.$disconnect();
}

main().catch(async e => { console.error(e); await prisma.$disconnect(); process.exit(1); });
