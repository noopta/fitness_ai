/**
 * Measure how wrong the dish estimator actually is.
 *
 * We hold published nutrition for the chains. Running the SAME estimator that
 * handles independents over those chain items, and comparing against the real
 * table, turns "estimated, trust us less" into a number:
 *
 *     Chipotle chicken burrito bowl   est 690 kcal   true 625   +10.4%
 *
 * That number then does two jobs. It replaces the ranker's hand-picked 0.7
 * confidence discount with a measured one, and it lets the UI say "≈620 kcal,
 * ±18%" honestly. For a macro-tracking app this is a correctness feature: an
 * estimate silently off by 400 kcal is worse than no suggestion at all, and
 * until this runs we genuinely do not know which one we are shipping.
 *
 * Writes a JSON report to GCS when a bucket is configured (immutable artifact,
 * never read in the request path) and per-cuisine error bars to the database.
 *
 *   npx tsx scripts/calibrateDishEstimator.ts [--limit 20] [--dry] [--no-upload]
 */

import { PrismaClient } from '@prisma/client';
import { estimateDish } from '../src/services/foodFinder/dishEstimator.js';
import { blobStoreEnabled, putObject } from '../src/services/blobStore.js';

const prisma = new PrismaClient();

interface Row {
  brand: string;
  cuisine: string | null;
  item: string;
  trueKcal: number;
  estKcal: number;
  errPct: number;
  trueProteinG: number;
  estProteinG: number;
  proteinErrPct: number;
}

const pctErr = (est: number, actual: number) =>
  actual > 0 ? ((est - actual) / actual) * 100 : 0;

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Median absolute error — robust to the one dish the model wildly misreads. */
const medianAbs = (values: number[]) => median(values.map(Math.abs));

/**
 * Median SIGNED error, which is what a bias correction must use.
 *
 * The mean is the wrong statistic here: a couple of catastrophic outliers
 * ("macho peas" at +146%) drag it far above where the typical dish sits, and
 * correcting by the mean would over-correct every ordinary item to compensate
 * for two freaks. The median says where the middle of the distribution actually
 * is.
 */
const medianSigned = (values: number[]) => median(values);

async function main() {
  const args = process.argv.slice(2);
  const limit = args.includes('--limit') ? Number(args[args.indexOf('--limit') + 1]) : Infinity;
  const dry = args.includes('--dry');
  const noUpload = args.includes('--no-upload');
  /**
   * Measure CORRECTED output instead of raw, to check the correction actually
   * helped. Implies --dry: a verify pass must never feed its own residual back
   * into the corrections, or successive runs converge on claiming zero error.
   */
  const verify = args.includes('--verify');

  const brands = await prisma.foodBrand.findMany({
    // `curated` chains are UNVERIFIED (see chainSeed.ts). Calibrating against
    // them is still more informative than a hand-picked constant, but the
    // artifact records which kind of ground truth it used.
    where: { nutritionKind: { in: ['published', 'curated'] } },
    select: { id: true, name: true, cuisine: true, nutritionKind: true },
  });
  const unverified = brands.filter(b => b.nutritionKind !== 'published').length;
  if (unverified) console.warn(`! ${unverified}/${brands.length} brands are UNVERIFIED curated data — results are provisional`);
  if (brands.length === 0) {
    console.error('No chain corpus. Run scripts/seedChainMenus.ts first.');
    process.exit(1);
  }

  const rows: Row[] = [];
  let n = 0;

  for (const brand of brands) {
    const items = await prisma.menuItem.findMany({
      where: { brandId: brand.id, source: { startsWith: 'CHAIN_' } },
      select: { name: true, section: true, kcal: true, proteinG: true },
    });

    for (const item of items) {
      if (n >= limit) break;
      n++;
      // useCache:false — a cached estimate would be measuring the cache.
      // raw:true normally — measuring corrected output would measure our own
      // correction. --verify deliberately does the opposite, to check it worked.
      const est = await estimateDish(item.name, { cuisine: brand.cuisine, useCache: false, raw: !verify });
      if (!est) { console.warn(`  ! no estimate for ${item.name}`); continue; }

      const row: Row = {
        brand: brand.name,
        cuisine: brand.cuisine,
        item: item.name,
        trueKcal: item.kcal,
        estKcal: Math.round(est.kcal),
        errPct: pctErr(est.kcal, item.kcal),
        trueProteinG: item.proteinG,
        estProteinG: Math.round(est.proteinG),
        proteinErrPct: pctErr(est.proteinG, item.proteinG),
      };
      rows.push(row);
      console.log(
        `  ${row.item.slice(0, 46).padEnd(48)} est ${String(row.estKcal).padStart(4)}  true ${String(row.trueKcal).padStart(4)}  ${row.errPct >= 0 ? '+' : ''}${row.errPct.toFixed(1)}%`,
      );
    }
  }

  if (rows.length === 0) { console.error('No rows measured.'); process.exit(1); }

  // Per-cuisine error bars, which is the granularity the ranker consumes.
  const byCuisine = new Map<string, number[]>();
  for (const r of rows) {
    const key = r.cuisine ?? 'unknown';
    byCuisine.set(key, [...(byCuisine.get(key) ?? []), r.errPct]);
  }

  const overallKcal = medianAbs(rows.map(r => r.errPct));
  const overallProtein = medianAbs(rows.map(r => r.proteinErrPct));
  const bias = rows.reduce((a, r) => a + r.errPct, 0) / rows.length;

  console.log(`\n─── ${verify ? 'VERIFY (corrected output)' : 'calibration (raw output)'} ───────────`);
  console.log(`items measured        ${rows.length}`);
  console.log(`median |kcal error|   ${overallKcal.toFixed(1)}%`);
  console.log(`median |protein err|  ${overallProtein.toFixed(1)}%`);
  console.log(`mean signed bias      ${bias >= 0 ? '+' : ''}${bias.toFixed(1)}%  ${bias > 8 ? '(over-estimates)' : bias < -8 ? '(under-estimates)' : '(roughly centred)'}`);
  console.log(`median signed bias    ${medianSigned(rows.map(r => r.errPct)) >= 0 ? '+' : ''}${medianSigned(rows.map(r => r.errPct)).toFixed(1)}%  <- what the correction uses`);
  console.log('per cuisine:   bias      |err|');
  for (const [cuisine, errs] of byCuisine) {
    const b = medianSigned(errs);
    console.log(`  ${cuisine.padEnd(12)} ${(b >= 0 ? '+' : '') + b.toFixed(1)}%`.padEnd(26) + `${medianAbs(errs).toFixed(1)}%  (n=${errs.length})`);
  }

  // The artifact the estimator reads at runtime. Per-cuisine, because the
  // spread between cuisines (burger 4.7%, cafe 56%) is an order of magnitude —
  // a single global correction would be wrong nearly everywhere.
  const corrections = Object.fromEntries(
    [...byCuisine].map(([c, errs]) => [c, {
      biasPct: Number(medianSigned(errs).toFixed(2)),
      errPct: Number(medianAbs(errs).toFixed(2)),
      n: errs.length,
    }]),
  );

  const report = {
    generatedAt: new Date().toISOString(),
    corrections,
    globalBiasPct: Number(medianSigned(rows.map(r => r.errPct)).toFixed(2)),
    model: process.env.FOOD_FINDER_ESTIMATOR_MODEL ?? 'gemini-2.5-flash',
    itemsMeasured: rows.length,
    medianAbsKcalErrPct: Number(overallKcal.toFixed(2)),
    medianAbsProteinErrPct: Number(overallProtein.toFixed(2)),
    meanSignedBiasPct: Number(bias.toFixed(2)),
    byCuisine: Object.fromEntries([...byCuisine].map(([c, e]) => [c, Number(medianAbs(e).toFixed(2))])),
    rows,
  };

  if (dry || verify) {
    console.log(`\n[${verify ? 'verify' : 'dry'}] no writes`);
    await prisma.$disconnect();
    return;
  }

  // No per-row stamping. MenuItem has no cuisine column, so a per-cuisine
  // updateMany rewrote every row on each pass and the last cuisine won. The
  // ranker reads the per-cuisine error from calibration.json at request time
  // (nearbyFinder.measuredErrPctFor), which is the single source of truth.

  const json = JSON.stringify(report, null, 2);
  const { writeFileSync } = await import('node:fs');

  // Committed artifact: the estimator reads this, so calibration ships with the
  // code rather than depending on a job having run in the target environment.
  const artifact = new URL('../src/services/foodFinder/calibration.json', import.meta.url).pathname;
  writeFileSync(artifact, JSON.stringify({
    generatedAt: report.generatedAt,
    model: report.model,
    itemsMeasured: report.itemsMeasured,
    globalBiasPct: report.globalBiasPct,
    groundTruth: unverified ? 'curated-unverified' : 'published',
    corrections,
  }, null, 2) + '\n');
  console.log(`artifact: ${artifact}`);

  const local = `/tmp/food-finder-calibration-${Date.now()}.json`;
  writeFileSync(local, json);
  console.log(`full report: ${local}`);

  if (!noUpload && blobStoreEnabled()) {
    // Immutable, dated artifact: written once, never read in the request path.
    const key = `food-finder/calibration/${new Date().toISOString().slice(0, 10)}-${Date.now()}.json`;
    const stored = await putObject(key, json, 'application/json');
    console.log(stored ? `uploaded to GCS: gs://.../${stored.key} (${stored.bytes}b)` : 'GCS upload skipped');
  }

  await prisma.$disconnect();
}

main().catch(async e => { console.error(e); await prisma.$disconnect(); process.exit(1); });
