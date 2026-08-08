/**
 * Live end-to-end check of the nearby food finder against real Places data.
 *
 * Hits the real Places API, so it costs a couple of requests per run. It uses a
 * SYNTHETIC day rather than a real user's log — the question here is "does the
 * nearby half return sane, honest answers", not "what did anyone eat".
 *
 *   npx tsx scripts/probeFoodFinder.ts                      # downtown Toronto
 *   npx tsx scripts/probeFoodFinder.ts --lat 40.73 --lng -73.99
 *   npx tsx scripts/probeFoodFinder.ts --scenario tight
 */

import { computeDayRemaining } from '../src/services/nutritionRemaining.js';
import { findNearby } from '../src/services/foodFinder/nearbyFinder.js';

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const LAT = Number(arg('--lat') ?? 43.6532);
const LNG = Number(arg('--lng') ?? -79.3832);
const SCENARIO = arg('--scenario') ?? 'midday';

// Three moments worth eyeballing, because they should produce visibly
// different answers — that difference IS the feature.
const SCENARIOS: Record<string, Record<string, number>> = {
  // Half the day eaten, plenty of room: expect macro-led, substantial options.
  midday: { calories: 1200, proteinG: 70, carbsG: 150, fatG: 40 },
  // Calories nearly gone, protein still short: expect lean, small options.
  tight: { calories: 2480, proteinG: 120, carbsG: 300, fatG: 80 },
  // Macros basically done, micros thin: expect micro-led picks.
  micros: { calories: 2400, proteinG: 175, carbsG: 285, fatG: 76 },
};

async function main() {
  const totals = SCENARIOS[SCENARIO] ?? SCENARIOS.midday;
  const remaining = computeDayRemaining({
    date: new Date().toISOString().slice(0, 10),
    todayTotals: totals,
    weekDayTotals: [],
    bodyweightKg: 80,
    mealsLogged: 3,
    planMacros: { calories: 2600, proteinG: 180, carbsG: 300, fatG: 80 },
  });

  console.log(`scenario=${SCENARIO}  @ ${LAT},${LNG}`);
  console.log(
    `left: ${remaining.macros.kcal.remaining} kcal, ` +
    `${remaining.macros.proteinG.remaining} g protein\n`,
  );

  const t0 = Date.now();
  const found = await findNearby(remaining, { lat: LAT, lng: LNG, limit: 8 });
  const ms = Date.now() - t0;

  console.log(`mode: ${found.arbitration.mode}`);
  console.log(`why:  ${found.arbitration.rationale}`);
  console.log(
    `places: ${found.storesFound} stores, ${found.restaurantsFound} restaurants` +
    `${found.degraded ? '  [DEGRADED — no Places data]' : ''}  (${ms}ms)\n`,
  );

  for (const r of found.results) {
    const where = (r.meta?.vendor ?? r.meta?.store) as { name: string; distanceM: number } | null | undefined;
    const loc = where ? `${where.name} · ${where.distanceM}m` : 'no nearby source';
    console.log(
      `${r.kind === 'takeout' ? '🍽 ' : '🛒 '}${r.name.padEnd(28)} ${String(r.kcal).padStart(4)} kcal  ` +
      `score ${r.score.toFixed(3)}  [${r.confidence}]`,
    );
    console.log(`     ${loc}`);
    console.log(`     closes: ${r.closes.map(c => `${c.label} ${c.pctOfRemaining}%`).join(', ') || '—'}`);
    for (const w of r.warns) console.log(`     ⚠ ${w.text}`);
  }

  const kinds = new Set(found.results.map(r => r.kind));
  console.log(`\npaths represented: ${[...kinds].join(' + ') || 'none'}`);
}

main().catch(err => { console.error(err); process.exitCode = 1; });
