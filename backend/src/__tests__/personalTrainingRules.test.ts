// The deterministic rules behind the dashboard: lift trends, guardrails, pain
// detection, the briefing engine, notification tiers, check-in analysis and
// Ask Anakin's parser and queries. No database, no model.

import { describe, it, expect } from 'vitest';
import { LIFT_LABEL, fillForward, liftHistory, liftKeyOf, liftTrend, prEvents, weeklyBest } from '../services/personalTraining/lifts.js';
import { checkContraindications } from '../services/personalTraining/guardrails.js';
import { painMention } from '../services/personalTraining/signals.js';
import { candidatesFor, planBriefing } from '../services/personalTraining/briefingEngine.js';
import { emptyClientData, type ClientData, type PracticeData } from '../services/personalTraining/data.js';
import { EVENT_TYPES, resolveTier } from '../services/personalTraining/notificationRules.js';
import { SettingsError, applyPatch, describeSettings, detectEvents, inQuietHours } from '../services/personalTraining/notifications.js';
import { CheckInError, DEFAULT_QUESTIONS, analyse, lastOccurrence, missStreak, validateSchedule } from '../services/personalTraining/checkins.js';
import { answerQuestion, clarifyOptions, daysForChoice, parseQuestion } from '../services/personalTraining/anakin.js';
import { buildProgress } from '../services/personalTraining/progress.js';
import { buildNarrative, buildStats, composeReportText, defaultMonth, monthRange } from '../services/personalTraining/reports.js';
import { editDistance, shortenFallback } from '../services/personalTraining/drafts.js';
import type { Client } from '../services/personalTraining/types.js';

const NOW = new Date('2026-10-02T16:00:00Z');
const ago = (days: number) => new Date(NOW.getTime() - days * 86_400_000);
const set = (name: string, kg: number, reps = '5') => ({ name, sets: 3, reps, weightKg: kg });
const workout = (id: string, days: number, exercises: object[], notes: string | null = null) =>
  ({ id, createdAt: ago(days), title: 'Lower', exercises: JSON.stringify(exercises), notes });

const client = (over: Partial<Client> = {}): Client => ({
  id: 'c1', name: 'Maya Okafor', initials: 'MO', email: 'maya@example.com', status: 'onPlan', channel: 'app',
  program: { blockLabel: 'Strength', week: 6, weeks: 12, goal: 'Squat 100 kg' }, sessionsPerWeek: 4,
  engagement8w: [8, 8, 8, 8, 8, 8, 8, 8], engagementTrend: 'steady', joinedAt: ago(120).toISOString(),
  lastSessionAt: ago(1).toISOString(), contraindications: [], ...over,
});
const practice = (entries: [Client, Partial<ClientData>][]): PracticeData => ({
  now: NOW, clients: entries.map(([c]) => c), byClient: new Map(entries.map(([c, d]) => [c.id, { ...emptyClientData(), ...d }])),
});
const engine = { fmt: (kg: number) => `${Math.round(kg)} kg`, tierOf: () => 'briefing' as const };

describe('lifts', () => {
  it('maps exercise names to main lifts and leaves variants out', () => {
    expect(liftKeyOf('Back squat')).toBe('squat');
    expect(liftKeyOf('Bulgarian split squat')).toBeNull();
    expect(liftKeyOf('Bench Press')).toBe('bench');
    expect(liftKeyOf('Incline bench press')).toBeNull();
    expect(liftKeyOf('Deadlift')).toBe('deadlift');
    expect(liftKeyOf('Romanian deadlift')).toBeNull();
    expect(liftKeyOf('Overhead press')).toBe('ohp');
    expect(liftKeyOf('Plank')).toBeNull();
  });

  it('builds a weekly best series and carries gaps forward', () => {
    const history = liftHistory([workout('a', 36, [set('Back squat', 100)]), workout('b', 20, [set('Back squat', 105)]), workout('c', 1, [set('Back squat', 110)])], 'squat');
    const weekly = weeklyBest(history, 6, NOW);
    expect(weekly.filter((v) => v !== null)).toHaveLength(3);
    expect(weekly[5]).toBe(history[2].e1rm);
    expect(fillForward(weekly)).toHaveLength(6);
    expect(fillForward([null, null])).toEqual([]);
  });

  it('applies PLAT-03: under 1 kg over three or more weekly exposures is a plateau', () => {
    expect(liftTrend([100, null, 100, 100.5, null, 100]).status).toBe('plateau');
    expect(liftTrend([100, 102, 104, null, null, 106]).status).toBe('progressing');
    expect(liftTrend([110, 108, null, 106, null, 105]).status).toBe('regressing');
    // Two exposures say nothing either way.
    expect(liftTrend([null, null, null, 100, null, 100])).toMatchObject({ status: 'noData', exposures: 2 });
    expect(liftTrend([null, null])).toMatchObject({ status: 'noData', exposures: 0, latestKg: null });
  });

  it('counts a PR only against a previous best', () => {
    const prs = prEvents([workout('a', 9, [set('Back squat', 100)]), workout('b', 5, [set('Back squat', 105)]), workout('c', 1, [set('Back squat', 105)])]);
    expect(prs.map((p) => p.logId)).toEqual(['b']);
  });
});

describe('guardrails', () => {
  const knee = [{ label: 'Left knee', active: true }, { label: 'Right shoulder', active: false }];
  it('flags a lift an active injury loads and ignores cleared ones', () => {
    expect(checkContraindications(knee, 'squat')).toMatchObject({ checked: 1, conflicts: ['Left knee'], label: 'Checked against 1 contraindication' });
    expect(checkContraindications(knee, 'bench').conflicts).toEqual([]);
    expect(checkContraindications([{ label: 'Lower back', active: true }], 'deadlift').conflicts).toEqual(['Lower back']);
    expect(checkContraindications([], 'squat')).toMatchObject({ checked: 0, label: 'Checked against 0 contraindications' });
  });
});

describe('pain detection', () => {
  it('finds the sentence that mentions pain', () => {
    expect(painMention('Good week. Knee has been sore since Tuesday so I skipped legs.')).toBe('Knee has been sore since Tuesday so I skipped legs.');
    expect(painMention('Left knee felt tight on the last set')).toBeTruthy();
  });
  it('does not read a denial as pain', () => {
    for (const text of ['No pain this week.', 'nothing hurts', 'None', 'pain-free session', 'Felt strong. No niggles at all.', '', null]) {
      expect(painMention(text)).toBeNull();
    }
  });
});

describe('briefing engine', () => {
  const maya = client({
    status: 'support', statusReason: 'No session logged in 9 days', lastSessionAt: ago(9).toISOString(),
    contraindications: [{ label: 'Left knee', active: true }],
  });
  const mayaData: Partial<ClientData> = {
    workouts: [workout('w1', 9, [set('Back squat', 100)])],
    messages: [
      { id: 'm1', createdAt: ago(13), fromClient: false, body: 'Great week.' },
      { id: 'm2', createdAt: ago(3), fromClient: true, body: 'Knee has been sore since Tuesday so I skipped legs.' },
    ],
  };

  it('leads with pain, folds the other reasons in, and always carries evidence', () => {
    const plan = planBriefing(practice([[maya, mayaData], [client({ id: 'c2', name: 'Jordan Lee' }), { workouts: [workout('j', 1, [set('Row', 60)])] }]]), engine);
    expect(plan.summary).toEqual({ attention: 1, look: 0, onPlan: 1 });
    expect(plan.onPlanClientIds).toEqual(['c2']);
    const [item] = plan.items;
    expect(item).toMatchObject({ ruleId: 'BRF-PAIN', eventType: 'painReported', severity: 'attention', primaryLabel: 'Send reply' });
    expect(item.headline).toBe('Maya mentioned pain');
    expect(item.reasons.some((r) => r.includes('Active injury on file: Left knee'))).toBe(true);
    expect(item.reasons).toContain('Also: Maya is waiting on a reply');
    expect(item.sources.map((s) => s.kind)).toEqual(expect.arrayContaining(['message', 'intake']));
    expect(item.guardrail).toMatchObject({ checked: 1 });
    expect(item.draft.fallback).not.toMatch(/!/);
  });

  it('every candidate from every rule has reasons, sources and a fallback draft', () => {
    const data = practice([[maya, {
      ...mayaData,
      wellness: [{ id: 'k', createdAt: ago(1), mood: 2, energy: 1, sleepHours: 5, stress: 5 }],
      proposals: [{ id: 'p', createdAt: ago(5), title: 'Add 2.5 kg to back squat', reasoning: 'Top of range twice', status: 'pending' }],
      checkIns: [{ id: 'k1', dueAt: ago(4), status: 'missed', submittedAt: null, classification: null, summary: null, answersJson: null, reviewedAt: null, nudgedAt: ago(3) }],
    }]]);
    const all = candidatesFor(maya, data.byClient.get('c1')!, NOW, engine);
    expect(all.map((c) => c.ruleId)).toEqual(expect.arrayContaining(['BRF-PAIN', 'BRF-UNANSWERED', 'BRF-INACTIVE', 'BRF-RECOVERY', 'BRF-PROPOSAL', 'BRF-MISSED']));
    for (const c of all) {
      expect(c.reasons.length).toBeGreaterThan(0);
      expect(c.sources.length).toBeGreaterThan(0);
      expect(c.existingDraftId || c.draft.fallback.length > 20).toBeTruthy();
    }
  });

  it('stops being a pain item once the trainer has replied', () => {
    const replied = { ...mayaData, messages: [...mayaData.messages!, { id: 'm3', createdAt: ago(2), fromClient: false, body: 'Rest it.' }] };
    const ids = candidatesFor(maya, { ...emptyClientData(), ...replied }, NOW, engine).map((c) => c.ruleId);
    expect(ids).not.toContain('BRF-PAIN');
    expect(ids).not.toContain('BRF-UNANSWERED');
  });

  it('blocks a load suggestion that an active injury rules out', () => {
    const stalled = { workouts: [0, 1, 2, 3, 4, 5].map((w) => workout(`s${w}`, w * 7 + 1, [set('Back squat', 100)])) };
    const free = candidatesFor(client(), { ...emptyClientData(), ...stalled }, NOW, engine).find((c) => c.ruleId === 'BRF-PLATEAU')!;
    expect(free.eventType).toBe('plateau');
    expect(free.draft.fallback).toMatch(/change the stimulus/);

    const injured = candidatesFor(client({ contraindications: [{ label: 'Left knee', active: true }] }), { ...emptyClientData(), ...stalled }, NOW, engine).find((c) => c.ruleId === 'BRF-PLATEAU')!;
    expect(injured.eventType).toBe('guardrailBlocked');
    expect(injured.guardrail?.conflicts).toEqual(['Left knee']);
    expect(injured.draft.fallback).toMatch(/keeping the load where it is/);
    expect(injured.reasons.join(' ')).toMatch(/ruled out by an active injury/);
  });

  it('leaves out events the trainer set to timeline only', () => {
    const data = practice([[client({ status: 'support', statusReason: 'No session logged in 8 days', lastSessionAt: ago(8).toISOString() }), {}]]);
    expect(planBriefing(data, engine).items).toHaveLength(1);
    expect(planBriefing(data, { ...engine, tierOf: (t) => (t === 'noSession7d' ? 'timeline' : 'briefing') }).items).toHaveLength(0);
  });
});

describe('notification tiers', () => {
  const settings = { rules: { workoutLogged: 'immediate' as const }, overrides: [{ clientId: 'c1', eventType: '*', tier: 'immediate' as const, expiresAt: ago(-2).toISOString() }, { clientId: 'c2', eventType: 'pr', tier: 'timeline' as const, expiresAt: ago(1).toISOString() }] };

  it('resolves override over rule over default, and ignores expired overrides', () => {
    expect(resolveTier({ rules: {}, overrides: [] }, 'workoutLogged', 'c9', NOW)).toBe('timeline');
    expect(resolveTier(settings, 'workoutLogged', 'c9', NOW)).toBe('immediate');
    expect(resolveTier(settings, 'pr', 'c1', NOW)).toBe('immediate');
    expect(resolveTier(settings, 'pr', 'c2', NOW)).toBe('briefing');
  });

  it('never lets a safety event fall to timeline, whatever is stored', () => {
    const bad = { rules: { painReported: 'timeline' as const }, overrides: [{ clientId: 'c1', eventType: '*', tier: 'timeline' as const }] };
    expect(resolveTier(bad, 'painReported', null, NOW)).toBe('briefing');
    expect(resolveTier(bad, 'painReported', 'c1', NOW)).toBe('briefing');
    expect(resolveTier(bad, 'workoutLogged', 'c1', NOW)).toBe('timeline');
  });

  const stored = { rules: {}, overrides: [], channels: { push: true, email: false }, quietStart: 21, quietEnd: 7 };
  it('refuses to set pain or guardrail events to timeline through the API', () => {
    expect(() => applyPatch(stored, { rules: { painReported: 'timeline' } }, new Set())).toThrow(SettingsError);
    expect(() => applyPatch(stored, { overrides: [{ clientId: 'c1', eventType: 'painReported', tier: 'timeline' }] }, new Set(['c1']))).toThrow(/Safety events always reach you/);
    expect(applyPatch(stored, { rules: { painReported: 'briefing', pr: 'timeline' } }, new Set()).rules).toEqual({ painReported: 'briefing', pr: 'timeline' });
  });

  it('validates overrides, quiet hours and unknown types', () => {
    expect(() => applyPatch(stored, { overrides: [{ clientId: 'stranger', eventType: '*', tier: 'immediate' }] }, new Set(['c1']))).toThrow(/not your client/);
    expect(() => applyPatch(stored, { rules: { nope: 'immediate' } as any }, new Set())).toThrow(/Unknown event type/);
    expect(() => applyPatch(stored, { quietHours: { start: 25, end: 7 } }, new Set())).toThrow(/Quiet hours/);
    expect(applyPatch(stored, { quietHours: { start: 22, end: 6 }, channels: { email: true } }, new Set())).toMatchObject({ quietStart: 22, quietEnd: 6, channels: { push: true, email: true } });
  });

  it('knows when it is quiet, including across midnight', () => {
    expect(inQuietHours(23, 21, 7)).toBe(true);
    expect(inQuietHours(3, 21, 7)).toBe(true);
    expect(inQuietHours(12, 21, 7)).toBe(false);
    expect(inQuietHours(12, 9, 17)).toBe(true);
    expect(inQuietHours(12, 8, 8)).toBe(false);
  });

  it('detects events once each and estimates alerts from real rates', () => {
    const data = practice([[client(), {
      workouts: [workout('a', 20, [set('Back squat', 100)]), workout('b', 0.2, [set('Back squat', 110)], 'Knee felt tight')],
      messages: [{ id: 'm', createdAt: ago(0.1), fromClient: true, body: 'My shoulder hurts when pressing.' }],
    }]]);
    const day = detectEvents(data, ago(1), 'metric');
    const types = day.map((e) => e.eventType).sort();
    expect(types).toEqual(['messageWaiting', 'painReported', 'painReported', 'pr', 'workoutLogged']);
    expect(new Set(day.map((e) => e.sourceKey)).size).toBe(day.length);

    const described = describeSettings(stored, data, 'metric');
    expect(described.rules).toHaveLength(EVENT_TYPES.length);
    expect(described.rules.find((r) => r.eventType === 'painReported')).toMatchObject({ tier: 'immediate', locked: true, perWeek: 0.5 });
    expect(described.tierCounts.immediate + described.tierCounts.briefing + described.tierCounts.timeline).toBe(EVENT_TYPES.length);
    expect(described.weeklyEstimate).toBe(1);
  });
});

describe('check-in analysis', () => {
  const answers = { energy: 4, sleep: 4, stress: 2, pain: 'None', notes: '' };
  it('calls a steady week routine and still says what it was judged on', () => {
    const a = analyse(DEFAULT_QUESTIONS, answers, { logged: 4, target: 4 }, 'k1');
    expect(a.classification).toBe('routine');
    expect(a.summary).toMatch(/^Steady week/);
    expect(a.evidence.reasons.length).toBeGreaterThan(0);
    expect(a.signals.map((s) => s.tone)).toEqual(['green', 'green', 'green', 'green', 'green']);
  });
  it('flags pain whatever else was reported', () => {
    const a = analyse(DEFAULT_QUESTIONS, { ...answers, pain: 'Lower back has been aching after deadlifts' }, { logged: 4, target: 4 }, 'k1');
    expect(a.classification).toBe('flag');
    expect(a.pain).toMatch(/aching/);
    expect(a.signals).toContainEqual({ label: 'Pain mentioned', tone: 'red' });
  });
  it('grades by how many signals are off', () => {
    expect(analyse(DEFAULT_QUESTIONS, { ...answers, energy: 2 }, { logged: 4, target: 4 }, 'k').classification).toBe('look');
    expect(analyse(DEFAULT_QUESTIONS, { ...answers, energy: 3, sleep: 3 }, { logged: 4, target: 4 }, 'k').classification).toBe('look');
    expect(analyse(DEFAULT_QUESTIONS, { ...answers, energy: 1, stress: 5 }, { logged: 1, target: 4 }, 'k').classification).toBe('flag');
  });

  it('validates a schedule', () => {
    const ok = { questions: DEFAULT_QUESTIONS, dayOfWeek: 0, hour: 18, nudgeAfterHours: 24, flagAfterHours: 48, pauseAfterMisses: 2, active: true };
    expect(validateSchedule(ok)).toMatchObject({ clientId: null, frequency: 'weekly', active: true });
    expect(() => validateSchedule({ ...ok, questions: [] })).toThrow(CheckInError);
    expect(() => validateSchedule({ ...ok, flagAfterHours: 12 })).toThrow(/after the nudge/);
    expect(() => validateSchedule({ ...ok, dayOfWeek: 9 })).toThrow(/Day must be/);
    expect(() => validateSchedule({ ...ok, questions: [{ text: 'Hi', type: 'photo' }] })).toThrow();
  });

  it('finds the last scheduled occurrence and counts a miss streak', () => {
    // 2026-10-02 is a Friday; Sunday 18:00 Eastern was 27 Sep 22:00 UTC.
    expect(lastOccurrence(0, 18, NOW).toISOString()).toBe('2026-09-27T22:00:00.000Z');
    expect(missStreak([{ status: 'missed' }, { status: 'submitted' }, { status: 'missed' }, { status: 'missed' }, { status: 'due' }])).toBe(2);
    expect(missStreak([{ status: 'missed' }, { status: 'submitted' }])).toBe(0);
  });
});

describe('Ask Anakin', () => {
  it('maps questions to intents, lifts and time ranges', () => {
    expect(parseQuestion('Who is on a plateau on bench press?')).toMatchObject({ intent: 'plateau', lift: 'bench' });
    expect(parseQuestion("Who hasn't trained in the last 10 days?")).toMatchObject({ intent: 'inactive', days: 10 });
    expect(parseQuestion('Who mentioned pain this week?')).toMatchObject({ intent: 'pain', days: 7 });
    expect(parseQuestion('Who has an injury I should be careful with?').intent).toBe('injuries');
    expect(parseQuestion('Who hit PRs this month?')).toMatchObject({ intent: 'prs', days: null, ambiguousRange: true });
    expect(parseQuestion('Whose program is ending soon?').intent).toBe('programEnding');
    expect(parseQuestion('Who has no program?').intent).toBe('noProgram');
    expect(parseQuestion('Draft a message to both').intent).toBe('draft');
    expect(parseQuestion('What is the weather?').intent).toBe('unknown');
  });

  it('offers concrete options for an ambiguous range', () => {
    expect(clarifyOptions(NOW)).toEqual(['Since 1 Oct', 'Last 30 days', 'Last 7 days']);
    expect(daysForChoice('Last 30 days', NOW)).toBe(30);
    expect(daysForChoice('Since 1 Oct', NOW)).toBe(2);
  });

  const stalled = [0, 1, 2, 3, 4, 5].map((w) => workout(`s${w}`, w * 7 + 1, [set('Back squat', 100)]));
  const data = practice([
    [client({ contraindications: [{ label: 'Left knee', active: true, note: 'patellar' }] }), { workouts: stalled }],
    [client({ id: 'c2', name: 'Jordan Lee', lastSessionAt: ago(12).toISOString(), program: null }), {}],
    [client({ id: 'c3', name: 'Dami Bello', status: 'new' }), { workouts: [workout('d', 2, [set('Bench press', 40)])] }],
  ]);

  it('answers a plateau question with evidence, a series and what it excluded', () => {
    const a = answerQuestion(parseQuestion('Who is on a plateau on squat?'), data, 'all', 'metric');
    expect(a.text).toBe('1 client is on a plateau on squat.');
    expect(a.rows).toHaveLength(1);
    expect(a.rows[0]).toMatchObject({ clientId: 'c1', evidence: expect.stringContaining('flat at') });
    expect(a.rows[0].series).toHaveLength(6);
    expect(a.note).toMatch(/^Excluded: Jordan, Dami — no squat logged/);
    expect(a.actionable).toBe(true);
    expect(a.followUps[0]).toBe('Draft a message to these clients');
  });

  it('will not guess on injuries', () => {
    const a = answerQuestion(parseQuestion('Who has an injury?'), data, 'all', 'metric');
    expect(a.rows.map((r) => r.evidence)).toEqual(['Left knee (patellar)']);
    expect(a.note).toMatch(/I won't guess on injuries: 2 clients have nothing on file/);
  });

  it('respects scope and reports inactivity and missing programs', () => {
    expect(answerQuestion(parseQuestion('Who has not trained in the last 7 days?'), data, 'all', 'metric').rows.map((r) => r.clientId)).toEqual(['c2']);
    expect(answerQuestion(parseQuestion('Who has not trained in the last 7 days?'), data, 'new', 'metric').rows).toEqual([]);
    expect(answerQuestion(parseQuestion('Who has no program?'), data, 'all', 'metric').rows.map((r) => r.clientId)).toEqual(['c2']);
  });

  it('says what it can answer when it does not understand', () => {
    const a = answerQuestion(parseQuestion('What is the weather?'), data, 'all', 'metric');
    expect(a.actionable).toBe(false);
    expect(a.rows).toEqual([]);
  });
});

describe('progress and reports', () => {
  const rising = [5, 4, 3, 2, 1, 0].map((w, i) => workout(`r${w}`, w * 7 + 1, [set('Back squat', 100 + i * 2.5)]));
  const flat = [0, 1, 2, 3, 4, 5].map((w) => workout(`f${w}`, w * 7 + 1, [set('Back squat', 80)]));
  const data = practice([[client(), { workouts: rising }], [client({ id: 'c2', name: 'Priya Nair' }), { workouts: flat }], [client({ id: 'c3', name: 'Sam Whitfield' }), {}]]);

  it('orders plateaus first and converts to the trainer unit', () => {
    const p = buildProgress(data, 'squat', 6, 'imperial');
    expect(p.unit).toBe('lbs');
    expect(p.rows.map((r) => [r.client.name, r.status])).toEqual([['Priya Nair', 'plateau'], ['Maya Okafor', 'progressing'], ['Sam Whitfield', 'noData']]);
    expect(p.kpis).toMatchObject({ progressing: 1, plateau: 1 });
    expect(p.rows[1].change).toBeGreaterThan(0);
    expect(p.rows[2]).toMatchObject({ e1rm: null, series: [], note: 'No squat logged in the last 6 weeks' });
    expect(p.lifts.map((l) => l.label)).toContain(LIFT_LABEL.deadlift);
  });

  it('builds a monthly report from the month only', () => {
    expect(defaultMonth(NOW)).toBe('2026-09');
    expect(monthRange('2026-09').label).toBe('September');
    const stats = buildStats(client(), { ...emptyClientData(), workouts: rising, weights: [{ id: 'a', createdAt: new Date('2026-09-03T10:00:00Z'), weightKg: 68, weightLbs: null }, { id: 'b', createdAt: new Date('2026-09-25T10:00:00Z'), weightKg: 67.2, weightLbs: null }] }, '2026-09', 'metric');
    expect(stats.sessions).toBe(4);
    expect(stats.bodyweight).toEqual({ start: '68 kg', end: '67.2 kg', change: '−0.8 kg' });
    expect(stats.headline.map((h) => h.label)).toEqual(['Sessions', 'Adherence', 'New PRs']);
    const narrative = buildNarrative(stats, 'September');
    expect(narrative).toMatch(/^You trained 4 times in September/);
    expect(narrative).not.toMatch(/!/);
    const text = composeReportText({ title: 'Your September, Maya.', narrative, coachNote: 'Proud of this block.', nextLine: 'Next month: Strength continues.', trainerName: 'Kofi Mensah', stats });
    expect(text).toContain('From Kofi: Proud of this block.');
  });
});

describe('draft helpers', () => {
  it('measures how much a trainer changed a draft', () => {
    expect(editDistance('same', 'same')).toBe(0);
    expect(editDistance('kitten', 'sitting')).toBe(3);
  });
  it('shortens to two sentences without the model', () => {
    expect(shortenFallback('One. Two. Three. Four.')).toBe('One. Two.');
    expect(shortenFallback('Only one.')).toBe('Only one.');
  });
});
