// One write path for meal entries — shared by the /nutrition/meals routes and
// Anakin's chat tools, so a meal logged in chat also upserts the saved-food
// library, marks the nutrition profile stale, logs activity and advances the
// nutrition streak, exactly like one logged in the app.

import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { cacheMarkStale } from './cacheService.js';
import type { Micronutrients } from './llmService.js';
import { logActivity } from './activityService.js';
import { nutritionProfileCacheKey, normalizeFoodName, updateNutritionStreakInBackground } from './nutritionShared.js';
import { descriptiveLabel, KNOWN_MEAL_SOURCES, KNOWN_PARSE_CONFIDENCE } from '../validation/descriptiveLabel.js';
import { normalizeMicronutrients } from './nutritionEnrichmentService.js';

const prisma = new PrismaClient();

// Clamp an estimated nutrient value into [0, max] instead of rejecting it.
// NaN/Infinity still reject (finite()) — those indicate a broken payload, not
// an over-eager estimate.
const clampedEstimate = (max: number) =>
  z.number().finite().optional()
    .transform((v) => (v == null ? v : Math.min(Math.max(v, 0), max)));

// Exported for schema-level tests (clamping behavior).
export const mealEntrySchema = z.object({
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
  // Micronutrients are scan/LLM ESTIMATES, not user assertions. An implausible
  // estimate (a salty takeout scan came back sodiumMg > 20000 on 2026-08-28 and
  // 400'd the whole meal four times) must never reject the log — clamp into the
  // plausible range instead. Same philosophy as descriptiveLabel below.
  nutrients: z.object({
    fiberG: clampedEstimate(500),
    sugarG: clampedEstimate(500),
    sodiumMg: clampedEstimate(20000),
    saturatedFatG: clampedEstimate(500),
    cholesterolMg: clampedEstimate(5000),
    vitaminAIU: clampedEstimate(200000),
    vitaminCMg: clampedEstimate(5000),
    vitaminDIU: clampedEstimate(10000),
    vitaminEMg: clampedEstimate(2000),
    vitaminB12Mcg: clampedEstimate(5000),
    folateMcg: clampedEstimate(10000),
    ironMg: clampedEstimate(200),
    calciumMg: clampedEstimate(5000),
    magnesiumMg: clampedEstimate(3000),
    zincMg: clampedEstimate(300),
    potassiumMg: clampedEstimate(10000),
    omega3G: clampedEstimate(200),
    omega6G: clampedEstimate(300),
    glycemicIndex: z.number().finite().nullable().optional()
      .transform((v) => (v == null ? v : Math.min(Math.max(v, 0), 150))),
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
export function deriveNutrientMap(
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

export type MealEntryInput = z.input<typeof mealEntrySchema>;

/** Log a meal with every side effect the app has. Throws ZodError on bad input. */
export async function createMealEntry(userId: string, input: MealEntryInput) {
    const data = mealEntrySchema.parse(input);
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
      return { entry, ingredients, tags, nutrients };
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
    return { entry, ingredients, tags, nutrients };
}

export const mealUpdateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  mealType: z.enum(['breakfast', 'lunch', 'dinner', 'snack', 'meal']).optional(),
  calories: z.number().min(0).max(5000).optional(),
  proteinG: z.number().min(0).max(500).optional(),
  carbsG: z.number().min(0).max(1000).optional(),
  fatG: z.number().min(0).max(500).optional(),
  notes: z.string().max(2000).optional().nullable(),
  // Chat can also move a meal to another day.
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
export type MealUpdate = z.infer<typeof mealUpdateSchema>;

/** Edit a meal in place. Returns { before, entry } or null when it isn't the user's. */
export async function updateMealEntry(userId: string, id: string, patch: MealUpdate) {
  const data = mealUpdateSchema.parse(patch);
  const existing = await prisma.mealEntry.findFirst({ where: { id, userId } });
  if (!existing) return null;
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
      ...(data.date !== undefined ? { date: data.date } : {}),
    },
  });
  cacheMarkStale(nutritionProfileCacheKey(userId));
  return { before: existing, entry };
}

/** Delete a meal; returns the deleted row (kept for undo) or null. */
export async function deleteMealEntry(userId: string, id: string) {
  const entry = await prisma.mealEntry.findFirst({ where: { id, userId } });
  if (!entry) return null;
  await prisma.mealEntry.delete({ where: { id } });
  cacheMarkStale(nutritionProfileCacheKey(userId));
  return entry;
}

/** Put a deleted meal back with its original id (undo). */
export async function restoreMealEntry(userId: string, row: any) {
  if (!row || row.userId !== userId) throw new Error('Nothing to restore.');
  const exists = await prisma.mealEntry.findUnique({ where: { id: row.id } });
  if (exists) return exists;
  const { id, userId: _u, createdAt, updatedAt, ...rest } = row;
  const restored = await prisma.mealEntry.create({ data: { ...rest, id, userId, ...(createdAt ? { createdAt: new Date(createdAt) } : {}) } });
  cacheMarkStale(nutritionProfileCacheKey(userId));
  return restored;
}
