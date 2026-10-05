// Training-phase inference (contract 6) + phase rules: synthetic inputs for
// every phase, confidence when data is missing, the stated-goal mismatch, and
// the phase_confirm / calorie_adjust drafts.
import { describe, it, expect, vi } from 'vitest';

vi.mock('@prisma/client', () => ({ PrismaClient: vi.fn(function (this: any) { /* unused by pure fns */ }) }));

import {
  classifyPhase, summarizeBodyweight, summarizeIntake, adaptiveMaintenance, summarizeFrequency,
  statedGoalOf, parseConfirmedPhase, type PhaseInput,
} from '../services/phaseInference.js';
import { phaseConfirmDraft, calorieAdjustDraft, buildPhaseDrafts } from '../adaptation/rules/phaseRules.js';

const NOW = new Date('2026-10-05T12:00:00Z');
const d = (daysAgo: number) => new Date(NOW.getTime() - daysAgo * 86400000).toISOString().slice(0, 10);

function input(over: Partial<PhaseInput> = {}): PhaseInput {
  return {
    now: NOW,
    unitPref: 'metric',
    strength: { pctPerWeek: 0.1, lifts: 3, trend: 'flat', weeks: 6, since: d(42) },
    bodyweight: { pctPerWeek: 0, points: 8, spanDays: 28, startKg: 80, endKg: 80, since: d(28) },
    intake: { avgKcal: 2500, loggedDays: 20 },
    maintenance: { kcal: 2500, source: 'adaptive' },
    repMix: { lowShare: 0.2, highShare: 0.7, sets: 60 },
    frequency: { sessionsPerWeek: 3, prevSessionsPerWeek: 3, daysSinceLast: 1, returnedOn: null, gapDays: null },
    statedGoal: null,
    confirmed: null,
    ...over,
  };
}
const bw = (pct: number, over: any = {}) => ({ bodyweight: { pctPerWeek: pct, points: 8, spanDays: 28, startKg: 80, endKg: 80 * (1 + pct * 4 / 100), since: d(28), ...over } });

describe('classifyPhase', () => {
  it('cutting: bodyweight down at a sustainable pace, flat strength, intake under maintenance', () => {
    const r = classifyPhase(input({ ...bw(-0.6), intake: { avgKcal: 2000, loggedDays: 20 } }));
    expect(r.inferred).toBe('cutting');
    expect(r.confidence).toBeGreaterThanOrEqual(0.8);
    expect(r.effective).toBe('cutting');
    expect(r.evidence.find(e => e.label === 'Bodyweight')?.value).toMatch(/−0.6%\/wk over 4 wks/);
  });
  it('cut too aggressive: losing >1.25%/wk, or >1%/wk with strength declining', () => {
    expect(classifyPhase(input(bw(-1.4))).inferred).toBe('cut_too_aggressive');
    expect(classifyPhase(input({ ...bw(-1.1), strength: { pctPerWeek: -0.8, lifts: 3, trend: 'declining', weeks: 5, since: d(35) } })).inferred).toBe('cut_too_aggressive');
    expect(classifyPhase(input(bw(-1.1))).inferred).toBe('cutting');
  });
  it('building muscle (bulk): bodyweight up, strength up', () => {
    const r = classifyPhase(input({ ...bw(0.4), strength: { pctPerWeek: 1, lifts: 3, trend: 'progressing', weeks: 6, since: d(42) }, intake: { avgKcal: 2800, loggedDays: 20 } }));
    expect(r.inferred).toBe('building_muscle');
    expect(r.confidence).toBeGreaterThan(0.8);
  });
  it('recomp vs building strength: stable bodyweight + progressing strength, split by rep mix', () => {
    const prog = { strength: { pctPerWeek: 0.9, lifts: 3, trend: 'progressing' as const, weeks: 6, since: d(42) } };
    expect(classifyPhase(input({ ...prog })).inferred).toBe('recomp');
    expect(classifyPhase(input({ ...prog, repMix: { lowShare: 0.6, highShare: 0.2, sets: 60 } })).inferred).toBe('building_strength');
  });
  it('plateau: stable bodyweight, strength flat ≥4 weeks', () => {
    expect(classifyPhase(input()).inferred).toBe('plateau');
  });
  it('rebuilding consistency: back after ≥14 days off, or currently away', () => {
    const r = classifyPhase(input({ frequency: { sessionsPerWeek: 1, prevSessionsPerWeek: 3, daysSinceLast: 2, returnedOn: d(2), gapDays: 20 } }));
    expect(r.inferred).toBe('rebuilding_consistency');
    expect(r.since).toBe(d(2));
    expect(classifyPhase(input({ frequency: { sessionsPerWeek: 0, prevSessionsPerWeek: 3, daysSinceLast: 18, returnedOn: null, gapDays: null } })).inferred).toBe('rebuilding_consistency');
  });
  it('missing bodyweight and nutrition → lower confidence, never effective on strength alone', () => {
    const r = classifyPhase(input({
      bodyweight: { pctPerWeek: null, points: 0, spanDays: 0, startKg: null, endKg: null, since: null },
      intake: { avgKcal: null, loggedDays: 0 }, maintenance: { kcal: 2400, source: 'formula' },
      strength: { pctPerWeek: 1, lifts: 3, trend: 'progressing', weeks: 6, since: d(42) },
    }));
    expect(r.confidence).toBeLessThanOrEqual(0.5);
    expect(r.effective).toBe('unknown');
  });
  it('no bodyweight but solid intake data → capped at 0.6', () => {
    const r = classifyPhase(input({ bodyweight: { pctPerWeek: null, points: 1, spanDays: 0, startKg: 80, endKg: 80, since: null }, intake: { avgKcal: 2000, loggedDays: 20 } }));
    expect(r.inferred).toBe('cutting');
    expect(r.confidence).toBeLessThanOrEqual(0.6);
  });
  it('no data at all → unknown', () => {
    const r = classifyPhase(input({
      strength: { pctPerWeek: null, lifts: 0, trend: 'insufficient', weeks: 0, since: null },
      bodyweight: { pctPerWeek: null, points: 0, spanDays: 0, startKg: null, endKg: null, since: null },
      intake: { avgKcal: null, loggedDays: 0 },
    }));
    expect(r).toMatchObject({ inferred: 'unknown', effective: 'unknown' });
  });
  it('confirmed phase always wins as effective', () => {
    const r = classifyPhase(input({ ...bw(0.4), confirmed: { phase: 'cutting', confirmedAt: NOW.toISOString(), source: 'user_set' } }));
    expect(r.inferred).toBe('building_muscle');
    expect(r.effective).toBe('cutting');
  });
  it('stated goal mismatch: said bulk, bodyweight falling', () => {
    const r = classifyPhase(input({ ...bw(-0.5, { spanDays: 21 }), statedGoal: 'bulk' }));
    expect(r.statedGoalMismatch).toBe('You said bulk, but bodyweight has fallen for 3 weeks');
    expect(classifyPhase(input({ ...bw(0.5), statedGoal: 'cut' })).statedGoalMismatch).toMatch(/You said cut/);
  });
  it('shows weights in the user unit', () => {
    const r = classifyPhase(input({ ...bw(-0.6), unitPref: 'imperial' }));
    expect(r.evidence.find(e => e.label === 'Bodyweight')?.value).toMatch(/lbs/);
  });
});

describe('phase helpers', () => {
  it('summarizeBodyweight: slope as %/week, needs ≥3 points over ≥10 days', () => {
    const pts = [28, 21, 14, 7, 0].map((a, i) => ({ date: d(a), kg: 80 - i * 0.5 }));
    const s = summarizeBodyweight(pts, NOW);
    expect(s.pctPerWeek!).toBeCloseTo(-0.64, 1);
    expect(summarizeBodyweight(pts.slice(-2), NOW).pctPerWeek).toBeNull();
  });
  it('adaptive maintenance = avg intake − Δkg×7700/days; else null', () => {
    const intake = Array.from({ length: 21 }, (_, i) => ({ date: d(i), kcal: 2000 }));
    const pts = [21, 14, 7, 0].map((a, i) => ({ date: d(a), kg: 80 - i * 0.5 })); // −0.5 kg/wk
    // 0.5 kg/wk × 7700 / 7 = 550 kcal/day deficit → maintenance ≈ 2550
    expect(adaptiveMaintenance(intake, pts, NOW)).toBe(2550);
    expect(adaptiveMaintenance(intake.slice(0, 5), pts, NOW)).toBeNull();
  });
  it('summarizeIntake skips partial days', () => {
    expect(summarizeIntake([{ date: d(0), kcal: 300 }, { date: d(1), kcal: 2200 }], NOW)).toEqual({ avgKcal: 2200, loggedDays: 1 });
  });
  it('summarizeFrequency: sessions/wk and a recent return', () => {
    const f = summarizeFrequency([d(1), d(3), d(25), d(30)], NOW);
    expect(f).toMatchObject({ daysSinceLast: 1, returnedOn: d(3), gapDays: 22 });
  });
  it("windows anchor on the user's local today when given (log dates are local)", () => {
    // A session on d(-1) is "tomorrow" by NOW's UTC date but today for a user
    // already past midnight — it must count, not be dropped as future.
    expect(summarizeFrequency([d(-1), d(6)], NOW).daysSinceLast).toBe(6);
    expect(summarizeFrequency([d(-1), d(6)], NOW, d(-1)).daysSinceLast).toBe(0);
    expect(summarizeIntake([{ date: d(-1), kcal: 2400 }], NOW, 28, d(-1))).toEqual({ avgKcal: 2400, loggedDays: 1 });
    expect(summarizeIntake([{ date: d(-1), kcal: 2400 }], NOW)).toEqual({ avgKcal: null, loggedDays: 0 });
  });
  it('statedGoalOf / parseConfirmedPhase', () => {
    expect(statedGoalOf('Lose fat', {})).toBe('cut');
    expect(statedGoalOf(null, { primaryGoal: 'Build muscle' })).toBe('bulk');
    expect(statedGoalOf('get stronger', {})).toBe('strength');
    expect(parseConfirmedPhase({ trainingPhase: { phase: 'cutting', confirmedAt: 'x', source: 'user_set' } })?.phase).toBe('cutting');
    expect(parseConfirmedPhase({ trainingPhase: { phase: 'nonsense' } })).toBeNull();
  });
});

describe('phase rules', () => {
  const sig = { bwPctPerWeek: -1.4, avgIntakeKcal: 1700, loggedDays: 20 };
  it('phase_confirm when confident and different from the confirmed phase', () => {
    const r = classifyPhase(input(bw(-0.6)));
    const draft = phaseConfirmDraft(r)!;
    expect(draft).toMatchObject({ kind: 'phase_confirm', dedupeKey: 'phase_confirm:cutting', priority: 85 });
    expect(draft.proposal).toMatchObject({ phase: 'cutting', previous: null });
    expect(phaseConfirmDraft({ ...r, confirmed: { phase: 'cutting', confirmedAt: '', source: 'confirmed' } })).toBeNull();
    expect(phaseConfirmDraft({ ...r, confidence: 0.5 })).toBeNull();
  });
  it('cut too aggressive → calorie_adjust to a smaller deficit (never above maintenance − 250)', () => {
    const r = classifyPhase(input({ ...bw(-1.4), maintenance: { kcal: 2500, source: 'adaptive' } }));
    expect(r.effective).toBe('cut_too_aggressive');
    const draft = calorieAdjustDraft({ result: r, signals: sig, dailyCalorieTarget: 1600 })!;
    expect(draft.proposal).toEqual({ kind: 'calorie_adjust', fromKcal: 1600, toKcal: 2000, reason: 'cut_too_aggressive' });
    expect(draft.reasoning).toMatch(/hold your loads/);
  });
  it('surplus too large → trim it', () => {
    const r = classifyPhase(input(bw(0.8)));
    const draft = calorieAdjustDraft({ result: r, signals: { bwPctPerWeek: 0.8, avgIntakeKcal: 3200, loggedDays: 20 }, dailyCalorieTarget: null })!;
    expect(draft.proposal).toMatchObject({ fromKcal: 3200, toKcal: 3000, reason: 'surplus_too_large' });
  });
  it('no calorie card without a number to move from, or outside those phases', () => {
    const r = classifyPhase(input(bw(-1.4)));
    expect(calorieAdjustDraft({ result: r, signals: { ...sig, avgIntakeKcal: null }, dailyCalorieTarget: null })).toBeNull();
    expect(buildPhaseDrafts({ result: classifyPhase(input()), signals: sig, dailyCalorieTarget: 2000 }).map(x => x.kind)).toEqual(['phase_confirm']);
  });
});
