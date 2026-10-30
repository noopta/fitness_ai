// The reasoner's guard rails: it may cite evidence, never invent it; a
// follow-up needs an open thread; three at most; due threads first.
import { describe, it, expect, vi } from 'vitest';

vi.mock('@prisma/client', async () => ({ PrismaClient: (await import('./helpers/memPrisma.js')).PrismaClient }));
vi.mock('../services/cacheService.js', () => ({ cacheDelete: vi.fn(), cacheClearByPrefix: vi.fn(), cacheGet: vi.fn(), cacheSet: vi.fn(), cacheMarkStale: vi.fn() }));

const { verifyCandidates, renderDossier } = await import('../proactive/reasoner.js');

const evidence = [
  { id: 'streak_days', verb: 'Checked' as const, text: '6 hard days in a row', topics: ['recovery'] },
  { id: 'quote_1', verb: 'Read' as const, text: '“Legs are cooked” · you, yesterday', topics: ['the user said'] },
  { id: 'energy_low', verb: 'Checked' as const, text: 'Energy 2 of 5 at your last 3 check-ins', topics: ['recovery'] },
];
const threads = [{ id: 'fight', status: 'open' }, { id: 'old', status: 'resolved' }];
const c = (over: Record<string, unknown>) => ({ kind: 'checkin', threadId: null, topic: 'recovery', question: 'Six hard days and energy is low. When\'s the fight? If it\'s close, I\'ll build a recovery week around it.', primary: 'It\'s soon', evidence: ['streak_days', 'energy_low'], pushWhyNow: null, area: 'training', ...over });

describe('verifyCandidates', () => {
  it('keeps a candidate whose evidence exists; drops the ids it made up; three evidence lines at most', () => {
    const out = verifyCandidates({ candidates: [c({ evidence: ['streak_days', 'hrv_drop', 'energy_low', 'quote_1', 'soreness'] })] }, evidence, threads);
    expect(out).toHaveLength(1);
    expect(out[0].evidence).toEqual(['streak_days', 'energy_low', 'quote_1']);
  });
  it('drops a candidate with no real evidence, no question, or a long primary', () => {
    expect(verifyCandidates({ candidates: [c({ evidence: ['hrv_drop'] })] }, evidence, threads)).toEqual([]);
    expect(verifyCandidates({ candidates: [c({ question: '' })] }, evidence, threads)).toEqual([]);
    expect(verifyCandidates({ candidates: [c({ primary: 'Yes please build me the whole recovery week now' })] }, evidence, threads)).toEqual([]);
  });
  it('a follow-up must point at an OPEN thread; a thread id makes it a follow-up', () => {
    expect(verifyCandidates({ candidates: [c({ kind: 'followup', threadId: 'old' })] }, evidence, threads)).toEqual([]);
    expect(verifyCandidates({ candidates: [c({ kind: 'followup', threadId: 'nope' })] }, evidence, threads)).toEqual([]);
    const out = verifyCandidates({ candidates: [c({ kind: 'checkin', threadId: 'fight' })] }, evidence, threads);
    expect(out[0]).toMatchObject({ kind: 'followup', threadId: 'fight' });
  });
  it('three candidates at most, follow-ups first; JSON inside prose is fine; garbage is empty', () => {
    const raw = `Sure: ${JSON.stringify({ candidates: [c({}), c({ topic: 'bench' }), c({ threadId: 'fight', topic: 'the fight date' }), c({ topic: 'sleep' })] })}`;
    const out = verifyCandidates(raw, evidence, threads);
    expect(out).toHaveLength(3);
    expect(out[0].topic).toBe('the fight date');
    expect(verifyCandidates('nonsense', evidence, threads)).toEqual([]);
  });
  it('trims and caps the question; keeps a push reason only when given', () => {
    const out = verifyCandidates({ candidates: [c({ question: `  ${'x'.repeat(300)}  `, pushWhyNow: '  Sparring\'s at 9.  ' })] }, evidence, threads);
    expect(out[0].question).toHaveLength(160);
    expect(out[0].pushWhyNow).toBe('Sparring\'s at 9.');
  });
});

describe('renderDossier', () => {
  it('lists due threads before other threads, cites evidence by id, and never mentions HRV', () => {
    const d: any = {
      today: '2026-10-30', tz: 'America/New_York', tier: 'pro', profile: ['goal: strength'],
      threads: [{ id: 'fight', kind: 'event', title: 'Amateur fight · Nov 22', checkBackAt: '2026-11-10', eventDate: '2026-11-22', read: null, sourceQuote: 'got a fight coming up' }, { id: 'q', kind: 'question', title: 'Creatine during the cut?', checkBackAt: '2026-10-30', eventDate: null, read: null, sourceQuote: null }],
      due: [{ id: 'q', kind: 'question', title: 'Creatine during the cut?', read: null, sourceQuote: null }],
      evidence, sessions: [{ date: '2026-10-29', title: 'MMA' }], mealDays: [], checkins: [{ date: '2026-10-29', energy: 2, sleepHours: 6 }], recent: [{ kind: 'checkin', topic: 'hydration', outcome: 'ignored', createdAt: '2026-10-20T07:00:00Z' }],
      sessionCount: 40, mealDayCount: 12, negatives: ['Knee clicking'],
    };
    const text = renderDossier(d);
    expect(text.indexOf('DUE THREADS')).toBeLessThan(text.indexOf('OTHER OPEN THREADS'));
    expect(text).toMatch(/id=q \[question\] Creatine/);
    expect(text).toMatch(/- streak_days: Checked — 6 hard days in a row/);
    expect(text).toMatch(/hydration → ignored/);
    expect(text).toMatch(/WRONG[\s\S]*Knee clicking/);
    expect(text).not.toMatch(/hrv/i);
  });
});
