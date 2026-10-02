// Ask Anakin as a conversation, and the client dossier. The model is faked:
// what is under test is that facts reach the reply only through tools, that
// the client list comes from the tool results rather than the model's words,
// and that nothing is sent.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({ ptDraft: { create: vi.fn() } }));
vi.mock('@prisma/client', () => {
  const PrismaClient = vi.fn(function (this: any) { Object.assign(this, mocks); });
  return { PrismaClient };
});

import { canonicalQuestion, historyFor, parseQuestion, type Parsed } from '../services/personalTraining/anakin.js';
import { matchClients, runAnakinAgent, type CreateMessage } from '../services/personalTraining/anakinAgent.js';
import { buildOverview, buildProgramView } from '../services/personalTraining/dossier.js';
import { emptyClientData, type ClientData, type PracticeData } from '../services/personalTraining/data.js';
import type { AnakinEvent, Client } from '../services/personalTraining/types.js';

const NOW = new Date('2026-10-02T16:00:00Z');
const ago = (days: number) => new Date(NOW.getTime() - days * 86_400_000);
const squat = (id: string, days: number, kg: number) => ({ id, createdAt: ago(days), title: 'Lower', exercises: JSON.stringify([{ name: 'Back squat', sets: 3, reps: '5', weightKg: kg }]), notes: null });
const client = (over: Partial<Client> = {}): Client => ({
  id: 'c1', name: 'Maya Okafor', initials: 'MO', email: null, status: 'onPlan', channel: 'app',
  program: { blockLabel: 'Strength', week: 6, weeks: 12, goal: 'Squat 100 kg' }, sessionsPerWeek: 4,
  engagement8w: [8, 8, 8, 8, 8, 8, 8, 8], engagementTrend: 'steady', joinedAt: ago(120).toISOString(), lastSessionAt: ago(1).toISOString(),
  contraindications: [], ...over,
});
const practice = (entries: [Client, Partial<ClientData>][]): PracticeData => ({
  now: NOW, clients: entries.map(([c]) => c), byClient: new Map(entries.map(([c, d]) => [c.id, { ...emptyClientData(), ...d }])),
});

const stalled = [0, 1, 2, 3, 4, 5].map((w) => squat(`s${w}`, w * 7 + 1, 100));
const data = practice([
  [client({ contraindications: [{ label: 'Left knee', active: true }] }), { workouts: stalled }],
  [client({ id: 'c2', name: 'Jordan Lee', initials: 'JL', lastSessionAt: ago(12).toISOString(), status: 'support', statusReason: 'No session logged in 12 days' }), {}],
  [client({ id: 'c3', name: 'Maya Chen', initials: 'MC' }), {}],
]);

/** A scripted model: each call returns the next response. */
function script(...responses: { stop_reason: string; content: any[] }[]): CreateMessage & { calls: any[] } {
  const calls: any[] = [];
  const fn = (async (req: any) => { calls.push(JSON.parse(JSON.stringify(req))); return responses[calls.length - 1] ?? { stop_reason: 'end_turn', content: [{ type: 'text', text: '' }] }; }) as any;
  fn.calls = calls;
  return fn;
}
const say = (text: string) => ({ stop_reason: 'end_turn', content: [{ type: 'text', text }] });
const call = (name: string, input: object, id = 'tu1') => ({ stop_reason: 'tool_use', content: [{ type: 'tool_use', id, name, input }] });
const base = { practiceId: 'p1', trainerId: 't1', replyId: 'r1', data, scope: 'all' as const, pref: 'metric' as const, trainerFirstName: 'Kofi' };

beforeEach(() => {
  mocks.ptDraft.create.mockReset();
  mocks.ptDraft.create.mockImplementation(async ({ data: d }: any) => ({ id: `d-${d.clientId}`, sentText: null, status: 'pending', undoUntil: null, sentAt: null, ...d }));
});

describe('canonical questions', () => {
  it('read back as the same query, so a scheduled question keeps its meaning', () => {
    const queries: Parsed[] = [
      { intent: 'plateau', lift: null, days: null, ambiguousRange: false },
      { intent: 'plateau', lift: 'bench', days: null, ambiguousRange: false },
      { intent: 'plateau', lift: 'ohp', days: null, ambiguousRange: false },
      { intent: 'inactive', lift: null, days: 10, ambiguousRange: false },
      { intent: 'engagement', lift: null, days: null, ambiguousRange: false },
      { intent: 'injuries', lift: null, days: null, ambiguousRange: false },
      { intent: 'pain', lift: null, days: 14, ambiguousRange: false },
      { intent: 'prs', lift: null, days: 30, ambiguousRange: false },
      { intent: 'recovery', lift: null, days: 7, ambiguousRange: false },
      { intent: 'checkins', lift: null, days: 14, ambiguousRange: false },
      { intent: 'programEnding', lift: null, days: null, ambiguousRange: false },
      { intent: 'noProgram', lift: null, days: null, ambiguousRange: false },
      { intent: 'unanswered', lift: null, days: null, ambiguousRange: false },
    ];
    for (const q of queries) {
      const back = parseQuestion(canonicalQuestion(q));
      expect({ intent: back.intent, lift: back.lift, ambiguous: back.ambiguousRange }).toEqual({ intent: q.intent, lift: q.lift, ambiguous: false });
      if (q.days) expect(back.days).toBe(q.days);
    }
  });
});

describe('conversational agent', () => {
  it('answers small talk without touching the roster and offers nothing to filter', async () => {
    const create = script(say('Hi Kofi. Ask me who is on a plateau or who has gone quiet!'));
    const events: AnakinEvent[] = [];
    const e = await runAnakinAgent({ ...base, messages: [{ role: 'user', content: 'hi' }], emit: (x) => events.push(x), create });
    expect(e).toMatchObject({ type: 'answer', rows: [], actionable: false });
    // House style is enforced on the way out.
    expect((e as any).text).toBe('Hi Kofi. Ask me who is on a plateau or who has gone quiet.');
    expect((e as any).scheduleText).toBeUndefined();
    expect(events).toEqual([]);
    expect(create.calls[0].system).toContain('Never state a number, date, lift, injury or name that a tool did not return');
  });

  it('takes the client list from the tool result, not from what the model wrote', async () => {
    // The model names someone the query did not return; the rows must not include them.
    const create = script(call('find_clients', { query: 'plateau', lift: 'squat' }), say('Maya Okafor and Jordan Lee have stalled on squat.'));
    const events: AnakinEvent[] = [];
    const e = await runAnakinAgent({ ...base, messages: [{ role: 'user', content: 'who is stuck on squat' }], emit: (x) => events.push(x), create }) as any;
    expect(e.type).toBe('answer');
    expect(e.rows.map((r: any) => r.client.name)).toEqual(['Maya Okafor']);
    expect(e.rows[0].evidence).toContain('flat at');
    expect(e.actionable).toBe(true);
    expect(e.scheduleText).toBe('Who is on a plateau on squat?');
    expect(e.note).toMatch(/^Excluded: Jordan, Maya/);
    expect(events).toEqual([{ type: 'status', text: 'Checking lift trends' }]);
    // The tool result the model saw carried the evidence and the exclusion note.
    const result = JSON.parse(create.calls[1].messages.at(-1).content[0].content);
    expect(result.clients).toEqual([{ name: 'Maya Okafor', evidence: expect.stringContaining('flat at') }]);
    expect(result.note).toMatch(/Excluded/);
  });

  it('for a broad question, lists everyone any query surfaced, and offers no single question to schedule', async () => {
    const create = script(
      { stop_reason: 'tool_use', content: [
        { type: 'tool_use', id: 'a', name: 'find_clients', input: { query: 'inactive', days: 7 } },
        { type: 'tool_use', id: 'b', name: 'find_clients', input: { query: 'injuries' } },
        { type: 'tool_use', id: 'c', name: 'find_clients', input: { query: 'plateau' } },
      ] },
      say('Jordan and Maya are the two to look at.'),
    );
    const e = await runAnakinAgent({ ...base, messages: [{ role: 'user', content: 'who should I worry about?' }], emit: () => {}, create }) as any;
    expect(e.rows.map((r: any) => r.client.name)).toEqual(['Jordan Lee', 'Maya Okafor']);
    // Maya came up twice; both reasons are kept.
    expect(e.rows[1].evidence).toMatch(/^Left knee · Squat estimated 1RM flat/);
    expect(e.actionable).toBe(true);
    expect(e.scheduleText).toBeUndefined();
    expect(e.followUps).toEqual(['Draft a message to these clients']);
    expect(e.sources).toBe('workout logs, intake and injury records, workout logs, plateau rule PLAT-03');
  });

  it('lists the clients the status rules flagged when it answers from the roster overview', async () => {
    const create = script(call('roster_overview', {}), say('Jordan is the one to look at.'));
    const e = await runAnakinAgent({ ...base, messages: [{ role: 'user', content: 'how is everyone?' }], emit: () => {}, create }) as any;
    expect(e.rows).toEqual([expect.objectContaining({ clientId: 'c2', evidence: 'No session logged in 12 days' })]);
    expect(e.actionable).toBe(true);
    expect(e.scheduleText).toBeUndefined();
    expect(e.sources).toBe('roster status rules');
  });

  it('looks up one client and says so when a name is ambiguous', async () => {
    expect(matchClients(data.clients, 'maya').map((c) => c.id)).toEqual(['c1', 'c3']);
    expect(matchClients(data.clients, 'Maya Okafor').map((c) => c.id)).toEqual(['c1']);
    expect(matchClients(data.clients, 'nobody')).toEqual([]);

    const create = script(call('get_client', { name: 'Jordan' }), say('Jordan has not logged a session in 12 days.'));
    const e = await runAnakinAgent({ ...base, messages: [{ role: 'user', content: 'how is Jordan doing?' }], emit: () => {}, create }) as any;
    expect(e.rows.map((r: any) => r.client.name)).toEqual(['Jordan Lee']);
    expect(e.actionable).toBe(false); // one client's file is not a roster filter
    const facts = JSON.parse(create.calls[1].messages.at(-1).content[0].content);
    expect(facts).toMatchObject({ name: 'Jordan Lee', status: 'might need support', statusReason: 'No session logged in 12 days' });
    expect(facts.injuries).toMatch(/unknown, not the same as none/);

    const ambiguous = script(call('get_client', { name: 'Maya' }), say('Which Maya do you mean, Okafor or Chen?'));
    const a = await runAnakinAgent({ ...base, messages: [{ role: 'user', content: 'how is Maya?' }], emit: () => {}, create: ambiguous }) as any;
    expect(JSON.parse(ambiguous.calls[1].messages.at(-1).content[0].content)).toMatchObject({ matches: ['Maya Okafor', 'Maya Chen'] });
    expect(a.rows).toEqual([]);
  });

  it('respects scope: a client outside it cannot be looked up', async () => {
    const create = script(call('get_client', { name: 'Maya Okafor' }), say('I do not see her in this scope.'));
    await runAnakinAgent({ ...base, scope: 'support', messages: [{ role: 'user', content: 'Maya?' }], emit: () => {}, create });
    expect(JSON.parse(create.calls[1].messages.at(-1).content[0].content).error).toMatch(/No client matching/);
  });

  it('asks rather than guesses an ambiguous range', async () => {
    const create = script(call('ask_clarification', { question: 'Which window?', options: ['Since 1 Oct', 'Last 30 days'] }));
    const e = await runAnakinAgent({ ...base, messages: [{ role: 'user', content: 'who hit PRs this month' }], emit: () => {}, create });
    expect(e).toEqual({ type: 'clarify', text: 'Which window?', options: ['Since 1 Oct', 'Last 30 days'] });
    expect(create.calls).toHaveLength(1);
  });

  it('drafts for named clients only, as pending drafts, and tells the model nothing was sent', async () => {
    const create = script(call('draft_messages', { clients: ['Jordan Lee', 'Maya', 'Stranger'], purpose: 'check in' }), say('Draft ready for Jordan.'));
    const e = await runAnakinAgent({ ...base, messages: [{ role: 'user', content: 'draft a note to Jordan, Maya and Stranger' }], emit: () => {}, create }) as any;
    expect(e.type).toBe('drafts');
    expect(e.drafts.map((d: any) => [d.client.name, d.status])).toEqual([['Jordan Lee', 'pending']]);
    expect(mocks.ptDraft.create).toHaveBeenCalledTimes(1);
    expect(mocks.ptDraft.create.mock.calls[0][0].data).toMatchObject({ practiceId: 'p1', trainerId: 't1', clientId: 'c2', kind: 'anakin', sourceId: 'r1' });
    const result = JSON.parse(create.calls[1].messages.at(-1).content[0].content);
    // "Maya" is ambiguous and "Stranger" is not a client: neither gets a draft.
    expect(result).toMatchObject({ drafted: ['Jordan Lee'], notFoundOrAmbiguous: ['Maya', 'Stranger'], sent: false });
  });

  it('stops after a bounded number of steps', async () => {
    const loop = Array.from({ length: 9 }, (_, i) => call('roster_overview', {}, `tu${i}`));
    const create = script(...loop);
    const e = await runAnakinAgent({ ...base, messages: [{ role: 'user', content: 'x' }], emit: () => {}, create }) as any;
    expect(create.calls).toHaveLength(5);
    expect(e.type).toBe('answer');
    expect(e.text.length).toBeGreaterThan(0);
  });
});

describe('thread history for the model', () => {
  const row = (role: string, text: string, event?: object) => ({ role, text, eventsJson: event ? JSON.stringify([event]) : null });
  it('alternates turns, carries the listed names, and ends on the new question', () => {
    const h = historyFor([
      row('user', 'Who is on a plateau?'),
      row('assistant', '1 client is on a plateau.', { type: 'answer', rows: [{ clientId: 'c1', client: { id: 'c1', name: 'Maya Okafor', initials: 'MO' }, evidence: 'x' }] }),
      row('user', 'draft a message to them'),
    ], 'draft a message to them');
    expect(h.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
    expect(h[1].content).toContain('[Clients listed: Maya Okafor]');
    expect(h[2].content).toBe('draft a message to them');
  });

  it('folds a clarify choice into a user turn after the question it answers', () => {
    const h = historyFor([
      row('user', 'Who hit PRs this month?'),
      row('assistant', 'Which window?', { type: 'clarify', text: 'Which window?', options: ['Since 1 Oct', 'Last 30 days'] }),
    ], 'Who hit PRs this month?', 'Last 30 days');
    expect(h.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
    expect(h[2].content).toBe('Use this time range: Last 30 days');
  });

  it('never starts with an assistant turn or leaves two of the same role together', () => {
    const h = historyFor([row('assistant', 'orphan'), row('user', 'a'), row('user', 'b')], 'b');
    expect(h).toEqual([{ role: 'user', content: 'a\nb' }]);
  });
});

describe('client dossier', () => {
  const engine = { fmt: (kg: number) => `${Math.round(kg)} kg`, tierOf: () => 'briefing' as const };

  it('writes the summary only from facts it can cite', () => {
    const c = client({ status: 'support', statusReason: 'No session logged in 9 days', contraindications: [{ label: 'Left knee', active: true, note: 'patellar' }, { label: 'Shoulder', active: false }] });
    const o = buildOverview(c, { ...emptyClientData(), workouts: stalled, weights: [{ id: 'a', createdAt: ago(30), weightKg: 68, weightLbs: null }, { id: 'b', createdAt: ago(2), weightKg: 67, weightLbs: null }] }, 'metric', NOW, engine);
    expect(o.summary.text).toContain('Maya is in week 6 of 12 of Strength, working towards "Squat 100 kg".');
    expect(o.summary.text).toContain('Squat has stalled.');
    expect(o.summary.text).toContain('Active injury on file: Left knee.');
    expect(o.summary.text).not.toContain('Shoulder'); // cleared injuries are not "active"
    // One reason per sentence, so the paragraph can always show its basis.
    expect(o.summary.evidence.reasons).toHaveLength(o.summary.text.split('. ').length);
    expect(o.summary.evidence.sources.map((s) => s.kind)).toEqual(expect.arrayContaining(['program', 'session', 'rule', 'intake']));
    expect(o.stats.map((s) => s.label)).toEqual(['Squat est. 1RM', 'Bodyweight', '4-week adherence']);
    expect(o.stats[1]).toMatchObject({ value: '67 kg', delta: '−1 kg' });
    expect(o.block).toEqual(c.program);
    expect(o.openItems.map((i) => i.id)).toContain('BRF-INACTIVE');
  });

  it('handles a client with nothing on file', () => {
    const o = buildOverview(client({ program: null, lastSessionAt: undefined }), emptyClientData(), 'metric', NOW, engine);
    expect(o.summary.text).toMatch(/^Maya has no program yet\./);
    expect(o.stats).toEqual([{ label: '4-week adherence', value: '0%', delta: '0 of 16 sessions' }]);
    expect(o.recentPrs).toEqual([]);
  });

  it('shapes a saved program for reading and marks the current phase', () => {
    const saved = JSON.stringify({
      goal: 'Squat 100 kg', daysPerWeek: 2, durationWeeks: 8,
      phases: [
        { phaseName: 'Foundation', durationWeeks: 4, rationale: 'Build the base', trainingDays: [{ day: 'Monday', focus: 'Lower', exercises: [{ exercise: 'Back squat', sets: 3, reps: '5', intensity: 'RPE 7', targetWeightKg: 80 }] }] },
        { phaseName: 'Strength', durationWeeks: 4, trainingDays: [{ day: 'Monday', focus: 'Lower', exercises: [{ exercise: 'Back squat', sets: 5, reps: '3', intensity: 'RPE 8' }] }] },
      ],
    });
    const view = buildProgramView({ savedProgram: saved, programStartDate: ago(30), coachGoal: null }, [{ id: 'p1', title: 'Add 2.5 kg to back squat', reasoning: 'Top of range twice', createdAt: ago(4) }], 'imperial', NOW)!;
    expect(view).toMatchObject({ goal: 'Squat 100 kg', daysPerWeek: 2, totalWeeks: 8, currentWeek: 5 });
    expect(view.phases.map((p) => [p.name, p.weeksLabel, p.current])).toEqual([['Foundation', 'Weeks 1 to 4', false], ['Strength', 'Weeks 5 to 8', true]]);
    expect(view.phases[0].days[0].exercises[0]).toEqual({ name: 'Back squat', scheme: '3×5 · RPE 7', target: '176 lbs' });
    expect(view.pending).toHaveLength(1);
    expect(buildProgramView({ savedProgram: null, programStartDate: null, coachGoal: null }, [], 'metric', NOW)).toBeNull();
    expect(buildProgramView({ savedProgram: '{broken', programStartDate: null, coachGoal: null }, [], 'metric', NOW)).toBeNull();
  });
});
