import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { requireAuth } from '../middleware/requireAuth.js';
import { cacheGet, cacheSet, cacheDelete } from '../services/cacheService.js';

const NUTRITION_PROFILE_TTL = 30 * 24 * 60 * 60 * 1000; // 30 days — invalidated on meal entry
const nutritionProfileCacheKey = (userId: string) => `nutrition_profile:${userId}`;
import { parseMealMacros, analyzeMealPhoto } from '../services/llmService.js';
import { logActivity } from '../services/activityService.js';
import { runNutritionEngine } from '../engine/nutritionEngine.js';
import type { NutritionEngineUser, DailyMacro, MealTiming, WellnessPoint } from '../engine/nutritionEngine.js';
import { runNutritionRules } from '../engine/nutritionRulesEngine.js';
import { buildRAGContext } from '../services/ragService.js';
import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const LLM_MODEL = 'gpt-5.4-mini-2026-03-17';

const router = Router();
const prisma = new PrismaClient();

const logSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  proteinG: z.number().min(0).max(1000),
  carbsG: z.number().min(0).max(2000),
  fatG: z.number().min(0).max(1000),
  calories: z.number().min(0).max(20000).optional(),
  notes: z.string().max(500).optional(),
});

// POST /api/nutrition/log - Save or update daily macro entry
router.post('/nutrition/log', requireAuth, async (req, res) => {
  try {
    const data = logSchema.parse(req.body);
    const userId = req.user!.id;

    // Upsert by userId + date
    const existing = await prisma.nutritionLog.findFirst({
      where: { userId, date: data.date },
    });

    if (existing) {
      const updated = await prisma.nutritionLog.update({
        where: { id: existing.id },
        data,
      });
      cacheDelete(`userctx:${userId}`);
      cacheDelete(nutritionProfileCacheKey(userId));
      logActivity(userId, 'nutrition').catch(() => {});
      return res.json(updated);
    }

    const created = await prisma.nutritionLog.create({
      data: { userId, ...data },
    });
    cacheDelete(`userctx:${userId}`);
    logActivity(userId, 'nutrition').catch(() => {});
    res.status(201).json(created);
  } catch (err: any) {
    console.error('Nutrition log error:', err);
    res.status(400).json({ error: err.message || 'Failed to save log' });
  }
});

// GET /api/nutrition/log - Fetch last 30 days
router.get('/nutrition/log', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.id;
    const logs = await prisma.nutritionLog.findMany({
      where: { userId },
      orderBy: { date: 'desc' },
      take: 30,
    });
    res.json({ logs });
  } catch (err) {
    console.error('Nutrition fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch logs' });
  }
});

// ── Meal Entries (individual logged meals) ─────────────────────────────────────

const mealEntrySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  name: z.string().min(1).max(200),
  mealType: z.enum(['breakfast', 'lunch', 'dinner', 'snack', 'meal']).default('meal'),
  calories: z.number().min(0).max(5000).optional().default(0),
  proteinG: z.number().min(0).max(500).optional().default(0),
  carbsG: z.number().min(0).max(1000).optional().default(0),
  fatG: z.number().min(0).max(500).optional().default(0),
  notes: z.string().max(500).optional(),
});

// POST /api/nutrition/meals - Log a meal entry
router.post('/nutrition/meals', requireAuth, async (req, res) => {
  try {
    const data = mealEntrySchema.parse(req.body);
    const userId = req.user!.id;
    const entry = await prisma.mealEntry.create({ data: { userId, ...data } });
    cacheDelete(nutritionProfileCacheKey(userId));
    logActivity(userId, 'nutrition').catch(() => {});
    res.status(201).json(entry);
  } catch (err: any) {
    console.error('Meal entry error:', err);
    res.status(400).json({ error: err.message || 'Failed to save meal' });
  }
});

// GET /api/nutrition/meals?date=YYYY-MM-DD - Get meals for a specific date
router.get('/nutrition/meals', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.id;
    const date = (req.query.date as string) || new Date().toISOString().split('T')[0];
    const entries = await prisma.mealEntry.findMany({
      where: { userId, date },
      orderBy: { createdAt: 'asc' },
    });
    res.json({ entries });
  } catch (err) {
    console.error('Meal entries fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch meal entries' });
  }
});

// PUT /api/nutrition/targets - Set user's daily calorie/macro targets
router.put('/nutrition/targets', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.id;
    const { dailyCalorieTarget } = req.body as { dailyCalorieTarget?: number | null };
    await prisma.user.update({
      where: { id: userId },
      data: { dailyCalorieTarget: dailyCalorieTarget ?? null },
    });
    // Bust the nutrition profile cache so next fetch uses the new target
    cacheDelete(nutritionProfileCacheKey(userId));
    res.json({ success: true });
  } catch (err: any) {
    console.error('Set nutrition targets error:', err);
    res.status(500).json({ error: 'Failed to update targets' });
  }
});

// DELETE /api/nutrition/meals/:id - Delete a meal entry
router.delete('/nutrition/meals/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const entry = await prisma.mealEntry.findFirst({
      where: { id, userId: req.user!.id },
    });
    if (!entry) return res.status(404).json({ error: 'Entry not found' });
    await prisma.mealEntry.delete({ where: { id } });
    res.json({ success: true });
  } catch (err: any) {
    console.error('Meal delete error:', err);
    res.status(500).json({ error: 'Failed to delete meal' });
  }
});

// POST /api/nutrition/parse-meal - Parse free-text meal description into macros
router.post('/nutrition/parse-meal', requireAuth, async (req, res) => {
  try {
    const { description } = req.body;
    if (!description || typeof description !== 'string' || description.trim().length < 3) {
      return res.status(400).json({ error: 'Please provide a meal description' });
    }
    const result = await parseMealMacros(description.trim());
    res.json(result);
  } catch (err: any) {
    console.error('Parse meal error:', err);
    res.status(500).json({ error: 'Failed to analyze meal' });
  }
});

// GET /api/nutrition/history?days=30 - Aggregated daily totals + individual meals
router.get('/nutrition/history', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.id;
    const days = Math.min(parseInt(req.query.days as string || '30', 10), 90);
    const since = new Date();
    since.setDate(since.getDate() - days);
    const sinceStr = since.toISOString().split('T')[0];

    const [entries, dailyLogs] = await Promise.all([
      prisma.mealEntry.findMany({
        where: { userId, date: { gte: sinceStr } },
        orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
      }),
      prisma.nutritionLog.findMany({
        where: { userId, date: { gte: sinceStr } },
        orderBy: { date: 'asc' },
      }),
    ]);

    // Group meal entries by date and aggregate
    const byDate: Record<string, { calories: number; proteinG: number; carbsG: number; fatG: number; meals: any[] }> = {};
    for (const e of entries) {
      if (!byDate[e.date]) byDate[e.date] = { calories: 0, proteinG: 0, carbsG: 0, fatG: 0, meals: [] };
      byDate[e.date].calories += e.calories;
      byDate[e.date].proteinG += e.proteinG;
      byDate[e.date].carbsG += e.carbsG;
      byDate[e.date].fatG += e.fatG;
      byDate[e.date].meals.push(e);
    }

    // Merge with manual daily logs
    for (const log of dailyLogs) {
      if (!byDate[log.date]) {
        byDate[log.date] = { calories: log.calories || 0, proteinG: log.proteinG, carbsG: log.carbsG, fatG: log.fatG, meals: [] };
      }
    }

    const history = Object.entries(byDate)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, data]) => ({ date, ...data }));

    res.json({ history });
  } catch (err) {
    console.error('Nutrition history error:', err);
    res.status(500).json({ error: 'Failed to fetch nutrition history' });
  }
});

// POST /api/nutrition/analyze-photo — Gemini vision meal photo analysis
const photoSchema = z.object({
  imageBase64: z.string().min(1),
  mimeType: z.string().regex(/^image\/(jpeg|png|webp|heic)$/),
});

const FREE_DAILY_PHOTO_LIMIT = 10;

router.post('/nutrition/analyze-photo', requireAuth, async (req, res) => {
  try {
    const { imageBase64, mimeType } = photoSchema.parse(req.body);
    const userId = req.user!.id;

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Rate limit free users
    if (user.tier === 'free') {
      const today = new Date().toISOString().slice(0, 10);
      const isNewDay = user.dailyPhotoScanDate !== today;
      const count = isNewDay ? 0 : user.dailyPhotoScanCount;

      if (count >= FREE_DAILY_PHOTO_LIMIT) {
        return res.status(429).json({
          error: `Free users can scan up to ${FREE_DAILY_PHOTO_LIMIT} photos per day. Upgrade to Axiom Pro for unlimited scans.`
        });
      }

      await prisma.user.update({
        where: { id: userId },
        data: {
          dailyPhotoScanCount: count + 1,
          dailyPhotoScanDate: today,
        },
      });
    }

    const result = await analyzeMealPhoto(imageBase64, mimeType);
    res.json(result);
  } catch (err: any) {
    if (err?.name === 'ZodError') return res.status(400).json({ error: 'Invalid request' });
    console.error('Meal photo analysis error:', err);
    res.status(500).json({ error: 'Failed to analyze photo' });
  }
});

// GET /api/nutrition/profile
// ─────────────────────────────────────────────────────────────────────────────
// Orchestrator: 4-layer pipeline before any LLM token is generated
//   1. Load user state (Prisma: demographics, sessions, meals, wellness, workouts)
//   2. Run deterministic NutritionEngine (TDEE, macros, trends, timing, correlations)
//   3. Run NutritionRulesEngine (expert flags grounded in sports science citations)
//   4. RAG retrieval (evidence chunks matched to this user's goal + lift)
//   5. GPT-5.4-mini-2026-03-17 receives ONLY the pre-computed context and reasons/explains
router.get('/nutrition/profile', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.id;
    const forceRefresh = req.query.refresh === '1';

    // ── Cache check: return immediately if fresh data exists ───────────────
    if (!forceRefresh) {
      const cached = cacheGet<object>(nutritionProfileCacheKey(userId));
      if (cached) return res.json(cached);
    }

    const since90 = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    // ── STEP 1: Load user state in parallel ────────────────────────────────
    const [user, entries, wellnessLogs, workoutLogs, recentSessions] = await Promise.all([
      prisma.user.findUnique({
        where: { id: userId },
        select: {
          weightKg: true, heightCm: true, dateOfBirth: true,
          trainingAge: true, bodyCompTag: true, coachGoal: true,
          dailyCalorieTarget: true,
        },
      }),
      prisma.mealEntry.findMany({
        where: { userId, date: { gte: since90 } },
        orderBy: { createdAt: 'asc' },
        select: {
          date: true, name: true, mealType: true,
          calories: true, proteinG: true, carbsG: true, fatG: true,
          createdAt: true,
        },
      }),
      prisma.wellnessCheckin.findMany({
        where: { userId, date: { gte: since90 } },
        select: { date: true, mood: true, energy: true, sleepHours: true, stress: true },
        orderBy: { date: 'asc' },
      }),
      prisma.workoutLog.findMany({
        where: { userId, date: { gte: since90 } },
        select: { date: true, exercises: true, duration: true, title: true },
        orderBy: { date: 'asc' },
      }),
      prisma.session.findMany({
        where: { userId },
        select: {
          selectedLift: true, goal: true,
          plans: { select: { planJson: true }, orderBy: { createdAt: 'desc' }, take: 1 },
        },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
    ]);

    if (entries.length === 0) {
      return res.json({
        hasData: false,
        message: 'Log at least a few meals to generate your Nutrition Profile.',
      });
    }

    // ── Derive age from dateOfBirth ──────────────────────────────────────
    let ageYears: number | null = null;
    if (user?.dateOfBirth) {
      const today = new Date();
      const dob = new Date(user.dateOfBirth);
      ageYears = today.getFullYear() - dob.getFullYear();
      if (today.getMonth() < dob.getMonth() ||
          (today.getMonth() === dob.getMonth() && today.getDate() < dob.getDate())) {
        ageYears--;
      }
    }

    // ── Extract workout training days set ────────────────────────────────
    const workoutDates = new Set(workoutLogs.map(w => w.date));
    const trainingDaysPerWeek = workoutLogs.length > 0
      ? Math.round((workoutLogs.length / 90) * 7 * 10) / 10
      : 0;

    // ── Extract lift context from sessions + workout logs ────────────────
    const sessionLifts = [...new Set(recentSessions.map(s =>
      s.selectedLift.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())
    ))];
    const workoutLiftNames = new Set<string>();
    for (const w of workoutLogs) {
      try {
        const exs: Array<{ name: string }> = JSON.parse(w.exercises);
        exs.forEach(e => e.name && workoutLiftNames.add(e.name));
      } catch { /* skip malformed */ }
    }
    const allLifts = [...new Set([...workoutLiftNames, ...sessionLifts])].slice(0, 8);

    // Goal priority: coachGoal is the holistic fitness plan (what the user actually wants to achieve).
    // Session goal is lift-specific (diagnostic context only) — used as secondary context, not the primary driver.
    const primaryGoal = user?.coachGoal ?? recentSessions.find(s => s.goal)?.goal ?? null;
    const sessionGoalContext = recentSessions.find(s => s.goal)?.goal ?? null;
    const primaryLift = sessionLifts[0] ?? null;

    // User-declared calorie target takes precedence over TDEE-computed recommendation
    const userCalorieTarget = user?.dailyCalorieTarget ?? null;

    // ── Build engine inputs ──────────────────────────────────────────────
    const engineUser: NutritionEngineUser = {
      weightKg: user?.weightKg ?? null,
      heightCm: user?.heightCm ?? null,
      ageYears,
      sex: 'unknown', // schema doesn't store sex yet — engine handles gracefully
      trainingAge: user?.trainingAge ?? null,
      bodyCompTag: user?.bodyCompTag ?? null,
      goal: primaryGoal,
      primaryLift,
      trainingDaysPerWeek,
    };

    // Build daily macro array (aggregate meals by date)
    const byDate: Record<string, {
      calories: number; proteinG: number; carbsG: number; fatG: number;
      isTrainingDay: boolean;
    }> = {};
    for (const e of entries) {
      if (!byDate[e.date]) {
        byDate[e.date] = {
          calories: 0, proteinG: 0, carbsG: 0, fatG: 0,
          isTrainingDay: workoutDates.has(e.date),
        };
      }
      byDate[e.date].calories  += e.calories;
      byDate[e.date].proteinG  += e.proteinG;
      byDate[e.date].carbsG    += e.carbsG;
      byDate[e.date].fatG      += e.fatG;
    }
    const dailyMacros: DailyMacro[] = Object.entries(byDate)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, d]) => ({ date, ...d }));

    const mealTimings: MealTiming[] = entries.map(e => ({
      hour: e.createdAt.getHours(),
      proteinG: e.proteinG,
      calories: e.calories,
    }));

    const wellnessPoints: WellnessPoint[] = wellnessLogs.map(w => ({
      date: w.date,
      energy: w.energy,
      sleepHours: w.sleepHours,
      stress: w.stress,
      mood: w.mood,
    }));

    // ── STEP 2: Run Deterministic Nutrition Engine ───────────────────────
    const engineOutput = runNutritionEngine({
      user: engineUser,
      dailyMacros,
      mealTimings,
      wellnessPoints,
    });

    // ── STEP 3: Run Rules Engine ─────────────────────────────────────────
    const avgEnergy = wellnessLogs.length > 0
      ? wellnessLogs.reduce((s, w) => s + w.energy, 0) / wellnessLogs.length
      : null;
    const avgSleep = wellnessLogs.length > 0
      ? wellnessLogs.reduce((s, w) => s + w.sleepHours, 0) / wellnessLogs.length
      : null;

    const rulesOutput = runNutritionRules(
      engineOutput,
      primaryGoal,
      avgEnergy,
      avgSleep,
    );

    // ── STEP 4: RAG Retrieval ────────────────────────────────────────────
    const ragQuery = [
      primaryGoal ? `nutrition for ${primaryGoal}` : '',
      primaryLift ? `${primaryLift} performance nutrition` : '',
      'protein requirements strength athletes leucine threshold',
      rulesOutput.topPriority ? rulesOutput.topPriority.title : '',
    ].filter(Boolean).join(' ');

    const ragContext = await buildRAGContext(ragQuery, 6);

    // ── STEP 5: Assemble LLM context ────────────────────────────────────
    // The LLM receives ONLY pre-verified, deterministically-computed data.
    // It must NEVER re-derive calculations — only explain and reason.

    const flagsSummary = rulesOutput.flags.map(f =>
      `[${f.severity.toUpperCase()}] ${f.title}: ${f.detail}`
    ).join('\n');

    const recentFoods = [...new Set(entries.slice(-60).map(e => e.name).filter(Boolean))]
      .slice(0, 30).join(', ');

    const diagnosticContext = recentSessions
      .filter(s => s.goal)
      .slice(0, 3)
      .map(s => `${s.selectedLift.replace(/_/g, ' ')} — goal: ${s.goal}`)
      .join('; ');

    const prompt = `You are an elite sports dietitian functioning as a reasoning and communication layer over a deterministic nutrition analysis system. You have been given pre-computed, verified data from our nutrition engine and rules engine. DO NOT re-derive or recalculate any numbers — only reason over and explain the provided data.

${ragContext ? `${ragContext}\n\n` : ''}═══ DETERMINISTIC ENGINE OUTPUT ═══
TDEE estimate: ${engineOutput.tdee ? `${engineOutput.tdee} kcal/day` : 'unavailable (no height/weight/age)'}
BMR: ${engineOutput.bmr ? `${engineOutput.bmr} kcal/day` : 'unavailable'}
Activity multiplier: ${engineOutput.activityMultiplier}x

Current avg intake (last 30 days):
- Calories: ${engineOutput.avgCalories} kcal | Protein: ${engineOutput.avgProteinG}g | Carbs: ${engineOutput.avgCarbsG}g | Fat: ${engineOutput.avgFatG}g
- Protein/kg: ${engineOutput.proteinPerKg ?? 'N/A'}g/kg
- Macro split: ${engineOutput.macroSplit.proteinPct}% P / ${engineOutput.macroSplit.carbsPct}% C / ${engineOutput.macroSplit.fatPct}% F
- Consistency: ${engineOutput.consistencyPct}% (${engineOutput.loggedDays} days logged)

Calorie trend: ${engineOutput.trend.direction} (${engineOutput.trend.deltaKcalPerWeek > 0 ? '+' : ''}${engineOutput.trend.deltaKcalPerWeek} kcal/week slope)
14-day plateau: ${engineOutput.trend.plateau14Day ? 'YES' : 'No'}

Training vs rest days:
- Training day avg: ${engineOutput.trainingDayAvgCalories ?? 'N/A'} kcal | P: ${engineOutput.trainingDayAvgProteinG ?? 'N/A'}g | C: ${engineOutput.trainingDayAvgCarbsG ?? 'N/A'}g
- Rest day avg: ${engineOutput.restDayAvgCalories ?? 'N/A'} kcal | C: ${engineOutput.restDayAvgCarbsG ?? 'N/A'}g
- Carb periodization delta: ${engineOutput.carbPeriodizationDelta !== null ? `${engineOutput.carbPeriodizationDelta}g` : 'N/A'} (positive = more carbs on training days)

Recommended targets:
- TDEE-computed daily: ${engineOutput.targets.calories} kcal | P: ${engineOutput.targets.proteinG}g | C: ${engineOutput.targets.carbsG}g | F: ${engineOutput.targets.fatG}g
${userCalorieTarget ? `- ⚠️ USER-DECLARED TARGET (USE THIS): ${userCalorieTarget} kcal/day — override the TDEE target above for all calorie recommendations` : '- (No user-declared target — use TDEE-computed target above)'}
- Training day target: ${engineOutput.periodization.trainingDay.calories} kcal | C: ${engineOutput.periodization.trainingDay.carbsG}g
- Rest day target: ${engineOutput.periodization.restDay.calories} kcal | C: ${engineOutput.periodization.restDay.carbsG}g
- Protein gap: ${engineOutput.proteinGap}g/day | Calorie gap: ${engineOutput.calorieGap} kcal/day

Meal timing analysis:
- Meals/day: ${engineOutput.timing.mealsPerDay}
- Morning meal frequency: ${engineOutput.timing.morningMealPct}% of days
- Avg morning protein: ${engineOutput.timing.avgMorningProteinG}g
- Evening calorie %: ${engineOutput.timing.eveningCaloriePct}% of daily intake after 6pm
- Leucine threshold met: ${engineOutput.timing.leucineAdequacyPct}% of meals (≥25g protein)
- Pre-workout fueled: ${engineOutput.timing.preWorkoutFueled ? 'Yes' : 'No'} | Post-workout fueled: ${engineOutput.timing.postWorkoutFueled ? 'Yes' : 'No'}

Wellness correlations:
- High protein days → next-day energy: ${engineOutput.wellness.highProteinEnergyAvg ?? 'N/A'}/10
- Low protein days → next-day energy: ${engineOutput.wellness.lowProteinEnergyAvg ?? 'N/A'}/10
- Energy delta: ${engineOutput.wellness.energyDelta !== null ? `${engineOutput.wellness.energyDelta} points` : 'N/A'}
- High protein → sleep: ${engineOutput.wellness.highProteinSleepAvg ?? 'N/A'}h | Low protein → sleep: ${engineOutput.wellness.lowProteinSleepAvg ?? 'N/A'}h

═══ RULES ENGINE FLAGS ═══
Critical flags: ${rulesOutput.criticalCount} | Warnings: ${rulesOutput.warningCount} | Positives: ${rulesOutput.positiveCount}
${flagsSummary || 'No flags triggered.'}

═══ USER PROFILE & GOALS ═══
Primary goal (from coach program — this is the user's ACTUAL overall fitness objective):
"${primaryGoal ?? 'not specified'}"

Lift diagnostic context (NOT the user's overall goal — do not use to drive calorie recommendations):
${sessionGoalContext ? `"${sessionGoalContext}" for ${primaryLift ?? 'a lift'}` : 'none'}

Primary lift: ${primaryLift ?? 'not specified'}
All tracked lifts: ${allLifts.length > 0 ? allLifts.join(', ') : 'none'}
Training: ${trainingDaysPerWeek} days/week
Weight: ${user?.weightKg ? `${user.weightKg} kg` : 'unknown'} | Height: ${user?.heightCm ? `${user.heightCm} cm` : 'unknown'}
Training age: ${user?.trainingAge ?? 'unknown'}
Recent foods: ${recentFoods || 'not logged'}
Avg wellness: energy ${avgEnergy?.toFixed(1) ?? 'N/A'}/10 | sleep ${avgSleep?.toFixed(1) ?? 'N/A'}h
${userCalorieTarget ? `\nUser-declared daily calorie target: ${userCalorieTarget} kcal — treat this as the hard target. All recommendations must align with it.` : ''}

⚠️ GOAL ALIGNMENT REQUIREMENT:
All calorie and macro recommendations MUST be derived from the user's primary goal above, not from TDEE alone.
- If their goal implies a caloric deficit (fat loss, cutting, weight loss) → recommend below TDEE
- If their goal implies a caloric surplus (muscle gain, bulking, mass building) → recommend above TDEE
- If their goal is strength/performance with no body comp change → recommend at or near TDEE with high protein
- If their goal is body recomposition → recommend near TDEE with high protein and carb periodization
- If a user-declared calorie target is provided above, it overrides the TDEE-computed target completely
Read the primary goal text carefully and let it drive all caloric reasoning. Do not default to TDEE maintenance if the goal clearly implies a different energy balance.

═══ INSTRUCTIONS ═══
Using ONLY the above verified data, produce a JSON object with EXACTLY this structure.
Every number you reference must come from the ENGINE OUTPUT above — never invent new calculations.
Cite specific values from the engine and flags in your analysis. Reference the scientific mechanisms from the RAG context where relevant.
Ensure every recommendation is consistent with the user's primary goal stated above.

{
  "overallScore": <0-100 based on engine gaps, rules flags severity, and consistency>,
  "overallGrade": <"A+"|"A"|"A-"|"B+"|"B"|"B-"|"C+"|"C"|"C-"|"D"|"F">,
  "summary": <3-4 sentences citing their exact numbers from the engine output>,

  "dimensionScores": {
    "dailyLife": <0-100>,
    "gymPerformance": <0-100>,
    "mentalClarity": <0-100>,
    "recovery": <0-100>,
    "nutritionTiming": <0-100>,
    "bodyComposition": <0-100>
  },

  "dailyLifeImpact": {
    "score": <0-100>, "grade": <letter>,
    "summary": <2-3 sentences referencing their specific timing and energy data>,
    "morningEnergy": <"very_low"|"low"|"moderate"|"high"|"very_high">,
    "afternoonEnergy": <"very_low"|"low"|"moderate"|"high"|"very_high">,
    "eveningEnergy": <"very_low"|"low"|"moderate"|"high"|"very_high">,
    "morningEnergyDetail": <cite their morning protein and meal frequency numbers>,
    "afternoonEnergyDetail": <cite their meal timing and macro balance>,
    "eveningEnergyDetail": <cite their evening calorie % and implications>,
    "moodStabilityRating": <1-10>,
    "moodStabilityDetail": <reference specific neurotransmitter precursors and their protein intake>,
    "keyFactors": [<3-4 factors citing exact numbers from engine>],
    "recommendations": [<3 specific, actionable recommendations with exact numbers>]
  },

  "gymPerformance": {
    "score": <0-100>, "grade": <letter>,
    "summary": <2-3 sentences referencing protein/kg, carb timing, and rules flags>,
    "strengthCapacity": <"severely_limited"|"limited"|"adequate"|"good"|"optimal">,
    "strengthCapacityDetail": <cite protein/kg vs target, leucine adequacy %>,
    "enduranceCapacity": <"severely_limited"|"limited"|"adequate"|"good"|"optimal">,
    "enduranceCapacityDetail": <cite carb intake and periodization delta>,
    "recoveryBetweenSets": <"poor"|"below_average"|"average"|"good"|"excellent">,
    "recoveryBetweenSetsDetail": <cite total calories vs TDEE and carb adequacy>,
    "keyLimiter": <the single biggest nutrition limiter for this user based on rules flags>,
    "preWorkoutReadiness": <"poor"|"below_average"|"average"|"good"|"excellent">,
    "postWorkoutRecovery": <"poor"|"below_average"|"average"|"good"|"excellent">,
    "recommendations": [<3-4 recommendations with specific gram targets from engine>]
  },

  "liftImpact": [
    ${allLifts.length > 0
      ? allLifts.slice(0, 6).map(lift => `{
      "lift": "${lift}",
      "impactLevel": <"optimal"|"good"|"moderate"|"limited"|"poor">,
      "currentImpact": <how their SPECIFIC engine numbers impact THIS lift — cite protein/kg, carb timing, calorie gap>,
      "scienceBacking": <one sentence citing the physiological mechanism from RAG context>,
      "recommendation": <one specific actionable recommendation with a gram target from engine>
    }`).join(',\n      ')
      : `{ "lift": "General Strength Training", "impactLevel": "moderate", "currentImpact": "Based on engine data.", "scienceBacking": "Relevant mechanism.", "recommendation": "Actionable recommendation." }`
    }
  ],

  "mentalClarity": {
    "score": <0-100>, "grade": <letter>,
    "summary": <2-3 sentences on cognitive performance based on macro data>,
    "focusRating": <1-10>,
    "glucoseStabilityRating": <1-10 based on meal frequency and carb quality signals>,
    "glucoseStabilityDetail": <cite meals/day and evening calorie % for glucose stability>,
    "brainFuelAdequacy": <"insufficient"|"marginal"|"adequate"|"optimal">,
    "brainFuelDetail": <cite fat intake and its adequacy vs target>,
    "neurotransmitterSupport": <"poor"|"moderate"|"good"|"excellent">,
    "neurotransmitterDetail": <cite protein intake and its role in neurotransmitter synthesis>,
    "keyFactors": [<3 factors citing exact engine numbers>],
    "recommendations": [<3 specific recommendations>]
  },

  "energyPattern": {
    "pattern": <"front_loaded"|"back_loaded"|"balanced"|"irregular">,
    "summary": <2-3 sentences based on morning meal % and evening calorie %>,
    "morningWindow": { "level": <"very_low"|"low"|"moderate"|"high">, "detail": <cite morning protein and cals> },
    "midDayWindow": { "level": <level>, "detail": <cite meal timing data> },
    "afternoonWindow": { "level": <level>, "detail": <explain afternoon based on their data> },
    "eveningWindow": { "level": <level>, "detail": <cite evening calorie % and its implications> },
    "crashRisk": <"low"|"moderate"|"high"|"very_high">,
    "crashRiskDetail": <explain crash risk based on their meal spacing and back-loading>,
    "optimalMealTiming": <a specific timing recommendation based on their training days/week>,
    "recommendations": [<3 timing recommendations with specific meal windows and gram targets>]
  },

  "recoveryAndSleep": {
    "score": <0-100>, "grade": <letter>,
    "summary": <2-3 sentences citing protein gap, sleep data, and leucine adequacy>,
    "muscleRepairCapacity": <"poor"|"below_average"|"average"|"good"|"excellent">,
    "muscleRepairDetail": <cite leucine adequacy % and protein per meal average vs 25-30g threshold>,
    "sleepQualityImpact": <"negative"|"neutral"|"positive">,
    "sleepQualityDetail": <cite average sleep hours from wellness data and evening eating pattern>,
    "inflammationRisk": <"low"|"moderate"|"high">,
    "inflammationDetail": <cite fat intake and its omega-3 implications>,
    "hormoneSupport": <"poor"|"moderate"|"good"|"excellent">,
    "hormonalDetail": <cite fat intake vs target and testosterone/hormone implications>,
    "recommendations": [<3-4 recovery recommendations with specific numbers>]
  },

  "strengths": [<3-4 specific data-backed strengths citing engine numbers>],
  "improvements": [<3-4 priority improvements citing the exact gaps from engine output>],
  "suggestions": [<5 prioritized actionable suggestions with specific gram/kcal targets from engine>],

  "macroRecommendation": {
    "proteinG": ${engineOutput.targets.proteinG},
    "carbsG": ${engineOutput.targets.carbsG},
    "fatG": ${engineOutput.targets.fatG},
    "calories": ${userCalorieTarget ?? engineOutput.targets.calories},
    "trainingDayProteinG": ${engineOutput.periodization.trainingDay.proteinG},
    "trainingDayCarbsG": ${engineOutput.periodization.trainingDay.carbsG},
    "restDayProteinG": ${engineOutput.periodization.restDay.proteinG},
    "restDayCarbsG": ${engineOutput.periodization.restDay.carbsG},
    "rationale": <2-3 sentences explaining the calorie target — if a user-declared target exists, EXPLAIN that their ${userCalorieTarget ?? engineOutput.targets.calories} kcal target aligns with their stated goal (${primaryGoal ?? 'their fitness goal'}), then cite their current avg intake vs target gap>
  }
}`;

    const completion = await openai.chat.completions.create({
      model: LLM_MODEL,
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      temperature: 0.2,
      max_completion_tokens: 4500,
    });

    let aiAnalysis: any = {};
    try {
      aiAnalysis = JSON.parse(completion.choices[0].message.content || '{}');
    } catch {
      aiAnalysis = { summary: 'Analysis unavailable at this time.', strengths: [], improvements: [], suggestions: [] };
    }

    // ── Return: metrics from engine (deterministic), analysis from LLM (reasoning) ──
    const responsePayload = {
      hasData: true,
      metrics: {
        loggedDays: engineOutput.loggedDays,
        consistencyPct: engineOutput.consistencyPct,
        avgCalories: engineOutput.avgCalories,
        avgProtein: engineOutput.avgProteinG,
        avgCarbs: engineOutput.avgCarbsG,
        avgFat: engineOutput.avgFatG,
        macroSplit: engineOutput.macroSplit,
        proteinPerKg: engineOutput.proteinPerKg,
        calorieTrend: engineOutput.trend.direction,
        avgMealsPerDay: engineOutput.timing.mealsPerDay,
        trainingDaysPerWeek,
        trainingDayCalories: engineOutput.trainingDayAvgCalories,
        restDayCalories: engineOutput.restDayAvgCalories,
        trainingDayProtein: engineOutput.trainingDayAvgProteinG,
        trainingDayCarbs: engineOutput.trainingDayAvgCarbsG,
        morningMealPct: engineOutput.timing.morningMealPct,
        eveningCaloriePct: engineOutput.timing.eveningCaloriePct,
        leucineAdequacyPct: engineOutput.timing.leucineAdequacyPct,
        tdee: engineOutput.tdee,
        bmr: engineOutput.bmr,
        trackedLifts: allLifts,
        highProteinEnergyAvg: engineOutput.wellness.highProteinEnergyAvg,
        lowProteinEnergyAvg: engineOutput.wellness.lowProteinEnergyAvg,
        ruleFlags: rulesOutput.flags.map(f => ({
          id: f.id, severity: f.severity, category: f.category, title: f.title,
        })),
      },
      analysis: aiAnalysis,
    };

    // Cache for 24h — invalidated automatically when a meal is logged
    cacheSet(nutritionProfileCacheKey(userId), responsePayload, NUTRITION_PROFILE_TTL);
    res.json(responsePayload);
  } catch (err: any) {
    console.error('Nutrition profile error:', err);
    res.status(500).json({ error: err?.message ?? 'Failed to generate nutrition profile' });
  }
});

export default router;
