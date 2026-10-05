// Freestyle release routes: exercise picker (contract 2), freestyle home
// (contract 3), program ↔ freestyle (contract 4), phase GET/POST (contract 6),
// the decide `edits` schema (Adjust path), and /training/overview strength
// without a program. Prisma + neighbours are mocked.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import jwt from 'jsonwebtoken';

process.env.JWT_SECRET = 'test_secret_key_at_least_32_chars_long!!';
process.env.OPENAI_API_KEY = 'test';

const store = vi.hoisted(() => ({
  workouts: [] as any[],
  norm: [] as any[],
  user: {} as any,
  completed: [] as any[],
  flags: { freestyle: false, phase: false, log: false },
  phaseSet: [] as any[],
  decideArgs: null as any,
}));

vi.mock('@prisma/client', () => ({
  PrismaClient: vi.fn(function (this: any) {
    this.user = {
      findUnique: vi.fn(async () => ({ ...store.user })),
      update: vi.fn(async (a: any) => { Object.assign(store.user, a.data); return store.user; }),
    };
    this.workoutLog = { findMany: vi.fn(async (a: any) => {
      const rows = store.workouts.slice().sort((x, y) => (x.date < y.date ? -1 : 1));
      return a?.orderBy?.date === 'desc' ? rows.reverse() : rows;
    }) };
    this.exerciseNormalization = { findMany: vi.fn(async () => store.norm) };
    this.adaptationProposal = { count: vi.fn(async () => 2), findMany: vi.fn(async () => []) };
    this.completedProgram = {
      findMany: vi.fn(async () => store.completed),
      findFirst: vi.fn(async (a: any) => store.completed.filter(c => c.userId === a.where.userId && c.reason === a.where.reason).sort((x, y) => y.endDate - x.endDate)[0] ?? null),
      delete: vi.fn(async (a: any) => { store.completed = store.completed.filter(c => c.id !== a.where.id); }),
    };
    this.formAnalysis = { findMany: vi.fn(async () => []) };
    this.session = { findMany: vi.fn(async () => []) };
  }),
}));
vi.mock('../services/featureFlags.js', () => ({
  freestyleAvailableFor: () => store.flags.freestyle,
  phaseInferenceAvailableFor: () => store.flags.phase,
  logAdaptationAvailableFor: () => store.flags.log,
}));
const PHASE = { inferred: 'cutting', confidence: 0.8, evidence: [], since: null, confirmed: null, effective: 'cutting', maintenanceKcal: 2500, maintenanceSource: 'adaptive', statedGoalMismatch: null };
vi.mock('../services/phaseInference.js', () => ({
  inferPhase: vi.fn(async () => PHASE),
  inferPhaseDetailed: vi.fn(async () => ({ ...PHASE, signals: {} })),
  setConfirmedPhase: vi.fn(async (...a: any[]) => { store.phaseSet.push(a); return null; }),
}));
vi.mock('../services/cacheService.js', () => ({ cacheDelete: vi.fn(), cacheClearByPrefix: vi.fn(), cacheGet: vi.fn(() => null), cacheSet: vi.fn() }));
vi.mock('../services/completedProgramService.js', () => ({
  archiveProgram: vi.fn(async (userId: string, json: string | null, start: Date | null, reason: string) => {
    if (!json) return null;
    const row = { id: 'cp' + (store.completed.length + 1), userId, programJson: json, startDate: start ?? new Date(), endDate: new Date(), reason };
    store.completed.push(row); return { id: row.id };
  }),
}));
vi.mock('../services/trainTogetherService.js', () => ({ deriveSplitLabel: () => 'UL' }));
vi.mock('./../routes/coach.js', () => ({
  buildScheduleData: () => ({ weekDays: [] }), fetchOverridesMap: async () => new Map(), getESTDateString: () => '2026-10-05', addDaysStr: (s: string) => s,
}));
vi.mock('../routes/strength.js', () => ({
  getStrengthProfileCached: vi.fn(async () => ({ lifts: [{ canonicalName: 'Bench Press', current1RMkg: 100, sessionCount: 9, weekSeries: [] }, { canonicalName: 'Squat', current1RMkg: 0 }] })),
  toWeekKey: (s: string) => s,
}));
vi.mock('../adaptation/proposalService.js', () => ({
  adaptationEnabledFor: () => true,
  bootstrap: vi.fn(), listPending: vi.fn(async () => []), listRecent: vi.fn(), undo: vi.fn(),
  decide: vi.fn(async (...a: any[]) => { store.decideArgs = a; return { proposal: { id: a[1] } }; }),
}));

const { default: trainingRoutes } = await import('../routes/training.js');
const { default: adaptationRoutes } = await import('../routes/adaptation.js');
const { listExerciseNames, buildExerciseNameList } = await import('../adaptation/exerciseNames.js');
const { goFreestyle, restoreProgram } = await import('../adaptation/programMode.js');

function app() {
  const a = express();
  a.use(express.json()); a.use(cookieParser());
  a.use('/api', trainingRoutes); a.use('/api', adaptationRoutes);
  // The exercise-names handler is mounted inline (workouts.ts pulls in the whole
  // logging stack); it is a thin wrapper over listExerciseNames.
  a.get('/api/workouts/exercise-names', async (req, res) => res.json({ names: await listExerciseNames('u1', String(req.query.q ?? ''), Number(req.query.limit ?? 20)) }));
  return a;
}
const auth = () => `Bearer ${jwt.sign({ id: 'u1', email: 'a@b.c', tier: 'pro' }, process.env.JWT_SECRET!)}`;
const today = new Date();
const d = (n: number) => new Date(today.getTime() - n * 86400000).toISOString().slice(0, 10);
const w = (id: string, ago: number, names: Array<[string, number, number]>, title: string | null = null) => ({
  id, date: d(ago), title, programDayRef: null,
  exercises: JSON.stringify(names.map(([name, weightKg, reps]) => ({ name, sets: 3, reps: String(reps), weightKg }))),
});

beforeEach(() => {
  store.workouts = []; store.norm = []; store.completed = []; store.phaseSet = []; store.decideArgs = null;
  store.flags = { freestyle: false, phase: false, log: false };
  // Fixture dates are UTC dates, so the user lives in UTC (log dates are the user's local dates).
  store.user = { savedProgram: null, programStartDate: null, unitPreference: 'metric', splitLabel: null, timezone: 'UTC' };
});

describe('exercise picker (contract 2)', () => {
  it('history first (canonicalized, most recent spelling), then the seed library', async () => {
    store.workouts = [w('a', 10, [['bench press', 80, 8]]), w('b', 2, [['Barbell Bench Press', 82.5, 8], ['My Weird Lift', 10, 10]])];
    const res = await request(app()).get('/api/workouts/exercise-names?q=bench&limit=5').set('Authorization', auth());
    expect(res.status).toBe(200);
    const [first, ...rest] = res.body.names;
    expect(first).toMatchObject({ name: 'Barbell Bench Press', canonical: 'Bench Press', source: 'history', lastDate: d(2), count: 2 });
    expect(rest.every((r: any) => r.source === 'library' && /bench/i.test(r.name))).toBe(true);
    expect(rest.some((r: any) => r.canonical === 'Bench Press')).toBe(false);
  });
  it('DB normalization wins; empty query lists recent history', () => {
    const rows = buildExerciseNameList([w('a', 1, [['My Weird Lift', 10, 10]])], new Map([['My Weird Lift', 'Zercher Squat']]), '', 3);
    expect(rows[0]).toMatchObject({ name: 'My Weird Lift', canonical: 'Zercher Squat', source: 'history' });
    expect(rows).toHaveLength(3);
  });
});

describe('GET /training/freestyle (contract 3)', () => {
  it('returns the home payload; enabled/phase follow their flags', async () => {
    store.workouts = [w('a', 14, [['Bench Press', 80, 8]], 'Push'), w('b', 7, [['Bench Press', 82.5, 8], ['Squat', 100, 5]]), w('c', 0, [['Bench Press', 85, 8]])];
    let res = await request(app()).get('/api/training/freestyle').set('Authorization', auth());
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ enabled: false, hasProgram: false, phase: null, pendingProposals: 2 });
    expect(res.body.recentSessions[0]).toMatchObject({ id: 'c', exerciseCount: 1, setCount: 3, topLifts: ['Bench Press'] });
    expect(res.body.recentSessions[2]).toMatchObject({ title: 'Push' });
    expect(res.body.liftTrends[0]).toMatchObject({ key: 'bench press', name: 'Bench Press', lastTop: { weightKg: 85, reps: 8, rpe: null } });
    expect(res.body.weeklySessions).toHaveLength(8);
    expect(res.body.weeklySessions.reduce((s: number, n: number) => s + n, 0)).toBe(3);
    store.flags = { freestyle: true, phase: true, log: false };
    res = await request(app()).get('/api/training/freestyle').set('Authorization', auth());
    expect(res.body.enabled).toBe(true);
    expect(res.body.phase).toMatchObject({ effective: 'cutting' });
    expect(res.body.phase.signals).toBeUndefined();
  });
});

describe('/training/phase (contract 6)', () => {
  it('flag off → GET {enabled:false}, POST 403', async () => {
    expect((await request(app()).get('/api/training/phase').set('Authorization', auth())).body).toEqual({ enabled: false });
    expect((await request(app()).post('/api/training/phase').set('Authorization', auth()).send({ phase: 'cutting' })).status).toBe(403);
  });
  it('flag on → PhaseResult; POST sets user_set or auto clears; bad phase 400', async () => {
    store.flags.phase = true;
    const g = await request(app()).get('/api/training/phase').set('Authorization', auth());
    expect(g.body).toMatchObject({ enabled: true, inferred: 'cutting', effective: 'cutting', maintenanceKcal: 2500 });
    const p = await request(app()).post('/api/training/phase').set('Authorization', auth()).send({ phase: 'building_muscle' });
    expect(p.status).toBe(200);
    expect(store.phaseSet[0]).toEqual(['u1', 'building_muscle', 'user_set']);
    await request(app()).post('/api/training/phase').set('Authorization', auth()).send({ phase: 'auto' });
    expect(store.phaseSet[1][1]).toBe('auto');
    expect((await request(app()).post('/api/training/phase').set('Authorization', auth()).send({ phase: 'shredding' })).status).toBe(400);
  });
});

describe('/training/overview strength without a program', () => {
  it('flag on → strength lifts ship even with no program; flag off → unchanged shape', async () => {
    let res = await request(app()).get('/api/training/overview').set('Authorization', auth());
    expect(res.status).toBe(200);
    expect(res.body.strength).toBeUndefined();
    store.flags.freestyle = true;
    res = await request(app()).get('/api/training/overview').set('Authorization', auth());
    expect(res.body.strength.lifts).toEqual([{ name: 'Bench Press', current1RMkg: 100, sessionCount: 9, weekSeries: [] }]);
  });
});

describe('decide edits schema (Adjust path)', () => {
  it('accepts reps/sets per edit and maps toWeightKg → targetWeightKg', async () => {
    const res = await request(app()).post('/api/adaptation/p1/decide').set('Authorization', auth())
      .send({ action: 'apply', edits: [{ key: 'bench press', toWeightKg: 85, reps: 6, sets: 4 }, { key: 'squat', targetWeightKg: 100, reps: '5' }] });
    expect(res.status).toBe(200);
    expect(store.decideArgs[3].edits).toEqual([
      { key: 'bench press', targetWeightKg: 85, reps: '6', sets: 4 },
      { key: 'squat', targetWeightKg: 100, reps: '5' },
    ]);
  });
  it('old clients ({key, targetWeightKg}) still work', async () => {
    const res = await request(app()).post('/api/adaptation/p1/decide').set('Authorization', auth()).send({ action: 'apply', edits: [{ key: 'b', targetWeightKg: null }] });
    expect(res.status).toBe(200);
    expect(store.decideArgs[3].edits).toEqual([{ key: 'b', targetWeightKg: null }]);
  });
});

describe('program ↔ freestyle (contract 4)', () => {
  const prog = JSON.stringify({ phases: [{ trainingDays: [{ day: 'A', exercises: [] }] }] });
  it('goFreestyle archives with reason "freestyle" and clears the program', async () => {
    store.user = { savedProgram: prog, programStartDate: new Date(Date.now() - 21 * 86400000), splitLabel: 'UL' };
    const r = await goFreestyle('u1');
    expect(r).toEqual({ ok: true, archivedId: 'cp1' });
    expect(store.completed[0].reason).toBe('freestyle');
    expect(store.user).toMatchObject({ savedProgram: null, programStartDate: null, splitLabel: null });
  });
  it('goFreestyle with no program → 409', async () => {
    await expect(goFreestyle('u1')).rejects.toMatchObject({ status: 409 });
  });
  it('restore brings back the latest freestyle archive at the same week and drops the archive', async () => {
    const start = new Date(Date.now() - 30 * 86400000), end = new Date(Date.now() - 9 * 86400000);
    store.completed = [{ id: 'old', userId: 'u1', programJson: prog, startDate: start, endDate: end, reason: 'freestyle' }];
    const r = await restoreProgram('u1');
    expect(r.ok).toBe(true);
    expect(store.user.savedProgram).toBe(prog);
    const weeksIn = (Date.now() - store.user.programStartDate.getTime()) / (7 * 86400000);
    expect(weeksIn).toBeCloseTo(3, 1);
    expect(store.completed).toHaveLength(0);
  });
  it('restore with nothing archived → 404', async () => {
    await expect(restoreProgram('u1')).rejects.toMatchObject({ status: 404 });
  });
});
