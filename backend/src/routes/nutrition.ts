import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { requireAuth } from '../middleware/requireAuth.js';
import { cacheGet, cacheSet, cacheDelete, cacheGetWithMeta, cacheMarkStale } from '../services/cacheService.js';
import posthog from '../services/posthogClient.js';

const NUTRITION_PROFILE_TTL = 30 * 24 * 60 * 60 * 1000; // 30 days — invalidated on meal entry
import {
  nutritionProfileCacheKey,
  normalizeFoodName,
  parseJsonArray,
  parseJsonObject,
  consumeMealLoggingQuota,
  updateNutritionStreakInBackground,
} from '../services/nutritionShared.js';
import { parseMealMacros, analyzeMealPhoto, suggestMeals, transcribeAudio, parseNutritionLabel } from '../services/llmService.js';
import type { Micronutrients } from '../services/llmService.js';
import { logActivity } from '../services/activityService.js';
import { trackValidationFailure } from '../services/errorAlertService.js';
import {
  descriptiveLabel,
  KNOWN_MEAL_SOURCES,
  KNOWN_PARSE_CONFIDENCE,
} from '../validation/descriptiveLabel.js';
import { detectAndNotifyProteinHit } from '../services/progressService.js';
import { sendJunkFoodEncouragement, isJunkFood } from '../services/reengagementService.js';
import { runNutritionEngine } from '../engine/nutritionEngine.js';
import type { NutritionEngineUser, DailyMacro, MealTiming, WellnessPoint } from '../engine/nutritionEngine.js';
import { runNutritionRules } from '../engine/nutritionRulesEngine.js';
import { buildRAGContext } from '../services/ragService.js';
import { chatComplete } from '../services/chatClient.js';
import { enrichMealDetailHybrid, normalizeMicronutrients } from '../services/nutritionEnrichmentService.js';
import { normalizeFoodRegion } from '../services/prompts/regionPrompts.js';


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
      cacheMarkStale(nutritionProfileCacheKey(userId));
      logActivity(userId, 'nutrition').catch(() => {});
      updateNutritionStreakInBackground(prisma, userId, data.date);
      detectAndNotifyProteinHit(prisma, userId, data.date, data.proteinG).catch(err =>
        console.error('[nutrition] protein hit detection error:', err)
      );
      posthog.capture({
        distinctId: userId,
        event: 'nutrition_log_saved',
        properties: {
          log_date: data.date,
          calories: data.calories ?? null,
          is_update: true,
        },
      });
      return res.json(updated);
    }

    const created = await prisma.nutritionLog.create({
      data: { userId, ...data },
    });
    cacheDelete(`userctx:${userId}`);
    // Profile cache must also be busted on create — the update path above does
    // this, but the original create branch only purged userctx. Without this
    // line, a fresh log (first one of the day) leaves a stale profile cached
    // server-side until the 30-day TTL expires.
    cacheMarkStale(nutritionProfileCacheKey(userId));
    logActivity(userId, 'nutrition').catch(() => {});
    updateNutritionStreakInBackground(prisma, userId, data.date);
    detectAndNotifyProteinHit(prisma, userId, data.date, data.proteinG).catch(err =>
      console.error('[nutrition] protein hit detection error:', err)
    );
    posthog.capture({
      distinctId: userId,
      event: 'nutrition_log_saved',
      properties: {
        log_date: data.date,
        calories: data.calories ?? null,
        is_update: false,
      },
    });
    res.status(201).json(created);
  } catch (err: any) {
    posthog.captureException(err, req.user?.id);
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
  ingredients: z.array(z.string().min(1).transform((v) => v.slice(0, 120))).max(30).optional().default([]),
  tags: z.array(z.string().min(1).max(60)).max(30).optional().default([]),
  plants: z.array(z.string().min(1).max(60)).max(30).optional().default([]),
  fermentedFoods: z.array(z.string().min(1).max(60)).max(20).optional().default([]),
  ultraProcessed: z.boolean().optional().default(false),
  nutrients: z.object({
    fiberG: z.number().min(0).max(500).optional(),
    sugarG: z.number().min(0).max(500).optional(),
    sodiumMg: z.number().min(0).max(20000).optional(),
    saturatedFatG: z.number().min(0).max(500).optional(),
    cholesterolMg: z.number().min(0).max(5000).optional(),
    vitaminAIU: z.number().min(0).max(200000).optional(),
    vitaminCMg: z.number().min(0).max(5000).optional(),
    vitaminDIU: z.number().min(0).max(10000).optional(),
    vitaminEMg: z.number().min(0).max(2000).optional(),
    vitaminB12Mcg: z.number().min(0).max(5000).optional(),
    folateMcg: z.number().min(0).max(10000).optional(),
    ironMg: z.number().min(0).max(200).optional(),
    calciumMg: z.number().min(0).max(5000).optional(),
    magnesiumMg: z.number().min(0).max(3000).optional(),
    zincMg: z.number().min(0).max(300).optional(),
    potassiumMg: z.number().min(0).max(10000).optional(),
    omega3G: z.number().min(0).max(200).optional(),
    omega6G: z.number().min(0).max(300).optional(),
    glycemicIndex: z.number().min(0).max(150).nullable().optional(),
  }).optional(),
  // Descriptive labels, NOT gates — an unrecognised value must never reject the
  // meal. See src/validation/descriptiveLabel.ts for why (this broke twice).
  source: descriptiveLabel(KNOWN_MEAL_SOURCES, 'manual'),
  parseConfidence: descriptiveLabel(KNOWN_PARSE_CONFIDENCE, null),
  notes: z.string().max(500).optional(),
  // OPEN nutrient channel — any nutrient keys the parser produced. Not capped
  // to a fixed set; the effects engine reads this. Values must be finite.
  nutrientMap: z.record(z.string(), z.number().finite()).optional(),
  ingredientNutrients: z.array(z.object({
    name: z.string().min(1).max(120),
    nutrients: z.record(z.string(), z.number().finite()),
  })).max(40).optional(),
});

// Build an open nutrient map from the structured micros + top-line macros, for
// entries whose client didn't forward an explicit nutrientMap. Non-numeric
// descriptors (digestiveSpeed, biochemicalEffects) and zeros are skipped.
function deriveNutrientMap(
  nutrients: Micronutrients,
  macros: { proteinG: number; carbsG: number; fatG: number },
): Record<string, number> {
  const out: Record<string, number> = {};
  if (macros.proteinG > 0) out.proteinG = macros.proteinG;
  if (macros.carbsG > 0) out.carbsG = macros.carbsG;
  if (macros.fatG > 0) out.fatG = macros.fatG;
  for (const [key, value] of Object.entries(nutrients)) {
    if (typeof value === 'number' && Number.isFinite(value) && value !== 0) out[key] = value;
  }
  return out;
}

// POST /api/nutrition/meals - Log a meal entry
router.post('/nutrition/meals', requireAuth, async (req, res) => {
  try {
    const data = mealEntrySchema.parse(req.body);
    const userId = req.user!.id;
    const nutrients = normalizeMicronutrients(data.nutrients);
    const ingredients = data.ingredients.map(v => v.trim()).filter(Boolean);
    const tags = data.tags.map(v => v.trim().toLowerCase()).filter(Boolean);
    // Open nutrient channel: prefer what the client forwarded; otherwise
    // derive it from the structured micros so entries logged by older clients
    // (which don't send nutrientMap) still feed the effects engine.
    const nutrientMap = data.nutrientMap && Object.keys(data.nutrientMap).length > 0
      ? data.nutrientMap
      : deriveNutrientMap(nutrients, data);
    const ingredientNutrients = (data.ingredientNutrients ?? [])
      .filter(i => i.name.trim() && Object.keys(i.nutrients).length > 0);

    const entry = await prisma.mealEntry.create({
      data: {
        userId,
        date: data.date,
        name: data.name,
        mealType: data.mealType,
        calories: data.calories,
        proteinG: data.proteinG,
        carbsG: data.carbsG,
        fatG: data.fatG,
        ingredientsJson: ingredients.length > 0 ? JSON.stringify(ingredients) : null,
        tagsJson: tags.length > 0 ? JSON.stringify(tags) : null,
        nutrientsJson: JSON.stringify(nutrients),
        nutrientMapJson: Object.keys(nutrientMap).length > 0 ? JSON.stringify(nutrientMap) : null,
        ingredientNutrientsJson: ingredientNutrients.length > 0 ? JSON.stringify(ingredientNutrients) : null,
        plantsJson: data.plants.length > 0 ? JSON.stringify(data.plants) : null,
        fermentedJson: data.fermentedFoods.length > 0 ? JSON.stringify(data.fermentedFoods) : null,
        ultraProcessed: data.ultraProcessed,
        source: data.source,
        parseConfidence: data.parseConfidence ?? null,
        notes: data.notes,
      },
    });

    // Auto-upsert into saved foods library for quick re-use and richer future
    // analysis. Skipped for recipe-sourced entries: recipes live in their own
    // library, and a per-serving shadow copy here could clobber a same-named
    // saved food (or vice versa) on the normalizedName unique key.
    if (data.source === 'recipe') {
      cacheMarkStale(nutritionProfileCacheKey(userId));
      logActivity(userId, 'nutrition').catch(() => {});
      updateNutritionStreakInBackground(prisma, userId, data.date);
      return res.status(201).json({ ...entry, ingredients, tags, nutrients });
    }
    const normalizedName = normalizeFoodName(data.name);
    const existingFood = await prisma.savedFood.findUnique({
      where: { userId_normalizedName: { userId, normalizedName } },
    });
    if (existingFood) {
      // A macro-only manual/barcode log must not erase micronutrients learned
      // from an earlier rich parse of the same saved food.
      const incomingHasMicros = Object.values(nutrients)
        .filter((value) => typeof value === 'number' && Number.isFinite(value) && value > 0)
        .length >= 3;
      await prisma.savedFood.update({
        where: { id: existingFood.id },
        data: {
          calories: data.calories,
          proteinG: data.proteinG,
          carbsG: data.carbsG,
          fatG: data.fatG,
          ingredientsJson: ingredients.length > 0 ? JSON.stringify(ingredients) : null,
          tagsJson: tags.length > 0 ? JSON.stringify(tags) : null,
          ...(incomingHasMicros ? { nutrientsJson: JSON.stringify(nutrients) } : {}),
          source: data.source,
          useCount: { increment: 1 },
        },
      });
    } else {
      await prisma.savedFood.create({
        data: {
          userId,
          name: data.name.trim(),
          normalizedName,
          calories: data.calories,
          proteinG: data.proteinG,
          carbsG: data.carbsG,
          fatG: data.fatG,
          ingredientsJson: ingredients.length > 0 ? JSON.stringify(ingredients) : null,
          tagsJson: tags.length > 0 ? JSON.stringify(tags) : null,
          nutrientsJson: JSON.stringify(nutrients),
          source: data.source,
          useCount: 1,
        },
      });
    }

    cacheMarkStale(nutritionProfileCacheKey(userId));
    logActivity(userId, 'nutrition').catch(() => {});
    updateNutritionStreakInBackground(prisma, userId, data.date);
    res.status(201).json({
      ...entry,
      ingredients,
      tags,
      nutrients,
    });
  } catch (err: any) {
    console.error('Meal entry error:', err);
    // Never surface raw Zod JSON to the sheet — it renders in the UI.
    const friendly = err?.name === 'ZodError'
      ? 'Some meal fields were invalid — try adjusting the values and logging again.'
      : err.message || 'Failed to save meal';
    if (err?.name === 'ZodError') {
      trackValidationFailure('/nutrition/meals', err.issues?.[0]?.message ?? 'unknown');
    }
    res.status(400).json({ error: friendly });
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
    res.json({
      entries: entries.map((e) => ({
        ...e,
        ingredients: parseJsonArray(e.ingredientsJson),
        tags: parseJsonArray(e.tagsJson),
        plants: parseJsonArray(e.plantsJson),
        fermentedFoods: parseJsonArray(e.fermentedJson),
        nutrients: normalizeMicronutrients(parseJsonObject<Partial<Micronutrients>>(e.nutrientsJson)),
      })),
    });
  } catch (err) {
    console.error('Meal entries fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch meal entries' });
  }
});

// GET /api/nutrition/barcode/:code — look up a food product by barcode (UPC/EAN/GTIN).
// Source: OpenFoodFacts (free, no API key, 3M+ products globally). Falls
// back gracefully when the barcode isn't in their DB so the client can
// route the user to manual entry or LLM-photo parse. Public-API spec:
//   https://world.openfoodfacts.org/api/v3/product/<barcode>.json
const OFF_BASE = 'https://world.openfoodfacts.org/api/v3/product';
router.get('/nutrition/barcode/:code', requireAuth, async (req, res) => {
  const code = String(req.params.code ?? '').trim();
  if (!/^[0-9]{6,14}$/.test(code)) {
    return res.status(400).json({ error: 'Invalid barcode format' });
  }
  // OpenFoodFacts' coverage of Nigerian- and Gambian-manufactured goods is
  // thin, so we keep our own community table of labels users have scanned.
  // Both are queried together: OFF wins when it has the product (it is
  // moderated and more complete), the community row is the fallback.
  const communityRow = prisma.productBarcode.findUnique({ where: { code } }).catch(() => null);

  try {
    const r = await fetch(`${OFF_BASE}/${code}.json`, {
      headers: { 'User-Agent': 'Axiom-Fitness/2.0.2 (https://axiomtraining.io)' },
      signal: AbortSignal.timeout(8000),
    }).catch(() => null);

    const json: any = r && r.ok ? await r.json().catch(() => null) : null;
    const offHasProduct = !!json && json.status !== 0 && !!json.product;

    if (!offHasProduct) {
      // Fall back to a label a user has already photographed for us.
      const local = await communityRow;
      if (local) return res.json(serializeCommunityProduct(local));
      if (r && !r.ok) {
        return res.status(502).json({ error: 'OpenFoodFacts unreachable', upstream: r.status });
      }
      // canScanLabel tells the client a recovery path exists, instead of the
      // dead end it used to hit ("try the meal-photo scan instead").
      return res.status(404).json({ error: 'Barcode not in database', code, canScanLabel: true });
    }
    const p = json.product;
    const nut = p.nutriments ?? {};
    // OFF returns per-100g values. We pass them through plus the typical
    // serving size if available so the client can show both default-100g
    // and per-serving cards. Energy is in kJ in EU products — fall back to
    // energy-kcal when present.
    const kcalPer100 = num(nut['energy-kcal_100g']) ?? Math.round((num(nut['energy_100g']) ?? 0) / 4.184);
    const servingSize = String(p.serving_size ?? '').trim() || null;
    const servingQtyG = num(p.serving_quantity);
    return res.json({
      code,
      name: p.product_name?.trim() || p.generic_name?.trim() || 'Unknown product',
      brand: p.brands?.split(',')[0]?.trim() || null,
      imageUrl: p.image_front_small_url ?? p.image_front_url ?? null,
      per100g: {
        calories: kcalPer100,
        proteinG: num(nut.proteins_100g) ?? 0,
        carbsG:   num(nut.carbohydrates_100g) ?? 0,
        fatG:     num(nut.fat_100g) ?? 0,
        fiberG:   num(nut.fiber_100g) ?? null,
        sugarG:   num(nut.sugars_100g) ?? null,
        sodiumMg: nut.sodium_100g != null ? Math.round(num(nut.sodium_100g)! * 1000) : null,
        // Full micronutrient set — OFF reports these per 100g in base units
        // (g for minerals-as-grams, so ×1000 → mg; vitamins vary by field).
        saturatedFatG: num(nut['saturated-fat_100g']) ?? null,
        cholesterolMg: nut.cholesterol_100g != null ? Math.round(num(nut.cholesterol_100g)! * 1000) : null,
        ironMg:      nut.iron_100g != null ? Math.round(num(nut.iron_100g)! * 1000 * 10) / 10 : null,
        calciumMg:   nut.calcium_100g != null ? Math.round(num(nut.calcium_100g)! * 1000) : null,
        magnesiumMg: nut.magnesium_100g != null ? Math.round(num(nut.magnesium_100g)! * 1000) : null,
        potassiumMg: nut.potassium_100g != null ? Math.round(num(nut.potassium_100g)! * 1000) : null,
        zincMg:      nut.zinc_100g != null ? Math.round(num(nut.zinc_100g)! * 1000 * 10) / 10 : null,
        vitaminCMg:  nut['vitamin-c_100g'] != null ? Math.round(num(nut['vitamin-c_100g'])! * 1000 * 10) / 10 : null,
        vitaminB12Mcg: nut['vitamin-b12_100g'] != null ? Math.round(num(nut['vitamin-b12_100g'])! * 1e6 * 10) / 10 : null,
        folateMcg:   nut['folates_100g'] != null ? Math.round(num(nut['folates_100g'])! * 1e6) : null,
      },
      servingSize,
      servingQuantityG: servingQtyG,
      source: 'openfoodfacts',
    });
  } catch (err: any) {
    console.error('[nutrition/barcode] lookup failed:', err?.message ?? err);
    return res.status(502).json({ error: 'Lookup failed', message: err?.message });
  }
});
function num(v: unknown): number | null {
  const n = typeof v === 'string' ? parseFloat(v) : (typeof v === 'number' ? v : NaN);
  return Number.isFinite(n) ? n : null;
}

/**
 * Shape a ProductBarcode row like the OpenFoodFacts branch, so the client
 * (and app/barcode-confirm.tsx) needs no branching. Only `source` differs.
 */
function serializeCommunityProduct(row: {
  code: string; name: string; brand: string | null;
  caloriesPer100g: number; proteinG: number; carbsG: number; fatG: number;
  nutrientsJson: string | null; servingSize: string | null; servingQuantityG: number | null;
  verified: boolean;
}) {
  let nutrients: Record<string, number | null> = {};
  try {
    nutrients = row.nutrientsJson ? JSON.parse(row.nutrientsJson) : {};
  } catch { nutrients = {}; }
  return {
    code: row.code,
    name: row.name,
    brand: row.brand,
    imageUrl: null,
    per100g: {
      calories: row.caloriesPer100g,
      proteinG: row.proteinG,
      carbsG: row.carbsG,
      fatG: row.fatG,
      ...nutrients,
    },
    servingSize: row.servingSize,
    servingQuantityG: row.servingQuantityG,
    source: 'community',
    // Surfaced so the client can caption an unreviewed crowd-sourced label.
    verified: row.verified,
  };
}

// POST /api/nutrition/barcode/:code/label — recover from a lookup miss.
// The user photographs the nutrition panel, we read it, and the result is
// cached globally so the next person to scan that product gets it instantly.
// This is the only way to build coverage for products OpenFoodFacts lacks.
router.post('/nutrition/barcode/:code/label', requireAuth, async (req, res) => {
  const code = String(req.params.code ?? '').trim();
  if (!/^[0-9]{6,14}$/.test(code)) {
    return res.status(400).json({ error: 'Invalid barcode format' });
  }
  try {
    const { imageBase64, mimeType } = req.body ?? {};
    if (typeof imageBase64 !== 'string' || !imageBase64 || typeof mimeType !== 'string') {
      return res.status(400).json({ error: 'imageBase64 and mimeType are required' });
    }
    if (!/^image\/(jpeg|jpg|png|webp|heic)$/i.test(mimeType)) {
      return res.status(400).json({ error: 'Unsupported image type' });
    }

    const userId = req.user!.id;
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { tier: true, foodRegion: true },
    });
    if (!user) return res.status(404).json({ error: 'User not found' });

    // A vision call, so it shares the daily meal-logging quota that exists to
    // stop scripted abuse.
    const ok = await consumeMealLoggingQuota(prisma, userId, user.tier, res);
    if (!ok) return;

    const parsed = await parseNutritionLabel(imageBase64, mimeType, normalizeFoodRegion(user.foodRegion));
    if (!parsed || parsed.caloriesPer100g <= 0) {
      return res.status(422).json({ error: "Could not read that label — try a straighter, closer photo of the nutrition panel." });
    }

    const nutrients = Object.fromEntries(
      Object.entries(parsed.nutrients ?? {}).filter(
        ([, v]) => typeof v === 'number' && Number.isFinite(v) && v > 0,
      ),
    );

    const existing = await prisma.productBarcode.findUnique({ where: { code } });
    // A verified row is authoritative and never overwritten by a fresh scan;
    // we only bump the counter so popularity is still visible.
    const freeze = existing?.verified === true;
    const row = await prisma.productBarcode.upsert({
      where: { code },
      create: {
        code,
        name: parsed.name || 'Unknown product',
        brand: parsed.brand || null,
        caloriesPer100g: parsed.caloriesPer100g,
        proteinG: parsed.proteinG,
        carbsG: parsed.carbsG,
        fatG: parsed.fatG,
        nutrientsJson: Object.keys(nutrients).length ? JSON.stringify(nutrients) : null,
        servingSize: parsed.servingSize || null,
        servingQuantityG: parsed.servingQuantityG ?? null,
        contributedByUserId: userId,
      },
      update: freeze
        ? { scanCount: { increment: 1 } }
        : {
            name: parsed.name || existing?.name || 'Unknown product',
            brand: parsed.brand || existing?.brand || null,
            caloriesPer100g: parsed.caloriesPer100g,
            proteinG: parsed.proteinG,
            carbsG: parsed.carbsG,
            fatG: parsed.fatG,
            nutrientsJson: Object.keys(nutrients).length ? JSON.stringify(nutrients) : existing?.nutrientsJson ?? null,
            servingSize: parsed.servingSize || existing?.servingSize || null,
            servingQuantityG: parsed.servingQuantityG ?? existing?.servingQuantityG ?? null,
            scanCount: { increment: 1 },
          },
    });

    return res.status(201).json(serializeCommunityProduct(row));
  } catch (err: any) {
    console.error('[nutrition/barcode/label] parse failed:', err?.message ?? err);
    return res.status(500).json({ error: 'Could not read that label' });
  }
});

// GET /api/nutrition/foods - Saved food library
router.get('/nutrition/foods', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.id;
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? '50'), 10) || 50, 1), 200);

    // Recipes ride along in the same search so the mobile quick-log sheet
    // shows one unified library. Additive key — older clients ignore it.
    const [foods, recipes] = await Promise.all([
      prisma.savedFood.findMany({
        where: {
          userId,
          ...(q
            ? {
                OR: [
                  { name: { contains: q } },
                  { normalizedName: { contains: normalizeFoodName(q) } },
                ],
              }
            : {}),
        },
        orderBy: [{ useCount: 'desc' }, { updatedAt: 'desc' }],
        take: limit,
      }),
      prisma.recipe.findMany({
        where: { userId, ...(q ? { name: { contains: q } } : {}) },
        orderBy: [{ useCount: 'desc' }, { updatedAt: 'desc' }],
        take: limit,
      }),
    ]);

    res.json({
      foods: foods.map((f) => ({
        ...f,
        ingredients: parseJsonArray(f.ingredientsJson),
        tags: parseJsonArray(f.tagsJson),
        nutrients: normalizeMicronutrients(parseJsonObject<Partial<Micronutrients>>(f.nutrientsJson)),
      })),
      recipes: recipes.map((r) => ({
        ...r,
        items: parseJsonObject<unknown[]>(r.itemsJson) ?? [],
        nutrients: normalizeMicronutrients(parseJsonObject<Partial<Micronutrients>>(r.nutrientsJson)),
      })),
    });
  } catch (err: any) {
    console.error('Saved foods fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch saved foods' });
  }
});

// DELETE /api/nutrition/foods/:id - Remove a food from saved library
router.delete('/nutrition/foods/:id', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.id;
    const id = req.params.id;
    const food = await prisma.savedFood.findFirst({ where: { id, userId } });
    if (!food) return res.status(404).json({ error: 'Saved food not found' });
    await prisma.savedFood.delete({ where: { id } });
    res.json({ success: true });
  } catch (err: any) {
    console.error('Saved food delete error:', err);
    res.status(500).json({ error: 'Failed to delete saved food' });
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
    cacheMarkStale(nutritionProfileCacheKey(userId));
    res.json({ success: true });
  } catch (err: any) {
    console.error('Set nutrition targets error:', err);
    res.status(500).json({ error: 'Failed to update targets' });
  }
});

// Partial-update schema for PUT /nutrition/meals/:id — every field is
// optional, only the keys the user actually touched in MealEditSheet are
// sent. We deliberately don't reuse mealEntrySchema (whose defaults would
// blast over existing values).
const mealUpdateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  mealType: z.enum(['breakfast', 'lunch', 'dinner', 'snack', 'meal']).optional(),
  calories: z.number().min(0).max(5000).optional(),
  proteinG: z.number().min(0).max(500).optional(),
  carbsG: z.number().min(0).max(1000).optional(),
  fatG: z.number().min(0).max(500).optional(),
  notes: z.string().max(2000).optional().nullable(),
});

// PUT /api/nutrition/meals/:id - Update a meal entry in place.
// Replaces the mobile MealEditSheet's old delete-then-re-log workaround so
// edits keep the row's id, createdAt, and saved-food backlinks intact.
router.put('/nutrition/meals/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const data = mealUpdateSchema.parse(req.body);
    const userId = req.user!.id;

    const existing = await prisma.mealEntry.findFirst({ where: { id, userId } });
    if (!existing) return res.status(404).json({ error: 'Entry not found' });

    const entry = await prisma.mealEntry.update({
      where: { id },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.mealType !== undefined ? { mealType: data.mealType } : {}),
        ...(data.calories !== undefined ? { calories: data.calories } : {}),
        ...(data.proteinG !== undefined ? { proteinG: data.proteinG } : {}),
        ...(data.carbsG !== undefined ? { carbsG: data.carbsG } : {}),
        ...(data.fatG !== undefined ? { fatG: data.fatG } : {}),
        ...(data.notes !== undefined ? { notes: data.notes } : {}),
      },
    });

    cacheMarkStale(nutritionProfileCacheKey(req.user!.id));
    res.json(entry);
  } catch (err: any) {
    console.error('Meal update error:', err);
    res.status(500).json({ error: 'Failed to update meal' });
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
    cacheMarkStale(nutritionProfileCacheKey(req.user!.id));
    res.json({ success: true });
  } catch (err: any) {
    console.error('Meal delete error:', err);
    res.status(500).json({ error: 'Failed to delete meal' });
  }
});

// POST /api/nutrition/transcribe - Whisper transcription of a voice note.
// Body is base64-encoded audio + the MIME type the recorder used. Returns
// the plain transcript; the mobile client funnels that straight into the
// DescribeSheet's text input.
const transcribeSchema = z.object({
  audioBase64: z.string().min(50),
  mimeType: z.string().min(3).max(60),
});

router.post('/nutrition/transcribe', requireAuth, async (req, res) => {
  // Log every request — without this we can't tell whether a "voice doesn't
  // work" report is a client-never-sent issue, an nginx rejection, or a
  // server-side Whisper failure. Logging only on catch hides the first two.
  const userId = (req as any).user?.id ?? 'anon';
  const bodyLen = req.body?.audioBase64?.length ?? 0;
  const mime = req.body?.mimeType ?? '(none)';
  console.log(`[transcribe] user=${userId} mime=${mime} base64=${bodyLen}b`);
  try {
    const data = transcribeSchema.parse(req.body);
    const text = await transcribeAudio(data.audioBase64, data.mimeType);
    console.log(`[transcribe] ok user=${userId} text.length=${text.length}`);
    res.json({ text });
  } catch (err: any) {
    console.error(`[transcribe] FAILED user=${userId}:`, err?.message ?? err);
    res.status(500).json({ error: err?.message ?? 'Failed to transcribe' });
  }
});

// POST /api/nutrition/suggest-meals - Anakin-ranked meal candidates for today.
// Mobile SuggestSheet calls this on open; the body carries today's remaining
// macros + optional slot pre-filter. Replaces the v1 static template ranker
// the sheet shipped with — we now pass goal/budget context from the user's
// coachProfile so suggestions actually reflect their plan.
const suggestSchema = z.object({
  remaining: z.object({
    kcal:    z.number().min(0).max(10000),
    protein: z.number().min(0).max(500),
    carbs:   z.number().min(0).max(1000),
    fat:     z.number().min(0).max(500),
  }),
  slot: z.enum(['breakfast', 'lunch', 'dinner', 'snack', 'meal']).optional().nullable(),
});

router.post('/nutrition/suggest-meals', requireAuth, async (req, res) => {
  try {
    const data = suggestSchema.parse(req.body);
    // Pull a thin slice of the user's profile so suggestions can lean toward
    // their goal (lean bulk vs cut etc.) without doing a heavyweight join.
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: { coachGoal: true, coachBudget: true },
    });
    const suggestions = await suggestMeals({
      remaining: data.remaining,
      slot: data.slot ?? null,
      goal: user?.coachGoal ?? null,
      budget: user?.coachBudget ?? null,
    });
    res.json({ suggestions });
  } catch (err: any) {
    console.error('Suggest meals error:', err);
    res.status(500).json({ error: 'Failed to generate suggestions' });
  }
});

// POST /api/nutrition/parse-meal - Parse free-text meal description into macros
router.post('/nutrition/parse-meal', requireAuth, async (req, res) => {
  try {
    const { description } = req.body;
    if (!description || typeof description !== 'string' || description.trim().length < 3) {
      return res.status(400).json({ error: 'Please provide a meal description' });
    }
    // Shared daily quota with /analyze-photo. Stops scripted abuse like the
    // Jun 2026 Go-http-client incident (2700 calls / day from one /24).
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: { tier: true, foodRegion: true },
    });
    if (!user) return res.status(404).json({ error: 'User not found' });
    const ok = await consumeMealLoggingQuota(prisma, req.user!.id, user.tier, res);
    if (!ok) return;
    const parsed = await parseMealMacros(description.trim(), normalizeFoodRegion(user.foodRegion));
    const { detail, meta } = await enrichMealDetailHybrid(parsed, { region: normalizeFoodRegion(user.foodRegion) });
    res.json({
      ...detail,
      source: 'text',
      enrichment: meta,
    });
    // Fire an encouraging indulgent-meal push if applicable (non-blocking, after response sent)
    if (isJunkFood(detail.name, detail.tags ?? [], detail.calories)) {
      sendJunkFoodEncouragement(req.user!.id, detail.name, detail.calories).catch(() => {});
    }
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
    const byDate: Record<string, {
      calories: number;
      proteinG: number;
      carbsG: number;
      fatG: number;
      meals: any[];
      micronutrients: Micronutrients;
    }> = {};
    for (const e of entries) {
      if (!byDate[e.date]) {
        byDate[e.date] = {
          calories: 0,
          proteinG: 0,
          carbsG: 0,
          fatG: 0,
          meals: [],
          micronutrients: normalizeMicronutrients(null),
        };
      }
      byDate[e.date].calories += e.calories;
      byDate[e.date].proteinG += e.proteinG;
      byDate[e.date].carbsG += e.carbsG;
      byDate[e.date].fatG += e.fatG;
      const micros = normalizeMicronutrients(parseJsonObject<Partial<Micronutrients>>(e.nutrientsJson));
      byDate[e.date].micronutrients = {
        ...byDate[e.date].micronutrients,
        fiberG: byDate[e.date].micronutrients.fiberG + micros.fiberG,
        sugarG: byDate[e.date].micronutrients.sugarG + micros.sugarG,
        sodiumMg: byDate[e.date].micronutrients.sodiumMg + micros.sodiumMg,
        saturatedFatG: byDate[e.date].micronutrients.saturatedFatG + micros.saturatedFatG,
        cholesterolMg: byDate[e.date].micronutrients.cholesterolMg + micros.cholesterolMg,
        vitaminAIU: byDate[e.date].micronutrients.vitaminAIU + micros.vitaminAIU,
        vitaminCMg: byDate[e.date].micronutrients.vitaminCMg + micros.vitaminCMg,
        vitaminDIU: byDate[e.date].micronutrients.vitaminDIU + micros.vitaminDIU,
        vitaminEMg: byDate[e.date].micronutrients.vitaminEMg + micros.vitaminEMg,
        vitaminB12Mcg: byDate[e.date].micronutrients.vitaminB12Mcg + micros.vitaminB12Mcg,
        folateMcg: byDate[e.date].micronutrients.folateMcg + micros.folateMcg,
        ironMg: byDate[e.date].micronutrients.ironMg + micros.ironMg,
        calciumMg: byDate[e.date].micronutrients.calciumMg + micros.calciumMg,
        magnesiumMg: byDate[e.date].micronutrients.magnesiumMg + micros.magnesiumMg,
        zincMg: byDate[e.date].micronutrients.zincMg + micros.zincMg,
        potassiumMg: byDate[e.date].micronutrients.potassiumMg + micros.potassiumMg,
        omega3G: byDate[e.date].micronutrients.omega3G + micros.omega3G,
        omega6G: byDate[e.date].micronutrients.omega6G + micros.omega6G,
        glycemicIndex: null,
      };
      byDate[e.date].meals.push({
        ...e,
        ingredients: parseJsonArray(e.ingredientsJson),
        tags: parseJsonArray(e.tagsJson),
        nutrients: micros,
      });
    }

    // Merge with manual daily logs
    for (const log of dailyLogs) {
      if (!byDate[log.date]) {
        byDate[log.date] = {
          calories: log.calories || 0,
          proteinG: log.proteinG,
          carbsG: log.carbsG,
          fatG: log.fatG,
          meals: [],
          micronutrients: normalizeMicronutrients(null),
        };
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

router.post('/nutrition/analyze-photo', requireAuth, async (req, res) => {
  try {
    const { imageBase64, mimeType } = photoSchema.parse(req.body);
    const userId = req.user!.id;

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Shared daily quota with /parse-meal so an attacker can't double the
    // limit by bouncing between endpoints.
    const ok = await consumeMealLoggingQuota(prisma, userId, user.tier, res);
    if (!ok) return;

    const parsed = await analyzeMealPhoto(imageBase64, mimeType, normalizeFoodRegion(user.foodRegion));
    const { detail, meta } = await enrichMealDetailHybrid(parsed, { region: normalizeFoodRegion(user.foodRegion) });
    res.json({
      ...detail,
      source: 'photo',
      enrichment: meta,
    });
    // Fire an encouraging indulgent-meal push if applicable (non-blocking, after response sent)
    if (isJunkFood(detail.name, detail.tags ?? [], detail.calories)) {
      sendJunkFoodEncouragement(userId, detail.name, detail.calories).catch(() => {});
    }
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
/**
 * Build the nutrition profile from scratch: 90 days of aggregates, a RAG
 * lookup, and a ~12k-token LLM analysis. Takes tens of seconds — measured at
 * 56s against prod on 2026-08-03 — which is exactly why it must not sit on the
 * request path. Callers go through the cache wrapper below.
 */
async function buildNutritionProfile(userId: string): Promise<Record<string, any>> {
  {
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
          ingredientsJson: true, tagsJson: true, nutrientsJson: true,
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
      return {
        hasData: false,
        message: 'Log at least a few meals to generate your Nutrition Profile.',
      };
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

    // ── Micronutrient + ingredient/tag aggregation (hybrid meal payloads) ──
    const micronutrientTotals = normalizeMicronutrients(null);
    const ingredientFreq = new Map<string, number>();
    const tagFreq = new Map<string, number>();
    let mealsWithNutrientData = 0;

    for (const e of entries) {
      const micros = normalizeMicronutrients(parseJsonObject<Partial<Micronutrients>>(e.nutrientsJson));
      const hasData =
        micros.fiberG > 0 ||
        micros.sodiumMg > 0 ||
        micros.potassiumMg > 0 ||
        micros.vitaminCMg > 0 ||
        micros.ironMg > 0;
      if (hasData) mealsWithNutrientData += 1;

      micronutrientTotals.fiberG += micros.fiberG;
      micronutrientTotals.sugarG += micros.sugarG;
      micronutrientTotals.sodiumMg += micros.sodiumMg;
      micronutrientTotals.saturatedFatG += micros.saturatedFatG;
      micronutrientTotals.cholesterolMg += micros.cholesterolMg;
      micronutrientTotals.vitaminAIU += micros.vitaminAIU;
      micronutrientTotals.vitaminCMg += micros.vitaminCMg;
      micronutrientTotals.vitaminDIU += micros.vitaminDIU;
      micronutrientTotals.vitaminEMg += micros.vitaminEMg;
      micronutrientTotals.vitaminB12Mcg += micros.vitaminB12Mcg;
      micronutrientTotals.folateMcg += micros.folateMcg;
      micronutrientTotals.ironMg += micros.ironMg;
      micronutrientTotals.calciumMg += micros.calciumMg;
      micronutrientTotals.magnesiumMg += micros.magnesiumMg;
      micronutrientTotals.zincMg += micros.zincMg;
      micronutrientTotals.potassiumMg += micros.potassiumMg;
      micronutrientTotals.omega3G += micros.omega3G;
      micronutrientTotals.omega6G += micros.omega6G;

      for (const i of parseJsonArray(e.ingredientsJson).map(v => v.toLowerCase())) {
        ingredientFreq.set(i, (ingredientFreq.get(i) ?? 0) + 1);
      }
      for (const t of parseJsonArray(e.tagsJson).map(v => v.toLowerCase())) {
        tagFreq.set(t, (tagFreq.get(t) ?? 0) + 1);
      }
    }

    const daysForAverage = Math.max(1, dailyMacros.length);
    const micronutrientDailyAverages = {
      fiberG: micronutrientTotals.fiberG / daysForAverage,
      sugarG: micronutrientTotals.sugarG / daysForAverage,
      sodiumMg: micronutrientTotals.sodiumMg / daysForAverage,
      saturatedFatG: micronutrientTotals.saturatedFatG / daysForAverage,
      cholesterolMg: micronutrientTotals.cholesterolMg / daysForAverage,
      vitaminCMg: micronutrientTotals.vitaminCMg / daysForAverage,
      vitaminDIU: micronutrientTotals.vitaminDIU / daysForAverage,
      ironMg: micronutrientTotals.ironMg / daysForAverage,
      calciumMg: micronutrientTotals.calciumMg / daysForAverage,
      magnesiumMg: micronutrientTotals.magnesiumMg / daysForAverage,
      zincMg: micronutrientTotals.zincMg / daysForAverage,
      potassiumMg: micronutrientTotals.potassiumMg / daysForAverage,
      omega3G: micronutrientTotals.omega3G / daysForAverage,
    };

    const micronutrientTargets = {
      fiberG: 30,
      sodiumMg: 2300,
      vitaminCMg: 90,
      vitaminDIU: 600,
      ironMg: 12,
      calciumMg: 1000,
      magnesiumMg: 400,
      zincMg: 11,
      potassiumMg: 3400,
      omega3G: 1.6,
    };

    const micronutrientGapText = [
      `Fiber: ${micronutrientDailyAverages.fiberG.toFixed(1)} g/day (target ~${micronutrientTargets.fiberG}g)`,
      `Sodium: ${micronutrientDailyAverages.sodiumMg.toFixed(0)} mg/day (upper target ~${micronutrientTargets.sodiumMg}mg)`,
      `Vitamin C: ${micronutrientDailyAverages.vitaminCMg.toFixed(1)} mg/day (target ~${micronutrientTargets.vitaminCMg}mg)`,
      `Vitamin D: ${micronutrientDailyAverages.vitaminDIU.toFixed(0)} IU/day (target ~${micronutrientTargets.vitaminDIU} IU)`,
      `Iron: ${micronutrientDailyAverages.ironMg.toFixed(1)} mg/day (target ~${micronutrientTargets.ironMg}mg)`,
      `Calcium: ${micronutrientDailyAverages.calciumMg.toFixed(0)} mg/day (target ~${micronutrientTargets.calciumMg}mg)`,
      `Magnesium: ${micronutrientDailyAverages.magnesiumMg.toFixed(0)} mg/day (target ~${micronutrientTargets.magnesiumMg}mg)`,
      `Zinc: ${micronutrientDailyAverages.zincMg.toFixed(1)} mg/day (target ~${micronutrientTargets.zincMg}mg)`,
      `Potassium: ${micronutrientDailyAverages.potassiumMg.toFixed(0)} mg/day (target ~${micronutrientTargets.potassiumMg}mg)`,
      `Omega-3: ${micronutrientDailyAverages.omega3G.toFixed(2)} g/day (target ~${micronutrientTargets.omega3G}g)`,
    ].join('\n');

    const topIngredients = [...ingredientFreq.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .map(([name, count]) => `${name} (${count})`)
      .join(', ');

    const topTags = [...tagFreq.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([name, count]) => `${name} (${count})`)
      .join(', ');

    // ── Build 14-day meal ledger for per-meal biochemical context ────────
    const since14 = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const ledgerEntries = entries.filter(e => e.date >= since14);
    const mealLedger = ledgerEntries.map(e => {
      const micros = parseJsonObject<Partial<Micronutrients>>(e.nutrientsJson);
      return {
        date: e.date,
        name: e.name,
        type: e.mealType ?? 'meal',
        cal: e.calories,
        p: e.proteinG,
        c: e.carbsG,
        f: e.fatG,
        gi: (micros as any)?.glycemicIndex ?? null,
        gl: (micros as any)?.glycemicLoad ?? null,
        speed: (micros as any)?.digestiveSpeed ?? null,
        effects: (micros as any)?.biochemicalEffects ?? null,
      };
    });
    const mealLedgerText = mealLedger.length > 0
      ? mealLedger.map(m => {
          const parts = [`${m.date} [${m.type}] "${m.name}" — ${m.cal}kcal P:${m.p}g C:${m.c}g F:${m.f}g`];
          if (m.speed) parts.push(`digest:${m.speed}`);
          if (m.gl != null) parts.push(`GL:${m.gl}`);
          if (m.effects?.length) parts.push(`effects:[${m.effects.join(',')}]`);
          return parts.join(' | ');
        }).join('\n')
      : 'No meals logged in the past 14 days.';

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
    const nutritionDataCoveragePct = entries.length > 0
      ? Math.round((mealsWithNutrientData / entries.length) * 100)
      : 0;

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

═══ FOOD COMPOSITION CONTEXT (HYBRID LLM + USDA ENRICHMENT) ═══
Meals with nutrient composition data: ${mealsWithNutrientData}/${entries.length} (${nutritionDataCoveragePct}% coverage)
Frequent food ingredients: ${topIngredients || 'not enough ingredient data'}
Frequent meal tags: ${topTags || 'not enough tag data'}

Estimated micronutrient averages (last ${daysForAverage} logged days):
${micronutrientGapText}

═══ 14-DAY MEAL LEDGER (per-meal biochemical context) ═══
Each entry: date [type] "name" — macros | digestive speed | glycemic load | biochemical effects
${mealLedgerText}

IMPORTANT: When writing the 4 domain analyses below, you MUST reference specific meal names from the ledger above. Do not write generic advice — tie observations directly to what this user actually ate (e.g. "Your repeated consumption of X is contributing to Y because...").
Use nutrient data as directional evidence, not medical diagnosis.

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

  "biochemicalDomains": {
    "energyGlucose": {
      "headline": <one sentence summarizing this user's glucose/energy pattern based on their meals>,
      "detail": <3-4 sentences referencing specific meals from the ledger — cite meal names, their glycemic load/speed, and how they create or disrupt energy patterns. E.g. "Your frequent consumption of [meal name] (GL:[x], fast-digesting) is causing mid-afternoon blood sugar drops...">
    },
    "recoveryInflammation": {
      "headline": <one sentence on recovery/inflammation status>,
      "detail": <3-4 sentences referencing specific meals — cite anti-inflammatory or pro-inflammatory effects from the ledger. E.g. "Meals like [name] tagged with pro-inflammatory effects appear [X] times this week — this can blunt muscle repair...">
    },
    "cognitiveMood": {
      "headline": <one sentence on cognitive fuel and mood support>,
      "detail": <3-4 sentences referencing specific meals — cite dopamine-precursor, serotonin-precursor, cognitive-boost effects from ledger. Explain how meal timing and food choices affect focus and mood.>
    },
    "bodyCompositionHormones": {
      "headline": <one sentence on body composition and hormonal support>,
      "detail": <3-4 sentences referencing specific meals — cite testosterone-support, muscle-protein-synthesis, fat intake, and how the pattern across the 14-day ledger is impacting body composition goals.>
    }
  },

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

    const completion = await chatComplete({
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      temperature: 0.2,
      max_completion_tokens: 12000,
    });

    const finishReason = completion.choices[0].finish_reason;
    const rawContent = completion.choices[0].message.content || '{}';

    let aiAnalysis: any = {};
    try {
      aiAnalysis = JSON.parse(rawContent);
      if (finishReason === 'length') {
        console.warn(`[nutrition/profile] LLM response truncated for user ${userId} — response length: ${rawContent.length} chars. Consider reducing prompt size.`);
      }
    } catch (parseErr) {
      console.error(`[nutrition/profile] JSON parse failed for user ${userId}. finish_reason=${finishReason}, content_length=${rawContent.length}, preview=${rawContent.slice(0, 200)}`);
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
        nutritionDataCoveragePct,
        micronutrients: micronutrientDailyAverages,
        topIngredients: [...ingredientFreq.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 8)
          .map(([name, count]) => ({ name, count })),
        topTags: [...tagFreq.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 8)
          .map(([name, count]) => ({ name, count })),
        ruleFlags: rulesOutput.flags.map(f => ({
          id: f.id, severity: f.severity, category: f.category, title: f.title,
        })),
      },
      analysis: aiAnalysis,
    };

    cacheSet(nutritionProfileCacheKey(userId), responsePayload, NUTRITION_PROFILE_TTL);
    return responsePayload;
  }
}

/**
 * In-flight background rebuilds, keyed by user, so a burst of requests for the
 * same stale profile triggers exactly one recompute rather than N concurrent
 * 12k-token LLM calls on a 3.7 GB box.
 */
const profileRebuilds = new Set<string>();

function refreshProfileInBackground(userId: string): void {
  if (profileRebuilds.has(userId)) return;
  profileRebuilds.add(userId);
  void buildNutritionProfile(userId)
    .catch(err => console.error(`[nutrition/profile] background rebuild failed for ${userId}:`, err?.message ?? err))
    .finally(() => profileRebuilds.delete(userId));
}

// GET /api/nutrition/profile — stale-while-revalidate.
//
// Previously every meal log deleted this cache entry, so the next person to
// open the Nutrition tab personally waited out a ~56s LLM generation with no
// client timeout to break it. Now a stale entry is served immediately and
// refreshed behind the response; only a user with no cached profile at all
// (genuinely first ever view) waits for a live build.
router.get('/nutrition/profile', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.id;
    const forceRefresh = req.query.refresh === '1';
    const key = nutritionProfileCacheKey(userId);

    if (!forceRefresh) {
      const cached = cacheGetWithMeta<Record<string, any>>(key);
      if (cached) {
        if (cached.stale) refreshProfileInBackground(userId);
        return res.json({ ...cached.data, stale: cached.stale || undefined });
      }
    }

    return res.json(await buildNutritionProfile(userId));
  } catch (err: any) {
    console.error('Nutrition profile error:', err);
    res.status(500).json({ error: err?.message ?? 'Failed to generate nutrition profile' });
  }
});

export default router;
