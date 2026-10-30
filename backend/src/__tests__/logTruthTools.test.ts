// Log truth at the tools (in memory): the date that's saved comes from the
// user's words, the row keeps a trace of why, the card shows the day, and a
// correction sent as a new log finds the one already there.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const db: Record<string, any[]> = { workoutLog: [], mealEntry: [], user: [], agentChange: [], agentCard: [] };
let seq = 0;
const cmp = (val: any, v: any) => {
  if (v && typeof v === 'object' && !(v instanceof Date)) {
    if ('in' in v) return v.in.includes(val);
    if ('gte' in v || 'lte' in v || 'lt' in v) return (v.gte == null || val >= v.gte) && (v.lte == null || val <= v.lte) && (v.lt == null || val < v.lt);
  }
  return val === v;
};
const match = (row: any, where: any = {}) => Object.entries(where).every(([k, v]) => cmp(row[k], v));
function model(name: string) {
  return {
    create: async ({ data }: any) => { const row = { id: data.id ?? `${name}-${++seq}`, createdAt: new Date(), status: 'applied', ...data }; db[name].push(row); return { ...row }; },
    update: async ({ where, data }: any) => { const row = db[name].find((r) => r.id === where.id); Object.assign(row ?? {}, data); return { ...row }; },
    updateMany: async () => ({ count: 0 }),
    findFirst: async ({ where, orderBy }: any = {}) => { const rows = db[name].filter((r) => match(r, where)); if (orderBy?.createdAt === 'desc') rows.sort((a, b) => +b.createdAt - +a.createdAt); return rows[0] ? { ...rows[0] } : null; },
    findUnique: async ({ where }: any) => { const r = db[name].find((row) => match(row, where)); return r ? { ...r } : null; },
    findMany: async ({ where, orderBy }: any = {}) => { const rows = db[name].filter((row) => match(row, where)).map((r) => ({ ...r })); if (orderBy?.createdAt === 'desc') rows.sort((a, b) => +b.createdAt - +a.createdAt); return rows; },
    count: async ({ where }: any = {}) => db[name].filter((row) => match(row, where)).length,
  };
}
vi.mock('@prisma/client', () => ({ PrismaClient: vi.fn(function (this: any) { for (const k of Object.keys(db)) this[k] = model(k); }) }));
vi.mock('../services/cacheService.js', () => ({ cacheDelete: vi.fn(), cacheClearByPrefix: vi.fn(), cacheGet: vi.fn(), cacheSet: vi.fn(), cacheMarkStale: vi.fn() }));
// The workout service: record what would be saved (date + trace), like the real row.
const saved: any[] = [];
vi.mock('../services/workoutLogService.js', () => ({
  createWorkoutLog: vi.fn(async (userId: string, input: any, _source: string, opts: any = {}) => {
    const row = { id: `w-${++seq}`, userId, date: input.date, title: input.title ?? null, exercises: JSON.stringify(input.exercises), createdAt: new Date(), logTrace: JSON.stringify(opts.trace ?? null) };
    db.workoutLog.push(row);
    saved.push(row);
    return { log: row, prs: [], adaptationProposals: [], exercises: input.exercises, moment: null };
  }),
  createWorkoutLogsBulk: vi.fn(), updateWorkoutLog: vi.fn(), deleteWorkoutLog: vi.fn(), restoreWorkoutLog: vi.fn(), addDays: vi.fn(),
}));
vi.mock('../services/logReview/flag.js', () => ({ logReviewOn: vi.fn(async () => false) }));
vi.mock('../agent/loopback.js', () => ({ callApi: vi.fn(async () => ({})) }));

process.env.OPENAI_API_KEY ||= 'test';
process.env.OPENROUTER_API_KEY ||= 'test';
const { WORKOUT_TOOLS, exerciseOverlap, dayRow } = await import('../agent/toolkits/workouts.js');
const { setTurnFacts } = await import('../agent/turnMessage.js');
const { normalizeName } = await import('../services/swap/match.js');
const tool = (n: string) => WORKOUT_TOOLS.find((t: any) => t.name === n)!;
const U = 'saeed';

/** A turn as loadTurn records it: what they wrote and when (Regina is UTC−6). */
function turn(text: string, sentAt: string, prevUser?: { text: string; at: string }) {
  setTurnFacts(U, { text, sentAt, prevUser: prevUser ?? null, prevAssistant: null });
}

beforeEach(() => {
  for (const k of Object.keys(db)) db[k] = [];
  saved.length = 0;
  db.user = [{ id: U, timezone: 'America/Regina', unitPreference: 'imperial', weightKg: 80 }];
  vi.useFakeTimers({ toFake: ['Date'] });
});

describe('log tools put the log on the day the user named', () => {
  it("Saeed's BJJ, Tue 23:36 Regina: the model asks for Monday, it goes on Tuesday, and the row says why", async () => {
    vi.setSystemTime(new Date('2026-10-28T05:36:41Z'));
    turn('Ended the night with BJJ drilled for 15 mins then did 3 rounds of 8 mins of rolling live', '2026-10-28T05:36:30Z');
    const r: any = await tool('log_conditioning').execute({ activity: 'BJJ (drilling + live rolling)', minutes: 39, intensity: 'hard', date: '2026-10-26' }, U);
    expect(r.date).toBe('2026-10-27');
    expect(r.day).toContain('today (Tue 27 Oct), not Mon 26 Oct');
    const trace = JSON.parse(saved[0].logTrace);
    expect(trace).toMatchObject({ via: 'chat', basis: 'overruled', said: 'the night', modelDate: '2026-10-26', tool: 'log_conditioning' });
    expect(trace.local).toBe('Tue 27 Oct, 11:36 pm · America/Regina');
    const cards: any = await tool('log_conditioning').card!({}, r, { userId: U, unit: 'imperial', tz: 'America/Regina', today: '2026-10-27' });
    expect(cards[0].rows[0]).toEqual({ key: 'Day', value: 'Today · Tue 27 Oct' });
  });

  it('"Yesterday I did Muay Thai" goes on yesterday and the card says so in their words', async () => {
    vi.setSystemTime(new Date('2026-10-27T17:28:30Z'));
    turn('Yesterday I also after the gym did Maui Thai for 2 hours', '2026-10-27T17:28:20Z');
    const r: any = await tool('log_conditioning').execute({ activity: 'Muay Thai', minutes: 120, intensity: 'hard' }, U);
    expect(r.date).toBe('2026-10-26');
    expect(JSON.parse(saved[0].logTrace)).toMatchObject({ basis: 'said', said: 'yesterday' });
    const cards: any = await tool('log_conditioning').card!({}, r, { userId: U, unit: 'imperial', tz: 'America/Regina', today: '2026-10-27' });
    expect(cards[0].rows[0]).toEqual({ key: 'Day', value: 'Mon 26 Oct · you said “yesterday”' });
  });

  it('log_workout: "First session of the day…" three hours after a "yesterday" message is today', async () => {
    vi.setSystemTime(new Date('2026-10-27T20:43:29Z'));
    turn('First session of the day Back squat: 4 sets of 4 reps 115lbs 135lbs 205lbs 205lbs', '2026-10-27T20:43:20Z', { text: 'Yesterday I also did Muay Thai for 2 hours', at: '2026-10-27T17:28:30Z' });
    const r: any = await tool('log_workout').execute({ date: '2026-10-26', exercises: [{ name: 'Back Squat', sets: 4, reps: '4', weight: 205 }] }, U);
    expect(r.date).toBe('2026-10-27');
    expect(JSON.parse(saved[0].logTrace)).toMatchObject({ basis: 'overruled', modelDate: '2026-10-26' });
  });

  it('a message split over two minutes keeps the day from the first', async () => {
    vi.setSystemTime(new Date('2026-10-27T17:31:00Z'));
    turn('then 20 min on the air bike', '2026-10-27T17:30:50Z', { text: 'Yesterday I lifted legs', at: '2026-10-27T17:29:00Z' });
    const r: any = await tool('log_conditioning').execute({ activity: 'Air bike', minutes: 20, date: '2026-10-26' }, U);
    expect(r.date).toBe('2026-10-26');
    expect(JSON.parse(saved[0].logTrace)).toMatchObject({ basis: 'context' });
  });

  it('two days named and the model picked neither: nothing saved, the model asks', async () => {
    vi.setSystemTime(new Date('2026-10-27T17:31:00Z'));
    turn('Monday I lifted and Sunday I ran 5k', '2026-10-27T17:30:50Z');
    const r: any = await tool('log_conditioning').execute({ activity: 'Run', minutes: 30, date: '2026-10-27' }, U);
    expect(r.logged).toBeNull();
    expect(r.ask).toMatch(/Ask which day/);
    expect(saved).toHaveLength(0);
  });
});

describe('a correction sent as a new log', () => {
  it("Rashad's climbing: the same activity that day within 3 hours points at the one there (no fourth row)", async () => {
    vi.setSystemTime(new Date('2026-10-26T01:20:19Z'));
    db.workoutLog.push({ id: 'climb1', userId: U, date: '2026-10-25', title: 'Rock climbing · 150 min', exercises: '[]', createdAt: new Date('2026-10-26T01:19:57Z') });
    turn('Change it to moderate', '2026-10-26T01:20:10Z');
    const r: any = await tool('log_conditioning').execute({ activity: 'Rock climbing', minutes: 150, intensity: 'moderate', date: '2026-10-25' }, U);
    // "Change it to moderate" names no day → today (25 Oct in Regina at 19:20).
    expect(r.logged).toBeNull();
    expect(r.duplicateOf.id).toBe('climb1');
    expect(r.say).toContain('update_workout on id climb1');
    expect(saved).toHaveLength(0);
    const second: any = await tool('log_conditioning').execute({ activity: 'Rock climbing', minutes: 60, date: '2026-10-25', secondSession: true }, U);
    expect(second.id).toBeTruthy();
  });

  it('log_workout: the app saved the session, chat logs most of the same lifts again → points at it', async () => {
    vi.setSystemTime(new Date('2026-10-27T02:00:40Z'));
    db.workoutLog.push({ id: 'app1', userId: U, date: '2026-10-26', title: 'Lower — Front Squat / Posterior Chain', exercises: JSON.stringify([{ name: 'Front Squat' }, { name: 'Romanian Deadlifts' }, { name: 'Hammer Curls' }]), createdAt: new Date('2026-10-27T00:18:02Z') });
    turn('135 on squats 10 reps, 12 reps on hammer curls, 235 10 reps on both sets of rdls', '2026-10-27T02:00:30Z');
    const r: any = await tool('log_workout').execute({ exercises: [{ name: 'Front squat', sets: 2, reps: '10', weight: 135 }, { name: 'RDL', sets: 2, reps: '10', weight: 235 }, { name: 'Hammer curl', sets: 2, reps: '12' }] }, U);
    expect(r.duplicateOf?.id).toBe('app1');
    expect(saved).toHaveLength(0);
  });

  it('a different session the same day logs (Saeed’s second lift on Wednesday)', async () => {
    vi.setSystemTime(new Date('2026-10-28T21:17:15Z'));
    db.workoutLog.push({ id: 'light', userId: U, date: '2026-10-28', title: 'Light lifting', exercises: JSON.stringify([{ name: 'Seated Cable Row' }, { name: 'DB RDL' }]), createdAt: new Date('2026-10-28T18:00:00Z') });
    turn('Okay now for Wednesday so far I’ve one this. Back squat 3 sets 3 reps 135lbs 205lbs 225lbs Barbell row 4 sets 6 reps', '2026-10-28T21:17:00Z');
    const r: any = await tool('log_workout').execute({ exercises: [{ name: 'Back Squat', sets: 3, reps: '3', weight: 225 }, { name: 'Overhead Press', sets: 3, reps: '4', weight: 105 }, { name: 'Barbell Row', sets: 4, reps: '6', weight: 185 }, { name: 'Box Jump', sets: 4, reps: '4' }] }, U);
    expect(r.id).toBeTruthy();
    expect(r.date).toBe('2026-10-28');
  });

  it('exerciseOverlap reads spellings the way history does', () => {
    expect(exerciseOverlap(['RDLs', 'hammer curl'], ['Romanian Deadlift', 'Hammer Curls'], normalizeName)).toBeGreaterThanOrEqual(0.5);
    expect(exerciseOverlap(['Box Jump', 'Back Squat'], ['Seated Cable Row'], normalizeName)).toBe(0);
  });

  it('dayRow: today, or the day in their words', () => {
    expect(dayRow({ date: '2026-10-27', basis: 'today' }, '2026-10-27')).toEqual({ key: 'Day', value: 'Today · Tue 27 Oct' });
    expect(dayRow({ date: '2026-10-25', basis: 'picked' }, '2026-10-27')).toEqual({ key: 'Day', value: 'Sun 25 Oct' });
  });
});
