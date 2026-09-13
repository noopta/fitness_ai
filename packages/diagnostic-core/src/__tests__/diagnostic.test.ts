import { describe, it, expect, vi } from 'vitest';
import {
  COPY,
  DiagnosticController,
  STAGES,
  canSubmit,
  changeOffer,
  composerModeFor,
  composerView,
  computeConfidence,
  diagnosticReducer,
  hydrate,
  initialState,
  nextOffer,
  parseRich,
  progressLabel,
  reportSections,
  verdictHeadline,
  homeHero,
  type DiagnosticApi,
  type DiagnosticState,
  type TurnInput,
  type TurnRecord,
  type TurnResult,
  type Verdict,
  type VideoResult,
} from '../index';

const SET = { weight: 225, sets: 3, reps: 5, unit: 'lb' as const };

function verdict(grade: 0 | 1 | 2, over: Partial<Verdict> = {}): Verdict {
  return {
    sessionId: 's1',
    lift: 'flat_bench_press',
    grade,
    confidence: 70,
    ratiosLogged: grade,
    hasVideo: false,
    answersGiven: 3,
    limiter: { phase: 'lockout', hypothesisKey: 'triceps_deficit', hypothesisLabel: 'Triceps lockout strength' },
    evidence: [],
    candidates: [],
    charts: grade === 2 ? { indices: {}, efficiency: 70 } : null,
    video: null,
    validationTest: null,
    fix: { locked: true, accessoryCount: 3 },
    trackNextTime: [],
    missingLifts: [],
    createdAt: '2026-09-13T00:00:00Z',
    ...over,
  };
}

let turnSeq = 0;
/** Submit + succeed a turn through the reducer, like a happy network. */
function act(s: DiagnosticState, input: TurnInput, result: TurnResult = {}): DiagnosticState {
  const id = `t${++turnSeq}`;
  const submitted = diagnosticReducer(s, { type: 'submit', turn: { id, input } });
  expect(submitted).not.toBe(s); // the action was legal
  return diagnosticReducer(submitted, { type: 'succeeded', turnId: id, result });
}

const userBubbles = (s: DiagnosticState) => s.thread.filter((t) => t.kind === 'user');

function toAcc(): DiagnosticState {
  let s = initialState('s1');
  s = act(s, { type: 'lift', lift: 'flat_bench_press' });
  return act(s, { type: 'main', set: SET });
}

function logOffer(s: DiagnosticState, result: TurnResult = {}) {
  return act(s, { type: 'accessory', exerciseId: s.offer!, set: { ...SET, weight: 185 } }, result);
}

describe('stage machine', () => {
  it('maps every one of the 12 stages to a composer mode', () => {
    expect(STAGES).toHaveLength(12);
    const modes = new Set(STAGES.map((st) => composerModeFor(st, false)));
    modes.add(composerModeFor('q1', true));
    expect([...modes].sort()).toEqual(
      ['accessory', 'blocked', 'chips', 'done', 'generate', 'numbers', 'typing', 'video', 'waiting'].sort(),
    );
  });

  it('progress pill counts over 7, maps sub-stages to parents, reads Done at verdict', () => {
    expect(progressLabel('lift', 0)).toBe('1 / 7');
    expect(progressLabel('analyzing', 0)).toBe('4 / 7');
    expect(progressLabel('q2', 0)).toBe('5 / 7');
    expect(progressLabel('blocked', 0)).toBe('5 / 7');
    expect(progressLabel('generating', 0)).toBe('6 / 7');
    expect(progressLabel('verdict', 6)).toBe('Done');
    // never backwards: re-scoring returns to acc after the verdict
    expect(progressLabel('acc', 6)).toBe('7 / 7');
  });
});

describe('one bubble per action (§1a)', () => {
  it('lift, numbers, skip, untrained and move on each leave exactly one user bubble', () => {
    let s = toAcc();
    expect(userBubbles(s)).toHaveLength(2);
    s = act(s, { type: 'skip', exerciseId: s.offer! });
    expect(userBubbles(s)).toHaveLength(3);
    s = act(s, { type: 'untrained', exerciseId: s.offer! });
    expect(userBubbles(s)).toHaveLength(4);
    s = logOffer(s);
    s = logOffer(s);
    expect(canSubmit(s, { type: 'moveOn' })).toBe(false); // ladder exhausted → already at video
    expect(s.stage).toBe('video');
    expect(userBubbles(s).map((b) => b.text)).toEqual([
      'Flat Bench Press',
      '225 lb · 3 × 5',
      COPY.skip,
      COPY.dontTrain,
      '185 lb · 3 × 5',
      '185 lb · 3 × 5',
    ]);
  });
});

describe('related lifts (§5)', () => {
  it('walks the flat bench ladder in spec order', () => {
    let s = toAcc();
    expect(s.offer).toBe('close_grip_bench_press');
    s = logOffer(s);
    expect(s.offer).toBe('paused_bench_press');
    expect(s.thread.at(-1)).toMatchObject({ kind: 'anakin', text: 'Good. And *Paused Bench Press*?' });
  });

  it('shows "n of 2 minimum" and Skip below the minimum, then Move on at 2+', () => {
    let s = toAcc();
    let view = composerView(s);
    expect(view).toMatchObject({ mode: 'accessory', escape: 'skip', counter: { text: '0 of 2 minimum', atMinimum: false } });
    s = logOffer(logOffer(s));
    view = composerView(s);
    expect(view).toMatchObject({ escape: 'moveOn', counter: { text: '2 logged · 3 sharpens it', atMinimum: true } });
  });

  it('offers the third at exactly two instead of assuming', () => {
    const s = logOffer(logOffer(toAcc()));
    expect(s.stage).toBe('acc');
    expect(s.thread.at(-1)).toMatchObject({
      text: 'Two is enough to score you — a third sharpens it. **Overhead Press**, or move on?',
    });
  });

  it('pushes back once on an under-minimum Skip and substitutes', () => {
    let s = toAcc();
    s = act(s, { type: 'skip', exerciseId: s.offer! });
    expect(s.thread.at(-1)).toMatchObject({ text: "I need two ratios minimum, so let's try *Paused Bench Press*." });
    s = act(s, { type: 'skip', exerciseId: s.offer! });
    expect(s.thread.at(-1)).toMatchObject({ text: 'Okay. *Overhead Press*?' });
  });

  it('treats "I don\'t train it" as signal and does not count it as a ratio', () => {
    let s = toAcc();
    s = act(s, { type: 'untrained', exerciseId: s.offer! });
    expect(s.accessories).toEqual([{ exerciseId: 'close_grip_bench_press', status: 'untrained' }]);
    expect(composerView(s)).toMatchObject({ counter: { text: '0 of 2 minimum' } });
  });

  it('Change never offers an answered lift and wraps', () => {
    let s = toAcc();
    s = logOffer(s); // close grip logged
    s = act(s, { type: 'change', exerciseId: s.offer! }); // paused → overhead
    expect(s.offer).toBe('overhead_press');
    s = act(s, { type: 'change', exerciseId: s.offer! }); // → pushdown
    expect(s.offer).toBe('tricep_pushdown');
    s = act(s, { type: 'change', exerciseId: s.offer! }); // wraps past close grip → paused
    expect(s.offer).toBe('paused_bench_press');
    expect(changeOffer('flat_bench_press', [
      { exerciseId: 'close_grip_bench_press', status: 'logged' },
      { exerciseId: 'paused_bench_press', status: 'logged' },
      { exerciseId: 'overhead_press', status: 'skipped' },
    ], 'tricep_pushdown')).toBeNull();
  });

  it('cannot strand the user: skipping through the whole ladder ends the loop', () => {
    let s = toAcc();
    for (let i = 0; i < 4; i++) s = act(s, { type: 'skip', exerciseId: s.offer! });
    expect(s.stage).toBe('video');
    expect(nextOffer('flat_bench_press', s.accessories)).toBeNull();
    expect(s.thread.at(-1)).toMatchObject({ text: COPY.askVideoThin });
  });

  it('ends at three logged', () => {
    const s = logOffer(logOffer(logOffer(toAcc())));
    expect(s.stage).toBe('video');
    expect(s.thread.slice(-2).map((t) => (t.kind === 'anakin' ? t.text : ''))).toEqual([COPY.threeLogged, COPY.askVideo]);
  });

  it('Move on at 2 logged advances through the same send path', () => {
    let s = logOffer(logOffer(toAcc()));
    s = act(s, { type: 'moveOn' });
    expect(s.stage).toBe('video');
    expect(userBubbles(s).at(-1)).toMatchObject({ text: COPY.moveOn, status: 'sent' });
  });
});

const VIDEO_OK: VideoResult = { stickingPhase: 'lockout', stickingPointSec: 0.4, elbowFlareDeg: 12, barDriftCm: 4, frameUrl: null };

describe('optional video (§6)', () => {
  function toVideoStage() {
    return act(logOffer(logOffer(toAcc())), { type: 'moveOn' });
  }

  it('a successful clip settles the phase: two questions instead of three', () => {
    let s = toVideoStage();
    s = diagnosticReducer(s, { type: 'submit', turn: { id: 'v1', input: { type: 'video', durationSec: 12 } } });
    expect(s.stage).toBe('analyzing');
    expect(composerView(s)).toEqual({ mode: 'waiting', label: COPY.trackingBar });
    s = diagnosticReducer(s, { type: 'succeeded', turnId: 'v1', result: { video: { status: 'pending' } } });
    expect(s.stage).toBe('analyzing');
    s = diagnosticReducer(s, { type: 'videoResolved', turnId: 'v1', result: VIDEO_OK });
    expect(s.stage).toBe('q1');
    expect(s.questionOrder).toEqual(['q1', 'q2']);
    expect(s.answers.q0).toMatchObject({ source: 'video', optionId: 'lockout' });
    expect(s.thread.some((t) => t.kind === 'video')).toBe(true);
    expect(s.thread.some((t) => t.kind === 'anakin' && t.text === COPY.phaseSettled)).toBe(true);
  });

  it('a failed clip falls back to all three questions — never a dead end', () => {
    let s = toVideoStage();
    s = act(s, { type: 'video', durationSec: 12 }, { video: { status: 'pending' } });
    s = diagnosticReducer(s, { type: 'videoResolved', turnId: s.video.turnId!, result: null });
    expect(s.stage).toBe('q0');
    expect(s.questionOrder).toEqual(['q0', 'q1', 'q2']);
  });

  it('skipping goes straight to q0', () => {
    const s = act(toVideoStage(), { type: 'skipVideo' });
    expect(s.stage).toBe('q0');
    expect(userBubbles(s).at(-1)!.text).toBe(COPY.skip);
  });
});

function toReady(): DiagnosticState {
  let s = act(act(logOffer(logOffer(toAcc())), { type: 'moveOn' }), { type: 'skipVideo' });
  for (const q of ['q0', 'q1', 'q2'] as const) {
    s = act(s, { type: 'answer', question: q, optionId: 'x', text: `answer ${q}`, flags: [] });
  }
  return s;
}

describe('interview, verdict, limits', () => {
  it('"Type instead" swaps chips for a text composer and back', () => {
    let s = act(act(logOffer(logOffer(toAcc())), { type: 'moveOn' }), { type: 'skipVideo' });
    s = diagnosticReducer(s, { type: 'setTypeInstead', value: true });
    expect(composerView(s).mode).toBe('typing');
    s = act(s, { type: 'answer', question: 'q0', text: 'it dies right at the top', flags: [] });
    expect(s.answers.q0).toMatchObject({ source: 'text' });
    expect(composerView(s).mode).toBe('chips');
  });

  it('ready → generating (optimistic) → verdict card', () => {
    let s = toReady();
    expect(s.stage).toBe('ready');
    s = diagnosticReducer(s, { type: 'submit', turn: { id: 'g', input: { type: 'verdict' } } });
    expect(s.stage).toBe('generating');
    expect(composerView(s)).toEqual({ mode: 'waiting', label: COPY.writingVerdict });
    s = diagnosticReducer(s, { type: 'succeeded', turnId: 'g', result: { verdict: verdict(2) } });
    expect(s.stage).toBe('verdict');
    expect(s.thread.at(-1)!.kind).toBe('verdict');
    expect(progressLabel(s.stage, s.maxProgress)).toBe('Done');
  });

  it('daily limit on the final answer pauses the thread; unblock resumes at ready', () => {
    let s = act(act(logOffer(logOffer(toAcc())), { type: 'moveOn' }), { type: 'skipVideo' });
    s = act(s, { type: 'answer', question: 'q0', text: 'a', flags: [] });
    s = act(s, { type: 'answer', question: 'q1', text: 'b', flags: [] });
    s = act(s, { type: 'answer', question: 'q2', text: 'c', flags: [] }, { limitReached: true });
    expect(s.stage).toBe('blocked');
    expect(s.thread.at(-1)!.kind).toBe('limit');
    expect(composerView(s)).toEqual({ mode: 'blocked', caption: COPY.paused });
    expect(s.answers.q2).toBeDefined(); // answers are saved
    s = diagnosticReducer(s, { type: 'unblock' });
    expect(s.stage).toBe('ready');
  });
});

describe('failure + retry (§8)', () => {
  it('keeps the bubble in place, rolls back optimistic state, and retries the same turn', () => {
    let s = toReady();
    s = diagnosticReducer(s, { type: 'submit', turn: { id: 'g', input: { type: 'verdict' } } });
    s = diagnosticReducer(s, { type: 'failed', turnId: 'g' });
    expect(s.stage).toBe('ready');
    const bubble = userBubbles(s).at(-1)!;
    expect(bubble).toMatchObject({ status: 'failed', text: COPY.getVerdict });
    // the composer is locked while a failed turn is outstanding
    expect(canSubmit(s, { type: 'verdict' })).toBe(false);
    s = diagnosticReducer(s, { type: 'retry' });
    expect(s.stage).toBe('generating');
    expect(userBubbles(s).at(-1)).toMatchObject({ id: bubble.id, status: 'sending' });
    expect(s.pending!.turn.id).toBe('g');
    s = diagnosticReducer(s, { type: 'succeeded', turnId: 'g', result: { verdict: verdict(1) } });
    expect(userBubbles(s).filter((b) => b.text === COPY.getVerdict)).toHaveLength(1);
    const ids = s.thread.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('re-scoring (§7)', () => {
  function toVerdictWithGap() {
    // 2 logged + Move on leaves Overhead Press and Tricep Pushdown unanswered.
    let s = act(act(logOffer(logOffer(toAcc())), { type: 'moveOn' }), { type: 'skipVideo' });
    for (const q of ['q0', 'q1', 'q2'] as const) s = act(s, { type: 'answer', question: q, text: q, flags: [] });
    return act(s, { type: 'verdict' }, { verdict: verdict(2) });
  }

  it('"Add the missing numbers" discards the stale card and returns to the accessory composer', () => {
    let s = toVerdictWithGap();
    expect(canSubmit(s, { type: 'addNumbers' })).toBe(true);
    s = act(s, { type: 'addNumbers' });
    expect(s.stage).toBe('acc');
    expect(s.thread.some((t) => t.kind === 'verdict')).toBe(false);
    expect(s.offer).toBe('overhead_press');
    expect(progressLabel(s.stage, s.maxProgress)).toBe('7 / 7');
  });

  it('a late ratio re-scores without replaying the video ask or the questions', () => {
    let s = act(toVerdictWithGap(), { type: 'addNumbers' });
    const threadLen = s.thread.length;
    s = diagnosticReducer(s, {
      type: 'submit',
      turn: { id: 'late', input: { type: 'accessory', exerciseId: 'overhead_press', set: SET } },
    });
    expect(s.stage).toBe('generating');
    expect(s.thread.at(-1)).toMatchObject({ kind: 'anakin', text: "Three ratios now — re-scoring on what you've already told me." });
    s = diagnosticReducer(s, { type: 'succeeded', turnId: 'late', result: { verdict: verdict(2, { confidence: 80 }) } });
    expect(s.stage).toBe('verdict');
    const added = s.thread.slice(threadLen);
    expect(added.map((t) => t.kind)).toEqual(['user', 'anakin', 'anakin', 'verdict']);
    expect(added.some((t) => t.kind === 'anakin' && (t.text === COPY.askVideo || t.text.includes('?')))).toBe(false);
  });

  it('Skip while re-scoring keeps the previous verdict', () => {
    let s = act(toVerdictWithGap(), { type: 'addNumbers' });
    s = act(s, { type: 'skip', exerciseId: s.offer! });
    expect(s.stage).toBe('verdict');
    expect(s.thread.at(-1)!.kind).toBe('verdict');
  });
});

describe('hydrate (resume)', () => {
  it('replaying persisted turns reproduces the live thread and stage', () => {
    const inputs: [TurnInput, TurnResult][] = [
      [{ type: 'lift', lift: 'flat_bench_press' }, {}],
      [{ type: 'main', set: SET }, {}],
      [{ type: 'accessory', exerciseId: 'close_grip_bench_press', set: SET }, {}],
      [{ type: 'untrained', exerciseId: 'paused_bench_press' }, {}],
      [{ type: 'accessory', exerciseId: 'overhead_press', set: SET }, {}],
      [{ type: 'moveOn' }, {}],
      [{ type: 'video', durationSec: 9 }, { video: { status: 'complete', result: VIDEO_OK } }],
      [{ type: 'answer', question: 'q1', optionId: 'flare', text: 'Elbows flare early', flags: ['elbows_flare_early'] }, {}],
    ];
    let live = initialState('s1');
    for (const [input, result] of inputs) live = act(live, input, result);

    const turns: TurnRecord[] = inputs.map(([input, result], i) => ({
      clientTurnId: `c${i}`,
      seq: i,
      input,
      result,
      createdAt: '',
    }));
    const restored = hydrate('s1', {
      session: { id: 's1', lift: 'flat_bench_press', flow: 'conversation', createdAt: '' },
      turns: [...turns].reverse(), // order comes from seq, not array order
      limit: { reached: false },
    });
    expect(restored.stage).toBe('q2');
    expect(restored.stage).toBe(live.stage);
    expect(restored.thread.map((t) => [t.kind, 'text' in t ? t.text : ''])).toEqual(
      live.thread.map((t) => [t.kind, 'text' in t ? t.text : '']),
    );
  });

  it('a blocked thread resumes at ready once the limit has cleared', () => {
    const base: TurnRecord[] = [
      { clientTurnId: 'a', seq: 0, input: { type: 'lift', lift: 'deadlift' }, result: {}, createdAt: '' },
      { clientTurnId: 'b', seq: 1, input: { type: 'main', set: SET }, result: {}, createdAt: '' },
    ];
    const turns: TurnRecord[] = [
      base[0],
      base[1],
      ...['romanian_deadlift', 'barbell_back_squat', 'rack_pull'].map((id, i) => ({
        clientTurnId: `acc${i}`, seq: 2 + i, input: { type: 'accessory' as const, exerciseId: id, set: SET }, result: {}, createdAt: '',
      })),
      { clientTurnId: 'sv', seq: 5, input: { type: 'skipVideo' }, result: {}, createdAt: '' },
      { clientTurnId: 'q0', seq: 6, input: { type: 'answer', question: 'q0', text: 'x', flags: [] }, result: {}, createdAt: '' },
      { clientTurnId: 'q1', seq: 7, input: { type: 'answer', question: 'q1', text: 'x', flags: [] }, result: {}, createdAt: '' },
      { clientTurnId: 'q2', seq: 8, input: { type: 'answer', question: 'q2', text: 'x', flags: [] }, result: { limitReached: true }, createdAt: '' },
    ];
    const session = { id: 's', lift: 'deadlift' as const, flow: 'conversation', createdAt: '' };
    expect(hydrate('s', { session, turns, limit: { reached: true } }).stage).toBe('blocked');
    expect(hydrate('s', { session, turns, limit: { reached: false } }).stage).toBe('ready');
  });
});

describe('controller: one shared send path', () => {
  function fakeApi(over: Partial<DiagnosticApi> = {}): DiagnosticApi {
    return {
      load: vi.fn(),
      sendTurn: vi.fn().mockResolvedValue({}),
      uploadVideo: vi.fn().mockResolvedValue({ video: { status: 'pending' } }),
      videoStatus: vi.fn().mockResolvedValue({ status: 'complete', result: VIDEO_OK }),
      getReport: vi.fn(),
      ...over,
    };
  }
  const flush = () => new Promise((r) => setTimeout(r, 0));

  it('a failed send greys the bubble; Retry re-sends the original payload with the same turn id', async () => {
    const sendTurn = vi.fn().mockRejectedValueOnce(Object.assign(new Error('offline'), { status: 0 })).mockResolvedValue({});
    const events: string[] = [];
    const c = new DiagnosticController(fakeApi({ sendTurn }), { onEvent: (e) => events.push(e.name) });
    expect(c.act({ type: 'lift', lift: 'snatch' })).toBe(true);
    await flush();
    expect(c.getState().pending?.status).toBe('failed');
    expect(c.getState().stage).toBe('lift');
    c.retry();
    await flush();
    expect(sendTurn).toHaveBeenCalledTimes(2);
    expect(sendTurn.mock.calls[0][1]).toBe(sendTurn.mock.calls[1][1]);
    expect(sendTurn.mock.calls[1][2]).toEqual({ type: 'lift', lift: 'snatch' });
    expect(c.getState().stage).toBe('numbers');
    expect(events).toContain('diagnostic_turn_failed');
    expect(events).toContain('diagnostic_started');
  });

  it('uploads video, polls, and settles the phase', async () => {
    const api = fakeApi();
    const c = new DiagnosticController(api, { videoPollMs: 1 });
    c.act({ type: 'lift', lift: 'flat_bench_press' });
    await flush();
    c.act({ type: 'main', set: SET });
    await flush();
    for (let i = 0; i < 2; i++) {
      c.act({ type: 'accessory', exerciseId: c.getState().offer!, set: SET });
      await flush();
    }
    c.act({ type: 'moveOn' });
    await flush();
    c.act({ type: 'video', durationSec: 10, file: { uri: 'file://clip.mov' } });
    await flush();
    expect(api.uploadVideo).toHaveBeenCalledWith(c.sessionId, expect.any(String), { uri: 'file://clip.mov' }, 10);
    await new Promise((r) => setTimeout(r, 20));
    expect(c.getState().stage).toBe('q1');
    c.dispose();
  });

  it('never sends the clip inside a JSON turn body', async () => {
    const api = fakeApi();
    const c = new DiagnosticController(api);
    c.act({ type: 'lift', lift: 'flat_bench_press' });
    await flush();
    expect(JSON.stringify((api.sendTurn as any).mock.calls)).not.toContain('file');
  });
});

describe('grading (§7)', () => {
  it('confidence is capped below 100', () => {
    expect(computeConfidence(0, false, 0)).toBe(46);
    expect(computeConfidence(1, false, 3)).toBe(67);
    expect(computeConfidence(3, true, 3)).toBe(84);
    expect(computeConfidence(10, true, 10)).toBeLessThan(100);
  });

  it('0 / 1 / 2+ ratios produce three visibly different verdicts', () => {
    const h = [0, 1, 2].map((g) => verdictHeadline(verdict(g as 0 | 1 | 2)));
    expect(h).toEqual([
      { eyebrow: 'Closest read', headline: 'Probably lockout — untested.' },
      { eyebrow: 'Verdict', headline: 'Likely lockout strength.' },
      { eyebrow: 'Verdict', headline: 'Lockout strength.' },
    ]);
    expect(reportSections(verdict(1)).charts).toBe(false);
    expect(reportSections(verdict(2)).charts).toBe(true);
  });
});

describe('home + markup', () => {
  it('hero switches to Resume for an in-progress conversation', () => {
    expect(homeHero([]).kind).toBe('start');
    const hero = homeHero([
      { id: 'a', lift: 'flat_bench_press', flow: 'conversation', status: 'in_progress', grade: null, confidence: null, limiter: null, updatedAt: '2026-09-13' },
    ]);
    expect(hero).toMatchObject({ kind: 'resume', sessionId: 'a', title: 'Finish your *bench* diagnostic', cta: 'Resume' });
  });

  it('parses emphasis and strong', () => {
    expect(parseRich('Good. And *Paused Bench Press*? **Now**')).toEqual([
      { text: 'Good. And ' },
      { text: 'Paused Bench Press', em: true },
      { text: '? ' },
      { text: 'Now', strong: true },
    ]);
  });
});

describe('review fixes', () => {
  it('formats clip length as m:ss', () => {
    expect(COPY.attachedSet(60)).toBe('Attached a set · 1:00');
    expect(COPY.attachedSet(9)).toBe('Attached a set · 0:09');
  });

  it('a readable clip that does not pin the phase says so, and keeps all three questions', () => {
    let s = act(logOffer(logOffer(toAcc())), { type: 'moveOn' });
    s = act(s, { type: 'video', durationSec: 8 }, { video: { status: 'pending' } });
    s = diagnosticReducer(s, { type: 'videoResolved', turnId: s.video.turnId!, result: { ...VIDEO_OK, stickingPhase: null } });
    expect(s.stage).toBe('q0');
    expect(s.thread.some((t) => t.kind === 'anakin' && t.text === COPY.videoNoPhase)).toBe(true);
  });

  it('replay of a thread unblocked live (verdict after a limit) shows the same "You\'re clear" beat', () => {
    const SETR = { weight: 225, sets: 3, reps: 5, unit: 'lb' as const };
    const t = (clientTurnId: string, seq: number, input: TurnInput, result: TurnResult = {}): TurnRecord => ({ clientTurnId, seq, input, result, createdAt: '' });
    const turns: TurnRecord[] = [
      t('a', 0, { type: 'lift', lift: 'flat_bench_press' }),
      t('b', 1, { type: 'main', set: SETR }),
      t('c', 2, { type: 'accessory', exerciseId: 'close_grip_bench_press', set: SETR }),
      t('d', 3, { type: 'accessory', exerciseId: 'paused_bench_press', set: SETR }),
      t('e', 4, { type: 'moveOn' }),
      t('f', 5, { type: 'skipVideo' }),
      t('g', 6, { type: 'answer', question: 'q0', text: 'x', flags: [] }),
      t('h', 7, { type: 'answer', question: 'q1', text: 'x', flags: [] }),
      t('i', 8, { type: 'answer', question: 'q2', text: 'x', flags: [] }, { limitReached: true }),
      t('j', 9, { type: 'verdict' }, { verdict: verdict(2) }),
    ];
    const s = hydrate('s1', { session: { id: 's1', lift: 'flat_bench_press', flow: 'conversation', createdAt: '' }, turns, limit: { reached: false } });
    expect(s.stage).toBe('verdict');
    expect(s.thread.some((x) => x.kind === 'anakin' && x.text === COPY.unblocked)).toBe(true);
  });
});
