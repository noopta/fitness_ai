import { describe, it, expect } from 'vitest';
import {
  checkInEvent, decodeCursor, detectPrs, encodeCursor, measurementEvent, messageEvent, pageEvents, parseKinds,
  programEvent, summariseExercises, workoutEvent, SUPPORTED_KINDS,
} from '../services/personalTraining/timeline.js';
import type { TimelineEvent } from '../services/personalTraining/types.js';

const ex = (list: object[]) => JSON.stringify(list);
const at = (iso: string) => new Date(iso);

describe('summariseExercises', () => {
  const json = ex([
    { name: 'Back squat', sets: 3, reps: '5', weightKg: 100 },
    { name: 'Bench press', sets: 3, reps: '8', weightKg: 60 },
    { name: 'Plank', sets: 3, reps: '60s' },
    { name: 'Row', sets: 3, reps: '10', weightKg: 50 },
  ]);
  it('shows the first three lifts in the viewer’s unit and counts the rest', () => {
    expect(summariseExercises(json, 'metric')).toBe('Back squat 3×5 at 100 kg · Bench press 3×8 at 60 kg · Plank 3×60s · 1 more');
    expect(summariseExercises(json, 'imperial')).toContain('Back squat 3×5 at 220 lbs');
  });
  it('survives malformed JSON', () => {
    expect(summariseExercises('{nope', 'metric')).toBe('');
    expect(summariseExercises('{"a":1}', 'metric')).toBe('');
  });
});

describe('detectPrs', () => {
  it('flags a new best but never a lift’s first appearance', () => {
    const prs = detectPrs([
      { id: 'w1', exercises: ex([{ name: 'Back squat', reps: '5', weightKg: 100 }]) },
      { id: 'w2', exercises: ex([{ name: 'back squat ', reps: '5', weightKg: 105 }, { name: 'Deadlift', reps: '3', weightKg: 140 }]) },
      { id: 'w3', exercises: ex([{ name: 'Back squat', reps: '5', weightKg: 105 }]) },
      { id: 'w4', exercises: 'broken' },
    ]);
    expect(prs.get('w1')).toBeUndefined();
    expect(prs.get('w2')).toEqual(['back squat']);
    expect(prs.get('w3')).toBeUndefined();
    expect(prs.size).toBe(1);
  });

  it('ignores unloaded and unparseable sets', () => {
    const prs = detectPrs([
      { id: 'w1', exercises: ex([{ name: 'Pull-up', reps: '8' }]) },
      { id: 'w2', exercises: ex([{ name: 'Pull-up', reps: '10' }, { name: 'Squat', reps: 'amrap', weightKg: 80 }]) },
    ]);
    expect(prs.size).toBe(0);
  });
});

describe('event mappers', () => {
  it('builds a workout event with a PR flag', () => {
    const e = workoutEvent(
      { id: 'w1', createdAt: at('2026-10-01T10:00:00Z'), title: null, exercises: ex([{ name: 'Back squat', sets: 3, reps: '5', weightKg: 100 }]), notes: ' felt strong ', duration: 55 },
      'c1', 'metric', ['Back squat', 'Deadlift'],
    );
    expect(e).toMatchObject({ id: 'workout:w1', kind: 'workout', title: 'Workout', flag: { label: 'PR · Back squat +1', tone: 'green' } });
    expect(e.body).toBe('Back squat 3×5 at 100 kg\n55 min · felt strong');
  });

  it('flags a strained check-in amber and leaves a good one unflagged', () => {
    const row = { id: 'k1', createdAt: at('2026-10-01T10:00:00Z'), mood: 4, energy: 4, sleepHours: 7.5, stress: 2 };
    expect(checkInEvent(row, 'c1').flag).toBeUndefined();
    expect(checkInEvent(row, 'c1').body).toBe('Mood 4/5 · Energy 4/5 · Stress 2/5 · Sleep 7.5 h');
    expect(checkInEvent({ ...row, stress: 5 }, 'c1').flag).toEqual({ label: 'High stress', tone: 'amber' });
    expect(checkInEvent({ ...row, energy: 1 }, 'c1').flag).toEqual({ label: 'Low energy', tone: 'amber' });
  });

  it('shows only the answered parts of a check-in and never flags a skipped one', () => {
    const row = { id: 'k2', createdAt: at('2026-10-01T10:00:00Z'), mood: null, energy: null, sleepHours: 6, stress: null };
    expect(checkInEvent(row, 'c1').body).toBe('Sleep 6 h');
    expect(checkInEvent(row, 'c1').flag).toBeUndefined();
    expect(checkInEvent({ ...row, energy: 2 }, 'c1').body).toBe('Energy 2/5 · Sleep 6 h');
  });

  it('marks only the client’s latest message as unanswered', () => {
    const row = { id: 'm2', createdAt: at('2026-10-01T10:00:00Z'), senderId: 'c1', body: 'Knee is sore' };
    expect(messageEvent(row, 'c1', 'Maya', 'm2')).toMatchObject({ title: 'Maya', flag: { label: 'Unanswered', tone: 'zinc' } });
    expect(messageEvent(row, 'c1', 'Maya', 'm3').flag).toBeUndefined();
    expect(messageEvent({ ...row, senderId: 't1' }, 'c1', 'Maya', 'm2')).toMatchObject({ title: 'You' });
    expect(messageEvent({ ...row, senderId: 't1' }, 'c1', 'Maya', 'm2').flag).toBeUndefined();
  });

  it('formats bodyweight and drops rows with no weight', () => {
    expect(measurementEvent({ id: 'b1', createdAt: at('2026-10-01T10:00:00Z'), weightKg: 82.44, notes: null }, 'c1', 'metric'))
      .toMatchObject({ title: 'Bodyweight', body: '82.4 kg' });
    expect(measurementEvent({ id: 'b2', createdAt: at('2026-10-01T10:00:00Z'), weightKg: null, notes: null }, 'c1', 'metric')).toBeNull();
  });

  it('marks program proposals as Axiom’s and shows where they stand', () => {
    const row = { id: 'p1', createdAt: at('2026-10-01T10:00:00Z'), title: 'Add 2.5 kg to bench', reasoning: 'Hit top of range twice', status: 'pending' };
    expect(programEvent(row, 'c1')).toMatchObject({ ai: true, flag: { label: 'Awaiting client', tone: 'zinc' } });
    expect(programEvent({ ...row, status: 'applied' }, 'c1').flag).toEqual({ label: 'Applied', tone: 'green' });
    expect(programEvent({ ...row, status: 'weird' }, 'c1').flag).toBeUndefined();
  });
});

describe('parseKinds', () => {
  it('defaults to every supported kind and drops unknown ones', () => {
    expect(parseKinds(undefined)).toEqual(SUPPORTED_KINDS);
    expect(parseKinds('checkin, workout,billing')).toEqual(['workout', 'checkin']);
    expect(parseKinds('billing')).toEqual(SUPPORTED_KINDS);
  });
});

describe('cursor paging', () => {
  const e = (id: string, iso: string): TimelineEvent => ({ id, clientId: 'c1', kind: 'workout', at: iso, title: '', body: '' });
  const events = [
    e('workout:a', '2026-10-01T10:00:00.000Z'),
    e('checkin:b', '2026-10-01T10:00:00.000Z'),
    e('workout:c', '2026-09-30T10:00:00.000Z'),
    e('workout:d', '2026-10-02T10:00:00.000Z'),
    e('workout:e', '2026-09-29T10:00:00.000Z'),
  ];

  it('round-trips a cursor and rejects junk', () => {
    const c = decodeCursor(encodeCursor(events[0]));
    expect(c).toEqual({ at: '2026-10-01T10:00:00.000Z', id: 'workout:a' });
    expect(decodeCursor('nope')).toBeNull();
    expect(decodeCursor('not-a-date|x')).toBeNull();
    expect(decodeCursor(undefined)).toBeNull();
  });

  it('walks every event exactly once, newest first, across same-millisecond ties', () => {
    const seen: string[] = [];
    let cursor = null as ReturnType<typeof decodeCursor>;
    for (let i = 0; i < 10; i++) {
      const page = pageEvents(events, cursor, 2);
      seen.push(...page.events.map((x) => x.id));
      if (!page.nextCursor) break;
      cursor = decodeCursor(page.nextCursor);
    }
    expect(seen).toEqual(['workout:d', 'workout:a', 'checkin:b', 'workout:c', 'workout:e']);
  });

  it('returns no cursor when the page is the last one', () => {
    expect(pageEvents(events, null, 5).nextCursor).toBeNull();
    expect(pageEvents([], null).events).toEqual([]);
  });
});
