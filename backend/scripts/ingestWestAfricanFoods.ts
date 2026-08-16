/**
 * West African food-composition ingestion
 *
 * Usage:
 *   npx tsx scripts/ingestWestAfricanFoods.ts [--dry-run] [--source=CURATED_DISH_V1]
 *
 * Populates the global FoodComposition table (plus FoodAlias and FoodPortion)
 * with West African food data, so Nigerian and Gambian users get real numbers
 * instead of USDA misses and LLM guesswork.
 *
 * Safe to re-run. Each source is replaced wholesale inside a transaction, so a
 * re-run is idempotent and never leaves the table half-updated. Sources do not
 * interfere with each other — re-ingesting CURATED_DISH_V1 leaves an imported
 * FAO source untouched.
 *
 * SOURCES
 *   CURATED_DISH_V1       hand-authored composite dishes (src/data/westAfricanDishes.ts)
 *   FAO_INFOODS_WA_2019   [Wave 2] FAO/INFOODS Food Composition Table for
 *                         Western Africa 2019 — not wired up yet; the converted
 *                         table is pending confirmation of FAO's redistribution
 *                         terms. Add a loader here once that clears.
 *   NG_FCT_2017           [Wave 2] Nigeria Food Composition Table 2017.
 *
 * Requires DATABASE_URL. This worktree has no .env, so pass it explicitly:
 *   DATABASE_URL="file:/path/to/dev.db" npx tsx scripts/ingestWestAfricanFoods.ts --dry-run
 */

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { WEST_AFRICAN_DISHES, type WestAfricanDish } from '../src/data/westAfricanDishes.js';
import { foldFoodName } from '../src/services/food/foodNameNormalize.js';

const prisma = new PrismaClient();

const CURATED_SOURCE = 'CURATED_DISH_V1';
const KNOWN_SOURCES = [CURATED_SOURCE] as const;

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const sourceArg = args.find((a) => a.startsWith('--source='))?.split('=')[1];

interface PreparedFood {
  source: string;
  sourceCode: string;
  region: string;
  name: string;
  foldedName: string;
  foodGroup: string | null;
  preparation: string | null;
  isComposite: boolean;
  caloriesPer100g: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  nutrientsJson: string | null;
  dataQuality: string;
  notes: string | null;
  aliases: Array<{ alias: string; foldedAlias: string }>;
  portions: Array<{ label: string; foldedLabel: string; grams: number; isDefault: boolean; note: string | null; region: string }>;
}

/** Reject rows that would poison lookups rather than importing them quietly. */
function validate(dish: WestAfricanDish): string | null {
  if (!dish.slug || !/^[a-z0-9-]+$/.test(dish.slug)) return 'invalid slug';
  if (!dish.name.trim()) return 'empty name';
  if (!foldFoodName(dish.name)) return 'name folds to empty';
  if (dish.per100g.calories <= 0) return 'non-positive calories';
  const { proteinG, carbsG, fatG } = dish.per100g;
  if (proteinG < 0 || carbsG < 0 || fatG < 0) return 'negative macro';
  if (proteinG + carbsG + fatG > 100) return 'macros exceed 100 g';
  if (dish.portions.length === 0) return 'no portions';
  if (dish.portions.some((p) => p.grams <= 0)) return 'non-positive portion weight';
  return null;
}

function prepare(dish: WestAfricanDish): PreparedFood {
  // Only keep nutrient keys with a real positive value. An explicit 0 is a
  // confident claim of absence: it would clear the >=3-nonzero bar that
  // hasUsableMicros() uses and drag the enrichment blend downward.
  const nutrients = Object.fromEntries(
    Object.entries(dish.nutrients).filter(([, v]) => typeof v === 'number' && Number.isFinite(v) && v > 0),
  );

  // Dedupe aliases against each other AND against the folded name, so a dish
  // whose alias equals its own name doesn't violate @@unique([foodId, foldedAlias]).
  const foldedName = foldFoodName(dish.name);
  const seen = new Set<string>([foldedName]);
  const aliases: PreparedFood['aliases'] = [];
  for (const alias of dish.aliases) {
    const folded = foldFoodName(alias);
    if (!folded || seen.has(folded)) continue;
    seen.add(folded);
    aliases.push({ alias, foldedAlias: folded });
  }

  return {
    source: CURATED_SOURCE,
    sourceCode: dish.slug,
    region: dish.region,
    name: dish.name,
    foldedName,
    foodGroup: dish.foodGroup ?? null,
    preparation: dish.preparation ?? null,
    isComposite: dish.isComposite,
    caloriesPer100g: dish.per100g.calories,
    proteinG: dish.per100g.proteinG,
    carbsG: dish.per100g.carbsG,
    fatG: dish.per100g.fatG,
    nutrientsJson: Object.keys(nutrients).length > 0 ? JSON.stringify(nutrients) : null,
    // Recipe-costed, not laboratory-analysed. Recorded so provenance lives in
    // the database rather than being implied.
    dataQuality: 'calculated',
    notes: dish.basis,
    aliases,
    portions: dish.portions.map((p) => ({
      label: p.label,
      foldedLabel: foldFoodName(p.label),
      grams: p.grams,
      isDefault: p.isDefault === true,
      note: p.note ?? null,
      region: dish.region,
    })),
  };
}

function summarize(prepared: PreparedFood[], dropped: Array<{ slug: string; reason: string }>): void {
  const kcals = prepared.map((p) => p.caloriesPer100g).sort((a, b) => a - b);
  const median = kcals.length ? kcals[Math.floor(kcals.length / 2)] : 0;
  const withMicros = prepared.filter((p) => {
    if (!p.nutrientsJson) return false;
    return Object.values(JSON.parse(p.nutrientsJson)).filter((v) => typeof v === 'number' && v > 0).length >= 3;
  }).length;

  console.log(`\n  rows prepared      ${prepared.length}`);
  console.log(`  rows dropped       ${dropped.length}`);
  for (const d of dropped) console.log(`     - ${d.slug}: ${d.reason}`);
  console.log(`  aliases            ${prepared.reduce((n, p) => n + p.aliases.length, 0)}`);
  console.log(`  portions           ${prepared.reduce((n, p) => n + p.portions.length, 0)}`);
  console.log(`  kcal/100g          min ${kcals[0]} · median ${median} · max ${kcals[kcals.length - 1]}`);
  // Below this bar the enrichment service throws the row away and re-asks the LLM.
  console.log(`  >=3 nonzero micros ${withMicros}/${prepared.length}`);
  const byRegion = prepared.reduce<Record<string, number>>((acc, p) => {
    acc[p.region] = (acc[p.region] ?? 0) + 1;
    return acc;
  }, {});
  console.log(`  by region          ${Object.entries(byRegion).map(([r, n]) => `${r}:${n}`).join(' · ')}`);
}

async function ingestCuratedDishes(): Promise<void> {
  const prepared: PreparedFood[] = [];
  const dropped: Array<{ slug: string; reason: string }> = [];

  for (const dish of WEST_AFRICAN_DISHES) {
    const problem = validate(dish);
    if (problem) {
      dropped.push({ slug: dish.slug, reason: problem });
      continue;
    }
    prepared.push(prepare(dish));
  }

  // A duplicate sourceCode would blow up createMany on @@unique([source, sourceCode]).
  const codes = prepared.map((p) => p.sourceCode);
  const dupes = codes.filter((c, i) => codes.indexOf(c) !== i);
  if (dupes.length > 0) throw new Error(`duplicate sourceCodes: ${[...new Set(dupes)].join(', ')}`);

  console.log(`\n[${CURATED_SOURCE}]`);
  summarize(prepared, dropped);

  if (dryRun) {
    console.log('\n  --dry-run: nothing written.\n');
    return;
  }

  const existing = await prisma.foodComposition.count({ where: { source: CURATED_SOURCE } });
  console.log(`\n  replacing ${existing} existing row(s)…`);

  // Replace-in-transaction so a failure can't leave the table half-populated.
  // The cascade on FoodAlias/FoodPortion clears the children with the parents.
  await prisma.$transaction([
    prisma.foodComposition.deleteMany({ where: { source: CURATED_SOURCE } }),
    prisma.foodComposition.createMany({
      data: prepared.map(({ aliases: _a, portions: _p, ...row }) => row),
    }),
  ]);

  // Children need the generated parent ids, so they go in a second pass keyed
  // by the natural (source, sourceCode) pair.
  const written = await prisma.foodComposition.findMany({
    where: { source: CURATED_SOURCE },
    select: { id: true, sourceCode: true },
  });
  const idBySourceCode = new Map(written.map((w) => [w.sourceCode, w.id]));

  const aliasRows = prepared.flatMap((p) =>
    p.aliases.map((a) => ({ foodId: idBySourceCode.get(p.sourceCode)!, ...a })),
  );
  const portionRows = prepared.flatMap((p) =>
    p.portions.map((portion) => ({ foodId: idBySourceCode.get(p.sourceCode)!, ...portion })),
  );

  await prisma.$transaction([
    prisma.foodAlias.createMany({ data: aliasRows }),
    prisma.foodPortion.createMany({ data: portionRows }),
  ]);

  console.log(`  wrote ${written.length} foods, ${aliasRows.length} aliases, ${portionRows.length} portions.\n`);
}

async function main(): Promise<void> {
  if (sourceArg && !KNOWN_SOURCES.includes(sourceArg as typeof KNOWN_SOURCES[number])) {
    console.error(`Unknown --source=${sourceArg}. Known: ${KNOWN_SOURCES.join(', ')}`);
    process.exit(1);
  }
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set. Pass it explicitly — this worktree has no .env.');
    process.exit(1);
  }

  console.log(`West African food ingestion${dryRun ? ' (dry run)' : ''}`);
  await ingestCuratedDishes();
}

main()
  .catch((err) => {
    console.error('\ningest failed:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
