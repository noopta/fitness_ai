// Meal-photo v2: prompt, Vertex response schema and response coercion.
//
// Kept out of llmService.ts so the pure parts (prompt text, schema shape,
// coercion of whatever the model sends back) are testable without mocking
// the OpenAI/Vertex clients that module constructs at import time.
//
// The design point that matters: the model lists ITEMS and never writes meal
// totals. Totals summed by the model drift between retakes of the same plate
// (it re-guesses the whole meal each time); per-item grams × a fixed database
// profile, summed server-side, does not. The model's own per-item macros are
// kept only as a fallback for items USDA can't price.

import type { Schema } from '@google/genai';
import { regionPromptBlock, type FoodRegion } from '../prompts/regionPrompts.js';

export const MAX_MEAL_PHOTOS = 3;

export type ItemVisibility = 'full' | 'partial' | 'inferred';

/** One item as the model reports it, after coercion. */
export interface RawPhotoItem {
  name: string;
  usdaQuery: string;
  preparation: string | null;
  grams: number | null;
  visibility: ItemVisibility | string;
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
}

export interface MealPhotoV2Raw {
  items: RawPhotoItem[];
  framingWarning: string | null;
  noFoodDetected: boolean;
  mealType: 'breakfast' | 'lunch' | 'dinner' | 'snack' | 'meal';
  name: string;
  confidence: 'high' | 'medium' | 'low';
  notes: string;
  tags: string[];
  plants: string[];
  fermentedFoods: string[];
  ultraProcessed: boolean;
}

/** What the client sends back on "add photo" — only name + grams are read. */
export interface ExistingItemRef {
  id: string | null;
  name: string;
  grams: number | null;
}

// Vertex OpenAPI-subset schema. Literal type names rather than the SDK's
// `Type` enum so this module stays import-safe under the test mocks of
// @google/genai (which only stub the client constructor).
const S = (s: Record<string, unknown>) => s as unknown as Schema;

const ITEM_SCHEMA = S({
  type: 'OBJECT',
  required: ['name', 'usdaQuery', 'grams', 'visibility', 'calories', 'proteinG', 'carbsG', 'fatG'],
  propertyOrdering: ['name', 'usdaQuery', 'preparation', 'grams', 'visibility', 'calories', 'proteinG', 'carbsG', 'fatG'],
  properties: {
    name: { type: 'STRING', description: 'Short display name, e.g. "Fried egg".' },
    usdaQuery: { type: 'STRING', description: 'Plain USDA FoodData Central search phrase, e.g. "egg, whole, fried".' },
    preparation: { type: 'STRING', nullable: true, description: 'raw, grilled, fried, sauteed, boiled, baked, roasted, steamed… or null.' },
    grams: { type: 'NUMBER', nullable: true, description: 'Estimated edible weight in grams; null only if truly unknowable.' },
    visibility: { type: 'STRING', description: 'full | partial | inferred' },
    calories: { type: 'NUMBER' },
    proteinG: { type: 'NUMBER' },
    carbsG: { type: 'NUMBER' },
    fatG: { type: 'NUMBER' },
  },
});

export const MEAL_PHOTO_V2_SCHEMA: Schema = S({
  type: 'OBJECT',
  required: ['items', 'framingWarning', 'noFoodDetected', 'mealType', 'name', 'confidence'],
  // Items FIRST: the model enumerates before it names or summarises, and a
  // truncated response still carries the part that matters.
  propertyOrdering: [
    'items', 'framingWarning', 'noFoodDetected', 'mealType', 'name', 'confidence', 'notes',
    'tags', 'plants', 'fermentedFoods', 'ultraProcessed',
  ],
  properties: {
    items: { type: 'ARRAY', items: ITEM_SCHEMA },
    framingWarning: { type: 'STRING', nullable: true },
    noFoodDetected: { type: 'BOOLEAN' },
    mealType: { type: 'STRING', description: 'breakfast | lunch | dinner | snack | meal' },
    name: { type: 'STRING' },
    confidence: { type: 'STRING', description: 'high | medium | low' },
    notes: { type: 'STRING' },
    tags: { type: 'ARRAY', items: { type: 'STRING' } },
    plants: { type: 'ARRAY', items: { type: 'STRING' } },
    fermentedFoods: { type: 'ARRAY', items: { type: 'STRING' } },
    ultraProcessed: { type: 'BOOLEAN' },
  },
});

export function buildMealPhotoV2Prompt(opts: {
  imageCount: number;
  existingItems?: ExistingItemRef[];
  region?: FoodRegion;
}): string {
  const n = Math.max(1, opts.imageCount);
  const existing = opts.existingItems ?? [];

  const photos = n > 1
    ? `You are given ${n} photos of ONE meal (different angles or a closer shot). Each physical item appears ONCE in your list even if it is visible in several photos — use the extra angles to see hidden items and judge portion size, never to count an item twice.`
    : 'You are given one photo of a meal.';

  const already = existing.length
    ? `\nALREADY LOGGED — the user has these items from an earlier photo of the same meal:\n${existing
        .map((e) => `- ${e.name}${e.grams != null ? ` (~${Math.round(e.grams)} g)` : ''}`)
        .join('\n')}\nReturn ONLY items that are NOT in that list. Do not re-list them under a different name or split them into parts. If nothing new is visible, return "items": [].\n`
    : '';

  return `You are a registered dietitian itemising a meal from photos so each item can be priced against the USDA database.

${photos}
${already}
LIST EVERY ITEM SEPARATELY. Be exhaustive — a missed item is the worst error. Explicitly look for:
- items partially hidden under or behind others, and stacked/layered foods (rice under curry, cheese inside a sandwich, toppings)
- side bowls, cups, ramekins and second plates anywhere in frame
- spreads, sauces, dressings and condiments (butter, mayo, ketchup, oil drizzle, gravy, salad dressing)
- cooking fat: if food looks fried, sautéed or pan-cooked, add a separate "cooking oil" (or butter) item with your gram estimate, visibility "inferred"
- drinks: include any caloric drink (juice, milk, soda, alcohol, latte). SKIP water, black coffee/tea, and diet soda.

PER ITEM:
- name: short display name
- usdaQuery: how a USDA FoodData Central entry would describe it (generic food, not a brand), e.g. "chicken breast, grilled", "rice, white, cooked", "oil, olive"
- preparation: raw/grilled/fried/sautéed/boiled/baked/roasted/steamed, or null
- grams: edible weight estimate using plate (~26 cm dinner plate), utensils, hands and packaging for scale. Give a number whenever you can.
- visibility: "full" (clearly visible), "partial" (cut off, covered or partly hidden), "inferred" (not visible but almost certainly present, e.g. cooking oil)
- calories/proteinG/carbsG/fatG: your own estimate for THAT item at that weight (used only as a fallback)

DO NOT write meal totals anywhere — totals are computed from the items.

TOP LEVEL:
- framingWarning: if any food or dish is cut off at the edge of the frame, say where in one short sentence (e.g. "A bowl is cut off at the left edge — add a photo?"); otherwise null
- noFoodDetected: true only if no food or caloric drink is visible at all (then items is [])
- mealType: breakfast, lunch, dinner, snack, or meal
- name: short meal name, e.g. "Grilled chicken with rice and broccoli"
- confidence: "low" if the photo is blurry, dark, heavily obscured or the items are unusual
- notes: one sentence on what you assumed (portion cues, hidden items)
- tags: e.g. "high-protein", "fried", "whole-food"
- plants: distinct plant species as singular lowercase names (vegetables, fruits, whole grains, legumes, nuts, seeds, herbs, spices); refined flour/sugar/oils do not count
- fermentedFoods: live-culture fermented items present, else []
- ultraProcessed: true only if the meal is predominantly ultra-processed
${regionPromptBlock(opts.region ?? 'global', 'photo')}`;
}

// ── Coercion ──────────────────────────────────────────────────────────────

const VISIBILITY = new Set(['full', 'partial', 'inferred']);

/**
 * Descriptive field: never a gate. Known values pass, a plausible new label
 * from a newer model passes as-is, anything else degrades to 'full'.
 */
export function coerceVisibility(v: unknown): ItemVisibility | string {
  if (typeof v !== 'string') return 'full';
  const s = v.trim().toLowerCase();
  if (VISIBILITY.has(s)) return s as ItemVisibility;
  if (s === 'hidden' || s === 'assumed' || s === 'implied') return 'inferred';
  if (s === 'cut off' || s === 'cutoff' || s === 'obscured' || s === 'partially visible') return 'partial';
  return /^[a-z][a-z _-]{0,23}$/.test(s) ? s : 'full';
}

/** Free-text label; trimmed and bounded, never rejected. */
export function coercePreparation(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim().toLowerCase().slice(0, 40);
  return s && s !== 'null' && s !== 'none' && s !== 'n/a' ? s : null;
}

function num(v: unknown, max: number): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(max, n);
}

function gramsOf(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.min(3000, n);
}

function strList(v: unknown, max = 20): string[] {
  return Array.isArray(v)
    ? v.map((s) => String(s).trim().slice(0, 60)).filter(Boolean).slice(0, max)
    : [];
}

export function coerceRawItem(raw: any): RawPhotoItem | null {
  const name = typeof raw?.name === 'string' ? raw.name.trim().slice(0, 120) : '';
  if (!name) return null;
  const usdaQuery = typeof raw?.usdaQuery === 'string' && raw.usdaQuery.trim()
    ? raw.usdaQuery.trim().slice(0, 120)
    : name;
  return {
    name,
    usdaQuery,
    preparation: coercePreparation(raw?.preparation),
    grams: gramsOf(raw?.grams),
    visibility: coerceVisibility(raw?.visibility),
    calories: num(raw?.calories, 5000),
    proteinG: num(raw?.proteinG, 500),
    carbsG: num(raw?.carbsG, 1000),
    fatG: num(raw?.fatG, 500),
  };
}

export function coerceMealPhotoV2Response(raw: any): MealPhotoV2Raw {
  const items = Array.isArray(raw?.items)
    ? raw.items.map(coerceRawItem).filter((x: RawPhotoItem | null): x is RawPhotoItem => !!x).slice(0, 25)
    : [];
  const mealType = ['breakfast', 'lunch', 'dinner', 'snack'].includes(raw?.mealType) ? raw.mealType : 'meal';
  const confidence = ['high', 'medium', 'low'].includes(raw?.confidence) ? raw.confidence : 'medium';
  const framing = typeof raw?.framingWarning === 'string' ? raw.framingWarning.trim().slice(0, 200) : '';
  return {
    items,
    framingWarning: framing && framing.toLowerCase() !== 'null' ? framing : null,
    // An empty item list with the flag unset still reads as "no food".
    noFoodDetected: raw?.noFoodDetected === true || items.length === 0,
    mealType,
    name: typeof raw?.name === 'string' && raw.name.trim() ? raw.name.trim().slice(0, 120) : (items[0]?.name ?? 'Meal'),
    confidence,
    notes: typeof raw?.notes === 'string' ? raw.notes.slice(0, 500) : '',
    tags: strList(raw?.tags, 10),
    plants: strList(raw?.plants, 30).map((s) => s.toLowerCase()),
    fermentedFoods: strList(raw?.fermentedFoods, 10),
    ultraProcessed: raw?.ultraProcessed === true,
  };
}

/** Lenient read of the client's existingItems: anything without a name is dropped. */
export function coerceExistingItems(raw: unknown): ExistingItemRef[] {
  if (!Array.isArray(raw)) return [];
  const out: ExistingItemRef[] = [];
  for (const it of raw.slice(0, 40)) {
    const name = typeof (it as any)?.name === 'string' ? (it as any).name.trim().slice(0, 120) : '';
    if (!name) continue;
    const id = typeof (it as any)?.id === 'string' ? (it as any).id.slice(0, 64) : null;
    out.push({ id, name, grams: gramsOf((it as any)?.grams) });
  }
  return out;
}
