import { describe, it, expect } from 'vitest';
import { createSseParser, parseJsonFrame } from '../src/sse';
import { threadReducer, emptyThread, receiptSummary, canSend, BUSY_UNLOCK_MS, type StreamEvent } from '../src/receipts';
import { rubberBand, snapTarget, fractionalPosition, nearestPage, titleOpacity, pillOffset, shouldStartDrag } from '../src/track';
import { initialWorkout, workoutReducer, defaultRules, summarize, exerciseProgress, toWorkoutLogBody, mmss, type PlanExercise } from '../src/workout';
import { initialOnboarding, onboardingReducer, askDots, goalHint, type Question } from '../src/onboarding';

describe('sse parser', () => {
  it('splits frames across chunk boundaries and parses json', () => {
    const frames: any[] = [];
    const p = createSseParser((f) => frames.push(f));
    p.push('data: {"type":"status","ph');
    p.push('ase":"thinking"}\n\ndata: {"type":"delta","text":"Hi"}\n\nevent: end\ndata: {}\n\n');
    p.end();
    expect(frames).toHaveLength(3);
    expect(parseJsonFrame(frames[0])).toEqual({ type: 'status', phase: 'thinking' });
    expect(parseJsonFrame(frames[1])).toEqual({ type: 'delta', text: 'Hi' });
    expect(frames[2].event).toBe('end');
  });
  it('drops comments and non-json data without throwing', () => {
    const frames: any[] = [];
    const p = createSseParser((f) => frames.push(f));
    p.push(': keepalive\n\ndata: not json\n\n');
    expect(frames).toHaveLength(1);
    expect(parseJsonFrame(frames[0])).toBeNull();
  });
  it('flushes a trailing frame on end', () => {
    const frames: any[] = [];
    const p = createSseParser((f) => frames.push(f));
    p.push('data: {"a":1}');
    expect(frames).toHaveLength(0);
    p.end();
    expect(frames).toHaveLength(1);
  });
});

describe('thread reducer', () => {
  const run = (events: StreamEvent[]) => {
    let s = threadReducer(emptyThread(), { type: 'send', id: 'u1', agentId: 'a1', text: 'hi', now: 1000 });
    for (const e of events) s = threadReducer(s, { type: 'event', agentId: 'a1', event: e });
    return s;
  };
  it('send appends a user turn and an open agent turn and locks', () => {
    const s = run([]);
    expect(s.turns.map((t) => t.kind)).toEqual(['user', 'agent']);
    expect(s.busy).toBe(true);
    expect(canSend(s, 1000)).toBe(false);
    expect(canSend(s, 1000 + BUSY_UNLOCK_MS + 1)).toBe(true);
  });
  it('receipts append and refine in place by id', () => {
    const s = run([
      { type: 'receipt', id: 'r1', verb: 'Pulled', text: 'Last 14 days of sessions' },
      { type: 'receipt', id: 'r2', verb: 'Read', text: 'Program' },
      { type: 'receipt', id: 'r1', verb: 'Pulled', text: 'Last 14 days — 6 sessions', final: true },
    ]);
    const t = s.turns[1];
    expect(t.receipts.map((r) => r.text)).toEqual(['Last 14 days — 6 sessions', 'Program']);
    expect(receiptSummary(t)).toBe('Read — Program');
  });
  it('deltas accumulate; done is authoritative and unlocks', () => {
    const s = run([
      { type: 'delta', text: 'Thinking…' },
      { type: 'done', reply: 'Final.', toolsUsed: [], iterations: 1 },
    ]);
    expect(s.turns[1].text).toBe('Final.');
    expect(s.turns[1].done).toBe(true);
    expect(s.busy).toBe(false);
  });
  it('done summary reads "Checked N things · verbs"', () => {
    const s = run([
      { type: 'receipt', id: 'r1', verb: 'Read', text: 'Program' },
      { type: 'receipt', id: 'r2', verb: 'Pulled', text: 'X' },
      { type: 'receipt', id: 'r3', verb: 'Pulled', text: 'Y' },
      { type: 'done', reply: 'ok', toolsUsed: [], iterations: 1 },
    ]);
    expect(receiptSummary(s.turns[1])).toBe('Checked 3 things · read, pulled');
  });
  it('cards initialise their state', () => {
    const s = run([
      { type: 'card', card: { type: 'week', data: { weekDays: [], proposal: { proposedWeek: [] } } } },
      { type: 'done', reply: 'ok', toolsUsed: [], iterations: 1 },
    ]);
    expect(s.turns[1].cardState).toEqual({ status: 'pending' });
  });
  it('error closes the turn and records the message', () => {
    const s = run([{ type: 'error', error: 'boom' }]);
    expect(s.busy).toBe(false);
    expect(s.error).toBe('boom');
    expect(s.turns[1].done).toBe(true);
  });
});

describe('track math', () => {
  it('rubber-bands at the ends', () => {
    expect(rubberBand(0, 100, 400)).toBe(30);
    expect(rubberBand(4, -100, 400)).toBe(-30);
    expect(rubberBand(2, 100, 400)).toBe(100);
    expect(rubberBand(2, 900, 400)).toBe(400);
  });
  it('snaps on distance or flick', () => {
    expect(snapTarget(1, -130, 400, 500)).toBe(2);
    expect(snapTarget(1, -40, 400, 100)).toBe(2);
    expect(snapTarget(1, -40, 400, 500)).toBe(1);
    expect(snapTarget(0, 300, 400, 500)).toBe(0);
    expect(snapTarget(4, -300, 400, 500)).toBe(4);
  });
  it('fractional position, nearest, title fade, pill', () => {
    expect(fractionalPosition(1, -200, 400)).toBe(1.5);
    expect(nearestPage(1.5)).toBe(2);
    expect(titleOpacity(1)).toBe(1);
    expect(titleOpacity(1.5)).toBe(0);
    expect(pillOffset(2)).toBeCloseTo(116.8);
  });
  it('drag start needs 6px and horizontal bias', () => {
    expect(shouldStartDrag(3, 0, false)).toBe('wait');
    expect(shouldStartDrag(10, 20, false)).toBe('cancel');
    expect(shouldStartDrag(10, 4, false)).toBe('start');
    expect(shouldStartDrag(0, 50, true)).toBe('start');
  });
});

describe('workout machine', () => {
  const plan: PlanExercise[] = [
    { name: 'Deadlift', sets: 2, reps: 3, load: 285, rest: 150, cue: null },
    { name: 'Pull-up', sets: 1, reps: 8, load: null, rest: 90, cue: null },
  ];
  const rules = defaultRules('lbs');
  it('begin → set; hard adds rest; miss drops next set and can be reverted', () => {
    let s = workoutReducer(initialWorkout(plan), { type: 'begin', now: 0 });
    expect(s.step).toBe('set');
    s = workoutReducer(s, { type: 'rate', rating: 'hard', now: 1000, plan, rules });
    expect(s.step).toBe('rest');
    expect(s.restDur).toBe(180);
    expect(s.lastReceipt?.verb).toBe('Adjusted');
    s = workoutReducer(s, { type: 'rest_skip' });
    expect(s.set).toBe(1);
    // last set of deadlift, miss → logged (no next set to drop), moves to pull-up rest
    s = workoutReducer(s, { type: 'rate', rating: 'miss', now: 2000, plan, rules });
    expect(s.lastReceipt?.verb).toBe('Logged');
    expect(s.ex).toBe(1);
  });
  it('miss on a non-last set drops the load by two steps with a revert', () => {
    let s = workoutReducer(initialWorkout(plan), { type: 'begin', now: 0 });
    s = workoutReducer(s, { type: 'rate', rating: 'miss', now: 1000, plan, rules });
    expect(s.loads[0]).toBe(275);
    expect(s.lastReceipt?.revert).toEqual({ ex: 0, load: 285 });
    s = workoutReducer(s, { type: 'revert_last' });
    expect(s.loads[0]).toBe(285);
    expect(s.receipts).toHaveLength(0);
  });
  it('easy on the last set notes next week; last exercise ends the session', () => {
    let s = workoutReducer(initialWorkout(plan), { type: 'begin', now: 0 });
    s = workoutReducer(s, { type: 'rate', rating: 'easy', now: 1000, plan, rules });
    s = workoutReducer(s, { type: 'rest_skip' });
    s = workoutReducer(s, { type: 'rate', rating: 'easy', now: 2000, plan, rules });
    expect(s.nextWeek).toEqual([{ ex: 0, delta: 5 }]);
    s = workoutReducer(s, { type: 'rest_skip' });
    s = workoutReducer(s, { type: 'rate', rating: 'easy', now: 3000, plan, rules });
    expect(s.step).toBe('done');
    const sum = summarize(s, plan, 3000);
    expect(sum.sets).toBe(3);
    expect(sum.totalSets).toBe(3);
    expect(sum.topSet).toBe('Deadlift 285 × 3');
    expect(sum.volume).toBe(285 * 3 * 2);
    expect(exerciseProgress(s, plan)).toEqual([1, 1]);
    const body = toWorkoutLogBody(s, plan, 'Pull', '2026-09-28', 3000);
    expect(body.exercises).toHaveLength(2);
    expect(body.exercises[0].weight).toBe(285);
  });
  it('pause excludes time from the clock and shifts the rest end', () => {
    let s = workoutReducer(initialWorkout(plan), { type: 'begin', now: 0 });
    s = workoutReducer(s, { type: 'rate', rating: 'easy', now: 10_000, plan, rules });
    s = workoutReducer(s, { type: 'pause', now: 20_000 });
    s = workoutReducer(s, { type: 'resume', now: 50_000 });
    expect(s.pausedMs).toBe(30_000);
    expect(s.restEnd).toBe(10_000 + 150_000 + 30_000);
    expect(mmss(65)).toBe('1:05');
  });
  it('kg rules step 2.5', () => {
    expect(defaultRules('kg').step).toBe(2.5);
    expect(defaultRules('kg').restForReps(3)).toBe(150);
    expect(defaultRules('kg').restForReps('8-10')).toBe(90);
  });
});

describe('onboarding reducer', () => {
  const qs: Question[] = [
    { key: 'bw', short: 'Bodyweight', label: 'Bodyweight?', why: 'w', adjust: 'protein target', options: ['Under 160', '160–190'] },
    { key: 'leg', short: 'Leg', label: 'Numbness?', why: 'w', adjust: 'the clinical route', options: ['No', 'Yes'], redFlag: ['Yes'] },
  ];
  it('goal → working → gaps → ask → plan with receipts', () => {
    let s = onboardingReducer(initialOnboarding(), { type: 'type_goal', goal: 'Pull 350' });
    s = onboardingReducer(s, { type: 'start' });
    expect(s.screen).toBe('working');
    s = onboardingReducer(s, { type: 'ledger', line: { verb: 'Read', text: 'NSCA' } });
    s = onboardingReducer(s, { type: 'gaps', sources: 3, questions: qs });
    expect(s.screen).toBe('gaps');
    s = onboardingReducer(s, { type: 'begin_ask' });
    expect(s.screen).toBe('ask');
    expect(askDots(s)).toEqual([true, false]);
    s = onboardingReducer(s, { type: 'answer', answer: '160–190' });
    expect(s.last?.text).toBe('protein target — from “160–190”');
    expect(s.qi).toBe(1);
    s = onboardingReducer(s, { type: 'answer', answer: 'No' });
    expect(s.screen).toBe('plan');
  });
  it('a red-flag answer pauses; cleared continues', () => {
    let s = onboardingReducer(initialOnboarding(), { type: 'gaps', sources: 3, questions: qs });
    s = onboardingReducer(s, { type: 'begin_ask' });
    s = onboardingReducer(s, { type: 'answer', answer: 'Under 160' });
    s = onboardingReducer(s, { type: 'answer', answer: 'Yes' });
    expect(s.screen).toBe('redflag');
    s = onboardingReducer(s, { type: 'redflag_choice', choice: 'clinician' });
    expect(s.screen).toBe('redflag');
    s = onboardingReducer(s, { type: 'redflag_choice', choice: 'cleared' });
    expect(s.screen).toBe('plan');
    expect(s.answers.redFlagRoute).toBe('cleared');
  });
  it('prefilled and consent sit between ask and plan', () => {
    let s = onboardingReducer(initialOnboarding(), { type: 'gaps', sources: 1, questions: [qs[0]], prefilled: [{ key: 'age', label: 'Age', value: '29', source: 'Apple Health' }], consent: [{ key: 'logs', label: 'Training logs', sub: '', on: true }] });
    s = onboardingReducer(s, { type: 'begin_ask' });
    s = onboardingReducer(s, { type: 'answer', answer: 'Under 160' });
    expect(s.screen).toBe('prefilled');
    s = onboardingReducer(s, { type: 'edit_prefilled', key: 'age', value: '30' });
    expect(s.prefilled[0].source).toBe('You, just now');
    s = onboardingReducer(s, { type: 'prefilled_ok' });
    expect(s.screen).toBe('consent');
    s = onboardingReducer(s, { type: 'toggle_consent', key: 'logs' });
    expect(s.consent[0].on).toBe(false);
    s = onboardingReducer(s, { type: 'agree' });
    expect(s.screen).toBe('plan');
  });
  it('goal hints', () => {
    expect(goalHint('Pull a 350 lb deadlift')).toBe('strength');
    expect(goalHint('Fix my lower back')).toBe('pain');
    expect(goalHint('Rehab a ruptured Achilles')).toBe('rehab');
    expect(goalHint('feel better')).toBe('general');
  });
});
