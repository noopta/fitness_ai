/**
 * /api/lift-diagnostics — the backend surface the conversational diagnostic
 * assumes (handoff §10): resumable sessions, idempotent turns, re-score in
 * place, graded output, tier-gated fix, public read-only link.
 *
 * Prisma is an in-memory fake so the tests exercise real sequencing (claimed
 * turns, replays, plan rows) rather than per-call mock choreography.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';

vi.hoisted(() => {
  process.env.JWT_SECRET = 'test_secret_key_at_least_32_chars_long!!';
  delete process.env.DIAGNOSTIC_FIRST_ONBOARDING_ENABLED;
  process.env.DIAGNOSTIC_FIRST_ONBOARDING_USERS = 'locked@axiom.io';
  process.env.FRONTEND_URL = 'https://axiomtraining.io';
});

const db = vi.hoisted(() => {
  let n = 0;
  const uid = () => `row-${++n}`;
  const tables = {
    session: [] as any[],
    turn: [] as any[],
    plan: [] as any[],
    snapshot: [] as any[],
    user: [] as any[],
  };
  const byKey = (row: any, where: any) => Object.entries(where).every(([k, v]) => row[k] === v);
  const sortBy = (rows: any[], orderBy: any) => {
    if (!orderBy) return rows;
    const [[field, dir]] = Object.entries(orderBy) as [string, string][];
    return [...rows].sort((a, b) => (a[field] > b[field] ? 1 : -1) * (dir === 'desc' ? -1 : 1));
  };
  let clock = 1_000_000;
  const now = () => new Date(++clock);
  const prisma = {
    session: {
      findUnique: vi.fn(async ({ where }: any) => tables.session.find((s) => s.id === where.id) ?? null),
      create: vi.fn(async ({ data }: any) => {
        if (tables.session.some((s) => s.id === data.id)) throw new Error('Unique constraint');
        const row = { isPublic: false, workoutLogId: null, flow: 'wizard', createdAt: now(), updatedAt: now(), ...data };
        tables.session.push(row);
        return row;
      }),
      update: vi.fn(async ({ where, data }: any) => Object.assign(tables.session.find((s) => s.id === where.id), data)),
      findMany: vi.fn(async ({ where, take }: any) =>
        sortBy(tables.session.filter((s) => byKey(s, where)), { updatedAt: 'desc' })
          .slice(0, take)
          .map((s) => ({ ...s, plans: sortBy(tables.plan.filter((p) => p.sessionId === s.id), { createdAt: 'desc' }).slice(0, 1) }))),
    },
    diagnosticTurn: {
      findUnique: vi.fn(async ({ where }: any) => {
        const k = where.sessionId_clientTurnId;
        return tables.turn.find((t) => t.sessionId === k.sessionId && t.clientTurnId === k.clientTurnId) ?? null;
      }),
      findMany: vi.fn(async ({ where, orderBy }: any) => sortBy(tables.turn.filter((t) => byKey(t, where)), orderBy)),
      findFirst: vi.fn(async ({ where, orderBy }: any) => sortBy(tables.turn.filter((t) => byKey(t, where)), orderBy)[0] ?? null),
      create: vi.fn(async ({ data }: any) => {
        if (tables.turn.some((t) => t.sessionId === data.sessionId && t.clientTurnId === data.clientTurnId)) throw new Error('Unique constraint');
        const row = { id: uid(), createdAt: now(), updatedAt: now(), resultJson: '{}', ...data };
        tables.turn.push(row);
        return row;
      }),
      update: vi.fn(async ({ where, data }: any) => Object.assign(tables.turn.find((t) => t.id === where.id), data, { updatedAt: now() })),
      delete: vi.fn(async ({ where }: any) => {
        tables.turn = tables.turn.filter((t) => t.id !== where.id);
      }),
    },
    generatedPlan: {
      findFirst: vi.fn(async ({ where, orderBy }: any) => sortBy(tables.plan.filter((p) => byKey(p, where)), orderBy)[0] ?? null),
      create: vi.fn(async ({ data }: any) => {
        const row = { id: uid(), createdAt: now(), ...data };
        tables.plan.push(row);
        return row;
      }),
    },
    exerciseSnapshot: {
      deleteMany: vi.fn(async ({ where }: any) => {
        tables.snapshot = tables.snapshot.filter((r) => !(r.sessionId === where.sessionId && r.exerciseId === where.exerciseId));
      }),
      create: vi.fn(async ({ data }: any) => {
        tables.snapshot.push(data);
        return data;
      }),
    },
    user: {
      findUnique: vi.fn(async ({ where }: any) => tables.user.find((u) => u.id === where.id) ?? null),
      update: vi.fn(async () => ({})),
    },
  };
  return { tables, prisma, reset: () => { for (const k of Object.keys(tables)) (tables as any)[k] = []; } };
});

vi.mock('@prisma/client', () => ({
  PrismaClient: vi.fn(function (this: any) {
    Object.assign(this, db.prisma);
  }),
}));

const quota = vi.hoisted(() => ({ allowed: true }));
vi.mock('../services/featureUsageService.js', () => ({
  FEATURE: { LIFT_DIAGNOSTIC: 'lift_diagnostic' },
  peekDailyQuota: vi.fn(async () => ({ allowed: quota.allowed })),
  consumeDailyQuota: vi.fn(async () => ({ allowed: quota.allowed })),
  refundDailyQuota: vi.fn(async () => {}),
}));

const PLAN = {
  selected_lift: 'flat_bench_press',
  diagnosis: [{ limiter: 'triceps', limiterName: 'Triceps', confidence: 0.8, evidence: [] }],
  bench_day_plan: {
    primary_lift: { exercise_id: 'flat_bench_press', exercise_name: 'Flat Bench Press', sets: 4, reps: '5', intensity: 'RIR 2', rest_minutes: 3 },
    accessories: [{ exercise_id: 'jm_press', exercise_name: 'JM Press', sets: 3, reps: '8', why: 'Lockout', category: 'targeted', priority: 1, impact: 'high' }],
  },
  progression_rules: ['Add 5 lb'],
  track_next_time: ['Bar speed at lockout'],
  dominance_archetype: { label: 'x', rationale: 'y' },
  efficiency_score: { score: 70, explanation: '' },
  validation_test: { description: 'Paused close-grip test', how_to_run: 'Work up to a 3RM', hypothesis_tested: 'triceps' },
  diagnostic_signals: {
    indices: { triceps_index: { value: 80, confidence: 0.65, sources: [] } },
    phase_scores: [],
    primary_phase: 'lockout',
    primary_phase_confidence: 0.7,
    hypothesis_scores: [{ key: 'triceps_deficit', label: 'Triceps lockout strength', score: 82, category: 'muscle', evidence: [], evidence_facts: [] }],
    efficiency_score: { score: 70, explanation: '', deductions: [] },
  },
};
const generateWorkoutPlan = vi.hoisted(() => vi.fn());
vi.mock('../services/llmService.js', () => ({ generateWorkoutPlan }));
vi.mock('../services/liftDiagnostic/video.js', () => ({ runDiagnosticVideo: vi.fn(), probeBufferDurationSec: vi.fn(async () => 8) }));
const writeThrough = vi.hoisted(() => vi.fn(async () => 'log-1'));
vi.mock('../services/liftDiagnostic/writeThrough.js', () => ({ writeThroughWorkingSets: writeThrough }));
vi.mock('../middleware/rateLimiter.js', () => ({ aiLimiter: (_q: any, _s: any, next: any) => next() }));
vi.mock('../services/posthogClient.js', () => ({ default: { capture: vi.fn(), captureException: vi.fn() } }));

import router from '../routes/liftDiagnostics.js';

const SID = '11111111-2222-4333-8444-555555555555';
const app = express();
app.use(express.json());
app.use('/api', router);

const token = (id: string, email: string) => `Bearer ${jwt.sign({ id, email, tier: 'free' }, process.env.JWT_SECRET!)}`;
const FREE = token('u1', 'free@axiom.io');
const LOCKED = token('u2', 'locked@axiom.io');
let turnN = 0;
const turn = (auth: string, input: any, clientTurnId = `turn-${String(++turnN).padStart(4, '0')}`, sid = SID) =>
  request(app).post(`/api/lift-diagnostics/${sid}/turns`).set('Authorization', auth).send({ clientTurnId, input });

const SET = (weight: number) => ({ weight, sets: 3, reps: 5, unit: 'lb' });

async function toReady(auth = FREE) {
  await turn(auth, { type: 'lift', lift: 'flat_bench_press' });
  await turn(auth, { type: 'main', set: SET(225) });
  await turn(auth, { type: 'accessory', exerciseId: 'close_grip_bench_press', set: SET(165) });
  await turn(auth, { type: 'accessory', exerciseId: 'paused_bench_press', set: SET(205) });
  await turn(auth, { type: 'moveOn' });
  await turn(auth, { type: 'skipVideo' });
  await turn(auth, { type: 'answer', question: 'q0', optionId: 'lockout', text: 'Near lockout', flags: ['hard_at_lockout', 'not_a_flag'] });
  await turn(auth, { type: 'answer', question: 'q1', optionId: 'flare', text: 'Elbows flare early', flags: ['elbows_flare_early'] });
  return turn(auth, { type: 'answer', question: 'q2', optionId: 'same', text: 'About the same', flags: [] });
}

beforeEach(() => {
  db.reset();
  db.tables.user.push(
    { id: 'u1', email: 'free@axiom.io', tier: 'free', unitPreference: 'imperial', trainingAge: 'intermediate' },
    { id: 'u2', email: 'locked@axiom.io', tier: 'free', unitPreference: 'metric' },
  );
  quota.allowed = true;
  generateWorkoutPlan.mockReset().mockResolvedValue(PLAN);
  writeThrough.mockClear();
});

describe('turns', () => {
  it('the lift chip creates the conversation session under the client id', async () => {
    const res = await turn(FREE, { type: 'lift', lift: 'flat_bench_press' });
    expect(res.status).toBe(200);
    expect(db.tables.session).toEqual([expect.objectContaining({ id: SID, userId: 'u1', flow: 'conversation', selectedLift: 'flat_bench_press' })]);
  });

  it('any other first turn on an unknown session is a 404', async () => {
    expect((await turn(FREE, { type: 'moveOn' })).status).toBe(404);
  });

  it('a retried turn replays its result and never double-logs a set', async () => {
    await turn(FREE, { type: 'lift', lift: 'flat_bench_press' });
    const a = await turn(FREE, { type: 'main', set: SET(225) }, 'same-turn-id');
    const b = await turn(FREE, { type: 'main', set: SET(225) }, 'same-turn-id');
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(db.tables.snapshot).toHaveLength(1);
    expect(db.tables.turn.filter((t) => t.clientTurnId === 'same-turn-id')).toHaveLength(1);
    expect(writeThrough).toHaveBeenCalledTimes(1);
  });

  it('stores sets in lbs for the engine and writes them through to the training log', async () => {
    await turn(FREE, { type: 'lift', lift: 'flat_bench_press' });
    await turn(FREE, { type: 'main', set: { weight: 100, sets: 3, reps: 5, unit: 'kg' } });
    expect(db.tables.snapshot[0]).toMatchObject({ exerciseId: 'flat_bench_press', weight: 220.5, repsSchema: '5' });
    expect(writeThrough).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u1', sessionId: SID, lift: 'flat_bench_press' }));
    // the set that triggered the write-through is in it
    expect((writeThrough.mock.calls[0] as any)[0].inputs.main).toEqual({ weight: 100, sets: 3, reps: 5, unit: 'kg' });
  });

  it("rejects an accessory that isn't on the lift's ladder", async () => {
    await turn(FREE, { type: 'lift', lift: 'flat_bench_press' });
    const res = await turn(FREE, { type: 'accessory', exerciseId: 'leg_press', set: SET(400) });
    expect(res.status).toBe(400);
  });

  it("someone else's session is a 404, not a 403", async () => {
    await turn(FREE, { type: 'lift', lift: 'flat_bench_press' });
    expect((await turn(LOCKED, { type: 'main', set: SET(225) })).status).toBe(404);
    expect((await request(app).get(`/api/lift-diagnostics/${SID}`).set('Authorization', LOCKED)).status).toBe(404);
  });

  it('a failed turn frees its claim so Retry can run it again', async () => {
    await toReady();
    generateWorkoutPlan.mockRejectedValueOnce(new Error('LLM down'));
    const failed = await turn(FREE, { type: 'verdict' }, 'verdict-turn');
    expect(failed.status).toBe(500);
    const retried = await turn(FREE, { type: 'verdict' }, 'verdict-turn');
    expect(retried.status).toBe(200);
    expect(retried.body.result.verdict.grade).toBe(2);
  });

  it('a re-score that fails and is retried leaves one snapshot for the lift', async () => {
    await toReady();
    await turn(FREE, { type: 'verdict' });
    await turn(FREE, { type: 'addNumbers' });
    generateWorkoutPlan.mockRejectedValueOnce(new Error('LLM down'));
    expect((await turn(FREE, { type: 'accessory', exerciseId: 'overhead_press', set: SET(150) }, 'late-set')).status).toBe(500);
    expect((await turn(FREE, { type: 'accessory', exerciseId: 'overhead_press', set: SET(150) }, 'late-set')).status).toBe(200);
    expect(db.tables.snapshot.filter((r) => r.exerciseId === 'overhead_press')).toHaveLength(1);
  });

  it('a second verdict tap returns the existing verdict without spending another diagnosis', async () => {
    const { consumeDailyQuota } = await import('../services/featureUsageService.js');
    vi.mocked(consumeDailyQuota).mockClear();
    await toReady();
    await turn(FREE, { type: 'verdict' });
    const again = await turn(FREE, { type: 'verdict' });
    expect(again.body.result.verdict.grade).toBe(2);
    expect(consumeDailyQuota).toHaveBeenCalledTimes(1);
    expect(generateWorkoutPlan).toHaveBeenCalledTimes(1);
  });
});

describe('daily limit (§8)', () => {
  it('blocks on the final answer with the answer saved', async () => {
    quota.allowed = false;
    const res = await toReady();
    expect(res.body.result).toEqual({ limitReached: true });
    const load = await request(app).get(`/api/lift-diagnostics/${SID}`).set('Authorization', FREE);
    expect(load.body.limit).toEqual({ reached: true });
    expect(load.body.turns.at(-1).input).toMatchObject({ type: 'answer', question: 'q2' });
  });

  it('a verdict tap over the limit returns limitReached without generating', async () => {
    await toReady();
    quota.allowed = false;
    const res = await turn(FREE, { type: 'verdict' });
    expect(res.body.result).toEqual({ limitReached: true });
    expect(generateWorkoutPlan).not.toHaveBeenCalled();
  });
});

describe('verdict + re-score', () => {
  it('generates a graded verdict and persists it with the legacy plan shape', async () => {
    await toReady();
    const res = await turn(FREE, { type: 'verdict' });
    const v = res.body.result.verdict;
    expect(v).toMatchObject({ grade: 2, ratiosLogged: 2, answersGiven: 3, fix: { locked: false } });
    expect(v.evidence.map((e: any) => e.tag)).toContain('RATIO');
    const flags = generateWorkoutPlan.mock.calls[0][0].sessionFlags;
    expect(flags).toMatchObject({ hard_at_lockout: true, elbows_flare_early: true });
    expect(flags.not_a_flag).toBeUndefined();
    const stored = JSON.parse(db.tables.plan[0].planJson);
    expect(stored.diagnosis[0].limiterName).toBe('Triceps');
    expect(stored.conversation_verdict.grade).toBe(2);
  });

  it('a late ratio re-scores the same session and does not spend another diagnosis', async () => {
    const { consumeDailyQuota } = await import('../services/featureUsageService.js');
    vi.mocked(consumeDailyQuota).mockClear();
    await toReady();
    await turn(FREE, { type: 'verdict' });
    await turn(FREE, { type: 'addNumbers' });
    const res = await turn(FREE, { type: 'accessory', exerciseId: 'overhead_press', set: SET(150) });
    expect(res.body.result.verdict.ratiosLogged).toBe(3);
    expect(db.tables.session).toHaveLength(1);
    expect(db.tables.plan).toHaveLength(2);
    expect(consumeDailyQuota).toHaveBeenCalledTimes(1);
  });

  it('locks only the fix for a diagnostic-first free user, in the turn and on reload', async () => {
    const sid = '99999999-2222-4333-8444-555555555555';
    await turn(LOCKED, { type: 'lift', lift: 'flat_bench_press' }, undefined, sid);
    await turn(LOCKED, { type: 'main', set: SET(100) }, undefined, sid);
    await turn(LOCKED, { type: 'moveOn' }, undefined, sid);
    const res = await turn(LOCKED, { type: 'verdict' }, undefined, sid);
    expect(res.body.result.verdict.fix).toEqual({ locked: true, accessoryCount: 1 });
    expect(JSON.stringify(res.body)).not.toContain('JM Press');
    const load = await request(app).get(`/api/lift-diagnostics/${sid}`).set('Authorization', LOCKED);
    expect(JSON.stringify(load.body)).not.toContain('JM Press');
    expect(load.body.unit).toBe('kg');
    const report = await request(app).get(`/api/lift-diagnostics/${sid}/report`).set('Authorization', LOCKED);
    expect(report.body.verdict.fix.locked).toBe(true);
  });
});

describe('resume, list, share', () => {
  it('load returns the transcript in seq order for replay', async () => {
    await toReady();
    const res = await request(app).get(`/api/lift-diagnostics/${SID}`).set('Authorization', FREE);
    expect(res.body.session).toMatchObject({ id: SID, lift: 'flat_bench_press', flow: 'conversation' });
    expect(res.body.turns.map((t: any) => t.input.type)).toEqual(['lift', 'main', 'accessory', 'accessory', 'moveOn', 'skipVideo', 'answer', 'answer', 'answer']);
    expect(res.body.turns[1].input.set).toEqual({ weight: 225, sets: 3, reps: 5, unit: 'lb' });
  });

  it('list shows in-progress and complete rows', async () => {
    await toReady();
    let res = await request(app).get('/api/lift-diagnostics').set('Authorization', FREE);
    expect(res.body.diagnostics[0]).toMatchObject({ id: SID, flow: 'conversation', status: 'in_progress', grade: null });
    await turn(FREE, { type: 'verdict' });
    res = await request(app).get('/api/lift-diagnostics').set('Authorization', FREE);
    expect(res.body.diagnostics[0]).toMatchObject({ status: 'complete', grade: 2, limiter: { phase: 'lockout' } });
  });

  it('share returns a /diagnostics link and the public view is read-only and still-free', async () => {
    await toReady();
    await turn(FREE, { type: 'verdict' });
    expect((await request(app).get(`/api/lift-diagnostics/${SID}/public`)).status).toBe(404);
    const share = await request(app).post(`/api/lift-diagnostics/${SID}/share`).set('Authorization', FREE);
    expect(share.body.shareUrl).toBe(`https://axiomtraining.io/diagnostics/${SID}`);
    const pub = await request(app).get(`/api/lift-diagnostics/${SID}/public`);
    expect(pub.status).toBe(200);
    expect(pub.body.verdict.grade).toBe(2);
  });
});
