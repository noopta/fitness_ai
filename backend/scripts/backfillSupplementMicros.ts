/**
 * Supplement logs saved without their micronutrients (Oct 2026): a supplement
 * logged from chat with explicit numbers skipped the nutrient estimate, so
 * "Magnesium bisglycinate 200 mg and zinc 15 mg" saved every micro as 0.
 * Re-reads every meal whose name carries a dose and adds what's missing, by
 * the same rule new logs now use (services/supplementDoses.ts).
 *
 *   npx tsx scripts/backfillSupplementMicros.ts          # dry run (default)
 *   npx tsx scripts/backfillSupplementMicros.ts --apply  # write changes
 */
import { PrismaClient } from '@prisma/client';
import { applySupplementDoses, parseSupplementDoses } from '../src/services/supplementDoses';

const prisma = new PrismaClient();
const apply = process.argv.includes('--apply');
const parse = (s: string | null) => { try { const v = s ? JSON.parse(s) : {}; return v && typeof v === 'object' ? v : {}; } catch { return {}; } };

async function main() {
  const rows = await prisma.mealEntry.findMany({ select: { id: true, userId: true, date: true, name: true, ingredientsJson: true, notes: true, nutrientsJson: true, nutrientMapJson: true } });
  let changed = 0;
  for (const r of rows) {
    const ingredients: string[] = Array.isArray(parse(r.ingredientsJson)) ? parse(r.ingredientsJson) : [];
    const text = [r.name, ...ingredients, r.notes ?? ''].join(', ');
    if (!parseSupplementDoses(text).length) continue;
    const nutrients = parse(r.nutrientsJson);
    const map = parse(r.nutrientMapJson);
    const out = applySupplementDoses(nutrients, map, text);
    if (!out.added.length) continue;
    changed++;
    console.log(`${apply ? 'FIX ' : 'WOULD FIX '}${r.date} user=${r.userId.slice(0, 8)} "${r.name.slice(0, 70)}" + ${out.added.map((a) => `${a.key} ${a.amount}`).join(', ')}`);
    if (apply) await prisma.mealEntry.update({ where: { id: r.id }, data: { nutrientsJson: JSON.stringify(out.nutrients), nutrientMapJson: JSON.stringify(out.nutrientMap) } });
  }
  console.log(`\n${changed} of ${rows.length} meals ${apply ? 'updated' : 'would change'}.`);
}
main().finally(() => prisma.$disconnect());
