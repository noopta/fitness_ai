// Food logging + recipes (catalog NUT-01…14, RCP-01…05). Meals go through
// the shared meal service (saved-food library, nutrition streak, activity),
// so a meal logged in chat is identical to one logged in Fuel.

import { registerToolkit } from '../registry.js';
import { defineOp, executeOp, UNDO_DELETE_MS } from '../ops.js';
import { callApi } from '../loopback.js';
import { tool, schema, str, numOr, prisma, parseJson } from './kit.js';
import { createMealEntry, updateMealEntry, deleteMealEntry, restoreMealEntry } from '../../services/mealLogService.js';
import { parseMealMacros } from '../../services/llmService.js';
import { dayLabel, num, plural, clockTime } from '../cards/format.js';
import type { CardDraft, CardRow } from '../cards/types.js';
import type { ToolCtx } from '../types.js';

type Slot = 'breakfast' | 'lunch' | 'dinner' | 'snack' | 'meal';
const SLOTS: Slot[] = ['breakfast', 'lunch', 'dinner', 'snack', 'meal'];
const slotOf = (v: unknown, tz: string): Slot => {
  const s = str(v).toLowerCase();
  if ((SLOTS as string[]).includes(s)) return s as Slot;
  const h = Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: tz }).format(new Date()));
  return h < 10 ? 'breakfast' : h < 15 ? 'lunch' : h < 17 ? 'snack' : h < 22 ? 'dinner' : 'snack';
};
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// ── Day totals vs targets (the program's macros are the app's source of truth) ─
export async function dayNutrition(userId: string, date: string) {
  const [meals, u, workouts] = await Promise.all([
    prisma.mealEntry.findMany({ where: { userId, date }, orderBy: { createdAt: 'asc' }, select: { id: true, name: true, mealType: true, calories: true, proteinG: true, carbsG: true, fatG: true, createdAt: true, servings: true } }),
    prisma.user.findUnique({ where: { id: userId }, select: { savedProgram: true, subtractWorkoutBurnFromCalories: true } }),
    prisma.workoutLog.findMany({ where: { userId, date }, select: { caloriesBurnedKcal: true } }),
  ]);
  const plan = parseJson<any>(u?.savedProgram, null)?.nutritionPlan;
  const macros = plan?.macros ?? null;
  const burn = workouts.reduce((n, w) => n + (w.caloriesBurnedKcal ?? 0), 0);
  const addBurn = u?.subtractWorkoutBurnFromCalories !== false;
  const target = macros ? {
    calories: Math.round((Number(macros.calories) || 0) + (addBurn ? burn : 0)), baseCalories: Math.round(Number(macros.calories) || 0),
    proteinG: Math.round(Number(macros.proteinG) || 0), carbsG: Math.round(Number(macros.carbsG) || 0), fatG: Math.round(Number(macros.fatG) || 0),
  } : null;
  const totals = meals.reduce((a, m) => ({ calories: a.calories + m.calories, proteinG: a.proteinG + m.proteinG, carbsG: a.carbsG + m.carbsG, fatG: a.fatG + m.fatG }), { calories: 0, proteinG: 0, carbsG: 0, fatG: 0 });
  return { date, meals, totals, target, burn: addBurn ? burn : 0 };
}
function leftLine(d: Awaited<ReturnType<typeof dayNutrition>>): string | undefined {
  if (!d.target) return undefined;
  const kcal = Math.round(d.target.calories - d.totals.calories);
  const p = Math.round(d.target.proteinG - d.totals.proteinG);
  return kcal >= 0 ? `${num(kcal)} kcal and ${Math.max(0, p)} g protein left today.` : `${num(-kcal)} kcal over today.`;
}
function mealRows(meal: { id: string; name: string; calories: number; proteinG: number; carbsG: number; fatG: number }): { rows: CardRow[]; edits: Record<string, any> } {
  const f = (k: string) => `${k}_${meal.id.slice(0, 8)}`;
  return {
    rows: [
      { key: meal.name, value: `${num(meal.calories)} kcal`, editable: { field: f('cal'), kind: 'number' } },
      { key: 'Protein', value: `${num(meal.proteinG)} g`, editable: { field: f('p'), kind: 'number' } },
      { key: 'Carbs · Fat', value: `${num(meal.carbsG)} g · ${num(meal.fatG)} g` },
    ],
    edits: {
      [f('cal')]: { op: 'meal.update', args: { id: meal.id, field: 'calories' }, valueKey: 'value', parse: 'number' },
      [f('p')]: { op: 'meal.update', args: { id: meal.id, field: 'proteinG' }, valueKey: 'value', parse: 'number' },
    },
  };
}
async function loggedMealCard(fn: string, userId: string, mealId: string, ctx: ToolCtx, extra: Partial<CardDraft> = {}): Promise<CardDraft> {
  const meal = await prisma.mealEntry.findFirst({ where: { id: mealId, userId } });
  if (!meal) return { fn, pattern: 'glance', rule: 'show', empty: 'That meal is no longer in your log.' };
  const day = await dayNutrition(userId, meal.date);
  const { rows, edits } = mealRows(meal);
  return {
    fn, pattern: 'logged', rule: 'log_undo',
    meta: { label: `Logged · ${cap(meal.mealType)}${meal.date === ctx.today ? '' : ` · ${dayLabel(meal.date)}`}`, open: { page: 'meal', params: { id: meal.id } } },
    rows, note: leftLine(day), pending: { edits }, undoLine: 'Undone — nothing logged', ...extra,
  };
}

// ── Ops ──────────────────────────────────────────────────────────────────────
defineOp({
  name: 'meal.create',
  run: async (userId, args) => {
    const r = await createMealEntry(userId, args.input as any);
    return { result: { id: r.entry.id, entry: r.entry }, inverse: { op: 'meal.remove', args: { id: r.entry.id } }, summary: `Logged · ${r.entry.name} · ${num(r.entry.calories)} kcal` };
  },
});
defineOp({
  name: 'meal.remove',
  undoMs: UNDO_DELETE_MS,
  run: async (userId, args) => {
    const row = await deleteMealEntry(userId, String(args.id));
    if (!row) throw new Error('That meal is already gone.');
    return { result: { row }, inverse: { op: 'meal.restore', args: { row } }, summary: `Removed · ${row.name}` };
  },
});
defineOp({
  name: 'meal.restore',
  run: async (userId, args) => { const r = await restoreMealEntry(userId, args.row); return { inverse: { op: 'meal.remove', args: { id: r.id } }, summary: 'Meal restored' }; },
});
defineOp({
  name: 'meal.update',
  run: async (userId, args) => {
    const patch = args.patch ? (args.patch as Record<string, unknown>) : { [String(args.field)]: args.value };
    const r = await updateMealEntry(userId, String(args.id), patch as any);
    if (!r) throw new Error('That meal isn’t in your log.');
    const before = Object.fromEntries(Object.keys(patch).map((k) => [k, (r.before as any)[k]]));
    const k = Object.keys(patch)[0];
    const display = k === 'calories' ? `${num(Number(patch[k]))} kcal` : /G$/.test(k) ? `${num(Number(patch[k]))} g` : String(patch[k]);
    return { result: { display }, inverse: { op: 'meal.update', args: { id: r.entry.id, patch: before } }, summary: `Corrected · ${r.entry.name}` };
  },
});
// A capture (photo / barcode / order) logged the meal itself; this links it
// to the capture card, swaps in the Logged card, and makes it undoable.
defineOp({
  name: 'capture.meal_logged',
  run: async (userId, args) => {
    const ids = String(args.value).split(',').map((s) => s.trim()).filter(Boolean);
    const meals = await prisma.mealEntry.findMany({ where: { userId, id: { in: ids } } });
    if (!meals.length) throw new Error('Nothing was logged.');
    const ctx = await ctxOf(userId);
    // The Logged card replaces the capture placeholder in place (spec §7.7) and owns the Undo.
    const nextCard = await loggedMealCard('NUT-02', userId, meals[0].id, ctx as any);
    return { result: { mealIds: meals.map((m) => m.id), nextCard, nextOwnsChange: true, line: `Logged — ${meals.map((m) => m.name).join(', ')}` }, inverse: { op: 'meal.remove_many', args: { ids: meals.map((m) => m.id) } }, summary: `Logged · ${meals.map((m) => m.name).join(', ')}` };
  },
});
defineOp({
  name: 'meal.remove_many',
  run: async (userId, args) => {
    const rows: any[] = [];
    for (const id of args.ids as string[]) { const r = await deleteMealEntry(userId, id); if (r) rows.push(r); }
    return { inverse: { op: 'meal.restore_many', args: { rows } }, summary: `Removed ${plural(rows.length, 'meal')}` };
  },
});
defineOp({
  name: 'meal.restore_many',
  run: async (userId, args) => { for (const r of args.rows as any[]) await restoreMealEntry(userId, r); return { inverse: null, summary: 'Meals restored' }; },
});
defineOp({
  name: 'saved_food.remove',
  run: async (userId, args) => {
    const row = await prisma.savedFood.findFirst({ where: { id: String(args.id), userId } });
    if (!row) throw new Error('That food isn’t in your library.');
    await callApi(userId, 'DELETE', `/nutrition/foods/${row.id}`);
    return { inverse: { op: 'saved_food.restore', args: { row } }, summary: `Removed · ${row.name}` };
  },
});
defineOp({
  name: 'saved_food.restore',
  run: async (userId, args) => {
    const { id, userId: _u, createdAt, updatedAt, ...rest } = args.row as any;
    await prisma.savedFood.create({ data: { ...rest, id, userId } }).catch(() => {});
    return { inverse: null, summary: 'Food restored' };
  },
});
defineOp({
  name: 'recipe.log',
  run: async (userId, args) => {
    const e: any = await callApi(userId, 'POST', `/nutrition/recipes/${String(args.id)}/log`, { date: args.date, mealType: args.mealType, servings: args.servings });
    return { result: { id: e.id }, inverse: { op: 'meal.remove', args: { id: e.id } }, summary: `Logged · ${e.name} · ${num(e.calories)} kcal` };
  },
});
defineOp({
  name: 'recipe.create',
  run: async (userId, args) => {
    const r: any = await callApi(userId, 'POST', '/nutrition/recipes', args.recipe);
    return { result: { recipe: r }, inverse: { op: 'recipe.remove', args: { id: r.id } }, summary: `Saved recipe · ${r.name}` };
  },
});
defineOp({
  name: 'recipe.update',
  run: async (userId, args) => {
    const before: any = (await callApi<any>(userId, 'GET', `/nutrition/recipes?limit=200`)).recipes.find((x: any) => x.id === String(args.id));
    if (!before) throw new Error('That recipe isn’t in your library.');
    const r: any = await callApi(userId, 'PUT', `/nutrition/recipes/${String(args.id)}`, args.recipe);
    return { result: { recipe: r }, inverse: { op: 'recipe.update', args: { id: r.id, recipe: { name: before.name, servings: before.servings, items: before.items } } }, summary: `Updated recipe · ${r.name}` };
  },
});
defineOp({
  name: 'recipe.remove',
  run: async (userId, args) => {
    const before: any = (await callApi<any>(userId, 'GET', `/nutrition/recipes?limit=200`)).recipes.find((x: any) => x.id === String(args.id));
    await callApi(userId, 'DELETE', `/nutrition/recipes/${String(args.id)}`);
    return { inverse: before ? { op: 'recipe.create', args: { recipe: { name: before.name, servings: before.servings, items: before.items } } } : null, summary: `Deleted recipe · ${before?.name ?? ''}` };
  },
});

async function findMeal(userId: string, input: Record<string, unknown>, ctx: ToolCtx) {
  if (str(input.mealId)) return prisma.mealEntry.findFirst({ where: { id: str(input.mealId), userId } });
  const date = /^\d{4}-\d{2}-\d{2}$/.test(str(input.date)) ? str(input.date) : ctx.today;
  const meals = await prisma.mealEntry.findMany({ where: { userId, date }, orderBy: { createdAt: 'desc' } });
  const q = str(input.name).toLowerCase();
  const slot = str(input.mealType).toLowerCase();
  return (q ? meals.find((m) => m.name.toLowerCase().includes(q)) : null) ?? (slot ? meals.find((m) => m.mealType === slot) : null) ?? (q || slot ? null : meals[0] ?? null);
}

const ctxOf = async (userId: string): Promise<ToolCtx> => (await import('../turn.js')).toolCtx(userId);

export const NUTRITION_TOOLS = [
  tool({
    name: 'log_meal', kind: 'log', core: true, fn: 'NUT-01',
    description: 'Log food the user ate. Give a plain description ("2 eggs and toast") and the macros and micronutrients are estimated, or pass explicit calories/protein/carbs/fat when they gave them. mealType breakfast|lunch|dinner|snack (guessed from the time if omitted). Log it on the same turn; say what you logged and what’s left.',
    input_schema: schema({ description: { type: 'string' }, name: { type: 'string' }, mealType: { type: 'string', enum: SLOTS }, calories: { type: 'number' }, proteinG: { type: 'number' }, carbsG: { type: 'number' }, fatG: { type: 'number' }, date: { type: 'string' } }),
    receipt: (i) => ({ verb: 'Logged', text: str(i.name) || str(i.description).slice(0, 40) || 'Meal' }),
    refine: (r) => r?.logged ?? null,
    execute: async (input, userId) => {
      const ctx = await ctxOf(userId);
      const date = /^\d{4}-\d{2}-\d{2}$/.test(str(input.date)) ? str(input.date) : ctx.today;
      const explicit = ['calories', 'proteinG', 'carbsG', 'fatG'].some((k) => typeof input[k] === 'number');
      let meal: any;
      if (!explicit && str(input.description)) {
        const d = await parseMealMacros(str(input.description));
        meal = { date, name: str(input.name) || d.name, mealType: slotOf(input.mealType, ctx.tz), calories: d.calories, proteinG: d.proteinG, carbsG: d.carbsG, fatG: d.fatG, ingredients: d.ingredients, tags: d.tags, plants: d.plants, fermentedFoods: d.fermentedFoods, ultraProcessed: d.ultraProcessed, nutrients: d.nutrients, nutrientMap: d.nutrientMap, ingredientNutrients: d.ingredientDetails, source: 'agent-parsed', parseConfidence: (d as any).confidence ?? null };
      } else {
        if (!explicit && !str(input.name)) throw new Error('Tell me what you ate.');
        meal = { date, name: str(input.name) || str(input.description) || 'Meal', mealType: slotOf(input.mealType, ctx.tz), calories: numOr(input.calories, 0), proteinG: numOr(input.proteinG, 0), carbsG: numOr(input.carbsG, 0), fatG: numOr(input.fatG, 0), source: 'agent-manual' };
      }
      const change = await executeOp(userId, 'meal.create', { input: meal });
      return { logged: change.summary, mealId: (change.result as any).id, _change: change };
    },
    card: async (_i, r, ctx) => loggedMealCard('NUT-01', ctx.userId, r.mealId, ctx),
  }),
  tool({
    name: 'log_saved_food', kind: 'log', fn: 'NUT-06',
    description: 'Log something the user has had before: a saved food by name, or repeat a past meal ("same breakfast as yesterday" → from=yesterday, mealType=breakfast). servings scales it.',
    input_schema: schema({ name: { type: 'string' }, fromDate: { type: 'string', description: 'Repeat meals from this date (YYYY-MM-DD).' }, mealType: { type: 'string', enum: SLOTS }, servings: { type: 'number' }, date: { type: 'string' } }),
    receipt: (i) => ({ verb: 'Logged', text: str(i.name) || `Same ${str(i.mealType) || 'meal'} again` }),
    execute: async (input, userId) => {
      const ctx = await ctxOf(userId);
      const date = /^\d{4}-\d{2}-\d{2}$/.test(str(input.date)) ? str(input.date) : ctx.today;
      const k = numOr(input.servings, 1)!;
      let src: any = null;
      if (str(input.fromDate) || !str(input.name)) {
        const from = /^\d{4}-\d{2}-\d{2}$/.test(str(input.fromDate)) ? str(input.fromDate) : null;
        src = await prisma.mealEntry.findFirst({ where: { userId, ...(from ? { date: from } : { date: { lt: date } }), ...(str(input.mealType) ? { mealType: str(input.mealType) } : {}), ...(str(input.name) ? { name: { contains: str(input.name) } } : {}) }, orderBy: [{ date: 'desc' }, { createdAt: 'desc' }] });
      }
      if (!src && str(input.name)) {
        const foods: any = await callApi(userId, 'GET', `/nutrition/foods?q=${encodeURIComponent(str(input.name))}&limit=5`);
        const f = foods.foods?.[0];
        if (f) src = { name: f.name, mealType: null, calories: f.calories, proteinG: f.proteinG, carbsG: f.carbsG, fatG: f.fatG, ingredientsJson: f.ingredientsJson, tagsJson: f.tagsJson, nutrientsJson: f.nutrientsJson };
      }
      if (!src) throw new Error('I couldn’t find that in your history or saved foods.');
      const scale = (v: number) => Math.round(v * k * 10) / 10;
      const meal = {
        date, name: src.name, mealType: slotOf(input.mealType || src.mealType, ctx.tz),
        calories: scale(src.calories), proteinG: scale(src.proteinG), carbsG: scale(src.carbsG), fatG: scale(src.fatG),
        ingredients: parseJson<string[]>(src.ingredientsJson, []), tags: parseJson<string[]>(src.tagsJson, []), source: 'agent-repeat',
        nutrients: parseJson<any>(src.nutrientsJson, undefined),
      };
      const change = await executeOp(userId, 'meal.create', { input: meal });
      return { logged: change.summary, mealId: (change.result as any).id, _change: change };
    },
    card: async (_i, r, ctx) => loggedMealCard('NUT-06', ctx.userId, r.mealId, ctx),
  }),
  tool({
    name: 'log_recipe', kind: 'log', fn: 'NUT-07',
    description: 'Log servings of one of the user’s saved recipes ("had 2 servings of my chili").',
    input_schema: schema({ recipe: { type: 'string', description: 'Recipe name or id' }, servings: { type: 'number' }, mealType: { type: 'string', enum: SLOTS }, date: { type: 'string' } }, ['recipe']),
    receipt: (i) => ({ verb: 'Logged', text: str(i.recipe) }),
    execute: async (input, userId) => {
      const ctx = await ctxOf(userId);
      const { recipes }: any = await callApi(userId, 'GET', `/nutrition/recipes?q=${encodeURIComponent(str(input.recipe))}&limit=5`);
      const rec = (recipes ?? []).find((x: any) => x.id === str(input.recipe)) ?? recipes?.[0];
      if (!rec) throw new Error(`No recipe called "${str(input.recipe)}". Save it first.`);
      const change = await executeOp(userId, 'recipe.log', { id: rec.id, date: /^\d{4}-\d{2}-\d{2}$/.test(str(input.date)) ? str(input.date) : ctx.today, mealType: slotOf(input.mealType, ctx.tz), servings: numOr(input.servings, 1) });
      return { logged: change.summary, mealId: (change.result as any).id, _change: change };
    },
    card: async (_i, r, ctx) => loggedMealCard('NUT-07', ctx.userId, r.mealId, ctx),
  }),
  tool({
    name: 'update_meal', kind: 'log', fn: 'NUT-08',
    description: 'Correct a logged meal: name, mealType, calories, proteinG, carbsG, fatG, notes, or move it to another date; or scale it (portion 1.5 = 50% bigger). Finds it by mealId, or by name / mealType on a date (default today).',
    input_schema: schema({ mealId: { type: 'string' }, name: { type: 'string', description: 'Which meal (name fragment)' }, mealType: { type: 'string' }, date: { type: 'string' }, set: { type: 'object', description: '{ name?, mealType?, calories?, proteinG?, carbsG?, fatG?, notes?, date? }' }, portion: { type: 'number' } }),
    receipt: () => ({ verb: 'Corrected', text: 'Meal' }),
    execute: async (input, userId) => {
      const ctx = await ctxOf(userId);
      const meal = await findMeal(userId, input, ctx);
      if (!meal) throw new Error('I couldn’t find that meal.');
      const patch: Record<string, unknown> = { ...((input.set as object) ?? {}) };
      const k = numOr(input.portion);
      if (k && k > 0) for (const f of ['calories', 'proteinG', 'carbsG', 'fatG'] as const) patch[f] = Math.round((meal as any)[f] * k * 10) / 10;
      if (!Object.keys(patch).length) throw new Error('Say what to change.');
      const change = await executeOp(userId, 'meal.update', { id: meal.id, patch });
      return { corrected: change.summary, mealId: meal.id, before: { calories: meal.calories }, _change: change };
    },
    card: async (_i, r, ctx) => {
      const c = await loggedMealCard('NUT-08', ctx.userId, r.mealId, ctx);
      if (c.rows?.[0] && r.before.calories != null) c.rows[0].was = `${num(r.before.calories)} kcal`;
      return c;
    },
  }),
  tool({
    name: 'delete_meal', kind: 'confirm', fn: 'NUT-09',
    description: 'Remove a logged meal (by mealId, or name / mealType on a date). The card confirms; Undo for 30 seconds.',
    input_schema: schema({ mealId: { type: 'string' }, name: { type: 'string' }, mealType: { type: 'string' }, date: { type: 'string' } }),
    receipt: () => ({ verb: 'Read', text: 'Meal to remove' }),
    execute: async (input, userId) => {
      const ctx = await ctxOf(userId);
      const meal = await findMeal(userId, input, ctx);
      if (!meal) throw new Error('I couldn’t find that meal.');
      const day = await dayNutrition(userId, meal.date);
      return { id: meal.id, name: meal.name, calories: meal.calories, date: meal.date, after: day.totals.calories - meal.calories, target: day.target?.calories ?? null };
    },
    card: (_i, r) => ({
      fn: 'NUT-09', pattern: 'confirm', rule: 'confirm_delete', meta: { label: 'Remove meal' },
      lose: { items: [`${r.name} · ${num(r.calories)} kcal`], keep: `Today would be ${num(r.after)}${r.target ? ` of ${num(r.target)}` : ''} kcal.` },
      actions: [{ id: 'delete', label: 'Remove', kind: 'destructive' }, { id: 'keep', label: 'Keep', kind: 'cancel' }],
      pending: { actions: { delete: { op: 'meal.remove', args: { id: r.id }, status: 'deleted', line: 'Removed · Undo' }, keep: { kind: 'keep' } } },
    }),
  }),
  tool({
    name: 'read_nutrition_today', kind: 'read', core: true, fn: 'NUT-10',
    description: 'What the user has eaten on a day (default today): each meal, totals, targets (with workout calories added when that setting is on) and what’s left. Call before any nutrition advice.',
    input_schema: schema({ date: { type: 'string' } }),
    receipt: () => ({ verb: 'Pulled', text: 'Today’s food' }),
    refine: (r) => r?.totals ? `Nutrition — ${Math.round(r.totals.calories)} kcal so far` : null,
    execute: async (input, userId) => {
      const ctx = await ctxOf(userId);
      const d = await dayNutrition(userId, /^\d{4}-\d{2}-\d{2}$/.test(str(input.date)) ? str(input.date) : ctx.today);
      return { ...d, meals: d.meals.map((m) => ({ id: m.id, name: m.name, mealType: m.mealType, calories: m.calories, proteinG: m.proteinG })) };
    },
    card: (_i, r, ctx) => ({
      fn: r.date === ctx.today ? 'NUT-10' : 'NUT-11', pattern: 'glance', rule: 'show', meta: { label: r.date === ctx.today ? 'Today' : dayLabel(r.date), open: { page: 'fuel' } },
      hero: { value: num(r.totals.calories), unit: r.target ? `of ${num(r.target.calories)} kcal` : 'kcal' },
      bars: r.target ? { v: [r.totals.proteinG / Math.max(1, r.target.proteinG), r.totals.carbsG / Math.max(1, r.target.carbsG), r.totals.fatG / Math.max(1, r.target.fatG)].map((x) => Math.round(Math.min(1.5, x) * 100)), labels: ['Protein', 'Carbs', 'Fat'] } : undefined,
      rows: [
        ...(r.target ? [{ key: 'Protein · Carbs · Fat', value: `${num(r.totals.proteinG)} · ${num(r.totals.carbsG)} · ${num(r.totals.fatG)} g`, sub: `of ${r.target.proteinG} · ${r.target.carbsG} · ${r.target.fatG} g` }] : []),
        ...r.meals.slice(0, 6).map((m: any) => ({ key: m.name, value: `${num(m.calories)} kcal`, sub: cap(m.mealType) })),
        ...(r.burn ? [{ key: 'Workout', value: `+${num(r.burn)} kcal`, mark: 'muted' as const }] : []),
      ],
      ...(r.meals.length ? {} : { empty: 'Nothing logged yet today.' }),
      // Search-first logging (bug fixes 5 Oct, 4a); `from: chat` makes the logged meal a Logged card here.
      actions: [{ id: 'log', label: 'Log food', kind: 'primary', client: { action: 'open_page', args: { page: 'foodsearch', from: 'chat' } } }],
    }),
  }),
  tool({
    name: 'read_nutrition_history', kind: 'read', fn: 'NUT-11',
    description: 'Daily totals for recent days (default 7, max 90): calories, protein, carbs, fat, meals per day. Use for "what did I eat this week", "how was my protein this month".',
    input_schema: schema({ days: { type: 'number' } }),
    receipt: () => ({ verb: 'Pulled', text: 'Food history' }),
    execute: async (input, userId) => {
      const days = Math.min(90, Math.max(1, Math.round(numOr(input.days, 7)!)));
      const { history }: any = await callApi(userId, 'GET', `/nutrition/history?days=${days}`);
      return { days: (history ?? []).map((h: any) => ({ date: h.date, calories: Math.round(h.calories), proteinG: Math.round(h.proteinG), carbsG: Math.round(h.carbsG), fatG: Math.round(h.fatG), meals: (h.meals ?? []).length })) };
    },
    card: (_i, r) => {
      const d = r.days as any[];
      if (!d.length) return { fn: 'NUT-11', pattern: 'glance', rule: 'show', meta: { label: 'Food history' }, empty: 'Nothing logged in that window.' };
      const avg = (k: string) => Math.round(d.reduce((n, x) => n + x[k], 0) / d.length);
      return { fn: 'NUT-11', pattern: 'glance', rule: 'show', meta: { label: `Last ${plural(d.length, 'day')}`, open: { page: 'fuel' } }, hero: { value: num(avg('calories')), unit: 'kcal a day' },
        bars: { v: d.slice(-14).map((x) => x.calories), labels: d.slice(-14).map((x) => dayLabel(x.date).slice(0, 3)) },
        rows: [{ key: 'Protein a day', value: `${avg('proteinG')} g` }, { key: 'Carbs · Fat a day', value: `${avg('carbsG')} · ${avg('fatG')} g` }, { key: 'Days logged', value: `${d.filter((x) => x.meals > 0).length} of ${d.length}` }] };
    },
  }),
  tool({
    name: 'suggest_meals', kind: 'read', fn: 'NUT-12',
    description: 'Suggest 2–4 meals that fit what’s left today, their budget, diet and food region. slot optional. Each suggestion can be logged from the card.',
    input_schema: schema({ slot: { type: 'string', enum: SLOTS } }),
    receipt: () => ({ verb: 'Computed', text: 'Meals that fit' }),
    execute: async (input, userId) => {
      const ctx = await ctxOf(userId);
      const d = await dayNutrition(userId, ctx.today);
      const rem = d.target ? { kcal: Math.max(0, d.target.calories - d.totals.calories), protein: Math.max(0, d.target.proteinG - d.totals.proteinG), carbs: Math.max(0, d.target.carbsG - d.totals.carbsG), fat: Math.max(0, d.target.fatG - d.totals.fatG) } : { kcal: 700, protein: 40, carbs: 70, fat: 25 };
      const { suggestions }: any = await callApi(userId, 'POST', '/nutrition/suggest-meals', { remaining: rem, slot: str(input.slot) || null });
      return { remaining: rem, suggestions: (suggestions ?? []).slice(0, 4), slot: slotOf(input.slot, ctx.tz), date: ctx.today };
    },
    card: (_i, r) => ({
      fn: 'NUT-12', pattern: 'glance', rule: 'show', meta: { label: `Fits what’s left · ${num(r.remaining.kcal)} kcal` },
      rows: r.suggestions.map((s: any, i: number) => ({ key: s.name, value: `${num(s.calories)} kcal`, sub: `${num(s.proteinG)} g protein`, action: `log${i}` })),
      actions: r.suggestions.map((s: any, i: number) => ({ id: `log${i}`, label: `Log ${s.name}`.slice(0, 36), kind: 'secondary' as const })),
      pending: { actions: Object.fromEntries(r.suggestions.map((s: any, i: number) => [`log${i}`, { op: 'meal.create', args: { input: { date: r.date, name: s.name, mealType: r.slot, calories: s.calories, proteinG: s.proteinG, carbsG: s.carbsG, fatG: s.fatG, source: 'agent-suggestion' } }, line: `Logged · ${s.name}` }])) },
    }),
  }),
  tool({
    name: 'read_saved_foods', kind: 'read', fn: 'NUT-13',
    description: 'The user’s saved-food library (things they log often), optionally filtered by name. Each can be logged or removed from the card.',
    input_schema: schema({ q: { type: 'string' } }),
    receipt: () => ({ verb: 'Read', text: 'Saved foods' }),
    execute: async (input, userId) => {
      const ctx = await ctxOf(userId);
      const r: any = await callApi(userId, 'GET', `/nutrition/foods?limit=12${str(input.q) ? `&q=${encodeURIComponent(str(input.q))}` : ''}`);
      return { foods: (r.foods ?? []).map((f: any) => ({ id: f.id, name: f.name, calories: f.calories, proteinG: f.proteinG, carbsG: f.carbsG, fatG: f.fatG, useCount: f.useCount })), date: ctx.today, slot: slotOf(null, ctx.tz) };
    },
    card: (_i, r) => {
      if (!r.foods.length) return { fn: 'NUT-13', pattern: 'glance', rule: 'show', meta: { label: 'Saved foods' }, empty: 'Foods you log show up here.' };
      const top = r.foods.slice(0, 6);
      return {
        fn: 'NUT-13', pattern: 'glance', rule: 'show', meta: { label: 'Saved foods', open: { page: 'fuel' } },
        rows: top.map((f: any, i: number) => ({ key: f.name, value: `${num(f.calories)} kcal`, sub: `Logged ${plural(f.useCount, 'time')}`, action: `log${i}` })),
        actions: top.flatMap((f: any, i: number) => [{ id: `log${i}`, label: `Log ${f.name}`.slice(0, 32), kind: 'secondary' as const }, { id: `rm${i}`, label: `Remove ${f.name}`.slice(0, 32), kind: 'secondary' as const }]),
        pending: { actions: Object.fromEntries(top.flatMap((f: any, i: number) => [
          [`log${i}`, { op: 'meal.create', args: { input: { date: r.date, name: f.name, mealType: r.slot, calories: f.calories, proteinG: f.proteinG, carbsG: f.carbsG, fatG: f.fatG, source: 'agent-repeat' } }, line: `Logged · ${f.name}` }],
          [`rm${i}`, { op: 'saved_food.remove', args: { id: f.id }, status: 'deleted', line: `Removed · ${f.name}` }],
        ])) },
      };
    },
  }),
  tool({
    name: 'lookup_food', kind: 'read', fn: 'NUT-14',
    description: 'Nutrition facts for a food and amount without logging it ("how much protein in 200 g salmon"). The card offers Log it.',
    input_schema: schema({ food: { type: 'string', description: 'Food and amount, e.g. "200 g salmon"' } }, ['food']),
    receipt: (i) => ({ verb: 'Searched', text: str(i.food) }),
    execute: async (input, userId) => {
      const ctx = await ctxOf(userId);
      const d = await parseMealMacros(str(input.food));
      return { name: d.name, calories: d.calories, proteinG: d.proteinG, carbsG: d.carbsG, fatG: d.fatG, fiberG: (d.nutrients as any)?.fiberG ?? null, date: ctx.today, slot: slotOf(null, ctx.tz), _parsed: d };
    },
    card: (_i, r) => ({
      fn: 'NUT-14', pattern: 'glance', rule: 'show', meta: { label: r.name },
      hero: { value: num(r.calories), unit: 'kcal' },
      rows: [{ key: 'Protein', value: `${num(r.proteinG)} g` }, { key: 'Carbs', value: `${num(r.carbsG)} g` }, { key: 'Fat', value: `${num(r.fatG)} g` }, ...(r.fiberG != null ? [{ key: 'Fiber', value: `${num(r.fiberG, 1)} g` }] : [])],
      note: 'Estimate, ±15%.',
      actions: [{ id: 'log', label: 'Log it', kind: 'primary' }],
      pending: { actions: { log: { op: 'meal.create', args: { input: { date: r.date, name: r.name, mealType: r.slot, calories: r.calories, proteinG: r.proteinG, carbsG: r.carbsG, fatG: r.fatG, ingredients: r._parsed.ingredients, tags: r._parsed.tags, plants: r._parsed.plants, fermentedFoods: r._parsed.fermentedFoods, ultraProcessed: r._parsed.ultraProcessed, nutrients: r._parsed.nutrients, source: 'agent-parsed' } }, line: `Logged · ${r.name}` } } },
    }),
  }),
  tool({
    name: 'open_food_capture', kind: 'intent', fn: 'NUT-02',
    description: 'Open the camera to log food: mode photo (snap a meal), barcode (scan a package; label scan if it isn’t found), order (screenshot of a takeout order), or describe (type it). The result comes back into the chat.',
    input_schema: schema({ mode: { type: 'string', enum: ['photo', 'barcode', 'order', 'describe'] } }),
    receipt: (i) => ({ verb: 'Opened', text: i.mode === 'barcode' ? 'Scanner' : i.mode === 'order' ? 'Order scan' : 'Camera' }),
    execute: async (input) => ({ mode: ['photo', 'barcode', 'order', 'describe'].includes(str(input.mode)) ? str(input.mode) : 'photo' }),
    card: (_i, r) => ({
      fn: r.mode === 'barcode' ? 'NUT-03' : r.mode === 'order' ? 'NUT-05' : 'NUT-02', pattern: 'capture', rule: 'log_undo',
      meta: { label: r.mode === 'barcode' ? 'Scanner open' : r.mode === 'order' ? 'Order scan' : 'Camera open' },
      note: 'Waiting for your photo. Cancel on the camera and nothing is logged.',
      handoff: { label: r.mode === 'barcode' ? 'Scan' : 'Open camera', action: 'open_camera', args: { mode: r.mode } },
      actions: [{ id: 'cancel', label: 'Cancel', kind: 'cancel' }],
      pending: { answer: { op: 'capture.meal_logged', valueKey: 'value' }, actions: { cancel: { kind: 'cancel', line: 'Cancelled — nothing logged' } } },
    }),
  }),
];

// ── Recipes ──────────────────────────────────────────────────────────────────
function recipeCard(fn: string, rec: any, extra: Partial<CardDraft> = {}): CardDraft {
  return {
    fn, pattern: 'logged', rule: 'log_undo', meta: { label: `Recipe · ${rec.name}`, open: { page: 'recipes' } },
    rows: [...(rec.items ?? []).slice(0, 10).map((it: any) => ({ key: it.name, value: `${num(it.calories)} kcal`, sub: it.quantity || undefined })),
      { key: 'Per serving', value: `${num(rec.calories)} kcal · ${num(rec.proteinG)} g protein`, sub: `${num(rec.servings, 1)} servings` }],
    undoLine: 'Undone', ...extra,
  };
}

export const RECIPE_TOOLS = [
  tool({
    name: 'read_recipes', kind: 'read', fn: 'RCP-05',
    description: 'The user’s saved recipes with per-serving macros (optionally filtered by name).',
    input_schema: schema({ q: { type: 'string' } }),
    receipt: () => ({ verb: 'Read', text: 'Recipes' }),
    execute: async (input, userId) => ({ recipes: ((await callApi<any>(userId, 'GET', `/nutrition/recipes?limit=20${str(input.q) ? `&q=${encodeURIComponent(str(input.q))}` : ''}`)).recipes ?? []).map((r: any) => ({ id: r.id, name: r.name, servings: r.servings, calories: r.calories, proteinG: r.proteinG, items: (r.items ?? []).length })) }),
    card: (_i, r) => r.recipes.length
      ? { fn: 'RCP-05', pattern: 'glance', rule: 'show', meta: { label: 'Recipes', open: { page: 'recipes' } }, rows: r.recipes.slice(0, 8).map((x: any) => ({ key: x.name, value: `${num(x.calories)} kcal`, sub: `${num(x.proteinG)} g protein a serving` })) }
      : { fn: 'RCP-05', pattern: 'glance', rule: 'show', meta: { label: 'Recipes' }, empty: 'No recipes yet. Paste one and I’ll save it.' },
  }),
  tool({
    name: 'create_recipe', kind: 'log', fn: 'RCP-01',
    description: 'Save a recipe: paste the recipe text (ingredients are broken down and costed), or save a logged meal as a recipe (fromMealId). servings = how many it makes.',
    input_schema: schema({ text: { type: 'string' }, name: { type: 'string' }, servings: { type: 'number' }, fromMealId: { type: 'string' } }),
    receipt: () => ({ verb: 'Saved', text: 'Recipe' }),
    execute: async (input, userId) => {
      let recipe: any;
      if (str(input.fromMealId)) {
        const m = await prisma.mealEntry.findFirst({ where: { id: str(input.fromMealId), userId } });
        if (!m) throw new Error('That meal isn’t in your log.');
        const ings = parseJson<string[]>(m.ingredientsJson, []);
        recipe = { name: str(input.name) || m.name, servings: numOr(input.servings, 1), items: ings.length ? ings.map((n, i) => ({ name: n, quantity: '', calories: i === 0 ? m.calories : 0, proteinG: i === 0 ? m.proteinG : 0, carbsG: i === 0 ? m.carbsG : 0, fatG: i === 0 ? m.fatG : 0 })) : [{ name: m.name, quantity: '', calories: m.calories, proteinG: m.proteinG, carbsG: m.carbsG, fatG: m.fatG }] };
      } else {
        if (!str(input.text)) throw new Error('Paste the recipe or name the meal to save.');
        const parsed: any = await callApi(userId, 'POST', '/nutrition/recipes/parse', { description: str(input.text), ...(numOr(input.servings) ? { servings: numOr(input.servings) } : {}) });
        recipe = { name: str(input.name) || parsed.name, servings: numOr(input.servings) ?? parsed.servings ?? 1, items: parsed.items, nutrients: parsed.nutrients };
      }
      const change = await executeOp(userId, 'recipe.create', { recipe });
      return { saved: change.summary, recipe: (change.result as any).recipe, fromMeal: !!str(input.fromMealId), _change: change };
    },
    card: (_i, r) => recipeCard(r.fromMeal ? 'RCP-02' : 'RCP-01', r.recipe, { actions: [{ id: 'log', label: 'Log a serving', kind: 'secondary', client: { action: 'send_message', args: { text: `Log a serving of my ${r.recipe.name}.` } } }] }),
  }),
  tool({
    name: 'update_recipe', kind: 'log', fn: 'RCP-03',
    description: 'Change a saved recipe: servings, name, or replace its ingredients from pasted text.',
    input_schema: schema({ recipe: { type: 'string', description: 'Name or id' }, servings: { type: 'number' }, name: { type: 'string' }, text: { type: 'string' } }, ['recipe']),
    receipt: (i) => ({ verb: 'Adjusted', text: `Recipe · ${str(i.recipe)}` }),
    execute: async (input, userId) => {
      const { recipes }: any = await callApi(userId, 'GET', `/nutrition/recipes?limit=200`);
      const q = str(input.recipe).toLowerCase();
      const cur = (recipes ?? []).find((x: any) => x.id === str(input.recipe)) ?? (recipes ?? []).find((x: any) => x.name.toLowerCase().includes(q));
      if (!cur) throw new Error(`No recipe called "${str(input.recipe)}".`);
      let items = cur.items;
      if (str(input.text)) items = ((await callApi<any>(userId, 'POST', '/nutrition/recipes/parse', { description: str(input.text) })).items) ?? items;
      const change = await executeOp(userId, 'recipe.update', { id: cur.id, recipe: { name: str(input.name) || cur.name, servings: numOr(input.servings) ?? cur.servings, items } });
      return { updated: change.summary, recipe: (change.result as any).recipe, _change: change };
    },
    card: (_i, r) => recipeCard('RCP-03', r.recipe),
  }),
  tool({
    name: 'delete_recipe', kind: 'confirm', fn: 'RCP-04',
    description: 'Delete a saved recipe. Meals already logged from it stay.',
    input_schema: schema({ recipe: { type: 'string' } }, ['recipe']),
    receipt: () => ({ verb: 'Read', text: 'Recipe to delete' }),
    execute: async (input, userId) => {
      const { recipes }: any = await callApi(userId, 'GET', `/nutrition/recipes?limit=200`);
      const q = str(input.recipe).toLowerCase();
      const cur = (recipes ?? []).find((x: any) => x.id === str(input.recipe)) ?? (recipes ?? []).find((x: any) => x.name.toLowerCase().includes(q));
      if (!cur) throw new Error(`No recipe called "${str(input.recipe)}".`);
      return { id: cur.id, name: cur.name };
    },
    card: (_i, r) => ({
      fn: 'RCP-04', pattern: 'confirm', rule: 'confirm_delete', meta: { label: 'Delete recipe' }, lose: { items: [r.name], keep: 'Meals you logged from it stay in your history.' },
      actions: [{ id: 'delete', label: 'Delete', kind: 'destructive' }, { id: 'keep', label: 'Keep', kind: 'cancel' }],
      pending: { actions: { delete: { op: 'recipe.remove', args: { id: r.id }, status: 'deleted', line: 'Deleted · Undo' }, keep: { kind: 'keep' } } },
    }),
  }),
];

registerToolkit([...NUTRITION_TOOLS, ...RECIPE_TOOLS]);
export { clockTime };
