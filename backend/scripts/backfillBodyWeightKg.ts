/**
 * One-time backfill for the BodyWeightLog.weightLbs → weightKg migration.
 *
 * Body weight was historically stored in POUNDS in `weightLbs`. Canonical
 * storage is now kilograms in `weightKg`; this script populates `weightKg` for
 * every legacy row that has a `weightLbs` value but no `weightKg` yet, using the
 * exact avoirdupois pound. It is idempotent — rows that already have `weightKg`
 * are skipped, so running it twice is safe.
 *
 * Unlike the workout-weight ambiguity (see auditWeightUnits.ts / UNITS.md),
 * body weight was unambiguously entered on a scale in pounds, so the conversion
 * is a straight ×0.45359237 with no per-user judgement needed.
 *
 * Run (after `prisma db push` adds the weightKg column):
 *   npx tsx scripts/backfillBodyWeightKg.ts          # dry run (default)
 *   npx tsx scripts/backfillBodyWeightKg.ts --apply  # write changes
 */
import { PrismaClient } from '@prisma/client';
import { KG_PER_LB } from '../src/services/weightUnits';

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');

async function main() {
  const rows = await prisma.bodyWeightLog.findMany({
    where: { weightKg: null, NOT: { weightLbs: null } },
    select: { id: true, weightLbs: true },
  });

  console.log(`${rows.length} legacy row(s) need weightKg backfill (${APPLY ? 'APPLY' : 'DRY RUN'}).`);
  if (rows.length === 0) return;

  let updated = 0;
  for (const row of rows) {
    if (row.weightLbs == null || !Number.isFinite(row.weightLbs)) continue;
    const weightKg = Math.round(row.weightLbs * KG_PER_LB * 100) / 100;
    if (APPLY) {
      await prisma.bodyWeightLog.update({ where: { id: row.id }, data: { weightKg } });
    }
    updated++;
  }

  console.log(
    APPLY
      ? `Backfilled weightKg on ${updated} row(s).`
      : `Would backfill ${updated} row(s). Re-run with --apply to write.`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
