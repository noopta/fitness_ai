#!/usr/bin/env node
// One-off repair: convert WorkoutLog.exercises rows that hold raw free text
// (written by the agent's log_workout tool before it stringified JSON) into
// the valid JSON-array format the read paths expect.
//
// Usage (from backend/):  node scripts/repairWorkoutExercisesJson.mjs [--dry-run]
// Take a DB backup first: sqlite3 prisma/dev.db ".backup 'prisma/dev.db.bak-<date>'"

import { PrismaClient } from '@prisma/client';

const dryRun = process.argv.includes('--dry-run');
const prisma = new PrismaClient();

// Mirrors services/workoutExercises.ts freeTextToExercises — kept in sync by
// the round-trip test in src/__tests__/workoutExercises.test.ts.
function freeTextToExercises(raw) {
  const segments = String(raw ?? '')
    .split(/\r?\n|;/)
    .map(s => s.trim())
    .filter(Boolean);
  const names = segments.length > 0 ? segments : ['Workout'];
  return names.map(name => ({ name, sets: 1, reps: '1', freeform: true }));
}

const rows = await prisma.$queryRaw`
  SELECT id, userId, date, exercises FROM WorkoutLog WHERE json_valid(exercises) = 0
`;
console.log(`Found ${rows.length} corrupt row(s)`);

for (const row of rows) {
  const fixed = JSON.stringify(freeTextToExercises(row.exercises));
  console.log(`${dryRun ? '[dry-run] ' : ''}${row.id} (${row.date}): ${JSON.stringify(row.exercises.slice(0, 50))} -> ${fixed.slice(0, 80)}`);
  if (!dryRun) {
    await prisma.workoutLog.update({ where: { id: row.id }, data: { exercises: fixed } });
  }
}

const remaining = await prisma.$queryRaw`
  SELECT COUNT(*) AS n FROM WorkoutLog WHERE json_valid(exercises) = 0
`;
console.log(`Done. Remaining corrupt rows: ${remaining[0].n}`);
await prisma.$disconnect();
