import { PrismaClient } from '@prisma/client';
import OpenAI from 'openai';

const prisma = new PrismaClient();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ─── Types ────────────────────────────────────────────────────────────────────

export type ExerciseCategory = 'push' | 'pull' | 'legs' | 'hinge' | 'core';

export interface NormalizedExercise {
  rawName: string;
  canonicalName: string;
  category: ExerciseCategory;
  primaryMuscle: string;
  isCompound: boolean;
}

// ─── Seed Dictionary ──────────────────────────────────────────────────────────
// Keys are lowercase, stripped variants. Values are the normalized record.
// Add new entries here as the app evolves.

const SEED: Record<string, Omit<NormalizedExercise, 'rawName'>> = {
  // ── PUSH – Chest ────────────────────────────────────────────────────────────
  'bench press':              { canonicalName: 'Bench Press',              category: 'push', primaryMuscle: 'chest',     isCompound: true  },
  'barbell bench press':      { canonicalName: 'Bench Press',              category: 'push', primaryMuscle: 'chest',     isCompound: true  },
  'flat bench press':         { canonicalName: 'Bench Press',              category: 'push', primaryMuscle: 'chest',     isCompound: true  },
  'incline bench press':      { canonicalName: 'Incline Bench Press',      category: 'push', primaryMuscle: 'chest',     isCompound: true  },
  'decline bench press':      { canonicalName: 'Decline Bench Press',      category: 'push', primaryMuscle: 'chest',     isCompound: true  },
  'db bench press':           { canonicalName: 'Dumbbell Bench Press',     category: 'push', primaryMuscle: 'chest',     isCompound: true  },
  'dumbbell bench press':     { canonicalName: 'Dumbbell Bench Press',     category: 'push', primaryMuscle: 'chest',     isCompound: true  },
  'db incline press':         { canonicalName: 'Incline Dumbbell Press',   category: 'push', primaryMuscle: 'chest',     isCompound: true  },
  'incline dumbbell press':   { canonicalName: 'Incline Dumbbell Press',   category: 'push', primaryMuscle: 'chest',     isCompound: true  },
  'cable fly':                { canonicalName: 'Cable Fly',                category: 'push', primaryMuscle: 'chest',     isCompound: false },
  'cable flye':               { canonicalName: 'Cable Fly',                category: 'push', primaryMuscle: 'chest',     isCompound: false },
  'pec deck':                 { canonicalName: 'Pec Deck',                 category: 'push', primaryMuscle: 'chest',     isCompound: false },
  'chest fly':                { canonicalName: 'Chest Fly',                category: 'push', primaryMuscle: 'chest',     isCompound: false },
  'push up':                  { canonicalName: 'Push-Up',                  category: 'push', primaryMuscle: 'chest',     isCompound: true  },
  'push-up':                  { canonicalName: 'Push-Up',                  category: 'push', primaryMuscle: 'chest',     isCompound: true  },
  'dips':                     { canonicalName: 'Dips',                     category: 'push', primaryMuscle: 'chest',     isCompound: true  },
  'chest dips':               { canonicalName: 'Dips',                     category: 'push', primaryMuscle: 'chest',     isCompound: true  },

  // ── PUSH – Shoulders ────────────────────────────────────────────────────────
  'overhead press':           { canonicalName: 'Overhead Press',           category: 'push', primaryMuscle: 'shoulders', isCompound: true  },
  'ohp':                      { canonicalName: 'Overhead Press',           category: 'push', primaryMuscle: 'shoulders', isCompound: true  },
  'barbell overhead press':   { canonicalName: 'Overhead Press',           category: 'push', primaryMuscle: 'shoulders', isCompound: true  },
  'military press':           { canonicalName: 'Overhead Press',           category: 'push', primaryMuscle: 'shoulders', isCompound: true  },
  'seated overhead press':    { canonicalName: 'Seated Overhead Press',    category: 'push', primaryMuscle: 'shoulders', isCompound: true  },
  'db shoulder press':        { canonicalName: 'Dumbbell Shoulder Press',  category: 'push', primaryMuscle: 'shoulders', isCompound: true  },
  'dumbbell shoulder press':  { canonicalName: 'Dumbbell Shoulder Press',  category: 'push', primaryMuscle: 'shoulders', isCompound: true  },
  'arnold press':             { canonicalName: 'Arnold Press',             category: 'push', primaryMuscle: 'shoulders', isCompound: false },
  'db arnold press':          { canonicalName: 'Arnold Press',             category: 'push', primaryMuscle: 'shoulders', isCompound: false },
  'lateral raise':            { canonicalName: 'Lateral Raise',            category: 'push', primaryMuscle: 'shoulders', isCompound: false },
  'db lateral raise':         { canonicalName: 'Lateral Raise',            category: 'push', primaryMuscle: 'shoulders', isCompound: false },
  'cable lateral raise':      { canonicalName: 'Lateral Raise',            category: 'push', primaryMuscle: 'shoulders', isCompound: false },
  'front raise':              { canonicalName: 'Front Raise',              category: 'push', primaryMuscle: 'shoulders', isCompound: false },

  // ── PUSH – Triceps ──────────────────────────────────────────────────────────
  'tricep pushdown':          { canonicalName: 'Triceps Pressdown',        category: 'push', primaryMuscle: 'triceps',   isCompound: false },
  'triceps pushdown':         { canonicalName: 'Triceps Pressdown',        category: 'push', primaryMuscle: 'triceps',   isCompound: false },
  'tricep pressdown':         { canonicalName: 'Triceps Pressdown',        category: 'push', primaryMuscle: 'triceps',   isCompound: false },
  'triceps pressdown':        { canonicalName: 'Triceps Pressdown',        category: 'push', primaryMuscle: 'triceps',   isCompound: false },
  'cable triceps pressdown':  { canonicalName: 'Triceps Pressdown',        category: 'push', primaryMuscle: 'triceps',   isCompound: false },
  'skullcrusher':             { canonicalName: 'Skullcrusher',             category: 'push', primaryMuscle: 'triceps',   isCompound: false },
  'skull crusher':            { canonicalName: 'Skullcrusher',             category: 'push', primaryMuscle: 'triceps',   isCompound: false },
  'ez bar skullcrusher':      { canonicalName: 'Skullcrusher',             category: 'push', primaryMuscle: 'triceps',   isCompound: false },
  'lying tricep extension':   { canonicalName: 'Skullcrusher',             category: 'push', primaryMuscle: 'triceps',   isCompound: false },
  'overhead tricep extension':{ canonicalName: 'Overhead Triceps Extension',category: 'push', primaryMuscle: 'triceps',  isCompound: false },
  'tricep overhead extension':{ canonicalName: 'Overhead Triceps Extension',category: 'push', primaryMuscle: 'triceps',  isCompound: false },
  'close grip bench press':   { canonicalName: 'Close Grip Bench Press',   category: 'push', primaryMuscle: 'triceps',   isCompound: true  },

  // ── PULL – Back ─────────────────────────────────────────────────────────────
  'pull up':                  { canonicalName: 'Pull-Up',                  category: 'pull', primaryMuscle: 'back',      isCompound: true  },
  'pull-up':                  { canonicalName: 'Pull-Up',                  category: 'pull', primaryMuscle: 'back',      isCompound: true  },
  'pullup':                   { canonicalName: 'Pull-Up',                  category: 'pull', primaryMuscle: 'back',      isCompound: true  },
  'chin up':                  { canonicalName: 'Chin-Up',                  category: 'pull', primaryMuscle: 'back',      isCompound: true  },
  'chin-up':                  { canonicalName: 'Chin-Up',                  category: 'pull', primaryMuscle: 'back',      isCompound: true  },
  'lat pulldown':             { canonicalName: 'Lat Pulldown',             category: 'pull', primaryMuscle: 'back',      isCompound: true  },
  'cable lat pulldown':       { canonicalName: 'Lat Pulldown',             category: 'pull', primaryMuscle: 'back',      isCompound: true  },
  'barbell row':              { canonicalName: 'Barbell Row',              category: 'pull', primaryMuscle: 'back',      isCompound: true  },
  'bent over row':            { canonicalName: 'Barbell Row',              category: 'pull', primaryMuscle: 'back',      isCompound: true  },
  'bent-over row':            { canonicalName: 'Barbell Row',              category: 'pull', primaryMuscle: 'back',      isCompound: true  },
  'db row':                   { canonicalName: 'Dumbbell Row',             category: 'pull', primaryMuscle: 'back',      isCompound: true  },
  'dumbbell row':             { canonicalName: 'Dumbbell Row',             category: 'pull', primaryMuscle: 'back',      isCompound: true  },
  'one arm row':              { canonicalName: 'Dumbbell Row',             category: 'pull', primaryMuscle: 'back',      isCompound: true  },
  'single arm row':           { canonicalName: 'Dumbbell Row',             category: 'pull', primaryMuscle: 'back',      isCompound: true  },
  'cable row':                { canonicalName: 'Cable Row',                category: 'pull', primaryMuscle: 'back',      isCompound: true  },
  'seated cable row':         { canonicalName: 'Cable Row',                category: 'pull', primaryMuscle: 'back',      isCompound: true  },
  'seated machine row':       { canonicalName: 'Machine Row',              category: 'pull', primaryMuscle: 'back',      isCompound: true  },
  'machine row':              { canonicalName: 'Machine Row',              category: 'pull', primaryMuscle: 'back',      isCompound: true  },
  't-bar row':                { canonicalName: 'T-Bar Row',                category: 'pull', primaryMuscle: 'back',      isCompound: true  },
  'tbar row':                 { canonicalName: 'T-Bar Row',                category: 'pull', primaryMuscle: 'back',      isCompound: true  },
  'face pull':                { canonicalName: 'Face Pull',                category: 'pull', primaryMuscle: 'back',      isCompound: false },

  // ── PULL – Biceps ───────────────────────────────────────────────────────────
  'barbell curl':             { canonicalName: 'Barbell Curl',             category: 'pull', primaryMuscle: 'biceps',    isCompound: false },
  'ez bar curl':              { canonicalName: 'EZ Bar Curl',              category: 'pull', primaryMuscle: 'biceps',    isCompound: false },
  'db curl':                  { canonicalName: 'Dumbbell Curl',            category: 'pull', primaryMuscle: 'biceps',    isCompound: false },
  'dumbbell curl':            { canonicalName: 'Dumbbell Curl',            category: 'pull', primaryMuscle: 'biceps',    isCompound: false },
  'hammer curl':              { canonicalName: 'Hammer Curl',              category: 'pull', primaryMuscle: 'biceps',    isCompound: false },
  'db hammer curl':           { canonicalName: 'Hammer Curl',              category: 'pull', primaryMuscle: 'biceps',    isCompound: false },
  'preacher curl':            { canonicalName: 'Preacher Curl',            category: 'pull', primaryMuscle: 'biceps',    isCompound: false },
  'cable curl':               { canonicalName: 'Cable Curl',               category: 'pull', primaryMuscle: 'biceps',    isCompound: false },
  'incline curl':             { canonicalName: 'Incline Dumbbell Curl',    category: 'pull', primaryMuscle: 'biceps',    isCompound: false },
  'concentration curl':       { canonicalName: 'Concentration Curl',       category: 'pull', primaryMuscle: 'biceps',    isCompound: false },

  // ── HINGE ───────────────────────────────────────────────────────────────────
  'deadlift':                 { canonicalName: 'Deadlift',                 category: 'hinge', primaryMuscle: 'hamstrings', isCompound: true },
  'conventional deadlift':    { canonicalName: 'Deadlift',                 category: 'hinge', primaryMuscle: 'hamstrings', isCompound: true },
  'sumo deadlift':            { canonicalName: 'Sumo Deadlift',            category: 'hinge', primaryMuscle: 'hamstrings', isCompound: true },
  'romanian deadlift':        { canonicalName: 'Romanian Deadlift',        category: 'hinge', primaryMuscle: 'hamstrings', isCompound: true },
  'rdl':                      { canonicalName: 'Romanian Deadlift',        category: 'hinge', primaryMuscle: 'hamstrings', isCompound: true },
  'stiff leg deadlift':       { canonicalName: 'Stiff Leg Deadlift',       category: 'hinge', primaryMuscle: 'hamstrings', isCompound: true },
  'trap bar deadlift':        { canonicalName: 'Trap Bar Deadlift',        category: 'hinge', primaryMuscle: 'hamstrings', isCompound: true },
  'hex bar deadlift':         { canonicalName: 'Trap Bar Deadlift',        category: 'hinge', primaryMuscle: 'hamstrings', isCompound: true },
  'good morning':             { canonicalName: 'Good Morning',             category: 'hinge', primaryMuscle: 'hamstrings', isCompound: true },
  'hip thrust':               { canonicalName: 'Hip Thrust',               category: 'hinge', primaryMuscle: 'glutes',    isCompound: true  },
  'barbell hip thrust':       { canonicalName: 'Hip Thrust',               category: 'hinge', primaryMuscle: 'glutes',    isCompound: true  },
  'glute ham raise':          { canonicalName: 'Glute Ham Raise',          category: 'hinge', primaryMuscle: 'hamstrings', isCompound: true },
  'nordic curl':              { canonicalName: 'Nordic Curl',              category: 'hinge', primaryMuscle: 'hamstrings', isCompound: true  },
  'kettlebell swing':         { canonicalName: 'Kettlebell Swing',         category: 'hinge', primaryMuscle: 'glutes',    isCompound: true  },

  // ── LEGS ────────────────────────────────────────────────────────────────────
  'squat':                    { canonicalName: 'Squat',                    category: 'legs', primaryMuscle: 'quads',     isCompound: true  },
  'back squat':               { canonicalName: 'Squat',                    category: 'legs', primaryMuscle: 'quads',     isCompound: true  },
  'barbell squat':            { canonicalName: 'Squat',                    category: 'legs', primaryMuscle: 'quads',     isCompound: true  },
  'high bar squat':           { canonicalName: 'Squat',                    category: 'legs', primaryMuscle: 'quads',     isCompound: true  },
  'low bar squat':            { canonicalName: 'Squat',                    category: 'legs', primaryMuscle: 'quads',     isCompound: true  },
  'front squat':              { canonicalName: 'Front Squat',              category: 'legs', primaryMuscle: 'quads',     isCompound: true  },
  'goblet squat':             { canonicalName: 'Goblet Squat',             category: 'legs', primaryMuscle: 'quads',     isCompound: true  },
  'leg press':                { canonicalName: 'Leg Press',                category: 'legs', primaryMuscle: 'quads',     isCompound: true  },
  'hack squat':               { canonicalName: 'Hack Squat',               category: 'legs', primaryMuscle: 'quads',     isCompound: true  },
  'lunge':                    { canonicalName: 'Lunge',                    category: 'legs', primaryMuscle: 'quads',     isCompound: true  },
  'walking lunge':            { canonicalName: 'Lunge',                    category: 'legs', primaryMuscle: 'quads',     isCompound: true  },
  'bulgarian split squat':    { canonicalName: 'Bulgarian Split Squat',    category: 'legs', primaryMuscle: 'quads',     isCompound: true  },
  'split squat':              { canonicalName: 'Bulgarian Split Squat',    category: 'legs', primaryMuscle: 'quads',     isCompound: true  },
  'leg extension':            { canonicalName: 'Leg Extension',            category: 'legs', primaryMuscle: 'quads',     isCompound: false },
  'leg curl':                 { canonicalName: 'Leg Curl',                 category: 'legs', primaryMuscle: 'hamstrings', isCompound: false },
  'lying leg curl':           { canonicalName: 'Leg Curl',                 category: 'legs', primaryMuscle: 'hamstrings', isCompound: false },
  'seated leg curl':          { canonicalName: 'Leg Curl',                 category: 'legs', primaryMuscle: 'hamstrings', isCompound: false },
  'calf raise':               { canonicalName: 'Calf Raise',               category: 'legs', primaryMuscle: 'calves',    isCompound: false },
  'standing calf raise':      { canonicalName: 'Calf Raise',               category: 'legs', primaryMuscle: 'calves',    isCompound: false },
  'seated calf raise':        { canonicalName: 'Calf Raise',               category: 'legs', primaryMuscle: 'calves',    isCompound: false },
  'step up':                  { canonicalName: 'Step Up',                  category: 'legs', primaryMuscle: 'quads',     isCompound: true  },

  // ── CORE ────────────────────────────────────────────────────────────────────
  'plank':                    { canonicalName: 'Plank',                    category: 'core', primaryMuscle: 'abs',       isCompound: false },
  'crunch':                   { canonicalName: 'Crunch',                   category: 'core', primaryMuscle: 'abs',       isCompound: false },
  'sit up':                   { canonicalName: 'Sit-Up',                   category: 'core', primaryMuscle: 'abs',       isCompound: false },
  'sit-up':                   { canonicalName: 'Sit-Up',                   category: 'core', primaryMuscle: 'abs',       isCompound: false },
  'ab wheel rollout':         { canonicalName: 'Ab Wheel Rollout',         category: 'core', primaryMuscle: 'abs',       isCompound: false },
  'ab rollout':               { canonicalName: 'Ab Wheel Rollout',         category: 'core', primaryMuscle: 'abs',       isCompound: false },
  'hanging leg raise':        { canonicalName: 'Hanging Leg Raise',        category: 'core', primaryMuscle: 'abs',       isCompound: false },
  'hanging knee raise':       { canonicalName: 'Hanging Knee Raise',       category: 'core', primaryMuscle: 'abs',       isCompound: false },
  'cable crunch':             { canonicalName: 'Cable Crunch',             category: 'core', primaryMuscle: 'abs',       isCompound: false },
  'russian twist':            { canonicalName: 'Russian Twist',            category: 'core', primaryMuscle: 'abs',       isCompound: false },
  'leg raise':                { canonicalName: 'Leg Raise',                category: 'core', primaryMuscle: 'abs',       isCompound: false },
  'landmine twist':           { canonicalName: 'Landmine Twist',           category: 'core', primaryMuscle: 'abs',       isCompound: false },
  'pallof press':             { canonicalName: 'Pallof Press',             category: 'core', primaryMuscle: 'abs',       isCompound: false },
};

// ─── Qualifier Stripping ──────────────────────────────────────────────────────
// Removes common parenthetical notes and prefixes before lookup.

const STRIP_PATTERNS = [
  /\(.*?\)/g,           // anything in parentheses: "(conventional)", "(assisted as needed)"
  /\bbarbell\b/gi,
  /\bdumbbell\b/gi,
  /\b\bdb\b/gi,
  /\bkb\b/gi,
  /\bcable\b/gi,
  /\bmachine\b/gi,
  /\bseated\b/gi,
  /\bstanding\b/gi,
  /\blying\b/gi,
  /\bincline\b/gi,
  /\bdecline\b/gi,
  /\bflat\b/gi,
  /\bweighted\b/gi,
  /\bassisted\b/gi,
  /\bclose grip\b/gi,
  /\bwide grip\b/gi,
  /\bneutral grip\b/gi,
  /\boverhand\b/gi,
  /\bunderhand\b/gi,
];

function stripQualifiers(name: string): string {
  let s = name.toLowerCase();
  for (const pat of STRIP_PATTERNS) s = s.replace(pat, ' ');
  return s.replace(/\s+/g, ' ').trim();
}

// ─── Levenshtein Distance ─────────────────────────────────────────────────────

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
  return dp[m][n];
}

function fuzzyMatch(stripped: string): (Omit<NormalizedExercise, 'rawName'>) | null {
  let best: string | null = null;
  let bestDist = Infinity;
  for (const key of Object.keys(SEED)) {
    const dist = levenshtein(stripped, key);
    // Allow up to 30% of key length as edit distance
    if (dist < bestDist && dist <= Math.max(2, Math.floor(key.length * 0.3))) {
      bestDist = dist;
      best = key;
    }
  }
  return best ? SEED[best] : null;
}

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

  const response = await openai.chat.completions.create({
    model: 'gpt-4.1-mini',
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
