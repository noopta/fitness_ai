import { PrismaClient } from '@prisma/client';
import { chatComplete } from './chatClient.js';

const prisma = new PrismaClient();

// Types + the pure dictionary/fuzzy layer live in exerciseCanonical.ts so
// engines can import them without dragging in Prisma or the LLM client.
import { SEED, stripQualifiers, fuzzyMatch, canonicalizeSync } from './exerciseCanonical.js';
import type { ExerciseCategory, NormalizedExercise } from './exerciseCanonical.js';
export { canonicalizeSync };
export type { ExerciseCategory, NormalizedExercise };

// ─── LLM Fallback ─────────────────────────────────────────────────────────────

async function classifyWithLLM(rawName: string): Promise<Omit<NormalizedExercise, 'rawName'>> {
  const prompt = `You are an exercise classification expert. Classify this gym exercise.

Exercise: "${rawName}"

Respond with valid JSON only, no markdown:
{
  "canonicalName": "clean, standardized exercise name (title case)",
  "category": "push | pull | legs | hinge | core",
  "primaryMuscle": "one of: chest | shoulders | triceps | back | biceps | quads | hamstrings | glutes | calves | abs",
  "isCompound": true or false
}

Rules:
- push = pressing movements (bench, OHP, dips, triceps isolation)
- pull = rowing/pulling/curling movements
- legs = squat-pattern and leg isolation
- hinge = hip-hinge pattern (deadlifts, RDLs, hip thrusts, GHRs)
- core = abs and trunk stability
- isCompound = true if it trains multiple major muscle groups simultaneously`;

  const response = await chatComplete({
    messages: [{ role: 'user', content: prompt }],
    response_format: { type: 'json_object' },
    temperature: 0,
  });

  const result = JSON.parse(response.choices[0].message.content || '{}');
  return {
    canonicalName: result.canonicalName || rawName,
    category: result.category || 'push',
    primaryMuscle: result.primaryMuscle || 'unknown',
    isCompound: result.isCompound ?? false,
  };
}

// ─── Main Normalize Function ───────────────────────────────────────────────────

export async function normalizeExercise(rawName: string): Promise<NormalizedExercise> {
  const trimmed = rawName.trim();

  // 1. Check DB cache first
  const cached = await prisma.exerciseNormalization.findUnique({ where: { rawName: trimmed } });
  if (cached) {
    return {
      rawName: cached.rawName,
      canonicalName: cached.canonicalName,
      category: cached.category as ExerciseCategory,
      primaryMuscle: cached.primaryMuscle,
      isCompound: cached.isCompound,
    };
  }

  // 2. Exact match in seed dictionary
  const lower = trimmed.toLowerCase();
  if (SEED[lower]) {
    const match = { rawName: trimmed, ...SEED[lower] };
    await prisma.exerciseNormalization.upsert({
      where: { rawName: trimmed },
      create: match,
      update: match,
    });
    return match;
  }

  // 3. Stripped exact match
  const stripped = stripQualifiers(trimmed);
  if (SEED[stripped]) {
    const match = { rawName: trimmed, ...SEED[stripped] };
    await prisma.exerciseNormalization.upsert({
      where: { rawName: trimmed },
      create: match,
      update: match,
    });
    return match;
  }

  // 4. Fuzzy match on stripped name
  const fuzzy = fuzzyMatch(stripped);
  if (fuzzy) {
    const match = { rawName: trimmed, ...fuzzy };
    await prisma.exerciseNormalization.upsert({
      where: { rawName: trimmed },
      create: match,
      update: match,
    });
    return match;
  }

  // 5. LLM fallback
  console.log(`[exerciseNorm] LLM classifying unknown exercise: "${trimmed}"`);
  const llmResult = await classifyWithLLM(trimmed);
  const match = { rawName: trimmed, ...llmResult };
  await prisma.exerciseNormalization.upsert({
    where: { rawName: trimmed },
    create: match,
    update: match,
  });
  return match;
}

// ─── Batch Normalize (for retroactive script) ─────────────────────────────────

export async function normalizeExerciseBatch(rawNames: string[]): Promise<Map<string, NormalizedExercise>> {
  const results = new Map<string, NormalizedExercise>();
  const needsLLM: string[] = [];

  // Check DB cache for all at once
  const cached = await prisma.exerciseNormalization.findMany({
    where: { rawName: { in: rawNames } },
  });
  for (const c of cached) {
    results.set(c.rawName, {
      rawName: c.rawName,
      canonicalName: c.canonicalName,
      category: c.category as ExerciseCategory,
      primaryMuscle: c.primaryMuscle,
      isCompound: c.isCompound,
    });
  }

  // Process uncached names
  for (const rawName of rawNames) {
    if (results.has(rawName)) continue;
    const trimmed = rawName.trim();
    const lower = trimmed.toLowerCase();
    const stripped = stripQualifiers(trimmed);

    let resolved: Omit<NormalizedExercise, 'rawName'> | null =
      SEED[lower] ?? SEED[stripped] ?? fuzzyMatch(stripped);

    if (resolved) {
      results.set(rawName, { rawName, ...resolved });
    } else {
      needsLLM.push(rawName);
    }
  }

  // LLM fallback for unknowns (sequential to avoid rate limits)
  for (const rawName of needsLLM) {
    try {
      const llmResult = await classifyWithLLM(rawName);
      results.set(rawName, { rawName, ...llmResult });
    } catch (err) {
      console.error(`[exerciseNorm] LLM failed for "${rawName}":`, err);
      results.set(rawName, {
        rawName,
        canonicalName: rawName,
        category: 'push',
        primaryMuscle: 'unknown',
        isCompound: false,
      });
    }
  }

  // Upsert all resolved entries to DB
  const toUpsert = Array.from(results.values());
  for (const entry of toUpsert) {
    await prisma.exerciseNormalization.upsert({
      where: { rawName: entry.rawName },
      create: entry,
      update: entry,
    });
  }

  return results;
}
