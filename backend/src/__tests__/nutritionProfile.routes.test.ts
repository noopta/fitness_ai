// Nutrition Profile routes — day profile, effect/nutrient detail, meal
// breakdown, trend, recommendations. Prisma + LLM narration + RAG are mocked;
// auth is a real JWT. Verifies the engine wiring, the deterministic narration
// fallback path, ownership checks, and open-vector round-tripping.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import jwt from 'jsonwebtoken';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_secret_key_at_least_32_chars_long!!';

const mocks = vi.hoisted(() => ({
  // update: requireAuth fires a background lastActiveAt write on every request.
  user: { findUnique: vi.fn(), update: vi.fn() },
  mealEntry: { findMany: vi.fn(), findFirst: vi.fn() },
}));
vi.mock('@prisma/client', () => {
  const PrismaClient = vi.fn(function (this: any) { Object.assign(this, mocks); });
  return { PrismaClient };
});

// LLM + RAG mocked. Narration REJECTS by default so tests exercise the
// deterministic fallback; individual tests can override.
const mockNarration = vi.fn();
const mockNutrientWhy = vi.fn();
const mockRag = vi.fn();
vi.mock('../services/llmService.js', () => ({
  generateProfileNarration: mockNarration,
  generateNutrientWhy: mockNutrientWhy,
}));
vi.mock('../services/ragService.js', () => ({ buildRAGContext: mockRag }));

const ME = 'u-1';
const token = jwt.sign({ id: ME, email: 'me@axiom.io', tier: 'free' }, process.env.JWT_SECRET!, { expiresIn: '1h' });

function meal(over: Partial<any> = {}) {
  return {
    id: 'm-1', name: 'Eggs & oats', mealType: 'breakfast', calories: 500,
    proteinG: 30, carbsG: 40, fatG: 18,
    nutrientMapJson: JSON.stringify({ proteinG: 30, cholineMg: 440, ironMg: 3, magnesiumMg: 90, omega3G: 0.3 }),
    nutrientsJson: null, ingredientsJson: JSON.stringify(['eggs', 'oats']),
    ingredientNutrientsJson: JSON.stringify([
      { name: 'eggs', nutrients: { proteinG: 18, cholineMg: 440, vitaminDIU: 120 } },
      { name: 'oats', nutrients: { carbsG: 27, fiberG: 4, magnesiumMg: 60 } },
    ]),
    createdAt: new Date('2026-07-16T08:00:00Z'),
    ...over,
  };
}

async function buildApp() {
  const { default: routes } = await import('../routes/nutritionProfile.js');
  const app = express();
  app.use(cookieParser());
  app.use(express.json());
  app.use('/api', routes);
  return app;
}

beforeEach(() => {
  mocks.user.findUnique.mockReset().mockResolvedValue({ weightKg: 80 });
  mocks.user.update.mockReset().mockResolvedValue({});
  mocks.mealEntry.findMany.mockReset();
  mocks.mealEntry.findFirst.mockReset();
  mockNarration.mockReset().mockRejectedValue(new Error('llm off')); // force fallback
  mockNutrientWhy.mockReset().mockRejectedValue(new Error('llm off'));
  mockRag.mockReset().mockResolvedValue('');
});

describe('GET /nutrition-profile', () => {
  it('returns the empty state when no meals are logged', async () => {
    const app = await buildApp();
    mocks.mealEntry.findMany.mockResolvedValue([]);
    const res = await request(app).get('/api/nutrition-profile?date=2026-07-16').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.hasData).toBe(false);
    expect(res.body.mealsLogged).toBe(0);
  });

  it('builds the day profile with quantified deterministic narration (LLM off)', async () => {
    const app = await buildApp();
    mocks.mealEntry.findMany.mockResolvedValue([meal()]);
    const res = await request(app).get('/api/nutrition-profile?date=2026-07-16').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.hasData).toBe(true);
    expect(res.body.systems).toHaveLength(5);
    // headline + every driver carries a number (spec §8)
    expect(res.body.headline).toMatch(/\d/);
    for (const s of res.body.systems) expect(s.driver).toMatch(/\d/);
    expect(res.body.profileScoreProvisional).toBe(true);
    expect(res.body.topMove?.gain).toMatch(/^\+\d+/);
    expect(res.body.meals[0].id).toBe('m-1');
  });

  it('prefers LLM narration when available', async () => {
    const app = await buildApp();
    mocks.mealEntry.findMany.mockResolvedValue([meal()]);
    mockNarration.mockResolvedValue({
      headline: 'Fueling recovery at 78 — cognition the lever at 61.',
      drivers: { Recovery: 'Protein at 144% is carrying recovery to 78.' },
    });
    const res = await request(app).get('/api/nutrition-profile').set('Authorization', `Bearer ${token}`);
    expect(res.body.headline).toContain('Fueling recovery');
    const recovery = res.body.systems.find((s: any) => s.id === 'recovery');
    expect(recovery.driver).toContain('144%');
  });

  it('falls back to macros+micros for pre-migration entries with no nutrientMap', async () => {
    const app = await buildApp();
    mocks.mealEntry.findMany.mockResolvedValue([meal({
      nutrientMapJson: null,
      nutrientsJson: JSON.stringify({ cholineMg: 300, ironMg: 5 }),
    })]);
    const res = await request(app).get('/api/nutrition-profile').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    // derived totals still produce systems
    expect(res.body.systems.find((s: any) => s.id === 'cognition').score).toBeGreaterThan(0);
  });
});

// The ranged profile: same effects UI, computed from the MEAN DAILY intake
// across the window's LOGGED days. The averaging math is the whole feature, so
// it is pinned from several directions.
describe('GET /nutrition-profile — windowed ranges', () => {
  const AUTH = { Authorization: `Bearer ${token}` };
  const at = (date: string, nutrients: Record<string, number>, over: Partial<any> = {}) =>
    meal({ id: `m-${date}-${over.id ?? '0'}`, date, nutrientMapJson: JSON.stringify(nutrients), ...over });

  it('averages over LOGGED days only — unlogged days are gaps, not zeros', async () => {
    const app = await buildApp();
    // Choline 400 + 700 on 2 of 7 days. Mean over logged days = 550, which is
    // exactly the daily target. Averaging over all 7 would give 157 (29%).
    mocks.mealEntry.findMany.mockResolvedValue([
      at('2026-07-15', { cholineMg: 400 }),
      at('2026-07-16', { cholineMg: 700 }),
    ]);
    const res = await request(app)
      .get('/api/nutrition-profile/effect/cognition?range=7d&date=2026-07-16').set(AUTH);
    expect(res.status).toBe(200);
    const choline = res.body.drivers.find((d: any) => d.key === 'cholineMg');
    expect(choline.amount).toBe(550);
    expect(choline.pct).toBe(100);
    expect(res.body.loggedDays).toBe(2);
    expect(res.body.windowDays).toBe(7);
  });

  it('divides by logged DAYS, not by meals', async () => {
    const app = await buildApp();
    // Day A has two meals (300 + 300 = 600), day B has one with none.
    // Correct: 600 / 2 days = 300. Dividing by 3 meals would give 200.
    mocks.mealEntry.findMany.mockResolvedValue([
      at('2026-07-15', { cholineMg: 300 }, { id: 'a1' }),
      at('2026-07-15', { cholineMg: 300 }, { id: 'a2' }),
      at('2026-07-16', { cholineMg: 0 }, { id: 'b1' }),
    ]);
    const res = await request(app)
      .get('/api/nutrition-profile/effect/cognition?range=7d&date=2026-07-16').set(AUTH);
    const choline = res.body.drivers.find((d: any) => d.key === 'cholineMg');
    expect(choline.amount).toBe(300);
    expect(res.body.loggedDays).toBe(2);
  });

  it('reports kcalLogged as a daily mean, not a window total', async () => {
    const app = await buildApp();
    mocks.mealEntry.findMany.mockResolvedValue([
      at('2026-07-01', { proteinG: 50 }, { calories: 2000 }),
      at('2026-07-16', { proteinG: 50 }, { calories: 3000 }),
    ]);
    const res = await request(app)
      .get('/api/nutrition-profile?range=30d&date=2026-07-16').set(AUTH);
    expect(res.body.kcalLogged).toBe(2500);  // not 5000, not 167
    expect(res.body.avgDaily).toBe(true);
  });

  it('keeps the per-kg target DAILY — the window never multiplies it', async () => {
    const app = await buildApp();
    mocks.user.findUnique.mockResolvedValue({ weightKg: 100 }); // target 1.6*100 = 160
    mocks.mealEntry.findMany.mockResolvedValue([
      at('2026-07-15', { proteinG: 160 }),
      at('2026-07-16', { proteinG: 160 }),
    ]);
    const res = await request(app)
      .get('/api/nutrition-profile/effect/recovery?range=7d&date=2026-07-16').set(AUTH);
    const protein = res.body.drivers.find((d: any) => d.key === 'proteinG');
    expect(protein.target).toBe(160);
    expect(protein.amount).toBe(160);
    expect(protein.pct).toBe(100);
  });

  it('issues ONE ranged query with the right bounds', async () => {
    const app = await buildApp();
    mocks.mealEntry.findMany.mockResolvedValue([at('2026-07-16', { proteinG: 50 })]);
    await request(app).get('/api/nutrition-profile?range=30d&date=2026-07-16').set(AUTH);
    // Guards both an N+1 regression and the -(days-1) off-by-one. The wide
    // per-meal select is today-only, so a window must not add a second query.
    expect(mocks.mealEntry.findMany).toHaveBeenCalledTimes(1);
    expect(mocks.mealEntry.findMany.mock.calls[0][0].where.date)
      .toEqual({ gte: '2026-06-17', lte: '2026-07-16' });
  });

  it('does not add a second meal query to the today path', async () => {
    const app = await buildApp();
    mocks.mealEntry.findMany.mockResolvedValue([meal()]);
    await request(app).get('/api/nutrition-profile?date=2026-07-16').set(AUTH);
    // Today needs the wide per-meal select for its meals list; the window
    // loader reuses those rows rather than re-querying the same day.
    expect(mocks.mealEntry.findMany).toHaveBeenCalledTimes(1);
  });

  it('returns an honest empty state when nothing was logged in the window', async () => {
    const app = await buildApp();
    mocks.mealEntry.findMany.mockResolvedValue([]);
    const res = await request(app)
      .get('/api/nutrition-profile?range=30d&date=2026-07-16').set(AUTH);
    expect(res.status).toBe(200);
    expect(res.body.hasData).toBe(false);
    expect(res.body.loggedDays).toBe(0);
    expect(res.body.windowDays).toBe(30);
    expect(res.body.days).toHaveLength(30);
    expect(JSON.stringify(res.body)).not.toMatch(/null|NaN/);
  });

  it('counts ceiling spikes per day, since averaging hides them', async () => {
    const app = await buildApp();
    // 4600 mg one day and 0 the next averages to exactly the 2300 ceiling and
    // reads "ok". The spike count is the only place the excess survives.
    mocks.mealEntry.findMany.mockResolvedValue([
      at('2026-07-15', { sodiumMg: 4600 }),
      at('2026-07-16', { sodiumMg: 0 }),
    ]);
    const res = await request(app)
      .get('/api/nutrition-profile/effect/energy?range=7d&date=2026-07-16').set(AUTH);
    const sodium = res.body.drivers.find((d: any) => d.key === 'sodiumMg');
    expect(sodium.amount).toBe(2300);
    expect(sodium.status).toBe('ok');            // the known limitation
    expect(res.body.daysOverCeiling.sodiumMg).toBe(1); // ...and its disclosure
    expect(res.body.ceilingSpikes).toContainEqual(
      expect.objectContaining({ key: 'sodiumMg', days: 1 }),
    );
  });

  it('flags lightly-logged days so a thin window can be captioned honestly', async () => {
    const app = await buildApp();
    mocks.mealEntry.findMany.mockResolvedValue([
      at('2026-07-15', { proteinG: 50 }, { calories: 2200 }),
      at('2026-07-16', { proteinG: 1 }, { calories: 5 }), // a black coffee
    ]);
    const res = await request(app)
      .get('/api/nutrition-profile?range=7d&date=2026-07-16').set(AUTH);
    expect(res.body.loggedDays).toBe(2);
    expect(res.body.partialDays).toBe(1);
  });

  it('swaps the meals list for a per-day list on a window', async () => {
    const app = await buildApp();
    mocks.mealEntry.findMany.mockResolvedValue([at('2026-07-16', { proteinG: 50 })]);
    const win = await request(app).get('/api/nutrition-profile?range=7d&date=2026-07-16').set(AUTH);
    expect(win.body.meals).toBeUndefined();
    expect(win.body.days).toHaveLength(7);
    expect(win.body.days[6]).toMatchObject({ date: '2026-07-16', logged: true });
    expect(win.body.days[0].logged).toBe(false);

    const today = await request(app).get('/api/nutrition-profile?date=2026-07-16').set(AUTH);
    expect(today.body.days).toBeUndefined();
    expect(today.body.meals).toHaveLength(1);
  });

  it('also reports the mean of DAILY scores, which is a different statistic', async () => {
    const app = await buildApp();
    // 1650/0 choline: averaged intake is 825 (150%, capped to full coverage),
    // but the per-day scores are 100 and 0. Both are honest; the client labels
    // them differently ("typical day" vs the trend chart's "day by day").
    mocks.mealEntry.findMany.mockResolvedValue([
      at('2026-07-15', { cholineMg: 1650 }),
      at('2026-07-16', { cholineMg: 0 }),
    ]);
    const res = await request(app)
      .get('/api/nutrition-profile?range=7d&date=2026-07-16').set(AUTH);
    expect(res.body.microCoveragePct).toBeGreaterThan(res.body.meanDailyCoveragePct);
    expect(res.body.meanDailyProfileScore).toBeTypeOf('number');
  });

  it('falls back to today for an unknown or hostile range, never 500s', async () => {
    const app = await buildApp();
    mocks.mealEntry.findMany.mockResolvedValue([at('2026-07-16', { proteinG: 50 })]);
    for (const bad of ['90d', '<script>', '']) {
      const res = await request(app)
        .get(`/api/nutrition-profile?range=${encodeURIComponent(bad)}&date=2026-07-16`).set(AUTH);
      expect(res.status).toBe(200);
      expect(res.body.range).toBe('today');
      expect(res.body.windowDays).toBe(1);
    }
  });

  it('is byte-identical for range=today and no range at all', async () => {
    const app = await buildApp();
    mocks.mealEntry.findMany.mockResolvedValue([at('2026-07-16', { proteinG: 50, cholineMg: 300 })]);
    const bare = await request(app).get('/api/nutrition-profile?date=2026-07-16').set(AUTH);
    const explicit = await request(app).get('/api/nutrition-profile?range=today&date=2026-07-16').set(AUTH);
    expect(explicit.body).toEqual(bare.body);
    expect(bare.body.range).toBe('today');
    expect(bare.body.avgDaily).toBe(false);
  });

  it('never says "today" in windowed copy, and still carries numbers', async () => {
    const app = await buildApp();
    mocks.mealEntry.findMany.mockResolvedValue([at('2026-07-16', { proteinG: 50 })]);
    const res = await request(app)
      .get('/api/nutrition-profile?range=30d&date=2026-07-16').set(AUTH);
    // Narration is rejecting (see beforeEach) so this is the deterministic path.
    expect(res.body.headline).toMatch(/\d/);         // §8 invariant holds
    expect(res.body.headline).not.toMatch(/today/i);
    for (const s of res.body.systems) {
      expect(s.driver).toMatch(/\d/);
      expect(s.driver).not.toMatch(/today/i);
    }
  });

  it('narrates a 30-day window in exactly ONE LLM call, with the coverage ratio', async () => {
    const app = await buildApp();
    mocks.mealEntry.findMany.mockResolvedValue([
      at('2026-07-15', { proteinG: 50 }),
      at('2026-07-16', { proteinG: 50 }),
    ]);
    mockNarration.mockResolvedValue({ headline: 'Averaging 2140 kcal a day.', drivers: {} });
    await request(app).get('/api/nutrition-profile?range=30d&date=2026-07-16').set(AUTH);
    expect(mockNarration).toHaveBeenCalledTimes(1); // NOT once per day
    const arg = mockNarration.mock.calls[0][0];
    expect(arg.headlineFacts).toMatch(/2 of 30/);   // anti-hallucination fact
    expect(arg.periodLabel).toMatch(/2 logged days/);
  });

  it('keeps drill-downs consistent with the card that opened them', async () => {
    const app = await buildApp();
    const fixture = [
      at('2026-07-15', { proteinG: 40, cholineMg: 200 }),
      at('2026-07-16', { proteinG: 60, cholineMg: 400 }),
    ];
    mocks.mealEntry.findMany.mockResolvedValue(fixture);

    const profile = await request(app).get('/api/nutrition-profile?range=7d&date=2026-07-16').set(AUTH);
    const card = profile.body.systems.find((s: any) => s.id === 'recovery');
    const detail = await request(app)
      .get('/api/nutrition-profile/effect/recovery?range=7d&date=2026-07-16').set(AUTH);
    // The bug this guards: a 7d card reading 41 opening a screen showing 78.
    expect(detail.body.score).toBe(card.score);
    expect(detail.body.status).toBe(card.status);

    // And the top move must be the first row of the list it links to.
    const recs = await request(app)
      .get('/api/nutrition-profile/recommendations?range=7d&date=2026-07-16').set(AUTH);
    expect(recs.body.recommendations[0].name).toBe(profile.body.topMove.title);
    expect(recs.body.range).toBe('7d');
  });

  it('windows the nutrient detail and says the figures are per day', async () => {
    const app = await buildApp();
    mocks.mealEntry.findMany.mockResolvedValue([
      at('2026-07-15', { cholineMg: 200 }),
      at('2026-07-16', { cholineMg: 400 }),
    ]);
    const res = await request(app)
      .get('/api/nutrition-profile/nutrient/cholineMg?range=30d&date=2026-07-16').set(AUTH);
    expect(res.body.current).toBe('300');           // averaged, not summed
    expect(res.body.range).toBe('30d');
    expect(res.body.why).not.toMatch(/today/i);
    expect(res.body.recommendation).toMatch(/a day/);
  });
});

describe('buildNutrientRec target scaling', () => {
  it('closes the gap against the BODYWEIGHT-SCALED target, not the registry floor', async () => {
    const app = await buildApp();
    // 100 kg → protein target 160 g (1.6/kg), registry floor is 130.
    // Logging 120 g leaves a 40 g gap; against def.target it would say 10 g and
    // contradict the "120 / 160 g" rendered directly above it.
    mocks.user.findUnique.mockResolvedValue({ weightKg: 100 });
    mocks.mealEntry.findMany.mockResolvedValue([meal({
      nutrientMapJson: JSON.stringify({ proteinG: 120 }),
    })]);
    const res = await request(app)
      .get('/api/nutrition-profile/nutrient/proteinG?date=2026-07-16')
      .set('Authorization', `Bearer ${token}`);
    expect(res.body.target).toBe('160');
    expect(res.body.recommendation).toContain('40');
  });
});

describe('GET /nutrition-profile/effect/:systemId', () => {
  it('returns drivers, mechanisms and a watch-for for a valid system', async () => {
    const app = await buildApp();
    mocks.mealEntry.findMany.mockResolvedValue([meal()]);
    const res = await request(app).get('/api/nutrition-profile/effect/cognition').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Cognition & focus');
    expect(res.body.drivers.length).toBeGreaterThan(0);
    expect(res.body.mechanisms.length).toBeGreaterThan(0);
    expect(res.body.drivers.some((d: any) => d.key === 'cholineMg')).toBe(true);
  });

  it('404s an unknown system', async () => {
    const app = await buildApp();
    const res = await request(app).get('/api/nutrition-profile/effect/telepathy').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });
});

describe('GET /nutrition-profile/nutrient/:key', () => {
  it('returns the mechanism chain, sources and a deterministic why (LLM off)', async () => {
    const app = await buildApp();
    mocks.mealEntry.findMany.mockResolvedValue([meal()]);
    const res = await request(app).get('/api/nutrition-profile/nutrient/cholineMg').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.label).toBe('Choline');
    expect(res.body.chain.length).toBeGreaterThan(0);
    expect(res.body.sources.length).toBeGreaterThan(0);
    expect(res.body.sources[0].amount).toMatch(/^\+\d+ mg$/);
    expect(res.body.why).toMatch(/\d/); // quantified fallback
  });

  it('404s an unknown nutrient key', async () => {
    const app = await buildApp();
    const res = await request(app).get('/api/nutrition-profile/nutrient/unobtainium').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });
});

describe('GET /nutrition-profile/meal/:mealId', () => {
  it('returns per-ingredient nutrient chips when resolved', async () => {
    const app = await buildApp();
    mocks.mealEntry.findFirst.mockResolvedValue(meal());
    const res = await request(app).get('/api/nutrition-profile/meal/m-1').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.ingredients[0].resolved).toBe(true);
    expect(res.body.ingredients[0].chips.some((c: string) => /Choline/.test(c))).toBe(true);
    expect(res.body.macros.proteinG).toBe(30);
  });

  it('marks ingredients unresolved when only names are stored (§7)', async () => {
    const app = await buildApp();
    mocks.mealEntry.findFirst.mockResolvedValue(meal({ ingredientNutrientsJson: null }));
    const res = await request(app).get('/api/nutrition-profile/meal/m-1').set('Authorization', `Bearer ${token}`);
    expect(res.body.ingredients[0].resolved).toBe(false);
    expect(res.body.ingredients[0].chips).toHaveLength(0);
  });

  it('404s a meal the user does not own', async () => {
    const app = await buildApp();
    mocks.mealEntry.findFirst.mockResolvedValue(null);
    const res = await request(app).get('/api/nutrition-profile/meal/nope').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });
});

describe('GET /nutrition-profile/trend', () => {
  it('returns the FULL calendar window, marking unlogged days as gaps', async () => {
    const app = await buildApp();
    // Only 2 of the 7 days have meals.
    mocks.mealEntry.findMany.mockResolvedValue([
      meal({ date: '2026-07-15' }),
      meal({ id: 'm-2', date: '2026-07-16' }),
    ]);
    const res = await request(app)
      .get('/api/nutrition-profile/trend?range=7d&date=2026-07-16')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.range).toBe('7d');
    // 7 entries, not 2 — unlogged days must not collapse out of the series.
    expect(res.body.series).toHaveLength(7);
    expect(res.body.series[0].date).toBe('2026-07-10');
    expect(res.body.series[6].date).toBe('2026-07-16');
    expect(res.body.loggedDays).toBe(2);
    const logged = res.body.series.filter((p: any) => p.logged);
    expect(logged.map((p: any) => p.date)).toEqual(['2026-07-15', '2026-07-16']);
    // A gap day is logged:false — NOT a real 0% coverage reading.
    expect(res.body.series[0].logged).toBe(false);
    expect(res.body.consistency[0]).toHaveProperty('pctDaysOnTarget');
  });

  it('supports a 30-day window anchored on the caller local date', async () => {
    const app = await buildApp();
    mocks.mealEntry.findMany.mockResolvedValue([meal({ date: '2026-07-16' })]);
    const res = await request(app)
      .get('/api/nutrition-profile/trend?range=30d&date=2026-07-16')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.range).toBe('30d');
    expect(res.body.series).toHaveLength(30);
    expect(res.body.series[0].date).toBe('2026-06-17'); // 29 days back
    expect(res.body.series[29].date).toBe('2026-07-16');
    expect(res.body.loggedDays).toBe(1);
    // the query window is bounded by the anchor, not the server's UTC day
    expect(mocks.mealEntry.findMany.mock.calls[0][0].where.date)
      .toEqual({ gte: '2026-06-17', lte: '2026-07-16' });
  });

  it('bases consistency on logged days only (the 29 gap days are not misses)', async () => {
    const app = await buildApp();
    // One logged day in a 30-day window, and it clears the choline target
    // (600 >= 550). Denominator must be the 1 logged day, not 30.
    mocks.mealEntry.findMany.mockResolvedValue([meal({
      date: '2026-07-16',
      nutrientMapJson: JSON.stringify({ cholineMg: 600 }),
    })]);
    const res = await request(app)
      .get('/api/nutrition-profile/trend?range=30d&date=2026-07-16')
      .set('Authorization', `Bearer ${token}`);
    expect(res.body.series).toHaveLength(30);
    expect(res.body.loggedDays).toBe(1);
    const choline = res.body.consistency.find((c: any) => c.key === 'cholineMg');
    expect(choline.pctDaysOnTarget).toBe(100); // 1/1 logged, not 1/30
  });
});

describe('GET /nutrition-profile/recommendations', () => {
  it('returns ranked foods with a deep-link prefill payload', async () => {
    const app = await buildApp();
    mocks.mealEntry.findMany.mockResolvedValue([meal({
      nutrientMapJson: JSON.stringify({ proteinG: 30 }), // lots of gaps
    })]);
    const res = await request(app).get('/api/nutrition-profile/recommendations').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.recommendations.length).toBeGreaterThan(0);
    const r = res.body.recommendations[0];
    expect(r.gain).toMatch(/^\+\d+/);
    expect(r.prefill.source).toBe('recommendation');
    expect(r.prefill.name).toContain(r.name);
  });
});
