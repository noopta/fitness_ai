import { describe, it, expect } from 'vitest';
import { receiptForCall, summarizeResult, cardForResult, WRITE_VERBS } from '../agent/receipts.js';
import { AGENT_TOOLS } from '../agent/tools.js';

describe('receiptForCall', () => {
  it('maps every registered tool to a verb + text', () => {
    for (const t of AGENT_TOOLS) {
      const r = receiptForCall(t.name, {});
      expect(r.verb).toBeTruthy();
      expect(r.text.length).toBeGreaterThan(0);
    }
  });

  it('no-arg reads are verb + fixed noun', () => {
    expect(receiptForCall('read_program')).toEqual({ verb: 'Read', text: 'Program' });
    expect(receiptForCall('read_profile', { anything: 1 })).toEqual({ verb: 'Read', text: 'Profile' });
  });

  it('windowed reads carry the window', () => {
    expect(receiptForCall('read_recent_workouts', { days: 30 }).text).toBe('Last 30 days of sessions');
    expect(receiptForCall('read_recent_workouts', {}).text).toBe('Last 14 days of sessions');
    expect(receiptForCall('read_recent_workouts', { days: -3 }).text).toBe('Last 14 days of sessions');
  });

  it('writes are write verbs', () => {
    for (const name of ['log_meal', 'log_workout', 'log_body_weight', 'log_wellness']) {
      expect(receiptForCall(name).verb).toBe('Logged');
      expect(WRITE_VERBS.has(receiptForCall(name).verb)).toBe(true);
    }
    expect(receiptForCall('adjust_macros', { calories: 2400 })).toEqual({ verb: 'Adjusted', text: 'Macros — 2400 kcal' });
    expect(receiptForCall('remember', { note: 'Knee hurts on squats' })).toEqual({ verb: 'Noted', text: 'Knee hurts on squats' });
    expect(WRITE_VERBS.has('Noted')).toBe(false);
  });

  it('proposals are Proposed and carry the noun', () => {
    expect(receiptForCall('propose_exercise_swap', { fromExerciseName: 'Deficit deadlift', toExerciseName: 'Block pull' }))
      .toEqual({ verb: 'Proposed', text: 'Deficit deadlift → Block pull' });
    expect(receiptForCall('propose_workout_swap', { sourceDate: '2026-10-02' }).text).toBe('Move 2026-10-02 → today');
  });

  it('delegation is Delegated', () => {
    expect(receiptForCall('delegate_task', { task: 'Check hinge loading' }).verb).toBe('Delegated');
  });

  it('clips long nouns', () => {
    const long = 'x'.repeat(200);
    expect(receiptForCall('remember', { note: long }).text.length).toBeLessThanOrEqual(64);
    expect(receiptForCall('query_research', { query: long }).text.length).toBeLessThanOrEqual(52);
  });

  it('unknown tools degrade to a readable Read', () => {
    expect(receiptForCall('some_new_tool')).toEqual({ verb: 'Read', text: 'some new tool' });
  });
});

describe('summarizeResult', () => {
  it('sharpens a workouts read with the count', () => {
    expect(summarizeResult('read_recent_workouts', { days: 14, count: 6, workouts: [] })).toBe('Last 14 days — 6 sessions');
    expect(summarizeResult('read_recent_workouts', { days: 14, count: 1, workouts: [] })).toBe('Last 14 days — 1 session');
  });
  it('returns null when there is nothing to add', () => {
    expect(summarizeResult('read_program', { phases: [] })).toBeNull();
    expect(summarizeResult('read_recent_workouts', null)).toBeNull();
    expect(summarizeResult('read_recent_workouts', { error: 'boom' })).toBeNull();
  });
  it('counts done sessions this week', () => {
    const weekDays = [{ session: {}, isLogged: true }, { session: {}, isLogged: false }, { session: null }];
    expect(summarizeResult('read_schedule_week', { weekDays })).toBe('This week — 1 of 2 done');
  });
});

describe('cardForResult', () => {
  it('a schedule read yields a week card', () => {
    const c = cardForResult('read_schedule_week', {}, { weekDays: [{}], weekNumber: 3, phaseName: 'Base' }, null);
    expect(c?.type).toBe('week');
  });
  it('a swap proposal upgrades the week card and is not downgraded by a later read', () => {
    const week = cardForResult('read_schedule_week', {}, { weekDays: [{}], weekNumber: 3, phaseName: 'Base' }, null);
    const prop = cardForResult('propose_workout_swap', { sourceDate: '2026-10-02' }, { _proposal: true, proposedWeek: [{}], rationale: 'r', summary: 's', sourceDate: '2026-10-02' }, week);
    expect(prop?.type).toBe('week');
    expect((prop as any).data.proposal.summary).toBe('s');
    const again = cardForResult('read_schedule_week', {}, { weekDays: [{}] }, prop);
    expect((again as any).data.proposal).toBeTruthy();
  });
  it('errors never produce a card', () => {
    expect(cardForResult('propose_workout_swap', {}, { error: 'nope' }, null)).toBeNull();
  });
  it('a nutrition read yields a food card', () => {
    const c = cardForResult('read_nutrition_today', {}, { totals: { calories: 1200, proteinG: 90, carbsG: 100, fatG: 40 }, meals: [{}, {}] }, null);
    expect(c).toEqual({ type: 'food', data: { totals: { calories: 1200, proteinG: 90, carbsG: 100, fatG: 40 }, mealCount: 2 } });
  });
});

describe('tidySentence (brief)', () => {
  it('strips markdown and clamps to two short sentences', async () => {
    const { tidySentence } = await import('../routes/brief.js');
    const long = 'Your body weight is trending **+6.3 lbs/week** — that\'s a sharp reversal. You haven\'t logged a workout in 14 days. Before touching macros, log meals. Right now there is zero data.';
    const t = tidySentence(long);
    expect(t).not.toMatch(/\*/);
    expect(t.length).toBeLessThanOrEqual(180);
    expect(t.split(/[.!?]\s/).length).toBeLessThanOrEqual(3);
    expect(t.startsWith('Your body weight is trending +6.3 lbs/week')).toBe(true);
  });
  it('leaves a short plain sentence alone', async () => {
    const { tidySentence } = await import('../routes/brief.js');
    expect(tidySentence('Pull day. Your top set moved fast last time.')).toBe('Pull day. Your top set moved fast last time.');
  });
});

describe('bench card', () => {
  it('maps read_lift_progress to a bench card, empty when no sets', () => {
    const c = cardForResult('read_lift_progress', { lift: 'bench' }, { lift: 'Bench', empty: true, series: [], current1RMkg: null }, null);
    expect(c).toEqual({ type: 'bench', data: { lift: 'Bench', series: [], forecast: null, delta: null, current1RMkg: null, weeks: 0, empty: true } });
    const full = cardForResult('read_lift_progress', { lift: 'bench' }, { lift: 'Bench Press', series: [{ week: 'w', rm: 100 }], deltaKg: 4, weeks: 1, current1RMkg: 100, forecast: { value: 104, week: 'x' } }, null);
    expect((full as any).data.empty).toBe(false);
    expect(receiptForCall('read_lift_progress', { lift: 'bench' })).toEqual({ verb: 'Pulled', text: 'Bench history' });
    expect(summarizeResult('read_lift_progress', { lift: 'Bench', empty: true })).toBe('Bench — no sets logged yet');
  });
});
