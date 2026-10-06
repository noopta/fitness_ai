// Reading workouts pasted from a notes app. The model's reply is faked; what
// is tested is that whatever it says is checked before the app sees it.

import { describe, it, expect, vi } from 'vitest';

// The default completion goes through chatClient, which builds API clients at
// import; every test here passes its own fake, so stub the module.
vi.mock('../services/chatClient.js', () => ({ chatComplete: vi.fn() }));

import { coerceParsedNotes, parseWorkoutNotes, recentCalendar, olderCalendar, chunkNotes, snapToWeekday } from '../services/workoutNotesParser.js';

const TODAY = '2026-10-02';

describe('coerceParsedNotes', () => {
  it('keeps what was written, in the user\'s unit', () => {
    const out = coerceParsedNotes({
      workouts: [{ date: '2026-09-29', title: 'Push', exercises: [
        { name: 'Bench press', sets: 3, reps: '8', weight: 135, weightUnit: null, rpe: 8 },
        { name: 'Incline DB press', sets: '3', reps: 10, weight: 25, weightUnit: 'kg' },
        { name: 'Push-ups', sets: 2, reps: '20', weight: null, bodyweight: true },
      ] }],
      unparsed: ['felt tired'],
    }, 'imperial', TODAY);
    expect(out.workouts).toEqual([{ date: '2026-09-29', title: 'Push', exercises: [
      { name: 'Bench press', sets: 3, reps: '8', weight: 135, rpe: 8, notes: null, bodyweight: false, setEntries: null },
      { name: 'Incline DB press', sets: 3, reps: '10', weight: 55.1, rpe: null, notes: null, bodyweight: false, setEntries: null },
      { name: 'Push-ups', sets: 2, reps: '20', weight: null, rpe: null, notes: null, bodyweight: true, setEntries: null },
    ] }]);
    expect(out.unparsed).toEqual(['felt tired']);
  });

  it('turns differing sets into set entries, and describes the exercise by its heaviest set', () => {
    const out = coerceParsedNotes({ workouts: [{ date: null, exercises: [
      { name: 'Squat', sets: 1, reps: '5', setEntries: [{ weight: 100, reps: 5 }, { weight: 110, reps: 5 }, { weight: 120, reps: 3 }], weightUnit: 'kg' },
    ] }] }, 'metric', TODAY);
    expect(out.workouts[0].exercises[0]).toMatchObject({ sets: 3, weight: 120, setEntries: [{ weight: 100, reps: 5, rpe: null }, { weight: 110, reps: 5, rpe: null }, { weight: 120, reps: 3, rpe: null }] });
  });

  it('drops future or implausible dates, nameless exercises and empty sessions, and orders by date', () => {
    const out = coerceParsedNotes({ workouts: [
      { date: '2026-10-05', exercises: [{ name: 'Row', sets: 3, reps: '10', weight: 9999 }] },
      { date: '2026-09-30', exercises: [{ name: '', sets: 3 }, { name: 'Curl', sets: 0, reps: '12', rpe: 14 }] },
      { date: '2026-09-28', exercises: [] },
      { date: 'last tuesday', exercises: [{ name: 'Deadlift', sets: 1, reps: '5', weight: 315 }] },
    ] }, 'imperial', TODAY);
    expect(out.workouts.map((w) => [w.date, w.exercises.map((e) => e.name)])).toEqual([['2026-09-30', ['Curl']], [null, ['Row']], [null, ['Deadlift']]]);
    expect(out.workouts[0].exercises[0]).toMatchObject({ sets: 1, rpe: null });
    expect(out.workouts[1].exercises[0].weight).toBeNull();
  });

  it('survives a reply that is not the expected shape', () => {
    for (const bad of [null, 'nope', { workouts: 'x' }, { workouts: [null, 3] }]) expect(coerceParsedNotes(bad, 'imperial', TODAY)).toEqual({ workouts: [], unparsed: [] });
  });
});

describe('parseWorkoutNotes', () => {
  it('tells the model today\'s date and unit, and reads a fenced reply', async () => {
    let sent = '';
    const out = await parseWorkoutNotes('Mon - bench 3x8 135', 'imperial', TODAY, async (p) => {
      sent = p;
      return '```json\n{"workouts":[{"date":"2026-09-28","exercises":[{"name":"Bench press","sets":3,"reps":"8","weight":135}]}]}\n```';
    });
    expect(sent).toContain('Today is Friday 2026-10-02');
    expect(sent).toContain('default unit is lb');
    expect(sent).toContain('Mon - bench 3x8 135');
    expect(sent).toContain('Monday 2026-09-28');
    expect(out.workouts[0]).toMatchObject({ date: '2026-09-28', exercises: [{ name: 'Bench press', weight: 135 }] });
  });
});

describe('recentCalendar', () => {
  it('lists today back two weeks with weekdays', () => {
    const lines = recentCalendar('2026-10-02').split('\n');
    expect(lines).toHaveLength(14);
    expect(lines.slice(0, 5)).toEqual(['Friday 2026-10-02 (today)', 'Thursday 2026-10-01 (yesterday)', 'Wednesday 2026-09-30', 'Tuesday 2026-09-29', 'Monday 2026-09-28']);
  });
});

describe('olderCalendar', () => {
  it('lists the Monday-to-Sunday weeks back from this one and the weekday each month began on', () => {
    const c = olderCalendar('2026-10-06'); // a Tuesday
    expect(c).toMatch(/^Weeks \(Monday to Sunday\), newest first: 2026-10-05 to 2026-10-11; 2026-09-28 to 2026-10-04; /);
    expect(c).toContain('2026-07-20 to 2026-07-26');
    expect(c).toContain('2026-07-01 is a Wednesday');
    expect(c).toContain('2025-10-01 is a Wednesday');
  });
});

describe('chunkNotes', () => {
  it('leaves a short paste whole', () => {
    expect(chunkNotes('July 15\nbench 3x5 225', 6000)).toEqual([{ text: 'July 15\nbench 3x5 225', before: null }]);
  });

  it('splits a long paste before dated lines, and tells each later chunk which heading it falls under', () => {
    const day = (d: number) => `July ${d}\n` + Array.from({ length: 8 }, (_, i) => `exercise ${i} 3x8 135`).join('\n');
    const text = Array.from({ length: 12 }, (_, i) => day(i + 1)).join('\n');
    const chunks = chunkNotes(text, 500);
    expect(chunks.length).toBeGreaterThan(2);
    expect(chunks.map((c) => c.text).join('\n')).toBe(text); // nothing lost or reordered
    expect(chunks[0].before).toBeNull();
    for (const c of chunks.slice(1)) {
      expect(c.text.startsWith('July ')).toBe(true); // breaks land on a date heading
      expect(c.before).toMatch(/^July \d+$/);
    }
  });

  it('carries the heading into a chunk that starts mid-day', () => {
    const text = 'Week of Jul 14\n' + Array.from({ length: 60 }, (_, i) => `Mon squat 5x5 ${200 + i}`).join('\n');
    const chunks = chunkNotes(text, 400);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[1].before).toBe('Week of Jul 14');
  });
});

describe('parseWorkoutNotes over several chunks', () => {
  const block = (label: string) => `${label}\n` + 'x'.repeat(4000);

  it('stitches a session split across a chunk boundary, sorts by date, and keeps going past a bad chunk', async () => {
    const text = [block('July 20'), block('July 21'), block('July 22')].join('\n');
    const replies: Record<string, any> = {
      'July 20': { workouts: [{ date: '2026-07-20', title: 'Legs', exercises: [{ name: 'Squat', sets: 3, reps: '5', weight: 225 }] }] },
      'July 21': 'not json',
      'July 22': { workouts: [{ date: '2026-07-22', title: null, exercises: [{ name: 'Bench press', sets: 3, reps: '5', weight: 185 }] }] },
    };
    const complete = async (p: string) => {
      const key = Object.keys(replies).find((k) => p.includes(`\n${k}\n`) || p.includes(`"\n${k}\n`) || p.includes(`${k}\nxxxx`))!;
      const r = replies[key];
      return typeof r === 'string' ? r : JSON.stringify(r);
    };
    const out = await parseWorkoutNotes(text, 'imperial', '2026-10-06', complete);
    expect(out.workouts.map((w) => w.date)).toEqual(['2026-07-20', '2026-07-22']);
    expect(out.unparsed.some((l) => l.includes('July 21'))).toBe(true);
  });

  it('rethrows when the only chunk fails, as before', async () => {
    await expect(parseWorkoutNotes('bench 3x5', 'imperial', '2026-10-06', async () => 'nope')).rejects.toThrow();
  });
});

describe('snapToWeekday', () => {
  it('moves a date onto the written weekday within its Monday-to-Sunday week', () => {
    expect(snapToWeekday('2026-07-21', 'Mon')).toBe('2026-07-20'); // Tue → Mon
    expect(snapToWeekday('2026-07-23', 'wednesday')).toBe('2026-07-22');
    expect(snapToWeekday('2026-07-25', 'Fri')).toBe('2026-07-24');
    expect(snapToWeekday('2026-07-20', 'Sun')).toBe('2026-07-26');
  });
  it('leaves the date alone when it already matches or no weekday was written', () => {
    expect(snapToWeekday('2026-07-22', 'Wed')).toBe('2026-07-22');
    expect(snapToWeekday('2026-07-22', null)).toBe('2026-07-22');
    expect(snapToWeekday('2026-07-22', 'someday')).toBe('2026-07-22');
  });
  it('is applied when coercing, and a snap past today is dropped', () => {
    const out = coerceParsedNotes({ workouts: [
      { date: '2026-07-21', weekday: 'Mon', exercises: [{ name: 'Deadlift', sets: 1, reps: '3', weight: 315 }] },
      { date: '2026-10-01', weekday: 'Sat', exercises: [{ name: 'Squat', sets: 1, reps: '3', weight: 315 }] },
    ] }, 'imperial', '2026-10-02');
    expect(out.workouts.map((w) => w.date)).toEqual(['2026-07-20', null]);
  });
});
