// Ask Anakin (handoff §6.6): questions about the roster, answered from the
// same practice snapshot and rules as everything else.
//
// The model is not asked for the answer. A question is mapped to one of a
// fixed set of intents — by pattern first, with the model only as a fallback
// classifier — and the intent is run as a deterministic query. That is what
// lets every answer list its per-client evidence, say what it excluded and
// what it does not know, and be re-run every morning with the same meaning.

import { describeCheckin } from '../checkinText.js';
import { displayWeight, formatWeight, type UnitPreference } from '../weightUnits.js';
import { shortDay } from './briefingEngine.js';
import { prisma } from './db.js';
import { loadPracticeData, type PracticeData } from './data.js';
import { completeRaw, createDraft, toDraft, writeDraftText } from './drafts.js';
import { LIFT_LABEL, fillForward, liftHistory, liftMentioned, liftTrend, prEvents, weeklyBest } from './lifts.js';
import { painMention } from './signals.js';
import type {
  AnakinEvent, AnakinFilter, AnakinMessage, AnakinRow, AnakinScope, Client, LiftKey, ScheduledResult,
} from './types.js';

const DAY_MS = 86_400_000;

export type Intent =
  | 'plateau' | 'inactive' | 'engagement' | 'injuries' | 'pain' | 'prs' | 'recovery'
  | 'checkins' | 'programEnding' | 'unanswered' | 'noProgram' | 'draft' | 'unknown';

export interface Parsed {
  intent: Intent;
  lift: LiftKey | null;
  /** Days back the question covers, when it said. */
  days: number | null;
  /** The question named a time range that could mean two things ("this month", "recently"). */
  ambiguousRange: boolean;
}

// Order matters: the first pattern that matches wins.
const PATTERNS: [Intent, RegExp][] = [
  ['draft', /\bdraft\b|\bwrite (a |them )?(a )?message\b|\bmessage (them|both|all|these)\b/i],
  ['noProgram', /\b(no|without( a)?|missing( a)?|needs? a) program\b/i],
  ['programEnding', /\b(program|block|plan)s?\b.{0,30}\b(end|ending|ends|finish|finishing|wrapping|due)|\b(end|finish)\w* .{0,20}\b(program|block)|next block|new (program|block)/i],
  ['plateau', /plateau|stall|stuck|not progress|stopped progress|flat ?lin/i],
  ['pain', /\bpain|hurt|sore|niggle|tweak/i],
  ['injuries', /injur|contraindication|safe (to|for)|shouldn'?t (do|squat|lift|press|deadlift)|careful with/i],
  ['prs', /\bprs?\b|personal (record|best)|new record|hit a record/i],
  ['checkins', /check[- ]?ins?\b/i],
  ['unanswered', /unanswered|waiting (on|for) (a |my )?repl|haven'?t replied|need(s)? a reply|owe .{0,12}repl/i],
  ['inactive', /(hasn'?t|haven'?t|not|no|didn'?t|without|miss(ed|ing)?|skipp\w*) .{0,24}(session|train|log|workout|show)|inactive|gone quiet|ghost/i],
  ['engagement', /engag|dropping off|slipping|fall(ing)? off|losing (interest|momentum)|might need support|need(s)? support/i],
  ['recovery', /stress|tired|fatigue|recover|sleep|energy|burn(ed|t)? out|run down/i],
];

export function parseQuestion(text: string): Parsed {
  const intent = PATTERNS.find(([, re]) => re.test(text))?.[0] ?? 'unknown';
  let days: number | null = null;
  const n = text.match(/\b(?:last|past)\s+(\d{1,3})\s+(day|week|month)s?\b/i);
  if (n) days = Number(n[1]) * (n[2].toLowerCase() === 'week' ? 7 : n[2].toLowerCase() === 'month' ? 30 : 1);
  else if (/\b(today|last 24 hours|since yesterday)\b/i.test(text)) days = 1;
  else if (/\b(this|past|last) week\b/i.test(text)) days = 7;
  else if (/\b(past|last) month\b/i.test(text)) days = 30;
  const ambiguousRange = days === null && /\b(this month|recently|lately|of late)\b/i.test(text);
  return { intent, lift: liftMentioned(text), days, ambiguousRange };
}

/** Intents whose answer depends on a time window, with the window used when the question gives none. */
const DEFAULT_DAYS: Partial<Record<Intent, number>> = { inactive: 7, pain: 14, prs: 30, recovery: 7, checkins: 14 };

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * A roster query written as a question that parseQuestion reads back to the
 * same query. This is what "Run every morning" stores, so a scheduled
 * question keeps a fixed meaning however the trainer first phrased it.
 */
export function canonicalQuestion(p: Parsed): string {
  const days = p.days ?? DEFAULT_DAYS[p.intent] ?? 7;
  switch (p.intent) {
    case 'plateau': return p.lift ? `Who is on a plateau on ${LIFT_LABEL[p.lift].toLowerCase()}?` : 'Who is on a plateau?';
    case 'inactive': return `Who has not trained in the last ${days} days?`;
    case 'engagement': return 'Whose engagement is falling?';
    case 'injuries': return 'Who has an active injury on file?';
    case 'pain': return `Who mentioned pain in the last ${days} days?`;
    case 'prs': return `Who set a PR in the last ${days} days?`;
    case 'recovery': return `Who reported poor recovery in the last ${days} days?`;
    case 'checkins': return `Which check-ins need me from the last ${days} days?`;
    case 'programEnding': return 'Whose program is ending soon?';
    case 'noProgram': return 'Who has no program?';
    case 'unanswered': return 'Who is waiting on a reply from me?';
    default: return '';
  }
}

export function clarifyOptions(now: Date): string[] {
  return [`Since 1 ${MONTHS[now.getMonth()]}`, 'Last 30 days', 'Last 7 days'];
}

export function daysForChoice(choice: string, now: Date): number | null {
  if (/^since 1 /i.test(choice)) return Math.max(1, now.getDate());
  const m = choice.match(/last (\d+) days/i);
  return m ? Number(m[1]) : null;
}

async function classifyWithModel(text: string): Promise<Intent> {
  const intents = PATTERNS.map(([i]) => i).filter((i) => i !== 'draft');
  const reply = await completeRaw(
    `You route a personal trainer's question about their client roster to one topic. Topics: ${intents.join(', ')}. Reply with exactly one topic word, or "unknown" if none fits.`,
    text.slice(0, 300),
    8,
  );
  const word = reply?.toLowerCase().replace(/[^a-z]/g, '') ?? '';
  return (intents.find((i) => i.toLowerCase() === word) as Intent | undefined) ?? 'unknown';
}

// ── Answers ──────────────────────────────────────────────────────────────────

export interface Answer {
  text: string;
  rows: AnakinRow[];
  note?: string;
  sources: string;
  followUps: string[];
  actionable: boolean;
}

const ref = (c: Client) => ({ id: c.id, name: c.name, initials: c.initials });
const row = (c: Client, evidence: string, series?: number[]): AnakinRow => ({ clientId: c.id, client: ref(c), evidence, ...(series?.length ? { series } : {}) });
const count = (n: number, one: string, many: string) => (n === 1 ? `1 ${one}` : `${n} ${many}`);
const names = (cs: Client[], max = 3) =>
  cs.length <= max ? cs.map((c) => c.name.split(' ')[0]).join(', ') : `${cs.slice(0, max).map((c) => c.name.split(' ')[0]).join(', ')} and ${cs.length - max} more`;
const daysAgo = (d: Date, now: Date) => Math.floor((now.getTime() - d.getTime()) / DAY_MS);

export function scopeClients(data: PracticeData, scope: AnakinScope): Client[] {
  return scope === 'all' ? data.clients : data.clients.filter((c) => c.status === scope);
}

const DRAFT_FOLLOW_UP = 'Draft a message to these clients';

export function answerQuestion(parsed: Parsed, data: PracticeData, scope: AnakinScope, pref: UnitPreference): Answer {
  const now = data.now;
  const clients = scopeClients(data, scope);
  const d = (c: Client) => data.byClient.get(c.id)!;
  const fmt = (kg: number) => formatWeight(kg, pref) ?? '';
  const days = parsed.days ?? DEFAULT_DAYS[parsed.intent] ?? 7;
  const since = now.getTime() - days * DAY_MS;
  const finish = (a: Omit<Answer, 'actionable' | 'followUps'> & { followUps?: string[] }): Answer => ({
    ...a, actionable: true, followUps: [...(a.rows.length ? [DRAFT_FOLLOW_UP] : []), ...(a.followUps ?? [])],
  });

  switch (parsed.intent) {
    case 'plateau': {
      const lifts: LiftKey[] = parsed.lift ? [parsed.lift] : ['squat', 'bench', 'deadlift'];
      const rows: AnakinRow[] = [];
      const excluded: Client[] = [];
      for (const c of clients) {
        let hit = false;
        let anyData = false;
        for (const lift of lifts) {
          const weekly = weeklyBest(liftHistory(d(c).workouts, lift), 6, now);
          const trend = liftTrend(weekly);
          if (trend.exposures > 0) anyData = true;
          if (trend.status === 'plateau' && trend.latestKg !== null && !hit) {
            hit = true;
            rows.push(row(c, `${LIFT_LABEL[lift]} estimated 1RM flat at ${fmt(trend.latestKg)} over ${trend.exposures} weeks`, fillForward(weekly).map((kg) => displayWeight(kg, pref))));
          }
        }
        if (!hit && !anyData) excluded.push(c);
      }
      const on = parsed.lift ? ` on ${LIFT_LABEL[parsed.lift].toLowerCase()}` : '';
      return finish({
        text: rows.length ? `${count(rows.length, 'client is', 'clients are')} on a plateau${on}.` : `No one is on a plateau${on} right now.`,
        rows,
        ...(excluded.length ? { note: `Excluded: ${names(excluded)} — no ${parsed.lift ? LIFT_LABEL[parsed.lift].toLowerCase() : 'main lift'} logged in the last 6 weeks.` } : {}),
        sources: 'workout logs, plateau rule PLAT-03',
        followUps: parsed.lift ? ['Who is on a plateau on any lift?'] : ['Who is on a plateau on bench press?'],
      });
    }
    case 'inactive': {
      const rows = clients
        .map((c) => ({ c, last: c.lastSessionAt ? new Date(c.lastSessionAt) : null }))
        .filter(({ c, last }) => (last ? last.getTime() <= since : new Date(c.joinedAt).getTime() <= since))
        .map(({ c, last }) => row(c, last ? `Last session ${shortDay(last)}, ${daysAgo(last, now)} days ago` : `No session logged since joining ${shortDay(new Date(c.joinedAt))}`));
      return finish({
        text: rows.length ? `${count(rows.length, 'client has', 'clients have')} not logged a session in the last ${days} days.` : `Everyone has logged a session in the last ${days} days.`,
        rows, sources: 'workout logs', followUps: ['Whose engagement is falling?'],
      });
    }
    case 'engagement': {
      const rows = clients.filter((c) => c.engagementTrend === 'falling' || c.statusReason?.startsWith('Engagement down'))
        .map((c) => row(c, c.statusReason?.startsWith('Engagement down') ? c.statusReason : `Engagement ${c.engagement8w.slice(-6, -3).join(', ')} then ${c.engagement8w.slice(-3).join(', ')} out of 10`, c.engagement8w));
      return finish({
        text: rows.length ? `Engagement is falling for ${count(rows.length, 'client', 'clients')}.` : 'No one\'s engagement is falling.',
        rows, sources: 'workout, nutrition and wellness logs over 8 weeks', followUps: ['Who has not trained in 7 days?'],
      });
    }
    case 'injuries': {
      const withInjury = clients.filter((c) => c.contraindications.some((x) => x.active));
      const unknown = clients.filter((c) => c.contraindications.length === 0);
      return finish({
        text: withInjury.length ? `${count(withInjury.length, 'client has', 'clients have')} an active injury on file.` : 'No client has an active injury on file.',
        rows: withInjury.map((c) => row(c, c.contraindications.filter((x) => x.active).map((x) => (x.note ? `${x.label} (${x.note})` : x.label)).join('; '))),
        note: unknown.length ? `I won't guess on injuries: ${count(unknown.length, 'client has', 'clients have')} nothing on file (${names(unknown)}), which is not the same as no injury.` : undefined,
        sources: 'intake and injury records', followUps: ['Who mentioned pain in the last 14 days?'],
      });
    }
    case 'pain': {
      const rows: AnakinRow[] = [];
      for (const c of clients) {
        const cd = d(c);
        const hits = [
          ...cd.messages.filter((m) => m.fromClient && m.createdAt.getTime() > since).map((m) => ({ at: m.createdAt, s: painMention(m.body), where: 'message' })),
          ...cd.workouts.filter((w) => w.createdAt.getTime() > since).map((w) => ({ at: w.createdAt, s: painMention(w.notes), where: 'workout note' })),
        ].filter((h) => h.s).sort((a, b) => b.at.getTime() - a.at.getTime());
        if (hits[0]) rows.push(row(c, `"${hits[0].s}" — ${hits[0].where}, ${shortDay(hits[0].at)}`));
      }
      return finish({
        text: rows.length ? `${count(rows.length, 'client', 'clients')} mentioned pain in the last ${days} days.` : `No one mentioned pain in the last ${days} days.`,
        rows,
        note: 'I won\'t guess on injuries: this covers only what clients wrote in messages and workout notes.',
        sources: 'messages and workout notes', followUps: ['Who has an active injury on file?'],
      });
    }
    case 'prs': {
      const rows: AnakinRow[] = [];
      for (const c of clients) {
        const recent = prEvents(d(c).workouts).filter((e) => e.at.getTime() > since);
        if (recent.length) {
          const top = recent[recent.length - 1];
          rows.push(row(c, `${top.lift} ${fmt(top.e1rm)} on ${shortDay(top.at)}${recent.length > 1 ? `, and ${recent.length - 1} more` : ''}`));
        }
      }
      return finish({
        text: rows.length ? `${count(rows.length, 'client', 'clients')} set a PR in the last ${days} days.` : `No PRs in the last ${days} days.`,
        rows, sources: 'workout logs (estimated 1RM)', followUps: ['Who is on a plateau?'],
      });
    }
    case 'recovery': {
      const rows: AnakinRow[] = [];
      for (const c of clients) {
        const w = [...d(c).wellness].reverse().find((x) => x.createdAt.getTime() > since && ((x.stress ?? 0) >= 4 || (x.energy != null && x.energy <= 2) || x.sleepHours < 6));
        if (w) rows.push(row(c, `${describeCheckin(w)} on ${shortDay(w.createdAt)}`));
      }
      const silent = clients.filter((c) => !d(c).wellness.some((x) => x.createdAt.getTime() > since));
      return finish({
        text: rows.length ? `${count(rows.length, 'client', 'clients')} reported poor recovery in the last ${days} days.` : `No one reported poor recovery in the last ${days} days.`,
        rows,
        ...(silent.length ? { note: `Unknown for ${names(silent)} — no wellness check-in in that window.` } : {}),
        sources: 'wellness check-ins', followUps: ['Who has not trained in 7 days?'],
      });
    }
    case 'checkins': {
      const rows: AnakinRow[] = [];
      for (const c of clients) {
        const recent = d(c).checkIns.filter((k) => k.dueAt.getTime() > since);
        const missed = recent.filter((k) => k.status === 'missed');
        const waiting = recent.filter((k) => k.status === 'submitted' && !k.reviewedAt);
        if (missed.length) rows.push(row(c, `Missed the check-in due ${shortDay(missed[missed.length - 1].dueAt)}`));
        else if (waiting.length) rows.push(row(c, `Submitted ${shortDay(waiting[waiting.length - 1].submittedAt!)}, not yet reviewed`));
      }
      return finish({
        text: rows.length ? `${count(rows.length, 'check-in needs', 'check-ins need')} you from the last ${days} days.` : `No missed or unreviewed check-ins in the last ${days} days.`,
        rows, sources: 'trainer check-ins', followUps: ['Who reported poor recovery this week?'],
      });
    }
    case 'programEnding': {
      const ending = clients.filter((c) => c.program && c.program.week >= c.program.weeks - 1);
      const none = clients.filter((c) => !c.program);
      return finish({
        text: ending.length ? `${count(ending.length, 'client is', 'clients are')} in the last two weeks of their program.` : 'No one is in the last two weeks of their program.',
        rows: ending.map((c) => row(c, `Week ${c.program!.week} of ${c.program!.weeks} in ${c.program!.blockLabel}`)),
        ...(none.length ? { note: `${count(none.length, 'client has', 'clients have')} no program at all: ${names(none)}.` } : {}),
        sources: 'saved programs', followUps: ['Who has no program?'],
      });
    }
    case 'noProgram': {
      const none = clients.filter((c) => !c.program);
      return finish({
        text: none.length ? `${count(none.length, 'client has', 'clients have')} no program.` : 'Every client has a program.',
        rows: none.map((c) => row(c, `Joined ${shortDay(new Date(c.joinedAt))}, no program saved`)),
        sources: 'saved programs', followUps: ['Whose program is ending soon?'],
      });
    }
    case 'unanswered': {
      const rows: AnakinRow[] = [];
      for (const c of clients) {
        const last = d(c).messages[d(c).messages.length - 1];
        if (last?.fromClient) rows.push(row(c, `"${last.body.length > 90 ? `${last.body.slice(0, 89)}…` : last.body}" — ${daysAgo(last.createdAt, now)} days ago`));
      }
      return finish({
        text: rows.length ? `${count(rows.length, 'client is', 'clients are')} waiting on a reply from you.` : 'You have no unanswered messages.',
        rows, sources: 'your message threads', followUps: ['Who mentioned pain in the last 14 days?'],
      });
    }
    default:
      return {
        text: 'I can answer questions about plateaus, missed sessions, engagement, injuries and pain, PRs, recovery, check-ins, programs and unanswered messages. Try one of those.',
        rows: [], sources: '', followUps: ['Who is on a plateau?', 'Who has not trained in 7 days?', 'Who has an active injury on file?'], actionable: false,
      };
  }
}

// ── Threads ──────────────────────────────────────────────────────────────────

export class AnakinError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'AnakinError';
    this.status = status;
  }
}

const isScope = (v: unknown): v is AnakinScope => v === 'all' || v === 'new' || v === 'support';
export const normaliseScope = (v: unknown): AnakinScope => (isScope(v) ? v : 'all');

async function ownedThread(threadId: string, practiceId: string, trainerId: string) {
  const thread = await prisma.ptAnakinThread.findUnique({ where: { id: threadId } });
  if (!thread || thread.practiceId !== practiceId || thread.trainerId !== trainerId) throw new AnakinError('Thread not found', 404);
  return thread;
}

const parseEvents = (json: string | null): AnakinEvent[] => { try { return json ? JSON.parse(json) : []; } catch { return []; } };

export async function listThreads(practiceId: string, trainerId: string) {
  const threads = await prisma.ptAnakinThread.findMany({ where: { practiceId, trainerId }, orderBy: { updatedAt: 'desc' }, take: 20 });
  return threads.map((t) => ({ id: t.id, title: t.title, updatedAt: t.updatedAt.toISOString() }));
}

export async function getThread(threadId: string, practiceId: string, trainerId: string): Promise<{ id: string; title: string; messages: AnakinMessage[] }> {
  const thread = await ownedThread(threadId, practiceId, trainerId);
  const messages = await prisma.ptAnakinMessage.findMany({ where: { threadId }, orderBy: { createdAt: 'asc' } });
  return {
    id: thread.id, title: thread.title,
    messages: messages.map((m) => ({ id: m.id, role: m.role as 'user' | 'assistant', text: m.text, createdAt: m.createdAt.toISOString(), events: parseEvents(m.eventsJson) })),
  };
}

/** The roster filter behind "Apply as roster filter": the answer's rows and the question that produced them. */
export async function getFilter(threadId: string, messageId: string, practiceId: string, trainerId: string): Promise<AnakinFilter> {
  await ownedThread(threadId, practiceId, trainerId);
  const messages = await prisma.ptAnakinMessage.findMany({ where: { threadId }, orderBy: { createdAt: 'asc' } });
  const index = messages.findIndex((m) => m.id === messageId && m.role === 'assistant');
  const answer = index >= 0 ? parseEvents(messages[index].eventsJson).find((e) => e.type === 'answer') : undefined;
  if (!answer || answer.type !== 'answer') throw new AnakinError('That answer is no longer available', 404);
  const question = [...messages.slice(0, index)].reverse().find((m) => m.role === 'user');
  return { question: question?.text ?? '', rows: answer.rows.map((r) => ({ clientId: r.clientId, evidence: r.evidence })) };
}

export async function ask(input: {
  practiceId: string; trainerId: string; threadId: string | null; text: string; scope: AnakinScope; clarifyChoice?: string;
  pref: UnitPreference; emit: (e: AnakinEvent) => void; now?: Date;
}): Promise<void> {
  const { practiceId, trainerId, scope, pref, emit } = input;
  const text = input.text.trim().slice(0, 500);
  if (!text) throw new AnakinError('Ask a question', 400);
  const now = input.now ?? new Date();

  const thread = input.threadId
    ? await ownedThread(input.threadId, practiceId, trainerId)
    : await prisma.ptAnakinThread.create({ data: { practiceId, trainerId, title: text.length > 60 ? `${text.slice(0, 59)}…` : text } });
  // A clarify choice continues the question already asked; it is not a new user turn.
  if (!input.clarifyChoice) await prisma.ptAnakinMessage.create({ data: { threadId: thread.id, role: 'user', text, scope } });
  const reply = await prisma.ptAnakinMessage.create({ data: { threadId: thread.id, role: 'assistant', text: '', scope } });
  emit({ type: 'thread', threadId: thread.id, messageId: reply.id });

  const data = await loadPracticeData(practiceId, trainerId, { now, includeProspects: true });
  emit({ type: 'status', text: `Reading ${count(scopeClients(data, scope).length, 'client', 'clients')}` });

  // The conversational agent when it is available; the pattern-matched path
  // below when it is not, or if it fails, so a question always gets an answer.
  const { agentAvailable, runAnakinAgent } = await import('./anakinAgent.js');
  let event: AnakinEvent | null = null;
  if (agentAvailable()) {
    try {
      const [earlier, trainer] = await Promise.all([
        prisma.ptAnakinMessage.findMany({ where: { threadId: thread.id, id: { not: reply.id } }, orderBy: { createdAt: 'desc' }, take: 13 }),
        prisma.user.findUnique({ where: { id: trainerId }, select: { name: true } }),
      ]);
      event = await runAnakinAgent({
        practiceId, trainerId, replyId: reply.id, data, scope, pref, emit,
        trainerFirstName: trainer?.name?.trim().split(/\s+/)[0] ?? 'Coach',
        messages: historyFor(earlier.reverse(), text, input.clarifyChoice),
      });
    } catch (err) {
      console.error('[personal-training] anakin agent failed, using the pattern fallback:', (err as Error)?.message);
      event = null;
    }
  }
  if (event) {
    await finish(thread.id, reply.id, event);
    emit(event);
    emit({ type: 'done' });
    return;
  }

  let parsed = parseQuestion(text);
  if (parsed.intent === 'unknown') parsed = { ...parsed, intent: await classifyWithModel(text) };

  if (parsed.intent === 'draft') {
    event = await draftForLastAnswer(thread.id, reply.id, practiceId, trainerId, data);
  } else if (parsed.ambiguousRange && DEFAULT_DAYS[parsed.intent] && !input.clarifyChoice) {
    event = { type: 'clarify', text: 'Which time range should I use?', options: clarifyOptions(now) };
  } else {
    if (input.clarifyChoice) parsed = { ...parsed, days: daysForChoice(input.clarifyChoice, now) ?? parsed.days };
    const answer = answerQuestion(parsed, data, scope, pref);
    event = { type: 'answer', messageId: reply.id, ...answer, ...(answer.actionable ? { scheduleText: canonicalQuestion(parsed) } : {}) };
  }

  const fallback: AnakinEvent = event;
  await finish(thread.id, reply.id, fallback);
  emit(fallback);
  emit({ type: 'done' });
}

async function finish(threadId: string, replyId: string, event: AnakinEvent) {
  await prisma.ptAnakinMessage.update({
    where: { id: replyId },
    data: { text: 'text' in event ? event.text : '', eventsJson: JSON.stringify([event]) },
  });
  await prisma.ptAnakinThread.update({ where: { id: threadId }, data: { updatedAt: new Date() } });
}

/**
 * The thread as model turns. An assistant turn carries the names it listed,
 * so "draft a message to them" has something to refer to. A clarify choice is
 * folded into the question it answers rather than sent as a turn of its own.
 */
export function historyFor(
  earlier: { role: string; text: string; eventsJson: string | null }[],
  question: string,
  clarifyChoice?: string,
): { role: 'user' | 'assistant'; content: string }[] {
  const out: { role: 'user' | 'assistant'; content: string }[] = [];
  for (const m of earlier) {
    const role = m.role === 'assistant' ? 'assistant' : 'user';
    let content = m.text.trim();
    if (role === 'assistant') {
      const e = parseEvents(m.eventsJson)[0];
      if (e?.type === 'answer' && e.rows.length) content += `\n[Clients listed: ${e.rows.map((r) => r.client.name).join(', ')}]`;
      if (e?.type === 'clarify') content += `\n[Options offered: ${e.options.join(' / ')}]`;
      if (e?.type === 'drafts') content += `\n[Drafted for: ${e.drafts.map((d) => d.client.name).join(', ')}]`;
    }
    if (!content) continue;
    // The API needs alternating turns; merge neighbours with the same role.
    const last = out[out.length - 1];
    if (last?.role === role) last.content += `\n${content}`;
    else out.push({ role, content });
  }
  // On a clarify choice the question is already the last stored user turn.
  const ask = clarifyChoice ? `Use this time range: ${clarifyChoice}` : question;
  const last = out[out.length - 1];
  if (last?.role === 'user') { if (clarifyChoice) last.content += `\n${ask}`; }
  else out.push({ role: 'user', content: ask });
  while (out[0]?.role === 'assistant') out.shift();
  return out;
}

/** "Draft a message to these clients": one editable draft per client in the previous answer. */
async function draftForLastAnswer(threadId: string, replyId: string, practiceId: string, trainerId: string, data: PracticeData): Promise<AnakinEvent> {
  const earlier = await prisma.ptAnakinMessage.findMany({ where: { threadId, role: 'assistant', id: { not: replyId } }, orderBy: { createdAt: 'desc' }, take: 6 });
  const last = earlier.flatMap((m) => parseEvents(m.eventsJson)).find((e) => e.type === 'answer' && e.rows.length > 0);
  if (!last || last.type !== 'answer') {
    return { type: 'answer', messageId: replyId, text: 'Ask a question first, then I can draft messages to the clients in the answer.', rows: [], sources: '', followUps: [], actionable: false };
  }
  const trainer = await prisma.user.findUnique({ where: { id: trainerId }, select: { name: true } });
  const byId = new Map(data.clients.map((c) => [c.id, c]));
  const targets = last.rows.filter((r) => byId.has(r.clientId)).slice(0, 6);
  const drafts = [];
  for (const r of targets) {
    const c = byId.get(r.clientId)!;
    const first = c.name.split(' ')[0];
    const draft = await createDraft({
      practiceId, trainerId, clientId: c.id, kind: 'anakin', sourceId: replyId,
      text: await writeDraftText({
        clientFirstName: first, trainerFirstName: trainer?.name?.split(' ')[0] ?? 'Your trainer',
        purpose: 'check in with a client about the observation below; ask how they are getting on and offer to adjust',
        facts: [r.evidence],
        fallback: `Hi ${first}, I was looking through your training and wanted to check in. How are things going on your side? If anything needs adjusting, tell me and I will change the plan.`,
      }),
    });
    drafts.push({ ...toDraft(draft), client: ref(c) });
  }
  return {
    type: 'drafts',
    text: `${count(drafts.length, 'draft', 'drafts')} ready. Nothing sends without you.${last.rows.length > targets.length ? ` I stopped at ${targets.length}; ask again for the rest.` : ''}`,
    drafts,
  };
}

// ── "Run every morning" ──────────────────────────────────────────────────────

export async function listScheduled(practiceId: string, trainerId: string) {
  const rows = await prisma.ptScheduledQuestion.findMany({ where: { practiceId, trainerId }, orderBy: { createdAt: 'asc' } });
  return rows.map((q) => {
    let lastCount: number | undefined;
    try { lastCount = q.lastResultJson ? JSON.parse(q.lastResultJson).count : undefined; } catch { /* no result yet */ }
    return {
      id: q.id, text: q.text, scope: normaliseScope(q.scope), active: q.active,
      ...(q.lastRunAt ? { lastRunAt: q.lastRunAt.toISOString() } : {}), ...(lastCount !== undefined ? { lastCount } : {}),
    };
  });
}

export async function addScheduled(practiceId: string, trainerId: string, text: string, scope: AnakinScope) {
  const clean = text.trim().slice(0, 300);
  const parsed = parseQuestion(clean);
  // Only a question with a fixed meaning can be re-run unattended.
  if (parsed.intent === 'unknown' || parsed.intent === 'draft') throw new AnakinError('That question cannot be run every morning', 400);
  if ((await prisma.ptScheduledQuestion.count({ where: { practiceId, trainerId } })) >= 10) throw new AnakinError('You can schedule up to 10 questions', 400);
  const existing = await prisma.ptScheduledQuestion.findFirst({ where: { practiceId, trainerId, text: clean, scope } });
  if (existing) return existing.id;
  return (await prisma.ptScheduledQuestion.create({ data: { practiceId, trainerId, text: clean, scope } })).id;
}

export async function setScheduledActive(id: string, practiceId: string, trainerId: string, active: boolean) {
  const done = await prisma.ptScheduledQuestion.updateMany({ where: { id, practiceId, trainerId }, data: { active } });
  if (done.count !== 1) throw new AnakinError('Scheduled question not found', 404);
}

export async function removeScheduled(id: string, practiceId: string, trainerId: string) {
  await prisma.ptScheduledQuestion.deleteMany({ where: { id, practiceId, trainerId } });
}

/** Run every active scheduled question against the briefing's snapshot. An ambiguous range takes the intent's default. */
export async function runScheduled(practiceId: string, trainerId: string, data: PracticeData, pref: UnitPreference): Promise<ScheduledResult[]> {
  const questions = await prisma.ptScheduledQuestion.findMany({ where: { practiceId, trainerId, active: true }, orderBy: { createdAt: 'asc' } });
  const results: ScheduledResult[] = [];
  for (const q of questions) {
    const answer = answerQuestion(parseQuestion(q.text), data, normaliseScope(q.scope), pref);
    const result = { id: q.id, text: q.text, answer: answer.text, count: answer.rows.length };
    await prisma.ptScheduledQuestion.update({ where: { id: q.id }, data: { lastRunAt: data.now, lastResultJson: JSON.stringify(result) } });
    results.push(result);
  }
  return results;
}
