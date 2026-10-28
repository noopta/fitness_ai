// Research-based rehab programs (Oct 2026): only with clearance, limits,
// progression criteria and sources; saved like a coach's program for review
// with the physio.
import { describe, it, expect } from 'vitest';
import { rehabProblem, rehabMeta, postOpWeek, rehabCard } from '../services/rehab/program.js';

const good = {
  area: 'Achilles tendon (surgical repair)', side: 'right', surgeryDate: '2026-10-10', clearedOn: '2026-10-26', clearedBy: 'orthopedic surgeon', clearedFor: 'start physio, weight-bearing in the boot',
  program: 'Phase 1 (weeks 3-6): Mon/Wed/Fri — seated active plantarflexion 3x15, isometric calf holds in boot 5x30s, hip abduction 3x12, upper body push 4x8. Phase 2 (weeks 7-12): ...',
  limits: ['No dorsiflexion past neutral before week 12', 'No running or jumping before week 16 and criteria met'],
  criteria: ['Full weight-bearing in the boot without pain', '20 single-leg heel raises before running'],
  sources: [{ title: 'Accelerated rehabilitation after Achilles repair: systematic review', year: '2024' }, { title: 'Clinical practice guideline: Achilles tendon rupture', year: '2024', url: 'https://example.org/cpg' }],
};

describe('rehabProblem', () => {
  it('accepts a complete, cleared, sourced program', () => { expect(rehabProblem(good)).toBeNull(); });
  it('needs clearance', () => { expect(rehabProblem({ ...good, clearedOn: '', clearedFor: '' })).toMatch(/cleared/); });
  it('needs hard limits and criteria', () => {
    expect(rehabProblem({ ...good, limits: [] })).toMatch(/limits/);
    expect(rehabProblem({ ...good, criteria: [' '] })).toMatch(/criteria/);
  });
  it('needs at least two sources — research first', () => { expect(rehabProblem({ ...good, sources: [good.sources[0]] })).toMatch(/two sources/); });
  it('needs the program written out', () => { expect(rehabProblem({ ...good, program: 'calf raises' })).toMatch(/Write the program/); });
  it('rejects a bad date', () => { expect(rehabProblem({ ...good, surgeryDate: 'Oct 10' })).toMatch(/YYYY-MM-DD/); });
});

describe('rehabMeta / postOpWeek', () => {
  it('cleans and keeps only http(s) urls', () => {
    const m = rehabMeta({ ...good, sources: [...good.sources, { title: 'x', url: 'javascript:alert(1)' }] });
    expect(m.sources[2].url).toBeNull();
    expect(m.sources[1].url).toBe('https://example.org/cpg');
    expect(m.surgeryDate).toBe('2026-10-10');
  });
  it('week since surgery', () => {
    expect(postOpWeek('2026-10-10', '2026-10-10')).toBe(1);
    expect(postOpWeek('2026-10-10', '2026-10-28')).toBe(3);
    expect(postOpWeek('2026-10-10', '2026-10-01')).toBeNull();
    expect(postOpWeek(null, '2026-10-28')).toBeNull();
  });
});

describe('rehabCard', () => {
  it('leads with the plan, shows limits and criteria, sources, and the physio-review line; apply activates the program', () => {
    const meta = rehabMeta(good);
    const card: any = rehabCard(meta, { name: 'Achilles rehab', weeks: 24, days: 4, rows: [{ key: 'Mon', value: 'Calf + upper' }] }, { phases: [] }, 3);
    expect(card.meta.label).toBe('Rehab · Achilles tendon (surgical repair) · week 3 post-op');
    expect(card.rows.map((r: any) => r.key)).toEqual(['Mon', 'Limit', 'Limit', 'Move on when', 'Move on when']);
    expect(card.why).toMatch(/Built from 2 sources/);
    expect(card.note).toMatch(/physio/);
    expect(card.note).toMatch(/isn’t medical advice/);
    expect(card.pending.actions.apply.op).toBe('program.activate');
  });
});

import { phaseWeeks, fromCurrentWeek, expandDaily, vagueEntries, prescriptionProblem } from '../services/rehab/program.js';

const ex = (exercise: string, sets: number, reps: string, intensity = '') => ({ exercise, sets, reps, intensity });
const day = (d: string, focus: string, exercises: any[]) => ({ day: d, focus, exercises, warmup: [], cooldown: [] });
const phase = (phaseName: string, weeksLabel: string, durationWeeks: number, trainingDays: any[]) => ({ phaseName, weeksLabel, durationWeeks, trainingDays, progressionNotes: [] });

// What the first real rehab program looked like (founder, Oct 28, week 3): an outline, not a prescription.
const outline = [
  phase('PHASE 1 — Weeks 0-2 post-op', 'Weeks 0-2 post-op', 2, [day('Training Day', 'Upper-body training', [ex('Upper-body training (bench/back/arms)', 1, 'as tolerated')])]),
  phase('PHASE 2 — Weeks 2-6 post-op', 'Weeks 2-6 post-op', 4, [day('Daily Rehab & Training', 'Active range of motion, isometrics, upper body', [
    ex('Seated active plantarflexion', 2, '10-15'), ex('Active inversion/eversion', 2, '10-15'), ex('Submaximal pain-free isometric holds in plantarflexion', 1, 'isometric holds'),
    ex('Upper-body program (bench press focus toward the 315 goal, back, arms)', 1, 'as tolerated'), ex('Core work', 1, 'as tolerated'), ex('Opposite-leg strength work', 1, 'as tolerated'),
  ])]),
  phase('PHASE 5 — Week 12+', 'Week 12+', 1, [day('Training Day', 'Return to run', [ex('Single-leg heel raise progression', 1, 'as tolerated'), ex('Return-to-run criteria testing', 1, 'testing')])]),
];

// A prescription: current week first, dosed, near-daily.
const prescription = [
  phase('Phase 2 — Weeks 2-6 post-op', 'Weeks 2-6', 4, [day('Daily', 'Ankle rehab (2x a day)', [
    ex('Seated active plantarflexion in boot range', 2, '15', 'pain-free, slow'), ex('Active inversion/eversion', 2, '15', 'pain-free'),
    ex('Seated isometric plantarflexion against the boot', 5, '30s holds', '30-50% effort'), ex('Towel scrunches', 3, '20', 'bodyweight'),
    ex('Side-lying hip abduction', 3, '12', 'bodyweight'), ex('Single-leg heel raise, uninjured leg (cross-education)', 3, '12', 'RPE 8'),
  ])]),
  phase('Phase 3 — Weeks 6-8', 'Weeks 6-8', 2, [day('Daily', 'Ankle rehab', [ex('Double-leg heel raise, partial range', 2, '10', 'bodyweight')])]),
];

describe('holding the program to a prescription', () => {
  it('reads week ranges', () => {
    expect(phaseWeeks('Weeks 2-6 post-op')).toEqual({ from: 2, to: 6 });
    expect(phaseWeeks('weeks 8 to 12')).toEqual({ from: 8, to: 12 });
    expect(phaseWeeks('Week 12+')).toEqual({ from: 12, to: null });
    expect(phaseWeeks('Foundation')).toBeNull();
  });

  it('opens on the current phase: weeks 0-2 are gone at week 3', () => {
    expect(fromCurrentWeek(outline, 3).map((p) => p.weeksLabel)).toEqual(['Weeks 2-6 post-op', 'Week 12+']);
    expect(fromCurrentWeek(outline, null)).toHaveLength(3);
  });

  it('a "Daily" session is every weekday, merged with named days', () => {
    const days = expandDaily([day('Daily rehab', 'Ankle', [ex('Calf isometric', 5, '30s')]), day('Monday', 'Upper body', [ex('Bench press', 4, '6', 'RPE 8')])]);
    expect(days.map((d) => d.day)).toEqual(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']);
    expect(days[0].exercises.map((e) => e.exercise)).toEqual(['Calf isometric', 'Bench press']);
    expect(days[1].exercises.map((e) => e.exercise)).toEqual(['Calf isometric']);
  });

  it('the first real program is rejected, naming the placeholders', () => {
    const phases = fromCurrentWeek(outline, 3).map((p) => ({ ...p, trainingDays: expandDaily(p.trainingDays) }));
    expect(vagueEntries(phases)).toEqual(expect.arrayContaining([
      'Upper-body program (bench press focus toward the 315 goal, back, arms) (1×as tolerated)', 'Core work (1×as tolerated)', 'Return-to-run criteria testing (1×testing)',
    ]));
    expect(prescriptionProblem(phases, 3)).toMatch(/Not a prescription yet/);
  });

  it('a dosed, near-daily prescription passes', () => {
    const phases = fromCurrentWeek(prescription, 3).map((p) => ({ ...p, trainingDays: expandDaily(p.trainingDays) }));
    expect(phases[0].trainingDays).toHaveLength(7);
    expect(prescriptionProblem(phases, 3)).toBeNull();
  });

  it('a thin current phase is sent back', () => {
    const thin = [phase('Weeks 2-6', 'Weeks 2-6', 4, [day('Daily', 'Ankle', [ex('Seated plantarflexion', 2, '15'), ex('Towel scrunches', 3, '20')])])];
    expect(prescriptionProblem(thin.map((p) => ({ ...p, trainingDays: expandDaily(p.trainingDays) })), 3)).toMatch(/has 2 exercises/);
  });

  it('a once-a-week current phase is sent back', () => {
    const weekly = [phase('Weeks 2-6', 'Weeks 2-6', 4, [day('Training Day', 'Ankle', prescription[0].trainingDays[0].exercises)])];
    expect(prescriptionProblem(weekly, 3)).toMatch(/1 day a week/);
  });
});
