/**
 * Retroactive exercise normalization seeder.
 *
 * Reads every WorkoutLog in the database, extracts all unique exercise names,
 * and populates the ExerciseNormalization table using the full
 * seed-dict → fuzzy → LLM resolution chain.
 *
 * Safe to re-run: uses upsert, so existing rows are not duplicated.
 *
 * Usage:
 *   npx ts-node --esm scripts/seedExerciseNormalizations.ts
 *   (or via: npm run seed:exercises)
 */

import { PrismaClient } from '@prisma/client';
import { normalizeExerciseBatch } from '../src/services/exerciseNormalizationService.js';

const prisma = new PrismaClient();

async function main() {
  console.log('🔍  Reading all workout logs…');
  const logs = await prisma.workoutLog.findMany({ select: { exercises: true } });
  console.log(`   Found ${logs.length} workout logs.`);

  // Collect every unique raw exercise name across all logs
  const uniqueNames = new Set<string>();
  for (const log of logs) {
    try {
      const exercises: { name: string }[] = JSON.parse(log.exercises);
      for (const ex of exercises) {
        if (ex.name && ex.name.trim()) uniqueNames.add(ex.name.trim());
      }
    } catch {
      console.warn('   Could not parse exercises JSON for a log — skipping.');
    }
  }

  console.log(`\n📋  Unique exercise names found: ${uniqueNames.size}`);
  console.log([...uniqueNames].map(n => `   • ${n}`).join('\n'));

  // Skip names already in the DB
  const existing = await prisma.exerciseNormalization.findMany({
    where: { rawName: { in: [...uniqueNames] } },
    select: { rawName: true },
  });
  const existingSet = new Set(existing.map(e => e.rawName));
  const toProcess = [...uniqueNames].filter(n => !existingSet.has(n));

  if (toProcess.length === 0) {
    console.log('\n✅  All exercises are already normalized. Nothing to do.');
    return;
  }

  console.log(`\n⚙️   Processing ${toProcess.length} new name(s)…`);
  const results = await normalizeExerciseBatch(toProcess);

  console.log('\n✅  Normalization complete:\n');
  for (const [raw, norm] of results.entries()) {
    const tag = norm.canonicalName !== raw ? `→ ${norm.canonicalName}` : '(unchanged)';
    console.log(`   "${raw}" ${tag}  [${norm.category} | ${norm.primaryMuscle} | compound=${norm.isCompound}]`);
  }

  const total = await prisma.exerciseNormalization.count();
  console.log(`\n📊  Total rows in ExerciseNormalization table: ${total}`);
}

main()
  .catch(err => { console.error(err); process.exit(1); })
  .finally(() => prisma.$disconnect());
