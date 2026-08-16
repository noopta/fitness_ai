// Gut-health & personalized-nutrition routes (gut-health feature, 2026-07):
//   POST /nutrition/assessment      — save the nutrition & gut-health intake
//   GET  /nutrition/assessment      — read it back (mobile pre-fill / edit)
//   POST /nutrition/plan/generate   — deterministic targets + LLM plan
//   GET  /nutrition/plan            — latest plan (living document)
//   GET  /nutrition/micros/daily    — day totals vs personal targets (bands)
//   GET  /nutrition/gut/week        — five-pillar week view + plant list
//   POST /nutrition/order-scan      — screenshot/receipt → line items (image NEVER stored)
//   POST /nutrition/order-log       — log selected items with portion factors
import { Router } from 'express';
import { z } from 'zod';
import { PrismaClient } from '@prisma/client';
import { requireAuth } from '../middleware/requireAuth.js';
import { analyzeOrderScreenshot } from '../services/llmService.js';
import type { Micronutrients } from '../services/llmService.js';
import { enrichMealDetailHybrid } from '../services/nutritionEnrichmentService.js';
import {
  generateNutritionPlan, latestNutritionPlan, type NutritionAssessment,
} from '../services/nutritionPlanService.js';
import {
  computeMicroTargets, statusFor, type MicroTargetResult,
} from '../services/microTargetsService.js';
import {
  scoreGutWeek, distinctPlants, PLANT_TARGET,
} from '../services/gutHealthScoreService.js';
import { consumeMealLoggingQuota, nutritionProfileCacheKey } from '../services/nutritionShared.js';
import { cacheDelete } from '../services/cacheService.js';
import { trackValidationFailure } from '../services/errorAlertService.js';
import { normalizeFoodRegion } from '../services/prompts/regionPrompts.js';

const prisma = new PrismaClient();
const router = Router();

// ── Assessment ─────────────────────────────────────────────────────────────

const assessmentSchema = z.object({
  typicalDay: z.string().max(4000).optional(),
  mealsPerDay: z.number().int().min(1).max(10).optional(),
  orderOutPerWeek: z.number().int().min(0).max(30).optional(),
  travelsOften: z.boolean().optional(),
  digestion: z.object({
    bloating: z.enum(['never', 'sometimes', 'often']).optional(),
    regularity: z.enum(['regular', 'irregular']).optional(),
    intolerances: z.array(z.string().max(60)).max(15).optional(),
  }).optional(),
  energy: z.object({
    afternoonCrashes: z.boolean().optional(),
    caffeinePerDay: z.number().int().min(0).max(20).optional(),
    alcoholPerWeek: z.number().int().min(0).max(50).optional(),
  }).optional(),
  sleepQualityLow: z.boolean().optional(),
  fermentedPerWeek: z.number().int().min(0).max(50).optional(),
  plantVarietyGuess: z.enum(['low', 'medium', 'high']).optional(),
  supplements: z.array(z.string().max(80)).max(20).optional(),
  dietaryStyle: z.enum(['omnivore', 'pescatarian', 'vegetarian', 'vegan']).optional(),
  goals: z.array(z.enum([
    'energy', 'gut_comfort', 'recovery', 'sleep', 'cognition', 'body_comp', 'general_health',
  ])).max(7).optional(),
  medicalFlags: z.array(z.string().max(120)).max(10).optional(),
});

router.post('/nutrition/assessment', requireAuth, async (req, res) => {
  try {
    const assessment = assessmentSchema.parse(req.body);
    const userId = req.user!.id;
    const user = await prisma.user.findUnique({
      where: { id: userId }, select: { coachProfile: true },
    });
    let profile: Record<string, unknown> = {};
    try { profile = user?.coachProfile ? JSON.parse(user.coachProfile) : {}; } catch { /* replace */ }
    // Single source of truth: assessment lives ONLY under coachProfile.nutrition.
    profile.nutrition = { ...assessment, completedAt: new Date().toISOString() };
    await prisma.user.update({
      where: { id: userId },
      data: { coachProfile: JSON.stringify(profile) },
    });
    res.status(201).json({ saved: true, assessment: profile.nutrition });
  } catch (err: any) {
    if (err?.name === 'ZodError') {
      trackValidationFailure('/nutrition/assessment', err.issues?.[0]?.message ?? 'unknown');
      return res.status(400).json({ error: 'Invalid assessment' });
    }
    console.error('[nutrition/assessment] save failed:', err);
    res.status(500).json({ error: 'Failed to save assessment' });
  }
});

router.get('/nutrition/assessment', requireAuth, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id }, select: { coachProfile: true },
    });
    let profile: any = {};
    try { profile = user?.coachProfile ? JSON.parse(user.coachProfile) : {}; } catch { /* empty */ }
    res.json({ assessment: profile?.nutrition ?? null });
  } catch (err) {
    console.error('[nutrition/assessment] read failed:', err);
    res.status(500).json({ error: 'Failed to read assessment' });
  }
});

// ── Plan ───────────────────────────────────────────────────────────────────

router.post('/nutrition/plan/generate', requireAuth, async (req, res) => {
  try {
    const result = await generateNutritionPlan(req.user!.id);
    cacheDelete(nutritionProfileCacheKey(req.user!.id));
    res.status(201).json(result);
  } catch (err: any) {
    console.error('[nutrition/plan] generation failed:', err);
    res.status(500).json({ error: 'Failed to generate nutrition plan' });
  }
});

router.get('/nutrition/plan', requireAuth, async (req, res) => {
  try {
    const plan = await latestNutritionPlan(req.user!.id);
    if (!plan) return res.status(404).json({ error: 'No nutrition plan yet' });
    res.json(plan);
  } catch (err) {
    console.error('[nutrition/plan] read failed:', err);
    res.status(500).json({ error: 'Failed to read nutrition plan' });
  }
});

// ── Daily micros ───────────────────────────────────────────────────────────

async function userTargets(userId: string): Promise<MicroTargetResult> {
  const plan = await latestNutritionPlan(userId);
  if (plan?.targets?.targets?.length) return plan.targets;
  // Pre-plan fallback: generic RDA targets so the tab still renders bands.
  return computeMicroTargets({});
}

const NUTRIENT_SUM_KEYS: Array<keyof Micronutrients> = [
  'fiberG', 'sugarG', 'sodiumMg', 'saturatedFatG', 'cholesterolMg', 'vitaminAIU',
  'vitaminCMg', 'vitaminDIU', 'vitaminEMg', 'vitaminB12Mcg', 'folateMcg', 'ironMg',
  'calciumMg', 'magnesiumMg', 'zincMg', 'potassiumMg', 'omega3G', 'omega6G',
];

function sumNutrients(rows: Array<{ nutrientsJson: string | null }>): Record<string, number> {
  const totals: Record<string, number> = Object.fromEntries(NUTRIENT_SUM_KEYS.map((k) => [k, 0]));
  for (const row of rows) {
    if (!row.nutrientsJson) continue;
    try {
      const n = JSON.parse(row.nutrientsJson);
      for (const key of NUTRIENT_SUM_KEYS) {
        const v = Number(n?.[key]);
        if (Number.isFinite(v)) totals[key] += v;
      }
    } catch { /* skip bad rows */ }
  }
  return totals;
}

router.get('/nutrition/micros/daily', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.id;
    const date = (req.query.date as string) || new Date().toISOString().split('T')[0];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'Invalid date' });

    const [entries, targets] = await Promise.all([
      prisma.mealEntry.findMany({ where: { userId, date }, select: { nutrientsJson: true } }),
      userTargets(userId),
    ]);
    const totals = sumNutrients(entries);

    const nutrients = targets.targets.map((t) => {
      const actual = t.key === 'fiberG' ? totals.fiberG : (totals[t.key] ?? 0);
      const pct = t.target > 0 ? Math.round((actual / t.target) * 100) : 0;
      return {
        key: t.key, label: t.label, unit: t.unit, target: t.target,
        direction: t.direction,
        actual: Math.round(actual * 10) / 10,
        pct,
        status: statusFor(t, actual),
        focus: targets.focus.includes(t.key),
      };
    });

    res.json({
      date,
      mealsLogged: entries.length,
      estimateNote: 'est. ±30%',
      focus: targets.focus,
      nutrients,
    });
  } catch (err) {
    console.error('[nutrition/micros] daily failed:', err);
    res.status(500).json({ error: 'Failed to compute daily micros' });
  }
});

// ── Weekly gut view ────────────────────────────────────────────────────────

function dateNDaysAgo(n: number, from: string): string {
  const d = new Date(`${from}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().split('T')[0];
}

router.get('/nutrition/gut/week', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.id;
    const end = (req.query.end as string) || new Date().toISOString().split('T')[0];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(end)) return res.status(400).json({ error: 'Invalid date' });
    const start = dateNDaysAgo(6, end);

    const [entries, firstEver, targets] = await Promise.all([
      prisma.mealEntry.findMany({
        where: { userId, date: { gte: start, lte: end } },
        select: {
          date: true, nutrientsJson: true, plantsJson: true,
          fermentedJson: true, ultraProcessed: true,
        },
      }),
      prisma.mealEntry.findFirst({
        where: { userId }, orderBy: { date: 'asc' }, select: { date: true },
      }),
      userTargets(userId),
    ]);

    // Observed window: don't hold a 2-day-old account to a 7-day bar.
    let days = 7;
    if (firstEver && firstEver.date > start) {
      const first = new Date(`${firstEver.date}T00:00:00Z`).getTime();
      const endMs = new Date(`${end}T00:00:00Z`).getTime();
      days = Math.max(1, Math.min(7, Math.round((endMs - first) / 86400000) + 1));
    }

    const byDate = new Map<string, number>();
    let fiberTotal = 0;
    let fermentedServings = 0;
    let ultraProcessedMeals = 0;
    const plantLists: string[][] = [];
    for (const e of entries) {
      byDate.set(e.date, (byDate.get(e.date) ?? 0) + 1);
      try {
        if (e.nutrientsJson) fiberTotal += Number(JSON.parse(e.nutrientsJson)?.fiberG) || 0;
      } catch { /* skip */ }
      try {
        if (e.plantsJson) plantLists.push(JSON.parse(e.plantsJson));
      } catch { /* skip */ }
      try {
        if (e.fermentedJson) fermentedServings += (JSON.parse(e.fermentedJson) as unknown[]).length;
      } catch { /* skip */ }
      if (e.ultraProcessed) ultraProcessedMeals += 1;
    }

    const fiberTarget = targets.targets.find((t) => t.key === 'fiberG')?.target ?? 30;
    const result = scoreGutWeek({
      days,
      avgDailyFiberG: fiberTotal / days,
      fiberTargetG: fiberTarget,
      distinctPlants: distinctPlants(plantLists),
      fermentedServings,
      mealsLogged: entries.length,
      ultraProcessedMeals,
      daysWithTwoPlusMeals: [...byDate.values()].filter((c) => c >= 2).length,
    });

    res.json({
      start, end, days,
      estimateNote: 'est. ±30%',
      ...result,
      plantTarget: PLANT_TARGET,
    });
  } catch (err) {
    console.error('[nutrition/gut] week failed:', err);
    res.status(500).json({ error: 'Failed to compute gut week' });
  }
});

// ── Order scan & item-level log ────────────────────────────────────────────

const orderScanSchema = z.object({
  imageBase64: z.string().min(100).max(15_000_000),
  mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp', 'image/heic']),
});

router.post('/nutrition/order-scan', requireAuth, async (req, res) => {
  try {
    const { imageBase64, mimeType } = orderScanSchema.parse(req.body);
    const userId = req.user!.id;
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { tier: true, foodRegion: true },
    });
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Shares the daily meal-logging quota with parse-meal / analyze-photo.
    const ok = await consumeMealLoggingQuota(prisma, userId, user.tier, res);
    if (!ok) return;

    // PRIVACY: imageBase64 lives only in this request's memory. It is not
    // written to disk, the DB, logs, or any cache — the response carries
    // extracted food data only.
    const scan = await analyzeOrderScreenshot(imageBase64, mimeType, normalizeFoodRegion(user.foodRegion));

    if (scan.kind === 'unreadable' || (scan.kind === 'order' && scan.items.length === 0)) {
      return res.status(422).json({
        error: "Couldn't read that order — try a clearer screenshot, or log by text.",
        kind: scan.kind,
      });
    }

    // USDA-enrich each item concurrently (best effort — LLM numbers stand
    // when USDA has no match).
    const items = await Promise.all(
      scan.items.map(async (item) => {
        try {
          const { detail, meta } = await enrichMealDetailHybrid(item, { region: normalizeFoodRegion(user.foodRegion) });
          return { ...item, ...detail, enrichment: meta };
        } catch {
          return { ...item, enrichment: null };
        }
      }),
    );

    res.json({ kind: scan.kind, vendor: scan.vendor, items, estimateNote: 'est. ±30%' });
  } catch (err: any) {
    if (err?.name === 'ZodError') return res.status(400).json({ error: 'Invalid request' });
    console.error('[order-scan] failed:', err);
    res.status(500).json({ error: 'Failed to scan order' });
  }
});

const orderLogSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  mealType: z.enum(['breakfast', 'lunch', 'dinner', 'snack', 'meal']).default('meal'),
  vendor: z.string().max(120).nullable().optional(),
  items: z.array(z.object({
    name: z.string().min(1).max(200),
    portionFactor: z.number().min(0.1).max(3).default(1), // All=1 · Ate half=0.5 · A bite=0.15
    quantity: z.number().int().min(1).max(10).default(1),
    calories: z.number().min(0).max(5000),
    proteinG: z.number().min(0).max(500),
    carbsG: z.number().min(0).max(1000),
    fatG: z.number().min(0).max(500),
    ingredients: z.array(z.string().max(120)).max(30).default([]),
    tags: z.array(z.string().max(60)).max(30).default([]),
    plants: z.array(z.string().max(60)).max(30).default([]),
    fermentedFoods: z.array(z.string().max(60)).max(20).default([]),
    ultraProcessed: z.boolean().default(false),
    nutrients: z.record(z.string(), z.unknown()).optional(),
  })).min(1).max(12),
});

router.post('/nutrition/order-log', requireAuth, async (req, res) => {
  try {
    const body = orderLogSchema.parse(req.body);
    const userId = req.user!.id;
    const date = body.date || new Date().toISOString().split('T')[0];

    const scaleNutrients = (n: Record<string, unknown> | undefined, f: number) => {
      if (!n) return null;
      const out: Record<string, number> = {};
      for (const key of NUTRIENT_SUM_KEYS) {
        const v = Number((n as any)?.[key]);
        if (Number.isFinite(v)) out[key] = Math.round(v * f * 10) / 10;
      }
      return out;
    };

    const created = await prisma.$transaction(
      body.items.map((item) => {
        const f = item.portionFactor * item.quantity;
        return prisma.mealEntry.create({
          data: {
            userId,
            date,
            name: body.vendor ? `${item.name} (${body.vendor})` : item.name,
            mealType: body.mealType,
            calories: Math.round(item.calories * f),
            proteinG: Math.round(item.proteinG * f * 10) / 10,
            carbsG: Math.round(item.carbsG * f * 10) / 10,
            fatG: Math.round(item.fatG * f * 10) / 10,
            ingredientsJson: item.ingredients.length ? JSON.stringify(item.ingredients) : null,
            tagsJson: item.tags.length ? JSON.stringify(item.tags) : null,
            nutrientsJson: JSON.stringify(scaleNutrients(item.nutrients, f) ?? {}),
            plantsJson: item.plants.length ? JSON.stringify(item.plants) : null,
            fermentedJson: item.fermentedFoods.length ? JSON.stringify(item.fermentedFoods) : null,
            ultraProcessed: item.ultraProcessed,
            source: 'order-scan',
          },
          select: { id: true, name: true, calories: true, proteinG: true, carbsG: true, fatG: true },
        });
      }),
    );

    cacheDelete(nutritionProfileCacheKey(userId));
    const plants = distinctPlants(body.items.map((i) => i.plants));
    res.status(201).json({
      logged: created,
      gutWins: {
        plants,
        fermented: body.items.some((i) => i.fermentedFoods.length > 0),
      },
    });
  } catch (err: any) {
    if (err?.name === 'ZodError') {
      trackValidationFailure('/nutrition/order-log', err.issues?.[0]?.message ?? 'unknown');
      return res.status(400).json({ error: 'Invalid request' });
    }
    console.error('[order-log] failed:', err);
    res.status(500).json({ error: 'Failed to log order' });
  }
});

export default router;
