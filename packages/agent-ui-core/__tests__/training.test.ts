import { describe, it, expect } from 'vitest';
import { swapOptions, lifePlan, phasesOf, programWeek, proposalRows, cuesFrom, isoWeekKey, inRange, patternsHeadline, addDays } from '../src/training';

const label = (s: any) => String(s?.name ?? 'Session');
const minutes = (s: any) => s?.minutes ?? null;

describe('swapOptions', () => {
  const week = [
    { date: '2026-10-05', session: { name: 'Push' }, isLogged: true },
    { date: '2026-10-08', session: { name: 'Upper', minutes: 62 } },
    { date: '2026-10-09', session: null },
    { date: '2026-10-10', session: { name: 'Lower', minutes: 55 } },
    { date: '2026-10-11', session: null },
  ];
  it('trades with a later session, offers short / recovery, and rest moves today to the next free day', () => {
    const o = swapOptions({ name: 'Upper' }, week, '2026-10-08', label, minutes);
    expect(o[0]).toMatchObject({ title: 'Lower · 55 min', tool: 'propose_workout_swap', input: { sourceDate: '2026-10-10', date: '2026-10-08' } });
    expect(o.map((x) => x.tool)).toEqual(['propose_workout_swap', 'propose_today_adjustment', 'propose_rest_days', 'propose_workout_swap']);
    expect(o[3]).toMatchObject({ title: 'Rest', sub: 'Upper moves to Fri', input: { sourceDate: '2026-10-08', date: '2026-10-09' } });
  });
  it('never offers a logged or past session, and rests in place with no free day', () => {
    const o = swapOptions({ name: 'Upper' }, [{ date: '2026-10-08', session: { name: 'Upper' } }], '2026-10-08', label, minutes);
    expect(o.some((x) => x.input.sourceDate === '2026-10-05')).toBe(false);
    expect(o[o.length - 1]).toMatchObject({ tool: 'propose_rest_days', input: { from: '2026-10-08' } });
  });
});

describe('lifePlan', () => {
  it('pauses for sickness, with pushing the program back as the alternative', () => {
    const p = lifePlan('sick', 3, '2026-10-08');
    expect(p).toMatchObject({ option: { tool: 'propose_rest_days', input: { from: '2026-10-08', to: '2026-10-10' } }, alt: { tool: 'propose_program_shift', input: { days: 3 } } });
  });
  it('a one-day break has no alternative', () => {
    expect(lifePlan('break', 1, '2026-10-08')).toMatchObject({ option: { input: { from: '2026-10-08', to: '2026-10-08' } }, alt: null });
  });
  it('sends travel, busy and injured to Anakin', () => {
    expect(lifePlan('travel', 7, '2026-10-08')).toEqual({ chat: expect.stringContaining('for 7 days') });
    expect(lifePlan('busy', 1, '2026-10-08')).toEqual({ chat: expect.stringContaining('today') });
    expect('chat' in lifePlan('injured', 1, '2026-10-08')).toBe(true);
  });
});

describe('phasesOf / programWeek', () => {
  it('numbers each phase from the week it starts', () => {
    const ph = phasesOf({ phases: [{ phaseName: 'Foundation', durationWeeks: 5, trainingDays: [{ day: 'Mon' }] }, { phaseName: 'Build', durationWeeks: 6 }, { name: 'Peak' }] });
    expect(ph.map((p) => [p.name, p.from, p.weeks])).toEqual([['Foundation', 1, 5], ['Build', 6, 6], ['Peak', 12, 1]]);
    expect(ph[0].days).toHaveLength(1);
  });
  it('places a date in the program, clamped to its length', () => {
    expect(programWeek('2026-09-01', '2026-09-01', 12)).toBe(1);
    expect(programWeek('2026-09-01', '2026-09-15', 12)).toBe(3);
    expect(programWeek('2026-09-01', '2027-09-01', 12)).toBe(12);
    expect(programWeek('2026-09-01', '2026-08-01', 12)).toBe(1);
  });
});

describe('proposalRows', () => {
  const fmt = (kg: number | null | undefined) => (kg == null ? '—' : `${kg} kg`);
  it('shows the change for a next-session suggestion', () => {
    expect(proposalRows({ proposal: { kind: 'next_session', exercise: 'Bench', fromWeightKg: 80, toWeightKg: 82.5, reps: '5' } }, fmt)).toEqual([{ key: 'Bench', from: '80 kg × 5', to: '82.5 kg × 5' }]);
  });
  it('falls back to the evidence lines', () => {
    expect(proposalRows({ proposal: { kind: 'phase_confirm' }, evidence: [{ label: 'Sessions', value: '9' }] }, fmt)).toEqual([{ key: 'Sessions', to: '9' }]);
  });
});

describe('cuesFrom', () => {
  it('splits notes into short cues and drops effort notes', () => {
    expect(cuesFrom('Front foot far forward. A slight lean; drive through the heel. RPE 8')).toEqual(['Front foot far forward', 'A slight lean', 'drive through the heel']);
    expect(cuesFrom(null)).toEqual([]);
  });
});

describe('isoWeekKey / inRange', () => {
  it('matches ISO weeks, including across the new year', () => {
    expect(isoWeekKey(new Date(2026, 0, 1))).toBe('2026-W01');
    expect(isoWeekKey(new Date(2027, 0, 1))).toBe('2026-W53');
    expect(isoWeekKey(new Date(2026, 9, 8))).toBe('2026-W41');
  });
  it('keeps the points inside the range', () => {
    const s = [{ week: '2026-W20' }, { week: '2026-W38' }, { week: '2026-W40' }];
    expect(inRange(s, 4, new Date(2026, 9, 8)).map((p) => p.week)).toEqual(['2026-W38', '2026-W40']);
    expect(inRange(s, 0)).toHaveLength(3);
  });
});

describe('patternsHeadline', () => {
  it('names what is missing', () => {
    expect(patternsHeadline([{ label: 'Carry', status: 'neglected' }, { label: 'core', status: 'neglected' }, { label: 'Squat', status: 'covered' }])).toBe('Carry and core are missing.');
    expect(patternsHeadline([{ label: 'lunge', status: 'neglected' }])).toBe('Lunge is missing.');
    expect(patternsHeadline([{ label: 'Squat', status: 'light' }])).toBe('Everything’s there. Some of it is light.');
    expect(patternsHeadline([])).toBe('Not enough logged yet.');
  });
});

describe('addDays', () => {
  it('crosses month ends', () => { expect(addDays('2026-10-31', 1)).toBe('2026-11-01'); });
});

import { askParts, progressFraction } from '../src/training';
describe('askParts', () => {
  it('splits the question from its reason', () => {
    expect(askParts('Where does the bar slow down? This tells me which muscle gives out first.')).toEqual({ title: 'Where does the bar slow down?', reason: 'This tells me which muscle gives out first.' });
  });
  it('keeps a lead-in sentence as part of the reason', () => {
    expect(askParts('Good. When a set gets heavy, what does the bar do?')).toEqual({ title: 'When a set gets heavy, what does the bar do?', reason: 'Good.' });
  });
  it('is all title without a question, or with nothing after it', () => {
    expect(askParts('Pick a lift.')).toEqual({ title: 'Pick a lift.', reason: null });
    expect(askParts('Which lift?')).toEqual({ title: 'Which lift?', reason: null });
  });
});
describe('progressFraction', () => {
  it('reads the progress label', () => {
    expect(progressFraction('3 / 10')).toBe(0.3);
    expect(progressFraction('Done')).toBe(1);
    expect(progressFraction('')).toBe(0);
  });
});
