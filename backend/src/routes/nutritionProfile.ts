// Nutrition Profile routes — the effects-first read behind Strength → Nutrition
// (see "Axiom nutrition profiling designs"). Read-only: this never writes food
// data (logging stays in Coach → Nutrition). It reads the day's meals, runs the
// deterministic profile engine, and phrases the numbers with best-effort LLM
// narration that always falls back to quantified deterministic copy.
//
// Endpoints (spec §8):
//   GET  /nutrition-profile?date=&range=     profile: hero, systems, meals, top move
//   GET  /nutrition-profile/effect/:systemId per-system effect detail
//   GET  /nutrition-profile/nutrient/:key    nutrient detail (flagship)
//   GET  /nutrition-profile/meal/:mealId     meal breakdown
//   GET  /nutrition-profile/trend?range=7d   day-by-day coverage/consistency
//   GET  /nutrition-profile/recommendations?date=&range=  ranked gap-closing foods
// The spec's "Add" action is a client deep-link into the Coach log — no write
// endpoint here.
//
// RANGES. Every read endpoint except /meal takes `range=today|7d|30d`, defaulting
// to today. For 7d/30d the figures are the MEAN DAILY intake across the window's
// logged days (unlogged days are excluded, not counted as zero) — see
// services/nutritionWindow.ts. `date` is always the window's anchor/END, and the
// client always sends its LOCAL day so an evening meal can't fall outside it.
//
// The drill-downs take `range` too, and must: a 30-day card reading "Sleep low ·
// 41" that opens a detail screen showing today's 78 is worse than no range at all.

import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { requireAuth } from '../middleware/requireAuth.js';
import {
  runNutritionProfileEngine,
  type ProfileEngineOutput, type BodySystemScore,
} from '../engine/nutritionProfileEngine.js';
import { foodSourceCandidates, recommendFoods } from '../engine/nutritionRecommendations.js';
import { gainTextFor } from '../engine/nutritionGap.js';
import { rankCandidates } from '../engine/foodFinderRanker.js';
import { remainingForDay } from '../services/nutritionRemaining.js';
import { findNearby } from '../services/foodFinder/nearbyFinder.js';
import {
  NUTRIENTS, BODY_SYSTEMS, getNutrient, driversForSystem, type BodySystemId,
} from '../engine/nutrientRegistry.js';
import { generateProfileNarration, generateNutrientWhy } from '../services/llmService.js';
import { buildRAGContext } from '../services/ragService.js';
import { parseJsonObject } from '../services/nutritionShared.js';
import {
  loadWindow, parseRange, periodLabelFor, periodSuffixFor,
  type ProfileRange, type NutritionWindow,
} from '../services/nutritionWindow.js';

const router = Router();
const prisma = new PrismaClient();

function todayStr(): string { return new Date().toISOString().slice(0, 10); }

function parseDate(raw: unknown): string {
  return typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : todayStr();
}
const isBodySystem = (s: string): s is BodySystemId => BODY_SYSTEMS.some(b => b.id === s);

// Run the engine over a loaded window. Single place so the day profile and
// every drill-down score identically for the same range — the invariant that
// keeps a card and the screen it opens from contradicting each other.
function runForWindow(win: NutritionWindow): ProfileEngineOutput {
  return runNutritionProfileEngine({
    totals: win.avgTotals,
    bodyweightKg: win.bodyweightKg,
    mealsLogged: win.mealCount,
  });
}

// Additive fields describing the window. Present on every range including
// today, so the client never has to infer the shape it's looking at — and so a
// new app talking to an old server can detect the missing `range` and refuse to
// render today's numbers under a "30 days" pill.
function windowMeta(win: NutritionWindow) {
  return {
    range: win.range,
    windowDays: win.windowDays,
    startDate: win.startDate,
    endDate: win.endDate,
    loggedDays: win.loggedDays,
    partialDays: win.partialDays,
    avgDaily: win.range !== 'today',
    daysOverCeiling: win.daysOverCeiling,
  };
}

// Averaging intake and THEN scoring is not the same as scoring each day and
// averaging the scores — 1650/0 mg choline averages to 825 (150%, capped to a
// full 100% coverage) where the per-day scores average 50%. We must feed the
// engine averaged intake, because the effect/nutrient screens render real
// `amount / target` rows and recommendFoods needs a gap in nutrient units.
// So we return both, and the client labels them differently: the hero is "your
// typical day", the trend chart is "day by day".
function meanDailyStats(win: NutritionWindow) {
  const perDay = [...win.dayTotals.values()].map(totals =>
    runNutritionProfileEngine({ totals, bodyweightKg: win.bodyweightKg, mealsLogged: 0 }));
  if (perDay.length === 0) return { meanDailyProfileScore: 0, meanDailyCoveragePct: 0 };
  const mean = (xs: number[]) => Math.round(xs.reduce((s, x) => s + x, 0) / xs.length);
  return {
    meanDailyProfileScore: mean(perDay.map(p => p.profileScore)),
    meanDailyCoveragePct: mean(perDay.map(p => p.microCoveragePct)),
  };
}

// The single-day `meals` list needs columns the window path deliberately skips
// (ingredient blobs), so it stays its own query. Totals still come from the
// window loader so the two paths can't diverge.
async function loadDayMeals(userId: string, date: string) {
  return prisma.mealEntry.findMany({
    where: { userId, date },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true, name: true, mealType: true, calories: true,
      proteinG: true, carbsG: true, fatG: true,
      nutrientMapJson: true, nutrientsJson: true, ingredientsJson: true,
      ingredientNutrientsJson: true, createdAt: true,
    },
  });
}

// Deterministic quantified fallbacks — used when the LLM is unavailable so the
// screen always has grounded copy (§8: never a claim without a number).
// `period` is "today" or "on a typical day"; nothing here may hardcode "today"
// or a 30-day window would assert a claim about a single day.
// `period` is the bare word ("today" / "on a typical day"); `clause` is the same
// with a leading space, and EMPTY for today — that keeps the today copy
// byte-identical to what shipped, so the range work is provably additive.
function fallbackHeadline(out: ProfileEngineOutput, period: string): string {
  const clause = period === 'today' ? '' : ` ${period}`;
  const worst = [...out.systems].sort((a, b) => a.score - b.score)[0];
  if (!worst) {
    return period === 'today'
      ? `Logged ${out.kcalLogged} kcal today.`
      : `Averaging ${out.kcalLogged} kcal a day.`;
  }
  if (out.profileScore >= 75) return `Fueling well${clause} — profile score ${out.profileScore}, ${worst.name.toLowerCase()} the one to watch at ${worst.score}.`;
  return `Under-supporting ${worst.name.toLowerCase()} at ${worst.score}/100${clause} — profile score ${out.profileScore}.`;
}
function fallbackDriver(sys: BodySystemScore, period: string): string {
  const d = sys.drivers[0];
  if (!d) return `${sys.name} scored ${sys.score} of 100 ${period}.`;
  return `${d.label} at ${d.pct}% of target is holding ${sys.name.toLowerCase()} to ${sys.score}.`;
}

// GET /nutrition-profile?date=&range=
router.get('/nutrition-profile', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.id;
    const date = parseDate(req.query.date);
    const range = parseRange(req.query.range);
    const isToday = range === 'today';

    // For today, `meals` is part of the payload; for a window it isn't (a month
    // of undifferentiated rows is neither readable nor a bounded payload), so
    // only pay for the wide select when it's actually rendered — and hand those
    // rows to the window loader so today still costs a single meal query.
    const meals = isToday ? await loadDayMeals(userId, date) : [];
    const win = await loadWindow(userId, date, range, isToday ? meals : undefined);

    if (win.loggedDays === 0) {
      return res.json(isToday
        ? { date, hasData: false, mealsLogged: 0, ...windowMeta(win) }
        : { date, hasData: false, mealsLogged: 0, ...windowMeta(win), days: win.days });
    }

    const engine = runForWindow(win);
    const period = periodSuffixFor(range);

    // Best-effort narration with deterministic fallback. ONE call regardless of
    // range — the window is averaged before narration, never narrated per day.
    let headline = fallbackHeadline(engine, period);
    const driverByName: Record<string, string> = {};
    for (const s of engine.systems) driverByName[s.name] = fallbackDriver(s, period);
    try {
      const coverageNote = isToday ? '' : `, across ${win.loggedDays} of ${win.windowDays} days logged`;
      const kcalNote = isToday ? `kcal ${engine.kcalLogged}` : `avg ${engine.kcalLogged} kcal/day`;
      const narration = await generateProfileNarration({
        headlineFacts: `${kcalNote}, micronutrient coverage ${engine.microCoveragePct}%, profile score ${engine.profileScore}${coverageNote}`,
        systems: engine.systems.map(s => ({
          name: s.name, status: s.status, score: s.score,
          topDriver: s.drivers[0] ? `${s.drivers[0].label} ${s.drivers[0].pct}%` : 'n/a',
        })),
        ...(isToday ? {} : {
          periodLabel: periodLabelFor(range, win.loggedDays),
          loggedDays: win.loggedDays,
          windowDays: win.windowDays,
        }),
      });
      if (narration.headline) headline = narration.headline;
      for (const [name, sentence] of Object.entries(narration.drivers)) {
        if (sentence) driverByName[name] = sentence;
      }
    } catch { /* keep fallbacks */ }

    // Top move = the #1 recommendation for the window. Same coverage vector the
    // /recommendations route uses at this range, so the card the user taps is
    // the first item in the list it opens.
    const recs = recommendFoods(engine.coverage, win.bodyweightKg, 1);
    const topRec = recs[0] ?? null;

    res.json({
      date,
      hasData: true,
      mealsLogged: isToday ? meals.length : win.mealCount,
      kcalLogged: engine.kcalLogged,
      microCoveragePct: engine.microCoveragePct,
      profileScore: engine.profileScore,
      profileScoreProvisional: true, // spec §11 — formula pending science sign-off
      headline,
      systems: engine.systems.map(s => ({
        id: s.id, name: s.name, status: s.status, score: s.score,
        driver: driverByName[s.name] ?? fallbackDriver(s, period),
        chips: s.chips,
      })),
      topMove: topRec && {
        title: topRec.name,
        mechanism: mechanismSentence(topRec.primaryNutrientKey),
        gain: topRec.primaryGainText,
      },
      ...(isToday
        ? {
          meals: meals.map(m => ({
            id: m.id, name: m.name, mealType: m.mealType, calories: Math.round(m.calories),
          })),
        }
        : {
          // One row per calendar day, so the window view has a readable
          // substitute for the meals list and somewhere to disclose coverage.
          days: win.days,
          ...meanDailyStats(win),
        }),
      ...windowMeta(win),
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
    const date = parseDate(req.query.date);
    const range = parseRange(req.query.range);

    const win = await loadWindow(userId, date, range);
    if (win.loggedDays === 0) return res.json({ systemId, hasData: false, ...windowMeta(win) });
    const engine = runForWindow(win);
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

    // Ceiling drivers are exposure, not a mean — an averaged sodium figure that
    // reads "ok" can still hide a 4600 mg day. Surface the spike count.
    const ceilingSpikes = drivers
      .map(d => ({ key: d.key, label: d.label, days: win.daysOverCeiling[d.key] ?? 0 }))
      .filter(d => d.days > 0);

    res.json({
      systemId,
      name: sys.name,
      status: sys.status,
      score: sys.score,
      summary: `${sys.name} scored ${sys.score} of 100 ${periodSuffixFor(range)}; ${drivers[0] ? `${drivers[0].label} at ${drivers[0].pct}% is the lever.` : ''}`.trim(),
      drivers,
      mechanisms,
      watchFor: watch,
      ceilingSpikes,
      ...windowMeta(win),
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
    const date = parseDate(req.query.date);
    const range = parseRange(req.query.range);

    const win = await loadWindow(userId, date, range);
    const engine = runForWindow(win);
    const cov = engine.coverage.find(c => c.key === def.key)!;
    // Under a window every figure here is per day, and the copy has to say so
    // or "add 210 mg of choline" reads as a one-off top-up for a month's gap.
    const perDay = range === 'today' ? '' : ' a day';

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
      recommendation: buildNutrientRec(def, cov, perDay),
      watchFor: def.watchFor ?? null,
      // Per-nutrient spike counts ride in windowMeta's daysOverCeiling map —
      // the client indexes it by this nutrient's key.
      ...windowMeta(win),
    });
  } catch (err) {
    console.error('Nutrient detail error:', err);
    res.status(500).json({ error: 'Failed to load nutrient detail' });
  }
});

// `cov.target` is the EFFECTIVE target (bodyweight-scaled via effectiveTarget),
// `def.target` is the raw registry floor. Using def.target here made the advice
// contradict the target rendered directly above it — a 100 kg user saw
// "120 / 160 g" over "Add about 10 g" when the real gap was 40.
function buildNutrientRec(
  def: ReturnType<typeof getNutrient> & object,
  cov: { amount: number; target: number; unit?: string; pct: number; ceiling: boolean },
  perDay = '',
): string {
  if (cov.ceiling) {
    return cov.pct > 100
      ? `Pull ${def.label.toLowerCase()} back toward ${cov.target} ${def.unit}${perDay} — you're at ${cov.amount}.`
      : `${def.label} is in range at ${cov.amount} ${def.unit}${perDay}. Hold it here.`;
  }
  const gap = Math.max(0, cov.target - cov.amount);
  return gap > 0
    ? `Add about ${Math.round(gap)} ${def.unit} of ${def.label.toLowerCase()}${perDay} to reach target.`
    : `${def.label} target met at ${cov.amount} ${def.unit}${perDay}. Maintain.`;
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

// GET /nutrition-profile/trend?range=7d|30d&date=YYYY-MM-DD
// `date` anchors the window to the CALLER's local day (same reason the day
// profile takes one) — anchoring to the server's UTC day would shift the whole
// chart for anyone whose local date differs.
router.get('/nutrition-profile/trend', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.id;
    const range: ProfileRange = req.query.range === '30d' ? '30d' : '7d';
    const end = parseDate(req.query.date);

    // Same loader the ranged profile uses, so the two surfaces can never
    // disagree about window bounds or about what counts as a logged day.
    const win = await loadWindow(userId, end, range);

    const series: Array<{ date: string; coveragePct: number; profileScore: number; logged: boolean }> = [];
    const perNutrientDays = new Map<string, { onTarget: number; total: number }>();
    for (const n of NUTRIENTS) perNutrientDays.set(n.key, { onTarget: 0, total: 0 });

    // This route scores each day SEPARATELY and keeps the variance — that's the
    // whole point of it, and why it isn't folded into the averaged profile. The
    // two numbers legitimately differ (see meanDailyStats).
    for (const day of win.days) {
      const totals = win.dayTotals.get(day.date);
      if (!day.logged || !totals) {
        series.push({ date: day.date, coveragePct: 0, profileScore: 0, logged: false });
        continue;
      }
      const eng = runNutritionProfileEngine({
        totals, bodyweightKg: win.bodyweightKg, mealsLogged: day.mealCount,
      });
      series.push({ date: day.date, coveragePct: eng.microCoveragePct, profileScore: eng.profileScore, logged: true });
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

    // loggedDays lets the client caption the window honestly ("3 of 30 days logged").
    res.json({
      range, series, consistency,
      loggedDays: win.loggedDays,
      partialDays: win.partialDays,
      daysOverCeiling: win.daysOverCeiling,
    });
  } catch (err) {
    console.error('Trend error:', err);
    res.status(500).json({ error: 'Failed to load trend' });
  }
});

// GET /nutrition-profile/recommendations?date=
router.get('/nutrition-profile/recommendations', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.id;
    const date = parseDate(req.query.date);
    const range = parseRange(req.query.range);
    // Same window + same coverage vector the day profile's topMove uses, so the
    // card the user tapped is the first row of the list it opens.
    // `mode=situational` runs the food finder's ranker instead of the flat
    // gap ranker: it decides whether this moment is about macros or micros and
    // weights accordingly, and it accounts for calories, ceilings, and
    // confidence. Opt-in so the shipped surface is untouched until the answers
    // are judged good. Always evaluated against TODAY — "what's left in the
    // day" has no meaning averaged over a 30-day window.
    if (req.query.mode === 'situational') {
      const remaining = await remainingForDay(userId, date);
      const { arbitration, results } = rankCandidates(foodSourceCandidates(), remaining, {
        limit: 8,
        guaranteeBothKinds: false, // Phase 1 has only the ingredient path
      });
      res.json({
        date,
        mode: arbitration.mode,
        why: arbitration.rationale,
        pressures: { macro: arbitration.macroPressure, micro: arbitration.microPressure },
        remaining: {
          kcal: remaining.macros.kcal.remaining,
          proteinG: remaining.macros.proteinG.remaining,
          carbsG: remaining.macros.carbsG.remaining,
          fatG: remaining.macros.fatG.remaining,
        },
        recommendations: results.map(r => ({
          name: r.name,
          serving: (r.meta?.serving as string) ?? '',
          category: (r.meta?.category as string) ?? '',
          kcal: r.kcal,
          gain: r.closes[0] ? gainTextFor(r.closes[0].key, r.closes[0].amount, r.closes[0].label) : '',
          closes: r.closes,
          warns: r.warns,
          mechanism: r.closes[0] ? mechanismSentence(r.closes[0].key) : '',
          score: r.score,
          prefill: { name: `${r.name} (${r.meta?.serving ?? ''})`, source: 'recommendation' },
        })),
      });
      return;
    }

    const win = await loadWindow(userId, date, range);
    const engine = runForWindow(win);
    const recs = recommendFoods(engine.coverage, win.bodyweightKg, 8);
    res.json({
      date,
      ...windowMeta(win),
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

// GET /nutrition-profile/food-finder?lat=&lng=&radius=&openNow=&include=
//
// "What should I eat right now, near me." Merges whole foods (attached to a
// nearby shop that plausibly carries them) with typical dishes at real nearby
// restaurants, ranked together by the situational ranker.
//
// Location is used for the request and never persisted; the Places cache is
// keyed on a ~1 km grid, not on the caller's exact position.
//
// Degrades rather than fails: with no lat/lng, or when Places is unreachable,
// it still answers with whole foods and says so via `degraded`.
router.get('/nutrition-profile/food-finder', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.id;
    const date = parseDate(req.query.date);

    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);
    const hasLocation =
      Number.isFinite(lat) && Number.isFinite(lng) &&
      Math.abs(lat) <= 90 && Math.abs(lng) <= 180 &&
      !(lat === 0 && lng === 0); // a literal null island fix is a client bug, not a place

    const radiusRaw = Number(req.query.radius);
    const radiusM = Number.isFinite(radiusRaw) ? Math.min(Math.max(radiusRaw, 200), 10000) : undefined;

    // include=groceries,takeout — omitted means both.
    const include = typeof req.query.include === 'string' ? req.query.include.split(',') : null;
    const includeGroceries = !include || include.includes('groceries');
    const includeTakeout = !include || include.includes('takeout');

    const remaining = await remainingForDay(userId, date);

    const found = hasLocation
      ? await findNearby(remaining, {
          lat, lng, radiusM,
          limit: 8,
          includeGroceries,
          includeTakeout,
          openNowOnly: req.query.openNow === '1',
        })
      : {
          ...rankCandidates(foodSourceCandidates(), remaining, { limit: 8, guaranteeBothKinds: false }),
          storesFound: 0,
          restaurantsFound: 0,
          degraded: true,
        };

    res.json({
      date,
      mode: found.arbitration.mode,
      why: found.arbitration.rationale,
      pressures: { macro: found.arbitration.macroPressure, micro: found.arbitration.microPressure },
      remaining: {
        kcal: remaining.macros.kcal.remaining,
        proteinG: remaining.macros.proteinG.remaining,
        carbsG: remaining.macros.carbsG.remaining,
        fatG: remaining.macros.fatG.remaining,
      },
      nearby: {
        used: hasLocation,
        degraded: found.degraded,
        storesFound: found.storesFound,
        restaurantsFound: found.restaurantsFound,
      },
      recommendations: found.results.map(r => {
        const store = r.meta?.store as { name: string; distanceM: number; openNow: boolean | null } | null | undefined;
        const vendor = r.meta?.vendor as { name: string; distanceM: number; openNow: boolean | null; rating: number | null } | undefined;
        return {
          id: r.id,
          kind: r.kind,
          name: r.name,
          serving: (r.meta?.serving as string) ?? '',
          category: (r.meta?.category as string) ?? '',
          kcal: r.kcal,
          gain: r.closes[0] ? gainTextFor(r.closes[0].key, r.closes[0].amount, r.closes[0].label) : '',
          closes: r.closes,
          warns: r.warns,
          mechanism: r.closes[0] ? mechanismSentence(r.closes[0].key) : '',
          score: r.score,
          // We have no menu feed and no stock feed, so the copy is scoped to
          // what we can actually stand behind: a real place, and a typical dish
          // or a plausibly-stocked food. Never "their bowl has 45 g".
          where: vendor
            ? { name: vendor.name, distanceM: vendor.distanceM, openNow: vendor.openNow, rating: vendor.rating }
            : store
              ? { name: store.name, distanceM: store.distanceM, openNow: store.openNow, rating: null }
              : null,
          note: vendor
            ? `Typical for ${(r.meta?.typicalFor as string ?? 'restaurant').replace(/_/g, ' ')} — estimated, not their menu.`
            : store
              ? `Usually carried at ${store.name}.`
              : null,
          confidence: r.confidence,
          prefill: { name: `${r.name} (${r.meta?.serving ?? ''})`, source: 'food-finder' },
        };
      }),
    });
  } catch (err) {
    console.error('Food finder error:', err);
    res.status(500).json({ error: 'Failed to load food finder' });
  }
});

export default router;
