import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { requireAuth } from '../middleware/requireAuth.js';
import { cacheDelete } from '../services/cacheService.js';
import { parseMealMacros, analyzeMealPhoto } from '../services/llmService.js';
import { logActivity } from '../services/activityService.js';

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
// Deep nutrition analysis: aggregates 90 days of meals, workout logs, and
// wellness check-ins to produce a 6-dimension science-backed profile covering
// daily life, gym performance, specific lift impact, mental clarity, energy
// patterns, and recovery.
router.get('/nutrition/profile', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.id;
    const since90 = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const [user, entries, wellnessLogs, workoutLogs, recentSessions] = await Promise.all([
      prisma.user.findUnique({
        where: { id: userId },
        select: {
          weightKg: true, heightCm: true, coachGoal: true,
          trainingAge: true, coachProfile: true,
        },
      }),
      prisma.mealEntry.findMany({
        where: { userId, date: { gte: since90 } },
        orderBy: { createdAt: 'asc' },
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
        select: { selectedLift: true },
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

    const avg = (arr: number[]) => arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0;

    // ── Aggregate meals by day ───────────────────────────────────────────────
    const byDate: Record<string, {
      calories: number; proteinG: number; carbsG: number; fatG: number;
      mealCount: number; morningCals: number; eveningCals: number;
      morningProtein: number; meals: Array<{ type: string; cals: number }>;
    }> = {};

    for (const e of entries) {
      if (!byDate[e.date]) {
        byDate[e.date] = {
          calories: 0, proteinG: 0, carbsG: 0, fatG: 0, mealCount: 0,
          morningCals: 0, eveningCals: 0, morningProtein: 0, meals: [],
        };
      }
      const d = byDate[e.date];
      d.calories   += e.calories;
      d.proteinG   += e.proteinG;
      d.carbsG     += e.carbsG;
      d.fatG       += e.fatG;
      d.mealCount  += 1;
      d.meals.push({ type: e.mealType, cals: e.calories });

      // Infer time-of-day from createdAt hour
      const hour = e.createdAt.getHours();
      if (hour < 11) { d.morningCals += e.calories; d.morningProtein += e.proteinG; }
      if (hour >= 18) d.eveningCals += e.calories;
    }

    const days = Object.values(byDate);
    const loggedDays = days.length;

    const avgCalories = Math.round(avg(days.map(d => d.calories)));
    const avgProtein  = Math.round(avg(days.map(d => d.proteinG)));
    const avgCarbs    = Math.round(avg(days.map(d => d.carbsG)));
    const avgFat      = Math.round(avg(days.map(d => d.fatG)));
    const avgMealsPerDay = +avg(days.map(d => d.mealCount)).toFixed(1);

    const totalCals = avgProtein * 4 + avgCarbs * 4 + avgFat * 9;
    const macroSplit = totalCals > 0 ? {
      proteinPct: Math.round((avgProtein * 4 / totalCals) * 100),
      carbsPct:   Math.round((avgCarbs * 4   / totalCals) * 100),
      fatPct:     Math.round((avgFat * 9     / totalCals) * 100),
    } : { proteinPct: 0, carbsPct: 0, fatPct: 0 };

    const weightKg     = user?.weightKg ?? null;
    const proteinPerKg = weightKg && weightKg > 0 ? +(avgProtein / weightKg).toFixed(2) : null;

    // Calorie trend
    const sortedDates = Object.keys(byDate).sort();
    const mid         = Math.floor(sortedDates.length / 2);
    const trendDelta  = Math.round(
      avg(sortedDates.slice(mid).map(d => byDate[d].calories)) -
      avg(sortedDates.slice(0, mid).map(d => byDate[d].calories))
    );
    const calorieTrend: 'increasing' | 'decreasing' | 'stable' =
      trendDelta > 100 ? 'increasing' : trendDelta < -100 ? 'decreasing' : 'stable';

    const consistencyPct = Math.round((loggedDays / 90) * 100);

    // ── Meal timing analysis ─────────────────────────────────────────────────
    const avgMorningCals    = Math.round(avg(days.map(d => d.morningCals)));
    const avgEveningCals    = Math.round(avg(days.map(d => d.eveningCals)));
    const eveningCaloriePct = totalCals > 0 ? Math.round((avgEveningCals / (avgCalories || 1)) * 100) : null;
    const morningMealPct    = Math.round(
      (days.filter(d => d.morningCals > 0).length / (loggedDays || 1)) * 100
    );
    const avgMorningProtein = Math.round(avg(days.map(d => d.morningProtein)));

    // ── Workout analysis ─────────────────────────────────────────────────────
    const workoutDates = new Set(workoutLogs.map(w => w.date));
    const trainingDaysPerWeek = workoutLogs.length > 0
      ? +((workoutLogs.length / 90) * 7).toFixed(1)
      : 0;

    // Nutrition on training vs rest days
    const trainingDayMacros = sortedDates
      .filter(d => workoutDates.has(d))
      .map(d => byDate[d])
      .filter(Boolean);
    const restDayMacros = sortedDates
      .filter(d => !workoutDates.has(d))
      .map(d => byDate[d])
      .filter(Boolean);

    const trainingDayCalories = trainingDayMacros.length
      ? Math.round(avg(trainingDayMacros.map(d => d.calories))) : null;
    const restDayCalories = restDayMacros.length
      ? Math.round(avg(restDayMacros.map(d => d.calories))) : null;
    const trainingDayProtein = trainingDayMacros.length
      ? Math.round(avg(trainingDayMacros.map(d => d.proteinG))) : null;
    const trainingDayCarbs = trainingDayMacros.length
      ? Math.round(avg(trainingDayMacros.map(d => d.carbsG))) : null;

    // Extract unique exercise/lift names from workout logs
    const allLiftNames = new Set<string>();
    for (const w of workoutLogs) {
      try {
        const exs: Array<{ name: string }> = JSON.parse(w.exercises);
        exs.forEach(e => e.name && allLiftNames.add(e.name));
      } catch { /* skip malformed */ }
    }
    // Also add diagnostic session lifts (formatted nicely)
    const sessionLifts = [...new Set(recentSessions.map(s =>
      s.selectedLift.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
    ))];
    const allLifts = [...new Set([...allLiftNames, ...sessionLifts])].slice(0, 8);

    // ── Wellness aggregation ─────────────────────────────────────────────────
    let wellnessSummary = '';
    let highProteinEnergyAvg: number | null = null;
    let lowProteinEnergyAvg: number | null = null;

    if (wellnessLogs.length >= 5) {
      const avgEnergy    = avg(wellnessLogs.map(w => w.energy));
      const avgMood      = avg(wellnessLogs.map(w => w.mood));
      const avgSleep     = avg(wellnessLogs.map(w => w.sleepHours));
      const avgStress    = avg(wellnessLogs.map(w => w.stress));

      wellnessSummary = `${wellnessLogs.length} check-ins: avg energy ${avgEnergy.toFixed(1)}/10, mood ${avgMood.toFixed(1)}/10, sleep ${avgSleep.toFixed(1)}h, stress ${avgStress.toFixed(1)}/10.`;

      // Correlate high/low protein days with next-day energy
      const highProteinDates = sortedDates.filter(d => byDate[d]?.proteinG >= avgProtein * 1.2);
      const lowProteinDates  = sortedDates.filter(d => byDate[d]?.proteinG <= avgProtein * 0.8);

      const getEnergyAfter = (dates: string[]) => {
        const energies = dates
          .map(d => {
            const next = new Date(new Date(d).getTime() + 86400000).toISOString().slice(0, 10);
            return wellnessLogs.find(w => w.date === next)?.energy;
          })
          .filter((v): v is number => v !== undefined);
        return energies.length >= 3 ? +avg(energies).toFixed(1) : null;
      };

      highProteinEnergyAvg = getEnergyAfter(highProteinDates);
      lowProteinEnergyAvg  = getEnergyAfter(lowProteinDates);
    }

    // ── Food variety (meal names for LLM context) ───────────────────────────
    const recentFoods = [...new Set(
      entries.slice(-90).map(e => e.name).filter(Boolean)
    )].slice(0, 40).join(', ');

    // ── Build comprehensive LLM prompt ───────────────────────────────────────
    const { default: OpenAI } = await import('openai');
    const openai = new (OpenAI as any)({ apiKey: process.env.OPENAI_API_KEY });

    const prompt = `You are an elite sports nutritionist and performance dietitian with expertise in exercise physiology. Analyze this athlete's complete nutrition and training data to produce a deep, scientifically rigorous performance nutrition profile.

═══ USER PROFILE ═══
- Body weight: ${weightKg ? `${weightKg.toFixed(1)} kg (${(weightKg * 2.205).toFixed(0)} lbs)` : 'unknown'}
- Height: ${user?.heightCm ? `${user.heightCm} cm` : 'unknown'}
- Training goal: ${user?.coachGoal || 'general strength / fitness'}
- Training experience: ${user?.trainingAge || 'unknown'}

═══ NUTRITION DATA (last 90 days) ═══
- Logged: ${loggedDays}/90 days (${consistencyPct}% consistency)
- Avg daily intake: ${avgCalories} kcal | P: ${avgProtein}g | C: ${avgCarbs}g | F: ${avgFat}g
- Macro split: ${macroSplit.proteinPct}% protein / ${macroSplit.carbsPct}% carbs / ${macroSplit.fatPct}% fat
${proteinPerKg !== null ? `- Protein per kg bodyweight: ${proteinPerKg}g/kg (research optimal for strength: 1.6–2.2g/kg)` : ''}
- Calorie trend: ${calorieTrend} (${trendDelta > 0 ? '+' : ''}${trendDelta} kcal drift first→second 45 days)
- Avg meals per day: ${avgMealsPerDay}
- Recent foods consumed: ${recentFoods || 'no food names logged'}

═══ MEAL TIMING ═══
- Morning meal frequency: ${morningMealPct}% of days have a morning meal (before 11am)
- Avg morning calories: ${avgMorningCals} kcal | Avg morning protein: ${avgMorningProtein}g
- Avg evening calories: ${avgEveningCals} kcal${eveningCaloriePct !== null ? ` (${eveningCaloriePct}% of daily intake after 6pm)` : ''}

═══ TRAINING DATA ═══
- Training frequency: ${trainingDaysPerWeek} days/week (${workoutLogs.length} workouts in 90 days)
${trainingDayCalories !== null ? `- Training day avg: ${trainingDayCalories} kcal | P: ${trainingDayProtein}g | C: ${trainingDayCarbs}g` : ''}
${restDayCalories !== null ? `- Rest day avg: ${restDayCalories} kcal` : ''}
${trainingDayCalories && restDayCalories ? `- Calorie periodization: ${trainingDayCalories > restDayCalories ? `+${trainingDayCalories - restDayCalories} kcal on training days (good)` : trainingDayCalories < restDayCalories ? `${trainingDayCalories - restDayCalories} kcal on training days (suboptimal — should be higher)` : 'same on training and rest days (no carb periodization)'}` : ''}
- Tracked lifts: ${allLifts.length > 0 ? allLifts.join(', ') : 'no lifts logged yet'}

═══ WELLNESS DATA ═══
${wellnessSummary || 'No wellness check-ins logged.'}
${highProteinEnergyAvg !== null && lowProteinEnergyAvg !== null ? `- High protein days → next-day energy: ${highProteinEnergyAvg}/10 vs low protein days: ${lowProteinEnergyAvg}/10` : ''}

Produce a JSON object with EXACTLY this structure. Be highly specific to their actual numbers — cite their exact values. Reference specific sports science research where relevant (e.g., leucine threshold, glycogen resynthesis rates, tryptophan-serotonin pathway, cortisol blunting, mTOR activation):

{
  "overallScore": <0-100>,
  "overallGrade": <"A+" | "A" | "A-" | "B+" | "B" | "B-" | "C+" | "C" | "C-" | "D" | "F">,
  "summary": <3-4 sentence plain-English summary citing their exact numbers>,

  "dimensionScores": {
    "dailyLife": <0-100>,
    "gymPerformance": <0-100>,
    "mentalClarity": <0-100>,
    "recovery": <0-100>,
    "nutritionTiming": <0-100>,
    "bodyComposition": <0-100>
  },

  "dailyLifeImpact": {
    "score": <0-100>,
    "grade": <letter grade>,
    "summary": <2-3 sentences about daily life energy and mood based on their data>,
    "morningEnergy": <"very_low"|"low"|"moderate"|"high"|"very_high">,
    "afternoonEnergy": <"very_low"|"low"|"moderate"|"high"|"very_high">,
    "eveningEnergy": <"very_low"|"low"|"moderate"|"high"|"very_high">,
    "morningEnergyDetail": <1-2 sentences explaining morning energy based on breakfast habits and their specific data>,
    "afternoonEnergyDetail": <1-2 sentences>,
    "eveningEnergyDetail": <1-2 sentences>,
    "moodStabilityRating": <1-10>,
    "moodStabilityDetail": <1-2 sentences on how their macros affect mood/neurotransmitters>,
    "keyFactors": [<3-4 specific factors from their data driving daily performance — cite numbers>],
    "recommendations": [<3 specific, actionable recommendations tailored to their exact data>]
  },

  "gymPerformance": {
    "score": <0-100>,
    "grade": <letter grade>,
    "summary": <2-3 sentences>,
    "strengthCapacity": <"severely_limited"|"limited"|"adequate"|"good"|"optimal">,
    "strengthCapacityDetail": <2 sentences citing protein/kg, carb timing, specific mechanisms>,
    "enduranceCapacity": <"severely_limited"|"limited"|"adequate"|"good"|"optimal">,
    "enduranceCapacityDetail": <1-2 sentences>,
    "recoveryBetweenSets": <"poor"|"below_average"|"average"|"good"|"excellent">,
    "recoveryBetweenSetsDetail": <1-2 sentences on creatine phosphate resynthesis, ATP availability>,
    "keyLimiter": <the single biggest nutrition factor limiting their gym performance>,
    "preWorkoutReadiness": <"poor"|"below_average"|"average"|"good"|"excellent">,
    "postWorkoutRecovery": <"poor"|"below_average"|"average"|"good"|"excellent">,
    "recommendations": [<3-4 specific workout nutrition recommendations>]
  },

  "liftImpact": [
    ${allLifts.length > 0
      ? allLifts.slice(0, 6).map(lift => `{
      "lift": "${lift}",
      "impactLevel": <"optimal"|"good"|"moderate"|"limited"|"poor">,
      "currentImpact": <1-2 sentences: how does their CURRENT nutrition specifically impact this lift's performance — be precise about mechanisms>,
      "scienceBacking": <1 sentence citing the specific physiological mechanism, e.g. "Phosphocreatine resynthesis requires...">,
      "recommendation": <1 specific actionable recommendation for this lift>
    }`).join(',\n      ')
      : `{
      "lift": "General Strength Training",
      "impactLevel": "moderate",
      "currentImpact": "Based on current macros, provide specific impact.",
      "scienceBacking": "Relevant mechanism.",
      "recommendation": "Actionable recommendation."
    }`
    }
  ],

  "mentalClarity": {
    "score": <0-100>,
    "grade": <letter grade>,
    "summary": <2-3 sentences on cognitive performance>,
    "focusRating": <1-10>,
    "glucoseStabilityRating": <1-10>,
    "glucoseStabilityDetail": <1-2 sentences on meal spacing, glycemic load, energy dips>,
    "brainFuelAdequacy": <"insufficient"|"marginal"|"adequate"|"optimal">,
    "brainFuelDetail": <1-2 sentences on fat intake for myelin, omega-3s, B-vitamins from food>,
    "neurotransmitterSupport": <"poor"|"moderate"|"good"|"excellent">,
    "neurotransmitterDetail": <1-2 sentences on tryptophan→serotonin, tyrosine→dopamine from their protein sources>,
    "keyFactors": [<3 specific factors from their data>],
    "recommendations": [<3 specific recommendations>]
  },

  "energyPattern": {
    "pattern": <"front_loaded"|"back_loaded"|"balanced"|"irregular">,
    "summary": <2-3 sentences describing their energy pattern and consequences>,
    "morningWindow": { "level": <"very_low"|"low"|"moderate"|"high">, "detail": <1-2 sentences> },
    "midDayWindow": { "level": <level>, "detail": <1-2 sentences> },
    "afternoonWindow": { "level": <level>, "detail": <1-2 sentences> },
    "eveningWindow": { "level": <level>, "detail": <1-2 sentences> },
    "crashRisk": <"low"|"moderate"|"high"|"very_high">,
    "crashRiskDetail": <1-2 sentences explaining when and why crashes occur>,
    "optimalMealTiming": <a specific meal timing recommendation tailored to their training schedule>,
    "recommendations": [<3 specific timing recommendations with reasoning>]
  },

  "recoveryAndSleep": {
    "score": <0-100>,
    "grade": <letter grade>,
    "summary": <2-3 sentences>,
    "muscleRepairCapacity": <"poor"|"below_average"|"average"|"good"|"excellent">,
    "muscleRepairDetail": <1-2 sentences on post-workout protein synthesis window, leucine threshold (2.5-3g), their specific intake>,
    "sleepQualityImpact": <"negative"|"neutral"|"positive">,
    "sleepQualityDetail": <1-2 sentences on evening eating, carb-tryptophan, magnesium, alcohol if relevant>,
    "inflammationRisk": <"low"|"moderate"|"high">,
    "inflammationDetail": <1-2 sentences on fat quality, omega-3/6 ratio from their food patterns>,
    "hormoneSupport": <"poor"|"moderate"|"good"|"excellent">,
    "hormonalDetail": <1-2 sentences on fat adequacy for testosterone/estrogen, zinc from proteins>,
    "recommendations": [<3-4 specific recovery recommendations>]
  },

  "strengths": [<3-4 specific data-backed strengths>],
  "improvements": [<3-4 specific priority improvements>],
  "suggestions": [<5 prioritized actionable suggestions, most impactful first>],

  "macroRecommendation": {
    "proteinG": <number>,
    "carbsG": <number>,
    "fatG": <number>,
    "calories": <number>,
    "trainingDayProteinG": <number>,
    "trainingDayCarbsG": <number>,
    "restDayProteinG": <number>,
    "restDayCarbsG": <number>,
    "rationale": <2-3 sentences explaining the recommendation based on their goal, body weight, and training frequency>
  }
}`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      temperature: 0.3,
      max_tokens: 4000,
    });

    let aiAnalysis: any = {};
    try {
      aiAnalysis = JSON.parse(completion.choices[0].message.content || '{}');
    } catch {
      aiAnalysis = { summary: 'Analysis unavailable at this time.', insights: [], suggestions: [] };
    }

    res.json({
      hasData: true,
      metrics: {
        loggedDays,
        consistencyPct,
        avgCalories,
        avgProtein,
        avgCarbs,
        avgFat,
        macroSplit,
        proteinPerKg,
        calorieTrend,
        trendDelta,
        avgMealsPerDay,
        trainingDaysPerWeek,
        trainingDayCalories,
        restDayCalories,
        trainingDayProtein,
        trainingDayCarbs,
        morningMealPct,
        avgMorningProtein,
        avgMorningCals,
        avgEveningCals,
        eveningCaloriePct,
        trackedLifts: allLifts,
        wellnessDataPoints: wellnessLogs.length,
        highProteinEnergyAvg,
        lowProteinEnergyAvg,
      },
      analysis: aiAnalysis,
    });
  } catch (err: any) {
    console.error('Nutrition profile error:', err);
    res.status(500).json({ error: err?.message ?? 'Failed to generate nutrition profile' });
  }
});

export default router;
