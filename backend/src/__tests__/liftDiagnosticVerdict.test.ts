/**
 * Grading rules for the conversational lift diagnostic (handoff §5–§7):
 * evidence is assembled only from what the user gave, 0/1/2+ ratios grade
 * differently, charts are suppressed below 2, confidence never reaches 100,
 * and the fix ships with the diagnosis (never paywalled).
 */
import { describe, it, expect } from 'vitest';
import {
  buildCandidates,
  buildEvidence,
  buildVerdict,
  e1rm,
  flagsFrom,
  gatherInputs,
  presentVerdict,
  ratioReads,
  type SignalsSubset,
  type TurnRow,
} from '../services/liftDiagnostic/verdict.js';
import { parseTrimWindow, toVideoResult } from '../services/liftDiagnostic/video.js';
import { computeConfidence, flagsForPhase, LADDERS, LIFT_PHASES, CONVERSATION_LIFTS } from '../services/liftDiagnostic/policy.js';
import { exercisesFor } from '../services/liftDiagnostic/writeThrough.js';

const lb = (weight: number, reps = 5, sets = 3) => ({ weight, sets, reps, unit: 'lb' as const });

const SIGNALS: SignalsSubset = {
  indices: { triceps_index: { value: 78 }, shoulder_index: { value: 96 } },
  primary_phase: 'lockout',
  hypothesis_scores: [
    { key: 'triceps_deficit', label: 'Triceps lockout strength', score: 82 },
    { key: 'scap_stability_deficit', label: 'Upper back stability', score: 40 },
  ],
  efficiency_score: { score: 71 },
  validation_test: { description: 'Paused close-grip test', how_to_run: 'Work up to a 3RM paused close grip.' },
};

function turns(...rows: [string, any, any?][]): TurnRow[] {
  return rows.map(([type, payload, result]) => ({ type, payload, result: result ?? {} }));
}

const BENCH_2_RATIOS = turns(
  ['lift', { lift: 'flat_bench_press' }],
  ['main', { set: lb(225) }],
  ['accessory', { exerciseId: 'close_grip_bench_press', set: lb(165) }], // 73% → below 85–95
  ['accessory', { exerciseId: 'paused_bench_press', set: lb(205) }], // 91% → inside
  ['moveOn', {}],
  ['skipVideo', {}],
  ['answer', { question: 'q0', optionId: 'lockout', text: 'Near lockout', flags: ['hard_at_lockout'] }],
  ['answer', { question: 'q1', text: 'my elbows flare out wide', flags: [] }],
);

describe('gatherInputs', () => {
  it('folds the transcript; a later logged set overrides an earlier skip', () => {
    const inputs = gatherInputs('s', 'flat_bench_press', turns(
      ['main', { set: lb(225) }],
      ['skip', { exerciseId: 'overhead_press' }],
      ['accessory', { exerciseId: 'overhead_press', set: lb(145) }],
      ['skip', { exerciseId: 'overhead_press' }],
    ));
    expect(inputs.accessories.get('overhead_press')?.status).toBe('logged');
  });

  it('chip flags pass through; typed answers go through the keyword parser; video phase adds its flags', () => {
    const inputs = gatherInputs('s', 'flat_bench_press', [
      ...BENCH_2_RATIOS,
      { type: 'video', payload: {}, result: { video: { status: 'complete', result: { stickingPhase: 'bottom', stickingPointSec: 0.4, elbowFlareDeg: null, barDriftCm: null, frameUrl: null } } } },
    ]);
    expect(flagsFrom(inputs)).toMatchObject({ hard_at_lockout: true, elbows_flare_early: true, hard_off_chest: true });
  });
});

describe('evidence (§7)', () => {
  it('RATIO rows cite the real percentage against the norm', () => {
    const rows = buildEvidence(gatherInputs('s', 'flat_bench_press', BENCH_2_RATIOS));
    const ratio = rows.filter((r) => r.tag === 'RATIO').map((r) => r.text);
    const cg = Math.round((e1rm(165, 5) / e1rm(225, 5)) * 100);
    expect(ratio[0]).toBe(`Close Grip Bench Press is ${cg}% of your bench — below the 85–95% norm, so triceps lag.`);
    expect(ratio[1]).toMatch(/inside the 88–95% norm, so strength off the chest is not the limiter\.$/);
  });

  it('a missing shoulder ratio says shoulders cannot be ruled out — never "not the limiter"', () => {
    const rows = buildEvidence(gatherInputs('s', 'flat_bench_press', BENCH_2_RATIOS));
    expect(rows).toContainEqual({ tag: 'GAP', text: "No shoulder ratio logged, so shoulders can't be ruled out yet." });
    expect(rows.some((r) => /shoulders are not the limiter/.test(r.text))).toBe(false);
  });

  it('an in-range shoulder ratio produces the confident row instead', () => {
    const rows = buildEvidence(gatherInputs('s', 'flat_bench_press', [
      ...BENCH_2_RATIOS,
      { type: 'accessory', payload: { exerciseId: 'overhead_press', set: lb(150) }, result: {} },
    ]));
    expect(rows.some((r) => r.tag === 'RATIO' && /shoulders are not the limiter/.test(r.text))).toBe(true);
    expect(rows.some((r) => /No shoulder ratio/.test(r.text))).toBe(false);
  });

  it('"I don\'t train it" is a GAP row, not a ratio', () => {
    const inputs = gatherInputs('s', 'flat_bench_press', turns(
      ['main', { set: lb(225) }],
      ['untrained', { exerciseId: 'overhead_press' }],
    ));
    const rows = buildEvidence(inputs);
    expect(rows).toEqual([{ tag: 'GAP', text: "You don't train Overhead Press — a gap in your pressing volume, not a blank." }]);
    expect(ratioReads(inputs)).toHaveLength(0);
  });

  it('never renders a row for data the user did not provide', () => {
    const rows = buildEvidence(gatherInputs('s', 'deadlift', turns(['main', { set: lb(405) }])));
    expect(rows).toEqual([]);
  });

  it('kg sets are converted before the ratio is taken', () => {
    const inputs = gatherInputs('s', 'flat_bench_press', turns(
      ['main', { set: { weight: 100, sets: 3, reps: 5, unit: 'kg' } }],
      ['accessory', { exerciseId: 'close_grip_bench_press', set: { weight: 90, sets: 3, reps: 5, unit: 'kg' } }],
    ));
    expect(ratioReads(inputs)[0].pct).toBe(90);
  });
});

describe('grades (§7)', () => {
  const zero = gatherInputs('s', 'flat_bench_press', turns(['main', { set: lb(225) }], ['answer', { question: 'q0', text: 'Near lockout', optionId: 'lockout', flags: ['hard_at_lockout'] }]));
  const one = gatherInputs('s', 'flat_bench_press', turns(['main', { set: lb(225) }], ['accessory', { exerciseId: 'close_grip_bench_press', set: lb(165) }]));
  const two = gatherInputs('s', 'flat_bench_press', BENCH_2_RATIOS);

  it('2+ ratios: Primary / Secondary / Ruled out and charts', () => {
    const v = buildVerdict(two, SIGNALS, null);
    expect(v.grade).toBe(2);
    expect(v.charts).toEqual({ indices: { triceps_index: 78, shoulder_index: 96 }, efficiency: 71 });
    expect(v.validationTest).toBeNull();
    expect(v.candidates.map((c) => c.rank)).toEqual(['primary', 'secondary', 'ruled_out']);
    expect(v.limiter).toEqual({ phase: 'lockout', hypothesisKey: 'triceps_deficit', hypothesisLabel: 'Triceps lockout strength' });
  });

  it('1 ratio: Leading / Open, no charts, validation test present', () => {
    const v = buildVerdict(one, SIGNALS, null);
    expect(v.grade).toBe(1);
    expect(v.charts).toBeNull();
    expect(v.validationTest).toEqual({ description: 'Paused close-grip test', howToRun: 'Work up to a 3RM paused close grip.' });
    expect(buildCandidates(one, SIGNALS, 1).map((c) => c.rank)).toEqual(['leading', 'open']);
  });

  it('0 ratios: nothing is named as leading', () => {
    const v = buildVerdict(zero, SIGNALS, null);
    expect(v.grade).toBe(0);
    expect(v.candidates.every((c) => c.rank === 'open')).toBe(true);
  });

  it('confidence follows the evidence and stays below 100', () => {
    expect(buildVerdict(zero, SIGNALS, null).confidence).toBe(computeConfidence(0, false, 1));
    expect(buildVerdict(two, SIGNALS, null).confidence).toBe(Math.min(84, 46 + 24 + 6));
    expect(computeConfidence(9, true, 9)).toBe(84);
  });

  it('missingLifts lists skipped or never-offered ladder lifts, not untrained ones', () => {
    const inputs = gatherInputs('s', 'flat_bench_press', [
      ...BENCH_2_RATIOS,
      { type: 'untrained', payload: { exerciseId: 'tricep_pushdown' }, result: {} },
    ]);
    expect(buildVerdict(inputs, SIGNALS, null).missingLifts).toEqual(['overhead_press']);
  });
});

describe('presentVerdict', () => {
  const plan = {
    bench_day_plan: {
      primary_lift: { exercise_id: 'flat_bench_press', exercise_name: 'Flat Bench Press', sets: 4, reps: '5', intensity: 'RIR 2', rest_minutes: 3 },
      accessories: [
        { exercise_id: 'close_grip_bench_press', exercise_name: 'Close Grip Bench Press', sets: 3, reps: '6', why: 'Triceps', category: 'targeted', priority: 1 as const, impact: 'high' as const },
        { exercise_id: 'jm_press', exercise_name: 'JM Press', sets: 3, reps: '8', why: 'Triceps', category: 'targeted', priority: 2 as const, impact: 'medium' as const },
      ],
    },
    progression_rules: ['Add 5 lb when all sets hit RIR 2'],
    track_next_time: ['Bar speed at lockout'],
  };
  const full = buildVerdict(gatherInputs('s', 'flat_bench_press', BENCH_2_RATIOS), SIGNALS, plan);

  it('the fix is part of the free verdict — never paywalled', () => {
    expect(full.fix?.accessories.map((a) => a.name)).toEqual(['Close Grip Bench Press', 'JM Press']);
    expect(presentVerdict(full)).toBe(full);
  });

  it('public links never carry the lifter still', () => {
    const withFrame = { ...full, video: { stickingPhase: 'lockout', stickingPointSec: 0.4, elbowFlareDeg: 12, barDriftCm: 4, frameUrl: 'data:image/jpeg;base64,AAA' } };
    const pub = presentVerdict(withFrame, { publicView: true });
    expect(pub.video?.frameUrl).toBeNull();
    expect(pub.fix).toEqual(full.fix);
  });
});

describe('video measurement validation', () => {
  it('drops out-of-range numbers, unknown phases, and elbow flare on non-press lifts', () => {
    expect(toVideoResult({ liftVisible: true, stickingPhase: 'lockout', stickingPointSec: 0.4, stickingTimestampSec: 3, elbowFlareDeg: 12, barDriftCm: 4 }, 'flat_bench_press', null))
      .toEqual({ stickingPhase: 'lockout', stickingPointSec: 0.4, elbowFlareDeg: 12, barDriftCm: 4, frameUrl: null });
    expect(toVideoResult({ liftVisible: true, stickingPhase: 'moon', stickingPointSec: 99, stickingTimestampSec: 1, elbowFlareDeg: 12, barDriftCm: 3 }, 'deadlift', 'QQ'))
      .toEqual({ stickingPhase: null, stickingPointSec: null, elbowFlareDeg: null, barDriftCm: 3, frameUrl: 'data:image/jpeg;base64,QQ' });
  });

  it('an unreadable clip is null, which the client turns into the full interview', () => {
    expect(toVideoResult({ liftVisible: false, stickingPhase: 'lockout', stickingPointSec: 1, stickingTimestampSec: 1, elbowFlareDeg: 1, barDriftCm: 1 }, 'flat_bench_press', null)).toBeNull();
    expect(toVideoResult({ liftVisible: true, stickingPhase: null, stickingPointSec: null, stickingTimestampSec: null, elbowFlareDeg: null, barDriftCm: null }, 'flat_bench_press', null)).toBeNull();
  });
});

describe('policy tables', () => {
  it('every lift has a ladder and every phase maps to flags', () => {
    for (const lift of CONVERSATION_LIFTS) {
      expect(LADDERS[lift].length).toBeGreaterThanOrEqual(3);
      for (const phase of LIFT_PHASES[lift]) expect(flagsForPhase(lift, phase).length).toBeGreaterThan(0);
    }
  });

  it('flat bench ladder matches the design spec order', () => {
    expect(LADDERS.flat_bench_press.map((l) => l.id)).toEqual(['close_grip_bench_press', 'paused_bench_press', 'overhead_press', 'tricep_pushdown']);
  });
});

describe('write-through', () => {
  it('stores the main lift and logged accessories in kg, once each', () => {
    const inputs = gatherInputs('s', 'flat_bench_press', BENCH_2_RATIOS);
    const ex = exercisesFor(inputs);
    expect(ex.map((e) => e.name)).toEqual(['Flat Bench Press', 'Close Grip Bench Press', 'Paused Bench Press']);
    expect(ex[0]).toMatchObject({ sets: 3, reps: '5', weightKg: 102.1 });
    expect(ex[0].setEntries).toHaveLength(3);
  });
});

describe('trim window', () => {
  it('accepts a sane window within the cap and rejects everything else', () => {
    expect(parseTrimWindow('3', '14.2', 65)).toEqual({ startSec: 3, endSec: 14.2 });
    expect(parseTrimWindow('0', '70', 65)).toBeNull();
    expect(parseTrimWindow('5', '5.2', 65)).toBeNull();
    expect(parseTrimWindow('-1', '4', 65)).toBeNull();
    expect(parseTrimWindow(undefined, '4', 65)).toBeNull();
  });
});
