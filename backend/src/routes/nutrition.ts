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
// Aggregates 90 days of nutrition history and runs an LLM analysis to produce
// a Nutrition Profile: key metrics, macro breakdown, habit scoring, and
// actionable AI insights tailored to the user's training goal.
router.get('/nutrition/profile', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.id;

    const [user, entries, wellnessLogs] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId }, select: { weightKg: true, coachGoal: true } }),
      prisma.mealEntry.findMany({
        where: {
          userId,
          date: { gte: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10) },
        },
        orderBy: { date: 'asc' },
      }),
      prisma.wellnessCheckin.findMany({
        where: {
          userId,
          date: { gte: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10) },
        },
        select: { date: true, mood: true, energy: true, sleepHours: true, stress: true },
      }),
    ]);

    if (entries.length === 0) {
      return res.json({
        hasData: false,
        message: 'Log at least a few meals to generate your Nutrition Profile.',
      });
    }

    // ── Aggregate by day ────────────────────────────────────────────────────
    const byDate: Record<string, { calories: number; proteinG: number; carbsG: number; fatG: number; mealCount: number }> = {};
    for (const e of entries) {
      if (!byDate[e.date]) byDate[e.date] = { calories: 0, proteinG: 0, carbsG: 0, fatG: 0, mealCount: 0 };
      byDate[e.date].calories += e.calories;
      byDate[e.date].proteinG += e.proteinG;
      byDate[e.date].carbsG += e.carbsG;
      byDate[e.date].fatG += e.fatG;
      byDate[e.date].mealCount += 1;
    }
    const days = Object.values(byDate);
    const loggedDays = days.length;

    const avg = (arr: number[]) => arr.reduce((s, v) => s + v, 0) / (arr.length || 1);

    const avgCalories = Math.round(avg(days.map(d => d.calories)));
    const avgProtein  = Math.round(avg(days.map(d => d.proteinG)));
    const avgCarbs    = Math.round(avg(days.map(d => d.carbsG)));
    const avgFat      = Math.round(avg(days.map(d => d.fatG)));

    const totalCals = avgProtein * 4 + avgCarbs * 4 + avgFat * 9;
    const macroSplit = totalCals > 0 ? {
      proteinPct: Math.round((avgProtein * 4 / totalCals) * 100),
      carbsPct:   Math.round((avgCarbs * 4   / totalCals) * 100),
      fatPct:     Math.round((avgFat * 9     / totalCals) * 100),
    } : { proteinPct: 0, carbsPct: 0, fatPct: 0 };

    // Protein per kg bodyweight
    const weightKg = user?.weightKg ?? null;
    const proteinPerKg = weightKg && weightKg > 0 ? +(avgProtein / weightKg).toFixed(2) : null;

    // Calorie trend: compare first half vs second half
    const sortedDates = Object.keys(byDate).sort();
    const mid = Math.floor(sortedDates.length / 2);
    const firstHalf  = sortedDates.slice(0, mid).map(d => byDate[d].calories);
    const secondHalf = sortedDates.slice(mid).map(d => byDate[d].calories);
    const trendDelta = Math.round(avg(secondHalf) - avg(firstHalf));
    const calorieTrend: 'increasing' | 'decreasing' | 'stable' =
      trendDelta > 100 ? 'increasing' : trendDelta < -100 ? 'decreasing' : 'stable';

    // Consistency: logged days / 90
    const consistencyPct = Math.round((loggedDays / 90) * 100);

    // Meal frequency
    const avgMealsPerDay = +(avg(days.map(d => d.mealCount))).toFixed(1);

    // ── Wellness correlation (if data exists) ───────────────────────────────
    let wellnessCorrelation: string | null = null;
    if (wellnessLogs.length > 5) {
      const avgEnergy = avg(wellnessLogs.map(w => w.energy)).toFixed(1);
      const avgMood   = avg(wellnessLogs.map(w => w.mood)).toFixed(1);
      wellnessCorrelation = `Average energy: ${avgEnergy}/10, mood: ${avgMood}/10 over ${wellnessLogs.length} check-ins.`;
    }

    // ── Sample of recent meals for LLM context ──────────────────────────────
    const recentMealNames = [...new Set(
      entries.slice(-60).map(e => e.name).filter(Boolean)
    )].slice(0, 30).join(', ');

    // ── LLM analysis ────────────────────────────────────────────────────────
    const { default: OpenAI } = await import('openai');
    const openai = new (OpenAI as any)({ apiKey: process.env.OPENAI_API_KEY });

    const prompt = `You are an expert sports nutritionist and performance dietitian. Analyze this user's nutrition data and provide a detailed, actionable nutrition profile.

USER DATA (last 90 days):
- Logged days: ${loggedDays} out of 90 (${consistencyPct}% consistency)
- Avg daily calories: ${avgCalories} kcal
- Avg protein: ${avgProtein}g | Avg carbs: ${avgCarbs}g | Avg fat: ${avgFat}g
- Macro split: ${macroSplit.proteinPct}% protein / ${macroSplit.carbsPct}% carbs / ${macroSplit.fatPct}% fat
${proteinPerKg !== null ? `- Protein per kg bodyweight: ${proteinPerKg}g/kg (body weight: ${weightKg?.toFixed(0)}kg)` : ''}
- Calorie trend: ${calorieTrend} (delta: ${trendDelta > 0 ? '+' : ''}${trendDelta} kcal first vs second half of period)
- Avg meals per day: ${avgMealsPerDay}
${wellnessCorrelation ? `- Wellness: ${wellnessCorrelation}` : ''}
${recentMealNames ? `- Recent foods logged: ${recentMealNames}` : ''}
- Training goal: ${user?.coachGoal || 'general fitness / strength'}

Respond with a JSON object with exactly these fields:
{
  "overallScore": <number 0-100 representing overall nutrition quality>,
  "overallGrade": <"A" | "B" | "C" | "D" — letter grade>,
  "summary": <2-3 sentence plain-English summary of their nutrition habits>,
  "strengths": [<up to 3 specific strengths, strings>],
  "improvements": [<up to 3 specific areas to improve, strings>],
  "insights": [
    {
      "category": <"performance" | "mood" | "recovery" | "body_composition" | "habits">,
      "title": <short title>,
      "body": <2-3 sentence insight specific to their data>
    }
  ],
  "suggestions": [<up to 5 specific, actionable suggestions strings tailored to their goal and data>],
  "macroRecommendation": {
    "proteinG": <recommended daily protein grams>,
    "carbsG": <recommended daily carbs grams>,
    "fatG": <recommended daily fat grams>,
    "calories": <recommended daily calories>,
    "rationale": <one sentence explaining the recommendation>
  }
}

Be specific to their actual numbers. Do not give generic advice.`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      temperature: 0.4,
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
      },
      analysis: aiAnalysis,
    });
  } catch (err: any) {
    console.error('Nutrition profile error:', err);
    res.status(500).json({ error: err?.message ?? 'Failed to generate nutrition profile' });
  }
});

export default router;
