// Reading arbitrary client spreadsheets: proposing a mapping by rules and
// extracting with plain code. The layouts below are the shapes real coaching
// sheets come in.

import { describe, it, expect } from 'vitest';
import {
  detectDateOrder, extract, findHeaderRow, parseDate, parseSetsReps, parseWeightKg, sanitiseGrids, suggestMapping, validateMapping,
  type Grid,
} from '../services/personalTraining/importParse.js';

const DEFAULTS = { unit: 'kg' as const, dateOrder: 'dmy' as const };
const TODAY = '2026-10-02';
const map = (grids: Grid[], defaults: { unit: 'kg' | 'lb'; dateOrder: 'dmy' | 'mdy' } = DEFAULTS) => grids.map((g) => suggestMapping(g, defaults));

describe('cells', () => {
  it('reads dates in the forms sheets actually use', () => {
    expect(parseDate('2026-09-03', 'dmy')).toBe('2026-09-03');
    expect(parseDate('2026-09-03T00:00:00.000Z', 'dmy')).toBe('2026-09-03');
    expect(parseDate('3/9/2026', 'dmy')).toBe('2026-09-03');
    expect(parseDate('3/9/2026', 'mdy')).toBe('2026-03-09');
    expect(parseDate('03.09.26', 'dmy')).toBe('2026-09-03');
    expect(parseDate('3 Sep 2026', 'mdy')).toBe('2026-09-03');
    expect(parseDate('Sep 3, 2026', 'dmy')).toBe('2026-09-03');
    expect(parseDate('Thursday 3rd September 2026', 'dmy')).toBe('2026-09-03');
    expect(parseDate('46268', 'dmy')).toBe('2026-09-03'); // Excel serial
  });
  it('rejects what is not a date', () => {
    for (const bad of ['', 'Week 3', '31/02/2026', '13/13/2026', '12345678', 'tbc']) expect(parseDate(bad, 'dmy')).toBeNull();
  });
  it('works out day/month order from the data', () => {
    expect(detectDateOrder(['3/9/2026', '25/9/2026'], 'mdy')).toBe('dmy');
    expect(detectDateOrder(['9/3/2026', '9/25/2026'], 'dmy')).toBe('mdy');
    expect(detectDateOrder(['2026-09-03'], 'dmy')).toBe('ymd');
    expect(detectDateOrder(['3/9/2026', '4/9/2026'], 'mdy')).toBe('mdy'); // undecidable → the trainer's habit
  });
  it('reads loads into kilograms, with a unit in the cell winning over the sheet', () => {
    expect(parseWeightKg('100', 'kg')).toBe(100);
    expect(parseWeightKg('225', 'lb')).toBe(102.06);
    expect(parseWeightKg('225 lbs', 'kg')).toBe(102.06);
    expect(parseWeightKg('60kg', 'lb')).toBe(60);
    expect(parseWeightKg('62,5', 'kg')).toBe(62.5);
    for (const none of ['', 'BW', 'bodyweight', '-', 'n/a', 'heavy']) expect(parseWeightKg(none, 'kg')).toBeNull();
  });
  it('reads sets and reps, including "3x5" in one cell', () => {
    expect(parseSetsReps('3', '5')).toEqual({ sets: 3, reps: '5' });
    expect(parseSetsReps('', '3x5')).toEqual({ sets: 3, reps: '5' });
    expect(parseSetsReps('4 x 8-10', '')).toEqual({ sets: 4, reps: '8-10' });
    expect(parseSetsReps('3', 'AMRAP')).toEqual({ sets: 3, reps: 'AMRAP' });
    expect(parseSetsReps('', 'lots')).toEqual({ sets: null, reps: '' });
  });
});

describe('proposing a mapping', () => {
  it('finds a header that is not on the first row', () => {
    const rows = [['Kofi Mensah Coaching — client log'], [''], ['Client', 'Date', 'Exercise', 'Sets', 'Reps', 'Load (kg)'], ['Maya', '3/9/2026', 'Squat', '3', '5', '100']];
    expect(findHeaderRow(rows)).toMatchObject({ headerRow: 2, columns: { client: 0, date: 1, exercise: 2, sets: 3, reps: 4, weight: 5 } });
  });

  it('tells a training log, a client list and a weigh-in log apart', () => {
    const log = suggestMapping({ name: 'Log', rows: [['Athlete', 'Session date', 'Movement', 'Sets', 'Reps', 'Weight (lbs)', 'RPE'], ['Maya', '9/25/2026', 'Squat', '3', '5', '225', '8']] }, DEFAULTS);
    expect(log).toMatchObject({ kind: 'workouts', unit: 'lb', dateOrder: 'mdy', clientFrom: 'column', columns: { client: 0, date: 1, exercise: 2, sets: 3, reps: 4, weight: 5, rpe: 6 } });

    const list = suggestMapping({ name: 'Clients', rows: [['Name', 'Email', 'Phone', 'Goal', 'Injuries'], ['Maya Okafor', 'maya@example.com', '555', 'Squat 100', 'Left knee']] }, DEFAULTS);
    expect(list).toMatchObject({ kind: 'clients', columns: { client: 0, email: 1, phone: 2, goal: 3, injuries: 4 } });

    const weighIns = suggestMapping({ name: 'Weigh-ins', rows: [['Client', 'Date', 'Weight'], ['Maya', '2026-09-01', '68.2']] }, DEFAULTS);
    expect(weighIns).toMatchObject({ kind: 'bodyweight', dateOrder: 'ymd', columns: { client: 0, date: 1, bodyweight: 2 } });
    expect(weighIns.columns.weight).toBeUndefined();
  });

  it('treats a training sheet with no name column as one sheet per client', () => {
    const m = suggestMapping({ name: 'Jordan Lee', rows: [['Date', 'Exercise', 'Sets x Reps', 'kg'], ['3/9/2026', 'Deadlift', '3x5', '140']] }, DEFAULTS);
    expect(m).toMatchObject({ kind: 'workouts', clientFrom: 'sheetName' });
  });

  it('ignores a sheet it cannot place rather than guessing', () => {
    expect(suggestMapping({ name: 'Pricing', rows: [['Package', 'Price'], ['Monthly', '200']] }, DEFAULTS).kind).toBe('ignore');
  });

  it('coerces an untrusted mapping: out-of-range columns and unknown kinds fall back', () => {
    const grid = { name: 'Log', rows: [['Client', 'Date', 'Exercise'], ['Maya', '3/9/2026', 'Squat']] };
    const base = suggestMapping(grid, DEFAULTS);
    const m = validateMapping({ kind: 'nonsense', headerRow: 99, columns: { client: 0, date: 7, exercise: 0, weight: -1 }, unit: 'stone', dateOrder: 'mdy' }, grid, base);
    expect(m.kind).toBe('workouts');
    expect(m.headerRow).toBe(0);
    // A column cannot be claimed twice, and one outside the sheet is dropped.
    expect(m.columns).toEqual({ client: 0 });
    expect(m.unit).toBe('kg');
    expect(m.dateOrder).toBe('mdy');
  });
});

describe('extraction', () => {
  const clients: Grid = { name: 'Clients', rows: [
    ['Name', 'Email', 'Goal', 'Injuries'],
    ['Maya Okafor', 'Maya@Example.com', 'Squat 100 kg', 'Left knee'],
    ['Jordan  Lee', 'not-an-email', 'Half marathon', ''],
  ] };
  const log: Grid = { name: 'Training', rows: [
    ['Client', 'Date', 'Session', 'Exercise', 'Sets', 'Reps', 'Weight', 'Notes'],
    ['Maya Okafor', '3/9/2026', 'Lower', 'Back Squat', '3', '5', '80', 'felt good'],
    ['', '', '', 'Romanian deadlift', '3', '8', '60', ''],
    ['maya okafor', '10/9/2026', 'Lower', 'Back squat', '3', '5', '82.5', ''],
    ['Jordan Lee', '4/9/2026', 'Upper', 'Bench press', '', '3x5', '70kg', ''],
    ['Jordan Lee', 'next week', 'Upper', 'Bench press', '3', '5', '72.5', ''],
    ['Jordan Lee', '5/9/2026', 'Upper', '', '3', '5', '72.5', ''],
    ['Jordan Lee', '1/1/2031', 'Upper', 'Row', '3', '5', '60', ''],
    ['', '', '', '', '', '', '', ''],
  ] };
  const weights: Grid = { name: 'Weigh-ins', rows: [['Client', 'Date', 'Body weight (lbs)'], ['Maya Okafor', '1/9/2026', '150'], ['Maya Okafor', '15/9/2026', '148.5'], ['Maya Okafor', '20/9/2026', 'forgot']] };
  const grids = [clients, log, weights];

  it('joins sheets by client name and copies numbers rather than rewriting them', () => {
    const out = extract(grids, map(grids), TODAY);
    expect(out.clients.map((c) => c.name)).toEqual(['Jordan Lee', 'Maya Okafor']);
    const maya = out.clients[1];
    expect(maya).toMatchObject({ email: 'maya@example.com', goal: 'Squat 100 kg', injuries: 'Left knee' });
    expect(maya.workouts.map((w) => w.date)).toEqual(['2026-09-03', '2026-09-10']);
    expect(maya.workouts[0]).toEqual({
      date: '2026-09-03', title: 'Lower', notes: 'felt good',
      exercises: [{ name: 'Back Squat', sets: 3, reps: '5', weightKg: 80 }, { name: 'Romanian deadlift', sets: 3, reps: '8', weightKg: 60 }],
    });
    expect(maya.workouts[1].exercises[0].weightKg).toBe(82.5);
    expect(maya.weights).toEqual([{ date: '2026-09-01', weightKg: 68.04 }, { date: '2026-09-15', weightKg: 67.36 }]);

    const jordan = out.clients[0];
    expect(jordan.email).toBeNull();
    expect(jordan.workouts).toEqual([{ date: '2026-09-04', title: 'Upper', exercises: [{ name: 'Bench press', sets: 3, reps: '5', weightKg: 70 }] }]);
  });

  it('says what it assumed and what it could not read, with where', () => {
    const out = extract(grids, map(grids), TODAY);
    expect(out.assumptions).toEqual(expect.arrayContaining([
      '"Training": weights read as kilograms unless a cell says otherwise',
      '"Training": dates like 3/4/2026 read as day/month/year',
      '"Training": blank name or date cells were filled from the row above',
      '"Weigh-ins": weights read as pounds unless a cell says otherwise',
    ]));
    expect(out.skippedRows).toBe(4);
    expect(out.warnings).toEqual(expect.arrayContaining([
      '1 row skipped: date could not be read ("Training" row 6)',
      '1 row skipped: no exercise name ("Training" row 7)',
      '1 row skipped: date is in the future ("Training" row 8)',
      '1 row skipped: bodyweight could not be read ("Weigh-ins" row 4)',
      '1 row skipped: email is not valid (client still imported) ("Clients" row 3)',
    ]));
  });

  it('reads one sheet per client, with one row per set', () => {
    const sheet: Grid = { name: 'Dami Bello', rows: [
      ['Date', 'Exercise', 'Reps', 'Lbs'],
      ['9/1/2026', 'Deadlift', '5', '225'], ['9/1/2026', 'Deadlift', '5', '245'], ['9/1/2026', 'Deadlift', '3', '265'],
      ['9/1/2026', 'Pull-up', '8', 'BW'],
    ] };
    const out = extract([sheet], map([sheet], { unit: 'kg', dateOrder: 'mdy' }), TODAY);
    expect(out.clients).toHaveLength(1);
    expect(out.clients[0].name).toBe('Dami Bello');
    // Three rows of the same lift are three sets; the heaviest row describes it.
    expect(out.clients[0].workouts[0].exercises).toEqual([
      { name: 'Deadlift', sets: 3, reps: '3', weightKg: 120.2 },
      { name: 'Pull-up', sets: 1, reps: '8', weightKg: null },
    ]);
    expect(out.assumptions).toContain('"Dami Bello": the sheet name is taken as the client\'s name');
  });

  it('reports a sheet it did not read', () => {
    const pricing: Grid = { name: 'Pricing', rows: [['Package', 'Price'], ['Monthly', '200']] };
    const out = extract([pricing], map([pricing]), TODAY);
    expect(out.clients).toEqual([]);
    expect(out.warnings).toEqual(['"Pricing" was not read: no client, training or bodyweight columns were recognised']);
  });

  it('never invents a client from a number or an over-long cell', () => {
    const odd: Grid = { name: 'Log', rows: [['Client', 'Date', 'Exercise'], ['12345', '3/9/2026', 'Squat'], ['x'.repeat(90), '3/9/2026', 'Squat']] };
    const out = extract([odd], map([odd]), TODAY);
    expect(out.clients).toEqual([]);
    expect(out.skippedRows).toBe(2);
  });
});

describe('one person under two names', () => {
  const list: Grid = { name: 'Clients', rows: [['Name', 'Email', 'Goal'], ['Sarah Kim', 'sarah@example.com', 'First pull-up'], ['Tom Becker', '', 'Squat 140']] };
  const tab = (name: string): Grid => ({ name, rows: [['Date', 'Exercise', 'Sets', 'Reps', 'Weight'], ['2026-09-01', 'Lat pulldown', '3', '10', '40']] });

  it('merges a tab named with an abbreviation into the one full name it abbreviates, and says so', () => {
    const grids = [list, tab('Sarah K'), tab('Tom')];
    const out = extract(grids, map(grids), TODAY);
    expect(out.clients.map((c) => [c.name, c.email, c.workouts.length])).toEqual([['Sarah Kim', 'sarah@example.com', 1], ['Tom Becker', null, 1]]);
    expect(out.assumptions).toContain('"Sarah K" and "Sarah Kim" were read as the same person');
    expect(out.assumptions).toContain('"Tom" and "Tom Becker" were read as the same person');
  });

  it('does not guess when the short name could be two people, or is a different name', () => {
    const two: Grid = { name: 'Clients', rows: [['Name'], ['Sarah Kim'], ['Sarah Khan'], ['Sam Hill']] };
    const grids = [two, tab('Sarah K'), tab('Samantha H')];
    const out = extract(grids, map(grids), TODAY);
    expect(out.clients.map((c) => c.name)).toEqual(['Sam Hill', 'Samantha H', 'Sarah K', 'Sarah Khan', 'Sarah Kim']);
    expect(out.assumptions.some((a) => a.includes('same person'))).toBe(false);
  });
});

describe('summary lines', () => {
  it('does not read an average under a weigh-in column as a weigh-in', () => {
    const weights: Grid = { name: 'Weigh-ins', rows: [['Client', 'Date', 'Body weight'], ['Tom Becker', '2026-09-02', '95.4'], ['', '', '88.1']] };
    const out = extract([weights], map([weights]), TODAY);
    expect(out.clients[0].weights).toEqual([{ date: '2026-09-02', weightKg: 95.4 }]);
    expect(out.warnings).toEqual(['1 row skipped: no date ("Weigh-ins" row 3)']);
  });
});

describe('upload limits', () => {
  it('coerces cells to trimmed strings, drops trailing blank rows and empty sheets', () => {
    const { grids, dropped } = sanitiseGrids([
      { name: ' Log ', rows: [[' Client ', 3, null], ['Maya', undefined, 'x'], ['', '', ''], []] },
      { name: 'Empty', rows: [['', '']] },
      { rows: [['a']] },
    ]);
    expect(grids).toEqual([{ name: 'Log', rows: [['Client', '3', ''], ['Maya', '', 'x']] }, { name: 'Sheet 2', rows: [['a']] }]);
    expect(dropped).toEqual([]);
  });
  it('reports what it truncated', () => {
    const { grids, dropped } = sanitiseGrids(Array.from({ length: 31 }, (_, i) => ({ name: `S${i}`, rows: [['a']] })));
    expect(grids).toHaveLength(30);
    expect(dropped).toEqual(['Only the first 30 sheets were read']);
    expect(sanitiseGrids('nope')).toEqual({ grids: [], dropped: [] });
  });
});
