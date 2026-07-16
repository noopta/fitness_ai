// Nutrition Profile routes — the effects-first read behind Strength → Nutrition
// (see "Axiom nutrition profiling designs"). Read-only: this never writes food
// data (logging stays in Coach → Nutrition). It reads the day's meals, runs the
// deterministic profile engine, and phrases the numbers with best-effort LLM
// narration that always falls back to quantified deterministic copy.
//
// Endpoints (spec §8):
//   GET  /nutrition-profile?date=            day profile: hero, systems, meals, top move
//   GET  /nutrition-profile/effect/:systemId per-system effect detail
//   GET  /nutrition-profile/nutrient/:key    nutrient detail (flagship)
//   GET  /nutrition-profile/meal/:mealId     meal breakdown
//   GET  /nutrition-profile/trend?range=7d   weekly coverage/consistency
//   GET  /nutrition-profile/recommendations?date=  ranked gap-closing foods
// The spec's "Add" action is a client deep-link into the Coach log — no write
// endpoint here.

import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { requireAuth } from '../middleware/requireAuth.js';
import {
  runNutritionProfileEngine, sumNutrientMaps, effectiveTarget,
  type ProfileEngineOutput, type BodySystemScore,
} from '../engine/nutritionProfileEngine.js';
import { recommendFoods } from '../engine/nutritionRecommendations.js';
import {
  NUTRIENTS, BODY_SYSTEMS, getNutrient, driversForSystem, type BodySystemId,
} from '../engine/nutrientRegistry.js';
import { generateProfileNarration, generateNutrientWhy } from '../services/llmService.js';
import { buildRAGContext } from '../services/ragService.js';
import { parseJsonObject } from '../services/nutritionShared.js';

const router = Router();
const prisma = new PrismaClient();

function todayStr(): string { return new Date().toISOString().slice(0, 10); }
const isBodySystem = (s: string): s is BodySystemId => BODY_SYSTEMS.some(b => b.id === s);

// Load a day's meals + the user's bodyweight, and roll them into day totals via
// the open nutrient maps.
async function loadDay(userId: string, date: string) {
  const [user, meals] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { weightKg: true } }),
    prisma.mealEntry.findMany({
      where: { userId, date },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true, name: true, mealType: true, calories: true,
        proteinG: true, carbsG: true, fatG: true,
        nutrientMapJson: true, nutrientsJson: true, ingredientsJson: true,
        ingredientNutrientsJson: true, createdAt: true,
      },
    }),
  ]);
  const maps = meals.map(m => {
    const open = parseJsonObject<Record<string, number>>(m.nutrientMapJson);
    if (open && Object.keys(open).length > 0) return open;
    // Fallback for pre-migration entries: synthesize from macros + structured
    // micros so historical days still profile (spec §7 "resolving" state).
    const micros = parseJsonObject<Record<string, number>>(m.nutrientsJson) ?? {};
    const synth: Record<string, number> = {};
    if (m.proteinG) synth.proteinG = m.proteinG;
    if (m.carbsG) synth.carbsG = m.carbsG;
    if (m.fatG) synth.fatG = m.fatG;
    for (const [k, v] of Object.entries(micros)) if (typeof v === 'number' && v) synth[k] = v;
    return synth;
  });
  const totals = sumNutrientMaps(maps, meals.map(m => m.calories));
  return { bodyweightKg: user?.weightKg ?? null, meals, totals };
}

// Deterministic quantified fallbacks — used when the LLM is unavailable so the
// screen always has grounded copy (§8: never a claim without a number).
function fallbackHeadline(out: ProfileEngineOutput): string {
  const worst = [...out.systems].sort((a, b) => a.score - b.score)[0];
  if (!worst) return `Logged ${out.kcalLogged} kcal today.`;
  if (out.profileScore >= 75) return `Fueling well — profile score ${out.profileScore}, ${worst.name.toLowerCase()} the one to watch at ${worst.score}.`;
  return `Under-supporting ${worst.name.toLowerCase()} at ${worst.score}/100 — profile score ${out.profileScore}.`;
}
function fallbackDriver(sys: BodySystemScore): string {
  const d = sys.drivers[0];
  if (!d) return `${sys.name} scored ${sys.score} of 100 today.`;
  return `${d.label} at ${d.pct}% of target is holding ${sys.name.toLowerCase()} to ${sys.score}.`;
}

// GET /nutrition-profile?date=
router.get('/nutrition-profile', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.id;
    const date = typeof req.query.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date)
      ? req.query.date : todayStr();

    const { bodyweightKg, meals, totals } = await loadDay(userId, date);
    if (meals.length === 0) {
      return res.json({ date, hasData: false, mealsLogged: 0 });
    }

    const engine = runNutritionProfileEngine({ totals, bodyweightKg, mealsLogged: meals.length });

    // Best-effort narration with deterministic fallback.
    let headline = fallbackHeadline(engine);
    const driverByName: Record<string, string> = {};
    for (const s of engine.systems) driverByName[s.name] = fallbackDriver(s);
    try {
      const narration = await generateProfileNarration({
        headlineFacts: `kcal ${engine.kcalLogged}, micronutrient coverage ${engine.microCoveragePct}%, profile score ${engine.profileScore}`,
        systems: engine.systems.map(s => ({
          name: s.name, status: s.status, score: s.score,
          topDriver: s.drivers[0] ? `${s.drivers[0].label} ${s.drivers[0].pct}%` : 'n/a',
        })),
      });
      if (narration.headline) headline = narration.headline;
      for (const [name, sentence] of Object.entries(narration.drivers)) {
        if (sentence) driverByName[name] = sentence;
      }
    } catch { /* keep fallbacks */ }

    // Top move = the #1 recommendation for the day.
    const recs = recommendFoods(engine.coverage, bodyweightKg, 1);
    const topRec = recs[0] ?? null;

    res.json({
      date,
      hasData: true,
      mealsLogged: meals.length,
      kcalLogged: engine.kcalLogged,
      microCoveragePct: engine.microCoveragePct,
      profileScore: engine.profileScore,
      profileScoreProvisional: true, // spec §11 — formula pending science sign-off
      headline,
      systems: engine.systems.map(s => ({
        id: s.id, name: s.name, status: s.status, score: s.score,
        driver: driverByName[s.name] ?? fallbackDriver(s),
        chips: s.chips,
      })),
      topMove: topRec && {
        title: topRec.name,
        mechanism: mechanismSentence(topRec.primaryNutrientKey),
        gain: topRec.primaryGainText,
      },
      meals: meals.map(m => ({
        id: m.id, name: m.name, mealType: m.mealType, calories: Math.round(m.calories),
      })),
      extras: engine.extras,
    });
  } catch (err) {
    console.error('Nutrition profile error:', err);
    res.status(500).json({ error: 'Failed to build nutrition profile' });
  }
});

// One-line mechanism sentence for a nutrient, from its registry chain.
function mechanismSentence(key: string): string {
  const def = getNutrient(key);
  if (!def?.chain || def.chain.length === 0) return def ? `${def.label} supports this system.` : '';
  const last = def.chain[def.chain.length - 1];
  return `${def.label} → ${last.title.toLowerCase()}: ${last.body}`;
}

// GET /nutrition-profile/effect/:systemId
router.get('/nutrition-profile/effect/:systemId', requireAuth, async (req, res) => {
  try {
    const systemId = req.params.systemId;
    if (!isBodySystem(systemId)) return res.status(404).json({ error: 'Unknown system' });
    const userId = req.user!.id;
    const date = typeof req.query.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date)
      ? req.query.date : todayStr();

    const { bodyweightKg, totals, meals } = await loadDay(userId, date);
    if (meals.length === 0) return res.json({ systemId, hasData: false });
    const engine = runNutritionProfileEngine({ totals, bodyweightKg, mealsLogged: meals.length });
    const sys = engine.systems.find(s => s.id === systemId)!;

    // Contributing nutrients = this system's drivers with their coverage rows.
    const covByKey = new Map(engine.coverage.map(c => [c.key, c]));
    const drivers = driversForSystem(systemId).map(({ def }) => {
      const cov = covByKey.get(def.key)!;
      return {
        key: def.key, label: def.label, unit: def.unit,
        amount: cov.amount, target: cov.target, pct: cov.pct, status: cov.status,
        tracked: !!def.chain, // mapped nutrient → tappable to Nutrient Detail
      };
    }).sort((a, b) => a.pct - b.pct);

    // Mechanism sentences: the chains of the 2-3 most load-bearing drivers.
    const mechanisms = drivers
      .filter(d => getNutrient(d.key)?.chain)
      .slice(0, 3)
      .map(d => mechanismSentence(d.key));

    const watch = drivers.map(d => getNutrient(d.key)?.watchFor).find(Boolean) ?? null;

    res.json({
      systemId,
      name: sys.name,
      status: sys.status,
      score: sys.score,
      summary: `${sys.name} scored ${sys.score} of 100 today; ${drivers[0] ? `${drivers[0].label} at ${drivers[0].pct}% is the lever.` : ''}`.trim(),
      drivers,
      mechanisms,
      watchFor: watch,
    });
  } catch (err) {
    console.error('Effect detail error:', err);
    res.status(500).json({ error: 'Failed to load effect detail' });
  }
});

// GET /nutrition-profile/nutrient/:key
router.get('/nutrition-profile/nutrient/:key', requireAuth, async (req, res) => {
  try {
    const def = getNutrient(req.params.key);
    if (!def) return res.status(404).json({ error: 'Unknown nutrient' });
    const userId = req.user!.id;
    const date = typeof req.query.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date)
      ? req.query.date : todayStr();

    const { bodyweightKg, totals, meals } = await loadDay(userId, date);
    const engine = runNutritionProfileEngine({ totals, bodyweightKg, mealsLogged: meals.length });
    const cov = engine.coverage.find(c => c.key === def.key)!;

    // Best food sources for this nutrient, ranked by how much they provide.
    const { FOOD_SOURCES } = await import('../engine/nutritionRecommendations.js');
    const sources = FOOD_SOURCES
      .filter(f => f.provides[def.key])
      .sort((a, b) => (b.provides[def.key] ?? 0) - (a.provides[def.key] ?? 0))
      .slice(0, 5)
      .map(f => ({ food: `${f.name} (${f.serving})`, amount: `+${Math.round(f.provides[def.key])} ${def.unit}` }));

    // Personalized "why" — best-effort with a deterministic fallback.
    let why = `You're at ${cov.amount} ${def.unit} of a ${cov.target} ${def.unit} target (${cov.pct}%). ${def.chain?.[0]?.body ?? ''}`.trim();
    try {
      const rag = await buildRAGContext(`${def.label} ${def.tag ?? ''} training performance`, 3);
      const generated = await generateNutrientWhy({
        nutrientLabel: def.label, pct: cov.pct,
        amount: `${cov.amount} ${def.unit}`, target: `${cov.target} ${def.unit}`,
        trainingContext: 'strength training, logging nutrition',
        ragContext: rag,
      });
      if (generated) why = generated;
    } catch { /* keep fallback */ }

    res.json({
      key: def.key,
      label: def.label,
      tag: def.tag ?? null,
      unit: def.unit,
      current: `${cov.amount}`,
      target: `${cov.target}`,
      pct: cov.pct,
      status: cov.status,
      ceiling: cov.ceiling,
      chain: def.chain ?? [],
      why,
      sources,
      recommendation: buildNutrientRec(def, cov),
      watchFor: def.watchFor ?? null,
    });
  } catch (err) {
    console.error('Nutrient detail error:', err);
    res.status(500).json({ error: 'Failed to load nutrient detail' });
  }
});

function buildNutrientRec(def: ReturnType<typeof getNutrient> & object, cov: { amount: number; target: number; unit?: string; pct: number; ceiling: boolean }): string {
  if (cov.ceiling) {
    return cov.pct > 100
      ? `Pull ${def.label.toLowerCase()} back toward ${def.target} ${def.unit} — you're at ${cov.amount}.`
      : `${def.label} is in range at ${cov.amount} ${def.unit}. Hold it here.`;
  }
  const gap = Math.max(0, def.target - cov.amount);
  return gap > 0
    ? `Add about ${Math.round(gap)} ${def.unit} of ${def.label.toLowerCase()} to reach target.`
    : `${def.label} target met at ${cov.amount} ${def.unit}. Maintain.`;
}

// GET /nutrition-profile/meal/:mealId
router.get('/nutrition-profile/meal/:mealId', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.id;
    const meal = await prisma.mealEntry.findFirst({
      where: { id: req.params.mealId, userId },
      select: {
        id: true, name: true, mealType: true, calories: true, createdAt: true,
        proteinG: true, carbsG: true, fatG: true,
        ingredientsJson: true, ingredientNutrientsJson: true, nutrientMapJson: true,
      },
    });
    if (!meal) return res.status(404).json({ error: 'Meal not found' });

    const ingredientNutrients = parseJsonObject<Array<{ name: string; nutrients: Record<string, number> }>>(
      meal.ingredientNutrientsJson,
    );
    const plainIngredients = parseJsonObject<string[]>(meal.ingredientsJson) ?? [];

    // Prefer per-ingredient nutrient rows; fall back to plain ingredient names
    // (spec §7 — chip reads "resolving…" client-side when nutrients are absent).
    const ingredients = ingredientNutrients && ingredientNutrients.length > 0
      ? ingredientNutrients.map(i => ({
          name: i.name,
          resolved: true,
          chips: Object.entries(i.nutrients)
            .map(([k, v]) => {
              const d = getNutrient(k);
              return d ? `${d.label} ${Math.round(v)}${d.unit}` : `${k} ${Math.round(v)}`;
            })
            .slice(0, 6),
        }))
      : plainIngredients.map(name => ({ name, resolved: false, chips: [] as string[] }));

    res.json({
      id: meal.id,
      name: meal.name,
      mealType: meal.mealType,
      kcal: Math.round(meal.calories),
      loggedAt: meal.createdAt,
      macros: {
        proteinG: Math.round(meal.proteinG),
        carbsG: Math.round(meal.carbsG),
        fatG: Math.round(meal.fatG),
      },
      ingredients,
    });
  } catch (err) {
    console.error('Meal breakdown error:', err);
    res.status(500).json({ error: 'Failed to load meal breakdown' });
  }
});

// GET /nutrition-profile/trend?range=7d
router.get('/nutrition-profile/trend', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.id;
    const days = req.query.range === '30d' ? 30 : 7;
    const since = new Date(Date.now() - (days - 1) * 86400000).toISOString().slice(0, 10);

    const meals = await prisma.mealEntry.findMany({
      where: { userId, date: { gte: since } },
      select: { date: true, calories: true, nutrientMapJson: true, nutrientsJson: true, proteinG: true, carbsG: true, fatG: true },
      orderBy: { date: 'asc' },
    });

    // Group by date, compute coverage per day.
    const byDate = new Map<string, typeof meals>();
    for (const m of meals) {
      const arr = byDate.get(m.date) ?? [];
      arr.push(m);
      byDate.set(m.date, arr);
    }

    const series: Array<{ date: string; coveragePct: number; profileScore: number }> = [];
    const perNutrientDays = new Map<string, { onTarget: number; total: number }>();
    for (const n of NUTRIENTS) perNutrientDays.set(n.key, { onTarget: 0, total: 0 });

    const user = await prisma.user.findUnique({ where: { id: userId }, select: { weightKg: true } });
    const bw = user?.weightKg ?? null;

    for (const [date, dayMeals] of [...byDate.entries()].sort()) {
      const maps = dayMeals.map(m => {
        const open = parseJsonObject<Record<string, number>>(m.nutrientMapJson);
        if (open && Object.keys(open).length) return open;
        const micros = parseJsonObject<Record<string, number>>(m.nutrientsJson) ?? {};
        const s: Record<string, number> = {};
        if (m.proteinG) s.proteinG = m.proteinG;
        if (m.carbsG) s.carbsG = m.carbsG;
        if (m.fatG) s.fatG = m.fatG;
        for (const [k, v] of Object.entries(micros)) if (typeof v === 'number' && v) s[k] = v;
        return s;
      });
      const totals = sumNutrientMaps(maps, dayMeals.map(m => m.calories));
      const eng = runNutritionProfileEngine({ totals, bodyweightKg: bw, mealsLogged: dayMeals.length });
      series.push({ date, coveragePct: eng.microCoveragePct, profileScore: eng.profileScore });
      for (const cov of eng.coverage) {
        if (cov.ceiling) continue;
        const rec = perNutrientDays.get(cov.key)!;
        rec.total += 1;
        if (cov.status === 'ok') rec.onTarget += 1;
      }
    }

    const consistency = [...perNutrientDays.entries()]
      .filter(([, v]) => v.total > 0)
      .map(([key, v]) => ({
        key, label: getNutrient(key)?.label ?? key,
        pctDaysOnTarget: Math.round((v.onTarget / v.total) * 100),
      }))
      .sort((a, b) => a.pctDaysOnTarget - b.pctDaysOnTarget);

    res.json({ range: `${days}d`, series, consistency });
  } catch (err) {
    console.error('Trend error:', err);
    res.status(500).json({ error: 'Failed to load trend' });
  }
});

// GET /nutrition-profile/recommendations?date=
router.get('/nutrition-profile/recommendations', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.id;
    const date = typeof req.query.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date)
      ? req.query.date : todayStr();
    const { bodyweightKg, totals, meals } = await loadDay(userId, date);
    const engine = runNutritionProfileEngine({ totals, bodyweightKg, mealsLogged: meals.length });
    const recs = recommendFoods(engine.coverage, bodyweightKg, 8);
    res.json({
      date,
      recommendations: recs.map(r => ({
        name: r.name,
        serving: r.serving,
        category: r.category,
        gain: r.primaryGainText,
        mechanism: mechanismSentence(r.primaryNutrientKey),
        // Deep-link payload for the client "Add" action → Coach log prefilled.
        prefill: { name: `${r.name} (${r.serving})`, source: 'recommendation' },
      })),
    });
  } catch (err) {
    console.error('Recommendations error:', err);
    res.status(500).json({ error: 'Failed to load recommendations' });
  }
});

export default router;
