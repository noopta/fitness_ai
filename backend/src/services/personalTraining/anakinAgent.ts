// Ask Anakin as a conversation.
//
// The first version mapped each question to one of a fixed list of intents and
// answered with a template, which made anything outside the list — "hi",
// "how is Maya doing?", a follow-up — read as broken. Here a model holds the
// conversation and decides what to look up, but it still cannot make claims of
// its own: every fact about a client reaches it through a tool that runs the
// same deterministic queries as the roster and briefing, and the client list
// shown under an answer is taken from the tool results, not from the model's
// words (handoff §2.2).

import { describeCheckin } from '../checkinText.js';
import Anthropic from '@anthropic-ai/sdk';
import { formatWeight, type UnitPreference } from '../weightUnits.js';
import { shortDay } from './briefingEngine.js';
import type { PracticeData } from './data.js';
import { adherence4w, liftSnapshots } from './dossier.js';
import { createDraft, toDraft, writeDraftText } from './drafts.js';
import { isLiftKey } from './lifts.js';
import type { AnakinEvent, AnakinRow, AnakinScope, Client, Draft, LiftKey } from './types.js';
import { answerQuestion, canonicalQuestion, scopeClients, type Answer, type Intent, type Parsed } from './anakin.js';

const MODEL = process.env.PERSONAL_TRAINING_AGENT_MODEL || process.env.AGENT_MODEL || 'claude-sonnet-5';
const MAX_STEPS = 5;
const MAX_DRAFTS = 6;

const QUERIES: Exclude<Intent, 'draft' | 'unknown'>[] = [
  'plateau', 'inactive', 'engagement', 'injuries', 'pain', 'prs', 'recovery', 'checkins', 'programEnding', 'noProgram', 'unanswered',
];

const SYSTEM = `You are Anakin, the assistant inside a personal trainer's dashboard in the Axiom training app. You are talking to the trainer about their own clients.

How to answer:
- Anything about clients must come from a tool. Call find_clients for questions about the roster ("who…"), get_client for one named person, roster_overview for a general picture. Never state a number, date, lift, injury or name that a tool did not return in this conversation, and never guess.
- The app lists the matching clients, each with their evidence, directly under your reply. So do not repeat every client's details — give the takeaway and what you would look at first. Usually two to four sentences, and no more than about 120 words unless the trainer asks for detail.
- If a tool result includes a "note" (people excluded, or things it cannot know), pass that on in your own words. On injuries and pain: report only what is on file or what the client wrote, say plainly when it is unknown, and never diagnose or advise treatment.
- When a time range matters and the trainer's wording could mean different windows ("this month", "recently"), call ask_clarification with two or three concrete options instead of picking one.
- You cannot send anything to a client. If the trainer wants to message people, call draft_messages; the drafts appear for them to edit and send. Say they are drafts.
- If asked something that is not about their clients or coaching, answer briefly and steer back. For a greeting, reply in one friendly sentence and suggest a question or two you can answer.
- Plain text only: no Markdown, no bullet lists, no headings, no emoji, no exclamation marks. Sentence case. Be brief and direct.`;

const TOOLS = [
  {
    name: 'find_clients',
    description:
      'Find the clients matching one roster question. Returns each matching client with the evidence for it, plus a note on who was excluded or what is unknown. query: plateau (estimated 1RM flat for 6 weeks; optional lift), inactive (no session logged in `days`), engagement (falling), injuries (active injuries on file), pain (wrote about pain in `days`), prs (set a personal record in `days`), recovery (reported high stress, low energy or short sleep in `days`), checkins (missed or unreviewed in `days`), programEnding (last two weeks of their program), noProgram, unanswered (their message is the last in the thread).',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', enum: QUERIES },
        lift: { type: 'string', enum: ['squat', 'bench', 'deadlift', 'ohp'], description: 'Only for plateau.' },
        days: { type: 'integer', minimum: 1, maximum: 365, description: 'Look-back window for inactive, pain, prs, recovery, checkins.' },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_client',
    description: 'Everything on file for one client, by name: status and why, program position, injuries, sessions and adherence, lift trends, latest wellness check-in, recent messages, suggested program changes.',
    input_schema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
  },
  {
    name: 'roster_overview',
    description: 'The whole roster at a glance: how many clients, how many in each status, and each client with their status and the reason for it.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'draft_messages',
    description: 'Draft a message from the trainer to one or more named clients. Nothing is sent: the drafts are shown to the trainer to edit and send. Use the names exactly as a tool returned them.',
    input_schema: {
      type: 'object',
      properties: {
        clients: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: MAX_DRAFTS },
        purpose: { type: 'string', description: 'What the message is for, in a few words.' },
      },
      required: ['clients', 'purpose'],
    },
  },
  {
    name: 'ask_clarification',
    description: 'Ask the trainer to choose between two or three concrete options before answering. Ends your turn.',
    input_schema: {
      type: 'object',
      properties: { question: { type: 'string' }, options: { type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 3 } },
      required: ['question', 'options'],
    },
  },
];

export type CreateMessage = (req: Record<string, unknown>) => Promise<{ stop_reason: string | null; content: any[] }>;

let client: Anthropic | null = null;
const defaultCreate: CreateMessage = (req) => {
  if (!client) client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return client.messages.create(req as any, { timeout: 30_000 }) as any;
};

/** Whether the conversational agent can run here; when it cannot, ask() uses the pattern-matched fallback. */
export function agentAvailable(): boolean {
  return !!process.env.ANTHROPIC_API_KEY && process.env.PERSONAL_TRAINING_AGENT !== '0' && process.env.NODE_ENV !== 'test' && !process.env.VITEST;
}

const ref = (c: Client) => ({ id: c.id, name: c.name, initials: c.initials });
const norm = (s: string) => s.trim().toLowerCase();

/** Clients a name could mean: an exact full-name match wins, otherwise anyone whose name contains it. */
export function matchClients(clients: Client[], name: string): Client[] {
  const n = norm(name);
  if (!n) return [];
  const exact = clients.filter((c) => norm(c.name) === n);
  if (exact.length) return exact;
  return clients.filter((c) => norm(c.name).includes(n) || norm(c.name).split(/\s+/).some((part) => part === n));
}

function clientFacts(c: Client, data: PracticeData, pref: UnitPreference) {
  const d = data.byClient.get(c.id)!;
  const now = data.now;
  const fmt = (kg: number) => formatWeight(kg, pref) ?? '';
  const adherence = adherence4w(c, d, now);
  const wellness = d.wellness[d.wellness.length - 1];
  const checkIn = [...d.checkIns].reverse().find((k) => k.status === 'submitted');
  return {
    name: c.name,
    status: c.status === 'support' ? 'might need support' : c.status === 'onPlan' ? 'on plan' : c.status === 'notJoined' ? 'not joined (imported from a spreadsheet; no Axiom account, cannot be messaged)' : c.status,
    statusReason: c.statusReason ?? null,
    clientSince: shortDay(new Date(c.joinedAt)),
    program: c.program ? `${c.program.blockLabel}, week ${c.program.week} of ${c.program.weeks}${c.program.goal ? `; goal: ${c.program.goal}` : ''}` : 'no program',
    lastSession: c.lastSessionAt ? shortDay(new Date(c.lastSessionAt)) : 'none logged',
    sessionsLast4Weeks: `${adherence.logged} of ${adherence.planned} planned`,
    engagementLast8Weeks: `${c.engagement8w.join(', ')} out of 10 (${c.engagementTrend})`,
    injuries: c.contraindications.length
      ? c.contraindications.map((x) => `${x.label}${x.note ? ` (${x.note})` : ''} — ${x.active ? 'active' : 'cleared'}`)
      : 'nothing on file (unknown, not the same as none)',
    lifts: liftSnapshots(d, now).map((l) => `${l.label}: estimated 1RM ${fmt(l.latestKg)}, ${l.status === 'noData' ? 'too little data for a trend' : l.status}${l.changeKg !== null ? ` (${l.changeKg >= 0 ? '+' : '−'}${fmt(Math.abs(l.changeKg))} over 6 weeks)` : ''}`),
    latestWellness: wellness ? `${shortDay(wellness.createdAt)}: ${describeCheckin(wellness)}` : 'none in the last 60 days',
    latestCheckIn: checkIn?.summary ? `${shortDay(checkIn.submittedAt!)}: ${checkIn.summary}` : 'none',
    recentMessages: d.messages.slice(-3).map((m) => `${shortDay(m.createdAt)} ${m.fromClient ? 'client' : 'trainer'}: ${m.body.slice(0, 200)}`),
    suggestedProgramChangesWaiting: d.proposals.map((p) => p.title),
  };
}

export interface AgentInput {
  practiceId: string;
  trainerId: string;
  /** The assistant message row this turn fills; drafts are tied to it. */
  replyId: string;
  data: PracticeData;
  scope: AnakinScope;
  pref: UnitPreference;
  trainerFirstName: string;
  /** Earlier turns, oldest first, then the new question last. */
  messages: { role: 'user' | 'assistant'; content: string }[];
  emit: (e: AnakinEvent) => void;
  create?: CreateMessage;
}

/** Run one conversational turn. Returns the terminal event (answer, clarify or drafts). */
export async function runAnakinAgent(input: AgentInput): Promise<AnakinEvent> {
  const { data, scope, pref, emit } = input;
  const create = input.create ?? defaultCreate;
  const clients = scopeClients(data, scope);
  const today = data.now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  // What the tools found this turn. The answer's client list comes from here.
  const queries: { parsed: Parsed; answer: Answer }[] = [];
  const looked: AnakinRow[] = [];
  const flagged: AnakinRow[] = [];
  const drafts: (Draft & { client: ReturnType<typeof ref> })[] = [];
  let clarify: { text: string; options: string[] } | null = null;

  const run = async (name: string, args: any): Promise<unknown> => {
    if (name === 'find_clients') {
      const intent = QUERIES.find((q) => q === args?.query);
      if (!intent) return { error: 'Unknown query' };
      const lift: LiftKey | null = isLiftKey(args?.lift) ? args.lift : null;
      const days = Number.isInteger(args?.days) && args.days > 0 && args.days <= 365 ? (args.days as number) : null;
      const parsed: Parsed = { intent, lift, days, ambiguousRange: false };
      emit({ type: 'status', text: STATUS[intent] });
      const answer = answerQuestion(parsed, data, scope, pref);
      queries.push({ parsed, answer });
      return { summary: answer.text, clients: answer.rows.map((r) => ({ name: r.client.name, evidence: r.evidence })), note: answer.note ?? null, basedOn: answer.sources };
    }
    if (name === 'get_client') {
      const matches = matchClients(clients, String(args?.name ?? ''));
      emit({ type: 'status', text: matches.length === 1 ? `Looking at ${matches[0].name}` : 'Looking up that client' });
      if (matches.length === 0) return { error: `No client matching "${args?.name}" in this scope.`, clients: clients.map((c) => c.name) };
      if (matches.length > 1) return { error: 'More than one client matches. Ask which one.', matches: matches.map((c) => c.name) };
      const c = matches[0];
      if (!looked.some((r) => r.clientId === c.id)) {
        looked.push({ clientId: c.id, client: ref(c), evidence: c.statusReason ?? (c.program ? `${c.program.blockLabel} · week ${c.program.week} of ${c.program.weeks}` : 'No program yet'), series: c.engagement8w });
      }
      return clientFacts(c, data, pref);
    }
    if (name === 'roster_overview') {
      emit({ type: 'status', text: 'Reading the roster' });
      const count = (s: Client['status']) => clients.filter((c) => c.status === s).length;
      // The overview's own "who to look at" list: everyone the status rules flagged, with the rule's reason.
      for (const c of clients) {
        if (c.status === 'support' && c.statusReason && !flagged.some((r) => r.clientId === c.id)) {
          flagged.push({ clientId: c.id, client: ref(c), evidence: c.statusReason, series: c.engagement8w });
        }
      }
      return {
        clients: clients.length,
        mightNeedSupport: count('support'), new: count('new'), onPlan: count('onPlan'), paused: count('paused'),
        roster: clients.map((c) => ({ name: c.name, status: c.status === 'support' ? 'might need support' : c.status === 'onPlan' ? 'on plan' : c.status, reason: c.statusReason ?? null })),
      };
    }
    if (name === 'draft_messages') {
      const names: string[] = Array.isArray(args?.clients) ? args.clients.slice(0, MAX_DRAFTS).map(String) : [];
      const purpose = String(args?.purpose ?? 'check in').slice(0, 200);
      emit({ type: 'status', text: 'Drafting' });
      const drafted: string[] = [];
      const missing: string[] = [];
      for (const n of names) {
        const [c, ...more] = matchClients(clients, n);
        // Someone who has not joined Axiom cannot be messaged, so there is nothing to draft.
        if (!c || more.length || c.status === 'notJoined') { missing.push(n); continue; }
        if (drafts.some((d) => d.clientId === c.id)) continue;
        const first = c.name.split(' ')[0];
        const evidence = queries.flatMap((q) => q.answer.rows).find((r) => r.clientId === c.id)?.evidence;
        const draft = await createDraft({
          practiceId: input.practiceId, trainerId: input.trainerId, clientId: c.id, kind: 'anakin', sourceId: input.replyId,
          text: await writeDraftText({
            clientFirstName: first, trainerFirstName: input.trainerFirstName, purpose,
            facts: [evidence, c.statusReason, c.program ? `Program: ${c.program.blockLabel}, week ${c.program.week} of ${c.program.weeks}` : null].filter((f): f is string => !!f),
            fallback: `Hi ${first}, I was looking through your training and wanted to check in. How are things going on your side? If anything needs adjusting, tell me and I will change the plan.`,
          }),
        });
        drafts.push({ ...toDraft(draft), client: ref(c) });
        drafted.push(c.name);
      }
      return { drafted, notFoundOrAmbiguous: missing, sent: false, note: 'These are drafts. Nothing has been sent.' };
    }
    if (name === 'ask_clarification') {
      const options = Array.isArray(args?.options) ? args.options.map(String).filter(Boolean).slice(0, 3) : [];
      if (options.length >= 2) clarify = { text: String(args?.question ?? 'Which did you mean?'), options };
      return { asked: true };
    }
    return { error: `Unknown tool ${name}` };
  };

  const messages: any[] = input.messages.map((m) => ({ role: m.role, content: m.content }));
  let text = '';
  for (let step = 0; step < MAX_STEPS; step++) {
    const res = await create({
      model: MODEL,
      max_tokens: 700,
      system: `${SYSTEM}\n\nToday is ${today}. The trainer is ${input.trainerFirstName}. Scope for this question: ${scope === 'all' ? 'all clients' : scope === 'new' ? 'new clients only' : 'clients who might need support only'} (${clients.length} in scope). Weights are in ${pref === 'metric' ? 'kilograms' : 'pounds'}.`,
      tools: TOOLS,
      messages,
    });
    const blocks: any[] = Array.isArray(res.content) ? res.content : [];
    const said = blocks.filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
    if (said) text = said;
    const calls = blocks.filter((b) => b.type === 'tool_use');
    if (res.stop_reason !== 'tool_use' || calls.length === 0) break;

    messages.push({ role: 'assistant', content: blocks });
    const results = [];
    for (const call of calls) {
      let out: unknown;
      try { out = await run(call.name, call.input); } catch (err) { out = { error: (err as Error)?.message ?? 'Tool failed' }; }
      results.push({ type: 'tool_result', tool_use_id: call.id, content: JSON.stringify(out) });
    }
    messages.push({ role: 'user', content: results });
    if (clarify) break; // the question to the trainer IS the reply
  }

  // House style is enforced, not requested.
  const clean = (s: string) => s.replace(/!/g, '.').replace(/\p{Extended_Pictographic}/gu, '').replace(/^\s*[-*•]\s+/gm, '').replace(/\*\*/g, '').trim();

  if (clarify) return { type: 'clarify', text: (clarify as { text: string }).text, options: (clarify as { options: string[] }).options };
  if (drafts.length) {
    return { type: 'drafts', text: clean(text) || `${drafts.length === 1 ? '1 draft' : `${drafts.length} drafts`} ready. Nothing sends without you.`, drafts };
  }
  // One query: its rows, note and a schedulable meaning. Several (a broad
  // question like "who should I worry about"): everyone any of them surfaced,
  // each with the evidence that surfaced them — a list that can be filtered
  // on, but not one question that can be re-run every morning.
  const single = queries.length === 1 ? queries[0] : null;
  const merged = new Map<string, AnakinRow>();
  for (const q of queries) {
    for (const r of q.answer.rows) {
      const seen = merged.get(r.clientId);
      if (!seen) merged.set(r.clientId, { ...r });
      else if (!seen.evidence.includes(r.evidence) && seen.evidence.split(' · ').length < 3) seen.evidence = `${seen.evidence} · ${r.evidence}`;
    }
  }
  // Rows a filter can be built from: query results, or failing that the clients the overview flagged.
  for (const r of merged.size ? [] : flagged) merged.set(r.clientId, r);
  const rows = merged.size ? [...merged.values()] : looked;
  const unique = (xs: (string | undefined)[]) => [...new Set(xs.filter((x): x is string => !!x))];
  const notes = unique(queries.map((q) => q.answer.note)).slice(0, 2).join(' ');
  return {
    type: 'answer',
    messageId: input.replyId,
    // The model's wording when it gave one; otherwise the query's own one-line summary.
    text: clean(text) || single?.answer.text || 'I could not put an answer together for that. Try asking it another way.',
    rows,
    ...(notes ? { note: notes } : {}),
    sources: unique(queries.map((q) => q.answer.sources)).join(', ') || (flagged.length && merged.size ? 'roster status rules' : looked.length ? 'their records on file' : ''),
    followUps: single
      ? single.answer.followUps
      : merged.size ? ['Draft a message to these clients']
      : looked.length ? [`Draft a message to ${looked[0].client.name.split(' ')[0]}`]
      : ['Who might need support?', 'Who is on a plateau?', 'Who has not trained in 7 days?'],
    // A filter only makes sense for roster queries, not for small talk or one client's file.
    actionable: merged.size > 0,
    ...(single && single.answer.rows.length ? { scheduleText: canonicalQuestion(single.parsed) } : {}),
  };
}

const STATUS: Record<(typeof QUERIES)[number], string> = {
  plateau: 'Checking lift trends',
  inactive: 'Checking who has not trained',
  engagement: 'Checking engagement',
  injuries: 'Checking injuries on file',
  pain: 'Reading messages and workout notes',
  prs: 'Looking for new PRs',
  recovery: 'Reading wellness check-ins',
  checkins: 'Checking check-ins',
  programEnding: 'Checking program dates',
  noProgram: 'Checking programs',
  unanswered: 'Checking your message threads',
};
