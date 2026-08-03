/**
 * Idempotently enrich every saved recipe that has no usable micronutrients.
 *
 * Dry-run by default:
 *   npm run backfill:recipe-micros
 * Apply against the configured DATABASE_URL:
 *   npm run backfill:recipe-micros -- --apply
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { estimateMicronutrientsOnly } from '../src/services/llmService.js';

const prisma = new PrismaClient();
const apply = process.argv.includes('--apply');

type Item = { name?: string; quantity?: string };

function parseItems(raw: string): Item[] {
  try {
    const value = JSON.parse(raw);
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function hasUsableMicros(raw: string | null): boolean {
  if (!raw) return false;
  try {
    const value = JSON.parse(raw);
    return Object.values(value).filter(
      (entry) => typeof entry === 'number' && Number.isFinite(entry) && entry > 0,
    ).length >= 3;
  } catch {
    return false;
  }
}

function perServingJson(values: Record<string, unknown>, servings: number): string | null {
  const scaled = Object.fromEntries(
    Object.entries(values)
      .filter(([, value]) => typeof value === 'number' && Number.isFinite(value))
      .map(([key, value]) => [key, Math.round(((value as number) / servings) * 100) / 100]),
  );
  return Object.keys(scaled).length ? JSON.stringify(scaled) : null;
}

async function main() {
  const recipes = await prisma.recipe.findMany({ orderBy: { createdAt: 'asc' } });
  const missing = recipes.filter((recipe) => !hasUsableMicros(recipe.nutrientsJson));
  console.log(`[recipe-micros] ${missing.length}/${recipes.length} recipes need enrichment; mode=${apply ? 'apply' : 'dry-run'}`);

  let updated = 0;
  let failed = 0;
  for (const recipe of missing) {
    const items = parseItems(recipe.itemsJson);
    const ingredients = items.map((item) =>
      [item.quantity?.trim(), item.name?.trim()].filter(Boolean).join(' '),
    ).filter(Boolean);
    const wholeRecipeCalories = recipe.calories * recipe.servings;

    if (!apply) {
      console.log(`[recipe-micros] would enrich ${recipe.id} (${recipe.name})`);
      continue;
    }

    const estimated = await estimateMicronutrientsOnly(recipe.name, ingredients, wholeRecipeCalories);
    const nutrientsJson = estimated
      ? perServingJson(estimated as unknown as Record<string, unknown>, recipe.servings)
      : null;
    if (!nutrientsJson || !hasUsableMicros(nutrientsJson)) {
      failed += 1;
      console.warn(`[recipe-micros] no usable result for ${recipe.id} (${recipe.name})`);
      continue;
    }
    await prisma.recipe.update({ where: { id: recipe.id }, data: { nutrientsJson } });
    updated += 1;
    console.log(`[recipe-micros] enriched ${recipe.id} (${recipe.name})`);
  }
  console.log(`[recipe-micros] complete: updated=${updated} failed=${failed} skipped=${recipes.length - missing.length}`);
}

main()
  .catch((error) => {
    console.error('[recipe-micros] fatal:', error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
