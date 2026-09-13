/**
 * Load the curated chain corpus into FoodBrand + MenuItem.
 *
 * Idempotent: a re-run replaces each brand's items wholesale rather than
 * accumulating duplicates, so editing a figure in chainSeed.ts and re-running is
 * the whole update workflow.
 *
 *   npx tsx scripts/seedChainMenus.ts [--dry]
 */

import { PrismaClient } from '@prisma/client';
import { CHAIN_SEEDS } from '../src/services/foodFinder/chainSeed.js';
import { fold } from '../src/engine/dietaryFilter.js';

const prisma = new PrismaClient();

async function main() {
  const dry = process.argv.includes('--dry');
  let brands = 0, items = 0;

  for (const seed of CHAIN_SEEDS) {
    if (dry) {
      console.log(`[dry] ${seed.slug}: ${seed.items.length} items`);
      brands++; items += seed.items.length;
      continue;
    }

    const brand = await prisma.foodBrand.upsert({
      where: { slug: seed.slug },
      create: {
        slug: seed.slug,
        name: seed.name,
        aliasesJson: JSON.stringify(seed.aliases),
        cuisine: seed.cuisine,
        nutritionUrl: seed.nutritionUrl,
        nutritionKind: 'published',
        lastScrapedAt: new Date(seed.verifiedOn),
      },
      update: {
        name: seed.name,
        aliasesJson: JSON.stringify(seed.aliases),
        cuisine: seed.cuisine,
        nutritionUrl: seed.nutritionUrl,
        nutritionKind: 'published',
        lastScrapedAt: new Date(seed.verifiedOn),
      },
    });
    brands++;

    // Replace wholesale — a menu item that vanished from the seed should vanish
    // from the corpus, not linger as a dish the chain no longer sells.
    await prisma.menuItem.deleteMany({ where: { brandId: brand.id } });

    await prisma.menuItem.createMany({
      data: seed.items.map(it => ({
        brandId: brand.id,
        name: it.name,
        foldedName: fold(it.name),
        section: it.section ?? null,
        kcal: it.kcal,
        proteinG: it.proteinG,
        carbsG: it.carbsG,
        fatG: it.fatG,
        servingGrams: it.servingGrams ?? null,
        nutrientsJson: JSON.stringify({
          ...(it.sodiumMg != null ? { sodiumMg: it.sodiumMg } : {}),
          ...(it.fiberG != null ? { fiberG: it.fiberG } : {}),
        }),
        // The chain published these, so they are the strongest non-USDA tier.
        confidence: 'published',
        dietTagsJson: it.dietTags ? JSON.stringify(it.dietTags) : null,
        source: `CHAIN_SEED_${seed.slug.toUpperCase()}`,
        sourceUrl: seed.nutritionUrl,
      })),
    });
    items += seed.items.length;
    console.log(`${seed.slug}: ${seed.items.length} items`);
  }

  console.log(`${dry ? '[dry] would load' : 'loaded'} ${brands} brands / ${items} menu items`);
  await prisma.$disconnect();
}

main().catch(async e => { console.error(e); await prisma.$disconnect(); process.exit(1); });
