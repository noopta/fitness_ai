/**
 * Sanity-check the seeded grocery prices against implied per-kg cost.
 *
 * Unlike the dish estimator, this table has never been validated against
 * anything. It is base USD from the catalogue times a metro index, and the base
 * figures are round numbers that were never sourced. This prints what each one
 * IMPLIES per kilo, which is the form in which a wrong price is obvious.
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { FOOD_SOURCES } from '../src/engine/nutritionRecommendations.js';
import { fold } from '../src/engine/dietaryFilter.js';

const prisma = new PrismaClient();

const GRAMS = /^(\d+(?:\.\d+)?)\s*g\b/;

async function load() {
  // Audit what we actually SERVE, not what the catalogue holds — the seeder
  // now prefers per-kilo anchors, so the two disagree by design.
  const seeded = await prisma.ingredientPrice.findMany({ where: { metro: 'toronto-on-ca' } });
  const byName = new Map(seeded.map(r => [r.foldedName, r]));
  const rows: Array<{ name: string; serving: string; cad: number; perKg: number | null }> = [];
  for (const f of FOOD_SOURCES) {
    const row = byName.get(fold(f.name));
    if (!row) continue;
    const cad = row.priceCents / 100;
    const m = GRAMS.exec(f.serving);
    rows.push({ name: f.name, serving: f.serving, cad, perKg: m ? cad / (Number(m[1]) / 1000) : null });
  }
  return rows;
}

async function main() {
  const rows = await load();

  const withKg = rows.filter(r => r.perKg != null).sort((a, b) => b.perKg! - a.perKg!);
  console.log(`${withKg.length} of ${rows.length} foods have a gram-denominated serving\n`);
  console.log('  implied $/kg (CAD)   serving price   food');
  for (const r of withKg) {
  console.log(`  ${('$' + r.perKg!.toFixed(0) + '/kg').padStart(12)}   ${('$' + r.cad.toFixed(2)).padStart(10)}   ${r.name} (${r.serving})`);
}

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
