// Recipe library — MyFitnessPal-style saved recipes. A recipe is a named dish
// built from N free-text ingredients plus a servings count; the model stores
// denormalized PER-SERVING macros (sum of ingredient totals ÷ servings).
// Logging a recipe snapshots servings × per-serving macros into a normal
// MealEntry (source 'recipe'), so streaks/rings/history work untouched and
// editing a recipe never rewrites past logs.
//
// Lives in its own router (not nutrition.ts) so tests don't have to drag in
// that module's OpenAI-at-import-time constructor and engine imports.

import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { requireAuth } from '../middleware/requireAuth.js';
import { cacheDelete } from '../services/cacheService.js';
import { logActivity } from '../services/activityService.js';
import { parseRecipeIngredients } from '../services/llmService.js';
import { normalizeMicronutrients } from '../services/nutritionEnrichmentService.js';
import type { Micronutrients } from '../services/llmService.js';
import {
  nutritionProfileCacheKey,
  parseJsonObject,
  consumeMealLoggingQuota,
  updateNutritionStreakInBackground,
} from '../services/nutritionShared.js';

const router = Router();
const prisma = new PrismaClient();

const recipeItemSchema = z.object({
  name: z.string().min(1).max(120),
  // Free text ("2 lbs", "1 can (400g)") — there's no canonical food DB to key
  // against, so quantities are display-only.
  quantity: z.string().max(60).optional().default(''),
  // Whole-recipe macro contribution of this ingredient (NOT per serving).
  calories: z.number().min(0).max(20000).optional().default(0),
  proteinG: z.number().min(0).max(2000).optional().default(0),
  carbsG: z.number().min(0).max(4000).optional().default(0),
  fatG: z.number().min(0).max(2000).optional().default(0),
});

const recipeSchema = z.object({
  name: z.string().min(1).max(200),
  servings: z.number().min(0.5).max(100),
  items: z.array(recipeItemSchema).min(1).max(40),
  // Optional whole-recipe micros (from LLM parse); stored per-serving.
  nutrients: z.record(z.string(), z.unknown()).optional(),
});

type RecipeItem = z.infer<typeof recipeItemSchema>;

const round1 = (n: number) => Math.round(n * 10) / 10;

// Sum ingredient totals and divide by servings → the denormalized per-serving
// columns. Done server-side so client math bugs can't corrupt the library.
function perServingTotals(items: RecipeItem[], servings: number) {
  const total = items.reduce(
    (acc, item) => ({
      calories: acc.calories + item.calories,
      proteinG: acc.proteinG + item.proteinG,
      carbsG: acc.carbsG + item.carbsG,
      fatG: acc.fatG + item.fatG,
    }),
    { calories: 0, proteinG: 0, carbsG: 0, fatG: 0 },
  );
  return {
    calories: round1(total.calories / servings),
    proteinG: round1(total.proteinG / servings),
    carbsG: round1(total.carbsG / servings),
    fatG: round1(total.fatG / servings),
  };
}

// Divide whole-recipe micros by servings, dropping non-numeric fields
// (digestiveSpeed etc. don't scale — normalizeMicronutrients re-defaults them).
function perServingNutrients(nutrients: Record<string, unknown> | undefined, servings: number): string | null {
  if (!nutrients) return null;
  const scaled: Record<string, number> = {};
  for (const [key, value] of Object.entries(nutrients)) {
    if (typeof value === 'number' && Number.isFinite(value)) scaled[key] = round1(value / servings);
  }
  return Object.keys(scaled).length > 0 ? JSON.stringify(scaled) : null;
}

function serializeRecipe(r: {
  itemsJson: string;
  nutrientsJson: string | null;
  [key: string]: unknown;
}) {
  return {
    ...r,
    items: parseJsonObject<RecipeItem[]>(r.itemsJson) ?? [],
    nutrients: normalizeMicronutrients(parseJsonObject<Partial<Micronutrients>>(r.nutrientsJson)),
  };
}

// GET /api/nutrition/recipes?q= — the user's recipe library
router.get('/nutrition/recipes', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.id;
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? '50'), 10) || 50, 1), 200);
    const recipes = await prisma.recipe.findMany({
      where: { userId, ...(q ? { name: { contains: q } } : {}) },
      orderBy: [{ useCount: 'desc' }, { updatedAt: 'desc' }],
      take: limit,
    });
    res.json({ recipes: recipes.map(serializeRecipe) });
  } catch (err) {
    console.error('Recipe list error:', err);
    res.status(500).json({ error: 'Failed to fetch recipes' });
  }
});

// POST /api/nutrition/recipes — create a recipe
router.post('/nutrition/recipes', requireAuth, async (req, res) => {
  try {
    const data = recipeSchema.parse(req.body);
    const userId = req.user!.id;
    const recipe = await prisma.recipe.create({
      data: {
        userId,
        name: data.name.trim(),
        servings: data.servings,
        itemsJson: JSON.stringify(data.items),
        ...perServingTotals(data.items, data.servings),
        nutrientsJson: perServingNutrients(data.nutrients, data.servings),
      },
    });
    res.status(201).json(serializeRecipe(recipe));
  } catch (err: any) {
    if (err?.name === 'ZodError') return res.status(400).json({ error: 'Invalid recipe' });
    console.error('Recipe create error:', err);
    res.status(500).json({ error: 'Failed to save recipe' });
  }
});

// PUT /api/nutrition/recipes/:id — full update (builder always sends the whole
// recipe). Past MealEntry snapshots are untouched by design.
router.put('/nutrition/recipes/:id', requireAuth, async (req, res) => {
  try {
    const data = recipeSchema.parse(req.body);
    const userId = req.user!.id;
    const existing = await prisma.recipe.findFirst({ where: { id: req.params.id, userId } });
    if (!existing) return res.status(404).json({ error: 'Recipe not found' });
    const recipe = await prisma.recipe.update({
      where: { id: existing.id },
      data: {
        name: data.name.trim(),
        servings: data.servings,
        itemsJson: JSON.stringify(data.items),
        ...perServingTotals(data.items, data.servings),
        nutrientsJson: perServingNutrients(data.nutrients, data.servings),
      },
    });
    res.json(serializeRecipe(recipe));
  } catch (err: any) {
    if (err?.name === 'ZodError') return res.status(400).json({ error: 'Invalid recipe' });
    console.error('Recipe update error:', err);
    res.status(500).json({ error: 'Failed to update recipe' });
  }
});

// DELETE /api/nutrition/recipes/:id — MealEntry.recipeId is SetNull, so log
// history survives deletion.
router.delete('/nutrition/recipes/:id', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.id;
    const existing = await prisma.recipe.findFirst({ where: { id: req.params.id, userId } });
    if (!existing) return res.status(404).json({ error: 'Recipe not found' });
    await prisma.recipe.delete({ where: { id: existing.id } });
    res.json({ success: true });
  } catch (err) {
    console.error('Recipe delete error:', err);
    res.status(500).json({ error: 'Failed to delete recipe' });
  }
});

const logRecipeSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  mealType: z.enum(['breakfast', 'lunch', 'dinner', 'snack', 'meal']).default('meal'),
  servings: z.number().min(0.1).max(20).default(1),
});

// POST /api/nutrition/recipes/:id/log — snapshot servings × per-serving macros
// into a MealEntry. Server-side multiply keeps the math canonical.
router.post('/nutrition/recipes/:id/log', requireAuth, async (req, res) => {
  try {
    const data = logRecipeSchema.parse(req.body);
    const userId = req.user!.id;
    const recipe = await prisma.recipe.findFirst({ where: { id: req.params.id, userId } });
    if (!recipe) return res.status(404).json({ error: 'Recipe not found' });

    const items = parseJsonObject<RecipeItem[]>(recipe.itemsJson) ?? [];
    const micros = parseJsonObject<Record<string, number>>(recipe.nutrientsJson);
    const scaledMicros: Record<string, number> = {};
    if (micros) {
      for (const [key, value] of Object.entries(micros)) {
        if (typeof value === 'number' && Number.isFinite(value)) scaledMicros[key] = round1(value * data.servings);
      }
    }

    const [entry] = await prisma.$transaction([
      prisma.mealEntry.create({
        data: {
          userId,
          date: data.date,
          name: recipe.name,
          mealType: data.mealType,
          calories: round1(recipe.calories * data.servings),
          proteinG: round1(recipe.proteinG * data.servings),
          carbsG: round1(recipe.carbsG * data.servings),
          fatG: round1(recipe.fatG * data.servings),
          ingredientsJson: items.length > 0 ? JSON.stringify(items.map((i) => i.name)) : null,
          nutrientsJson: Object.keys(scaledMicros).length > 0 ? JSON.stringify(scaledMicros) : null,
          source: 'recipe',
          recipeId: recipe.id,
          servings: data.servings,
        },
      }),
      prisma.recipe.update({ where: { id: recipe.id }, data: { useCount: { increment: 1 } } }),
    ]);

    cacheDelete(nutritionProfileCacheKey(userId));
    logActivity(userId, 'nutrition').catch(() => {});
    updateNutritionStreakInBackground(prisma, userId, data.date);
    res.status(201).json({
      ...entry,
      ingredients: items.map((i) => i.name),
      nutrients: normalizeMicronutrients(scaledMicros as Partial<Micronutrients>),
    });
  } catch (err: any) {
    if (err?.name === 'ZodError') return res.status(400).json({ error: 'Invalid request' });
    console.error('Recipe log error:', err);
    res.status(500).json({ error: 'Failed to log recipe' });
  }
});

const parseRecipeSchema = z.object({
  description: z.string().min(3).max(8000),
  servings: z.number().min(0.5).max(100).optional(),
});

// POST /api/nutrition/recipes/parse — LLM: free-text recipe → structured
// ingredient list with per-ingredient macros. The client shows the result in
// the builder for review/edits before POST /nutrition/recipes saves it.
// Shares the free-tier daily AI quota with /parse-meal and /analyze-photo.
router.post('/nutrition/recipes/parse', requireAuth, async (req, res) => {
  try {
    const data = parseRecipeSchema.parse(req.body);
    const userId = req.user!.id;
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { tier: true } });
    if (!user) return res.status(404).json({ error: 'User not found' });
    const ok = await consumeMealLoggingQuota(prisma, userId, user.tier, res);
    if (!ok) return;
    const parsed = await parseRecipeIngredients(data.description.trim(), data.servings);
    res.json(parsed);
  } catch (err: any) {
    if (err?.name === 'ZodError') return res.status(400).json({ error: 'Please provide a recipe description' });
    console.error('Recipe parse error:', err);
    res.status(500).json({ error: 'Failed to analyze recipe' });
  }
});

export default router;
