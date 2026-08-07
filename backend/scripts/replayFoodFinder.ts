/**
 * Replay the food finder over real logged days and print what it would have
 * said, so the answers can be JUDGED before any of this reaches a user.
 *
 * The point is not that it runs — the unit tests cover that. The point is to
 * read fifty real days and ask "would a good coach have said this?". Ranker
 * weights are guesses until they're checked against real intake.
 *
 * Read-only: it loads days and scores candidates. It writes nothing.
 *
 *   npx tsx scripts/replayFoodFinder.ts                # 40 most recent logged days
 *   npx tsx scripts/replayFoodFinder.ts --days 100
 *   npx tsx scripts/replayFoodFinder.ts --user <id> --verbose
 */

import { PrismaClient } from '@prisma/client';
import { rankCandidates, type RankedCandidate } from '../src/engine/foodFinderRanker.js';
import { foodSourceCandidates } from '../src/engine/nutritionRecommendations.js';
import { remainingForDay } from '../src/services/nutritionRemaining.js';

const prisma = new PrismaClient();

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const VERBOSE = process.argv.includes('--verbose');
const LIMIT = Number(arg('--days') ?? 40);
const ONLY_USER = arg('--user');

const pad = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s.padEnd(n));

async function main() {
  // Most recent distinct (user, date) pairs that actually have meals logged.
  const rows = await prisma.mealEntry.findMany({
    where: ONLY_USER ? { userId: ONLY_USER } : undefined,
    select: { userId: true, date: true },
    orderBy: { date: 'desc' },
    take: 4000,
  });

  const seen = new Set<string>();
  const days: { userId: string; date: string }[] = [];
  for (const r of rows) {
    const key = `${r.userId}|${r.date}`;
    if (seen.has(key)) continue;
    seen.add(key);
    days.push({ userId: r.userId, date: r.date });
    if (days.length >= LIMIT) break;
  }

  if (days.length === 0) {
    console.log('No logged days found.');
    return;
  }

  const candidates = foodSourceCandidates();
  const modeCounts: Record<string, number> = {};
  const topPicks: Record<string, number> = {};
  let emptyResults = 0;
  let withWarnings = 0;

  console.log(`Replaying ${days.length} logged days over ${candidates.length} candidate foods.\n`);

  for (const { userId, date } of days) {
    let remaining;
    try {
      remaining = await remainingForDay(userId, date);
    } catch (err) {
      console.log(`  ${date}  <failed: ${(err as Error).message}>`);
      continue;
    }

    const { arbitration, results } = rankCandidates(candidates, remaining, { limit: 3, guaranteeBothKinds: false });
    modeCounts[arbitration.mode] = (modeCounts[arbitration.mode] ?? 0) + 1;
    if (results.length === 0) emptyResults += 1;
    if (results.some((r: RankedCandidate) => r.warns.length > 0)) withWarnings += 1;
    for (const r of results) topPicks[r.name] = (topPicks[r.name] ?? 0) + 1;

    const m = remaining.macros;
    const head =
      `${date}  u:${userId.slice(0, 6)}  ` +
      `${pad(arbitration.mode, 15)} ` +
      `kcal-left ${String(m.kcal.remaining).padStart(5)}  ` +
      `P-left ${String(m.proteinG.remaining).padStart(4)}g  ` +
      `mac ${arbitration.macroPressure.toFixed(2)} mic ${arbitration.microPressure.toFixed(2)}`;
    console.log(head);
    console.log(`    why: ${arbitration.rationale}`);

    if (results.length === 0) {
      console.log('    → (nothing recommended)');
    } else {
      for (const r of results) {
        const closes = r.closes.map(c => `${c.label} ${c.pctOfRemaining}%`).join(', ');
        console.log(`    → ${pad(r.name, 26)} ${String(r.kcal).padStart(4)} kcal  score ${r.score.toFixed(3)}  [${closes}]`);
        if (VERBOSE) {
          console.log(`         gain ${r.gain.toFixed(3)} × fit ${r.kcalFit.toFixed(2)} × conf ${r.confidenceFactor} − ceil ${r.overflow.toFixed(2)}`);
        }
        for (const w of r.warns) console.log(`         ⚠ ${w.text}`);
      }
    }
    console.log('');
  }

  console.log('─'.repeat(72));
  console.log('Mode distribution:');
  for (const [mode, n] of Object.entries(modeCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${pad(mode, 16)} ${String(n).padStart(4)}  ${((n / days.length) * 100).toFixed(0)}%`);
  }
  console.log(`\nDays with no recommendation: ${emptyResults} (${((emptyResults / days.length) * 100).toFixed(0)}%)`);
  console.log(`Days with a ceiling warning: ${withWarnings}`);

  // Concentration is the quality smell to watch: if three foods take every slot,
  // the ranker has collapsed onto a few nutrient-dense items and the advice will
  // feel robotic no matter how defensible each individual pick is.
  const picks = Object.entries(topPicks).sort((a, b) => b[1] - a[1]);
  console.log(`\nDistinct foods recommended: ${picks.length} / ${candidates.length}`);
  console.log('Most-recommended:');
  for (const [name, n] of picks.slice(0, 12)) {
    console.log(`  ${pad(name, 28)} ${String(n).padStart(4)}`);
  }
}

main()
  .catch(err => { console.error(err); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
