// Flow B1/B2/B4/B5/B6/B7: the diff → program, the expiry rule, the card in
// both ownership modes, the share text, the re-offer and the coach follow-up.
import { describe, it, expect, vi } from 'vitest';

vi.mock('@prisma/client', async () => ({ PrismaClient: (await import('./helpers/memPrisma.js')).PrismaClient }));
vi.mock('../services/cacheService.js', () => ({ cacheDelete: vi.fn(), cacheClearByPrefix: vi.fn(), cacheGet: vi.fn(), cacheSet: vi.fn(), cacheMarkStale: vi.fn() }));

const P = await import('../proactive/prepared.js');

const changes = [
  { day: 'Mon', exercise: 'Sparring', from: 'Hard rounds 6×3', to: 'Drilling 4×3' },
  { day: 'Tue', exercise: 'Back squat', from: '5×5 @ 265', to: '3×5 @ 225' },
  { day: 'Thu', exercise: 'Conditioning', from: 'Bike sprints', to: 'Zone 2 · 35 min' },
];
const work = { title: 'Recovery week', startDate: '2026-11-02', endDate: '2026-11-08', rationale: '23 days out. Deload now, build after.', changes, checkBackAt: '2026-11-09', measureLift: 'Chest-supported row', reasons: ['6 hard sessions in 6 days', 'energy 2/5 at the last 3 check-ins', 'fight Nov 22'] };
const program = { goal: 'Strength', phases: [{ phaseName: 'Base', trainingDays: [
  { day: 'Monday', focus: 'Sparring', exercises: [{ exercise: 'Shadow boxing', sets: 3, reps: '3 min' }] },
  { day: 'Tuesday', focus: 'Lower', exercises: [{ exercise: 'Back Squat', sets: 5, reps: '5', intensity: '265 lb', notes: 'Brace' }, { exercise: 'RDL', sets: 3, reps: '8' }] },
  { day: 'Thursday', focus: 'Conditioning', exercises: [{ exercise: 'Assault bike sprints', sets: 8, reps: '20s' }] },
] }] };

describe('dates and expiry', () => {
  it('labels the range and finds the date a weekday names inside it (Nov 2 2026 is a Monday)', () => {
    expect(P.rangeLabel('2026-11-02', '2026-11-08')).toBe('Nov 2–8');
    expect(P.rangeLabel('2026-10-27', '2026-11-02')).toBe('Oct 27 – Nov 2');
    expect(P.dateForDay('Mon', '2026-11-02', '2026-11-08')).toBe('2026-11-02');
    expect(P.dateForDay('Thursday', '2026-11-02', '2026-11-08')).toBe('2026-11-05');
    expect(P.dateForDay('Rest', '2026-11-02', '2026-11-08')).toBeNull();
  });
  it('the first affected session is the earliest changed day at the usual session time', () => {
    expect(P.firstAffectedAt(work, '09:00')).toBe('2026-11-02T09:00:00.000Z');
    expect(P.firstAffectedAt(work, null)).toBe('2026-11-02T00:00:00.000Z');
    expect(P.firstAffectedAt({ ...work, changes: [{ day: 'Someday', exercise: 'x', from: '', to: '' }] }, '09:00')).toBeNull();
  });
  it('B5: expires when the first affected session starts; 48 h only when there is no dated session — never after a session already began', () => {
    const created = '2026-10-30T07:05:00.000Z';
    expect(P.preparedExpiry('2026-11-02T09:00:00.000Z', created)).toBe('2026-11-02T09:00:00.000Z');
    expect(P.preparedExpiry(null, created)).toBe('2026-11-01T07:05:00.000Z');
    expect(P.preparedExpiry('2026-10-29T09:00:00.000Z', created)).toBe('2026-11-01T07:05:00.000Z');
  });
});

describe('the diff becomes the program', () => {
  it('parses schemes', () => {
    expect(P.parseScheme('3×5 @ 225')).toEqual({ sets: 3, reps: '5', rest: '@ 225' });
    expect(P.parseScheme('Hard rounds 6x3')).toEqual({ sets: 6, reps: '3', rest: 'Hard rounds' });
    expect(P.parseScheme('Zone 2 · 35 min')).toEqual({ sets: null, reps: null, rest: 'Zone 2 · 35 min' });
  });
  it('a lift on the day gets its new sets/reps/load and remembers what it was; non-lifting work becomes a note on the day; an unknown day is missed', () => {
    const { program: next, applied, missed } = P.applyWeekChanges(program, [...changes, { day: 'Sat', exercise: 'Rest', from: 'Rest', to: 'Walk' }], 0, 'Recovery week');
    expect(applied).toBe(3);
    expect(missed).toEqual([{ day: 'Sat', exercise: 'Rest', from: 'Rest', to: 'Walk' }]);
    const squat = next.phases[0].trainingDays[1].exercises[0];
    expect(squat).toMatchObject({ sets: 3, reps: '5', intensity: '225', notes: 'Brace · was 5×5 @ 265' });
    expect(next.phases[0].trainingDays[0].notes).toBe('Recovery week: Sparring — Hard rounds 6×3 → Drilling 4×3');
    expect(next.phases[0].trainingDays[2].notes).toMatch(/Conditioning — Bike sprints → Zone 2/);
    expect(program.phases[0].trainingDays[1].exercises[0].sets).toBe(5); // the original is untouched
  });
});

describe('B1 · the card when I run my program', () => {
  const card = P.preparedCard(work, { programNext: {}, programOwner: 'me', prevProgram: '{}', eventId: 'ev1', expiresAt: '2026-11-02T09:00:00.000Z', sessionTime: '09:00' });
  it('Proposed label with the range, a strike-through diff per change, Apply / Not this week ("Keep" is reserved for B3)', () => {
    expect(card.meta?.label).toBe('Proposed · Recovery week · Nov 2–8');
    expect(card.diff).toEqual([
      { key: 'Mon · Sparring', from: 'Hard rounds 6×3', to: 'Drilling 4×3' }, { key: 'Tue · Back squat', from: '5×5 @ 265', to: '3×5 @ 225' }, { key: 'Thu · Conditioning', from: 'Bike sprints', to: 'Zone 2 · 35 min' },
    ]);
    expect(card.actions?.map((a) => a.label)).toEqual(['Apply', 'Not this week']);
    expect(card.why).toBe('23 days out. Deload now, build after.');
    expect(card.expiresAt).toBe('2026-11-02T09:00:00.000Z');
  });
  it('Apply runs the prepared-work op (program + experiment thread); its line is the Adjusted receipt', () => {
    const apply = card.pending?.actions?.apply as any;
    expect(apply.op).toBe('proactive.prepared_apply');
    expect(apply.args).toMatchObject({ title: 'Recovery week', checkBackAt: '2026-11-09', measureLift: 'Chest-supported row' });
    expect(apply.line).toBe('Adjusted — Recovery week · 3 changes to Nov 2–8');
    expect((card.pending?.actions?.keep as any).line).toBe('Not this week');
  });
});

describe('B4/B6 · a coach runs the program', () => {
  it('becomes a message, not an edit: Send to your coach opens the share sheet with the plain-text summary', () => {
    const card = P.preparedCard(work, { programNext: {}, programOwner: 'coach_offline', prevProgram: null, eventId: 'ev1', expiresAt: '2026-11-02T09:00:00.000Z', sessionTime: null });
    expect(card.meta?.label).toBe('Proposed · Recovery week · Nov 2–8 · for your coach');
    expect(card.actions?.[0]).toMatchObject({ label: 'Send to your coach', client: { action: 'share' } });
    expect((card.actions?.[0].client?.args as any).text).toBe(P.shareText(work));
    expect((card.pending?.actions?.send as any).op).toBe('proactive.coach_sent');
    expect(JSON.stringify(card.pending)).not.toMatch(/program\.replace|prepared_apply/);
  });
  it('the coach on Axiom gets it in their inbox (recorded) — still never an edit', () => {
    const card = P.preparedCard(work, { programNext: {}, programOwner: 'coach_axiom', prevProgram: null, eventId: null, expiresAt: 'x', sessionTime: null });
    expect(card.actions?.[0].client).toBeUndefined();
    expect((card.pending?.actions?.send as any).args.via).toBe('inbox');
  });
  it('B6 share text: the changes, the reasons, the attribution — no link', () => {
    const t = P.shareText(work, 'Mark');
    expect(t.split('\n')).toEqual([
      'Recovery week for Mark · Nov 2–8',
      '• Mon sparring Hard rounds 6×3 → Drilling 4×3',
      '• Tue back squat 5×5 @ 265 → 3×5 @ 225',
      '• Thu conditioning Bike sprints → Zone 2 · 35 min',
      'Why: 6 hard sessions in 6 days; energy 2/5 at the last 3 check-ins; fight Nov 22.',
      'Suggested by Axiom',
    ]);
    expect(t).not.toMatch(/http/);
  });
  it('B7: the next evening asks once, with four answers', () => {
    const card = P.coachFollowupCard(work, 't1', 'ev1');
    expect(card.ask?.options).toEqual(['Yes — apply it as sent', 'They changed it', 'They said no', 'No answer yet']);
    expect(card.pending?.answer).toMatchObject({ op: 'proactive.coach_reply', args: { threadId: 't1' } });
  });
});

describe('B5 · expired', () => {
  it('collapses to a muted Expired line naming the day that started', () => {
    expect(P.expiredLine(work, '2026-11-02T09:00:00.000Z')).toBe('Expired — Recovery week · Monday started before it was applied');
    expect(P.expiredLine(work, null)).toBe('Expired — Recovery week · not applied in time');
  });
  it('one smaller re-offer for the rest of the week', () => {
    const card = P.reofferCard(work, '2026-11-02', 'ev1');
    expect(card.fn).toBe('PRO-05');
    expect(card.ask?.options).toEqual(['Yes, Tue–Sun', 'No, train as planned']);
    expect(card.why).toMatch(/last time I’ll ask about this week/);
  });
});
