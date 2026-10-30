// Prepared work (design flow B): Anakin comes back with next week already
// built — a diff, not a description — and nothing changes until Apply.
//
//   B1  the card: Proposed receipt · rationale · strike-through rows · Apply / Not this week
//   B2  Apply runs the program change (undo until the first changed session
//       starts) and opens an experiment thread so B3 can report back
//   B4  a coach runs the program → the same proposal becomes a message, never an edit
//   B5  a card expires when the first affected session starts, or after 48 h
//       with no dated session; one smaller re-offer at most
//   B6  coach not on Axiom → the share sheet (plain text, no link)
//   B7  the next evening: "Did your coach get back to you?"
//
// The pure parts (changes → program, expiry, labels, share text) are tested
// without Prisma.

import { PrismaClient } from '@prisma/client';
import type { CardDraft } from '../agent/cards/types.js';
import { defineOp, getOp } from '../agent/ops.js';
import { postInitiatedTurn } from '../agent/initiated.js';
import type { ProgramOwner } from './prefs.js';
import { addDays, createThread, getThread, resolveThread, shortDate, updateThread } from './threads.js';

const prisma = new PrismaClient();

export interface WeekChange { day: string; exercise: string; from: string; to: string }
export interface PreparedWork {
  title: string;        // "Recovery week"
  startDate: string;    // YYYY-MM-DD (the week's first day)
  endDate: string;
  rationale: string;    // "23 days out. Deload now, build after."
  changes: WeekChange[];
  /** When Anakin will compare (B2 "I'll check in Nov 9"). */
  checkBackAt: string;
  /** The lift the outcome report measures (B3). */
  measureLift?: string | null;
  /** Receipt-style reasons the coach sees (B6/B8). */
  reasons?: string[];
}

export const EXPIRE_HOURS = 48;
const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** "Nov 2–8" (or "Oct 27 – Nov 2" across a month). */
export function rangeLabel(start: string, end: string): string {
  const a = shortDate(start), b = shortDate(end);
  return a.split(' ')[0] === b.split(' ')[0] ? `${a}–${b.split(' ')[1]}` : `${a} – ${b}`;
}

const dayIndex = (label: string) => DAYS.findIndex((d) => d.startsWith(label.trim().toLowerCase().slice(0, 3)));

/** The date inside [start, end] that a day label ("Mon", "Tuesday") names. Null when the label isn't a weekday. */
export function dateForDay(label: string, start: string, end: string): string | null {
  const idx = dayIndex(label);
  if (idx < 0) return null;
  for (let d = start; d <= end; d = addDays(d, 1)) if (new Date(`${d}T12:00:00Z`).getUTCDay() === idx) return d;
  return null;
}

/** ISO instant of the first changed session: its date at the usual session time (or 00:00 local when unknown). Null = no dated change. */
export function firstAffectedAt(p: Pick<PreparedWork, 'changes' | 'startDate' | 'endDate'>, sessionTime: string | null, tzOffsetMinutes = 0): string | null {
  const dates = p.changes.map((c) => dateForDay(c.day, p.startDate, p.endDate)).filter((d): d is string => !!d).sort();
  if (!dates.length) return null;
  const [h, m] = (sessionTime ?? '00:00').split(':').map(Number);
  return new Date(Date.parse(`${dates[0]}T00:00:00Z`) + ((h * 60 + m) - tzOffsetMinutes) * 60_000).toISOString();
}

/** B5: expires when the first affected session starts, else 48 h after it was proposed. Never applies late. */
export function preparedExpiry(firstAffected: string | null, createdAt: string): string {
  const fallback = new Date(Date.parse(createdAt) + EXPIRE_HOURS * 3_600_000).toISOString();
  return firstAffected && firstAffected > createdAt ? firstAffected : fallback;
}

/** "Hard rounds 6×3" → { sets: 6, reps: '3', rest: 'Hard rounds' }; "3×5 @ 225" → { sets: 3, reps: '5', rest: '@ 225' }. */
export function parseScheme(text: string): { sets: number | null; reps: string | null; rest: string } {
  const m = text.match(/(\d+)\s*[×x]\s*(\d+(?:\s*[-–]\s*\d+)?(?:\s*min)?)/i);
  if (!m) return { sets: null, reps: null, rest: text.trim() };
  return { sets: Number(m[1]), reps: m[2].replace(/\s+/g, ''), rest: (text.slice(0, m.index) + ' ' + text.slice((m.index ?? 0) + m[0].length)).replace(/\s+/g, ' ').trim() };
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const sameExercise = (a: string, b: string) => { const x = norm(a), y = norm(b); return x === y || x.includes(y) || y.includes(x); };

/**
 * Pure: apply the changes to a copy of the program's active phase. A change
 * whose exercise isn't on that day becomes a note on the day (sparring on a
 * lifting program), never an invented row. Returns what landed and what didn't.
 */
export function applyWeekChanges(program: any, changes: WeekChange[], phaseIndex = 0, title = 'Change'): { program: any; applied: number; missed: WeekChange[] } {
  const next = JSON.parse(JSON.stringify(program ?? {}));
  const phase = next?.phases?.[phaseIndex];
  const missed: WeekChange[] = [];
  let applied = 0;
  if (!phase?.trainingDays?.length) return { program: next, applied, missed: changes };
  for (const c of changes) {
    const day = phase.trainingDays.find((d: any) => dayIndex(String(d.day ?? '')) >= 0 && dayIndex(String(d.day)) === dayIndex(c.day))
      ?? phase.trainingDays.find((d: any) => norm(String(d.day ?? '')).startsWith(norm(c.day).slice(0, 3)));
    if (!day) { missed.push(c); continue; }
    const ex = (day.exercises ?? []).find((e: any) => sameExercise(String(e.exercise ?? e.name ?? ''), c.exercise));
    if (!ex) {
      day.notes = [day.notes, `${title}: ${c.exercise} — ${c.from} → ${c.to}`].filter(Boolean).join(' · ');
      applied++;
      continue;
    }
    const s = parseScheme(c.to);
    if (s.sets != null) ex.sets = s.sets;
    if (s.reps != null) ex.reps = s.reps;
    const load = s.rest.match(/@\s*([\d.]+\s*(?:lb|kg)?)/i);
    if (load) ex.intensity = load[1].trim();
    else if (s.rest) ex.notes = [ex.notes, `${title}: ${s.rest}`].filter(Boolean).join(' · ');
    ex.notes = [ex.notes, `was ${c.from}`].filter(Boolean).join(' · ');
    applied++;
  }
  return { program: next, applied, missed };
}

/** B1 (owner = me) or B4 (a coach runs it). */
export function preparedCard(p: PreparedWork, opts: { programNext: any; programOwner: ProgramOwner; prevProgram: string | null; eventId: string | null; expiresAt: string; sessionTime: string | null }): CardDraft {
  const range = rangeLabel(p.startDate, p.endDate);
  const diff = p.changes.map((c) => ({ key: `${c.day.slice(0, 3)} · ${c.exercise}`, from: c.from, to: c.to }));
  const base = { fn: 'PRO-02', pattern: 'proposal' as const, rule: 'propose' as const, diff, why: p.rationale, entity: `prepared:${p.title.toLowerCase()}:${p.startDate}`, expiresAt: opts.expiresAt };
  if (opts.programOwner === 'me') {
    return {
      ...base,
      meta: { label: `Proposed · ${p.title} · ${range}` },
      actions: [{ id: 'apply', label: 'Apply', kind: 'primary' }, { id: 'keep', label: 'Not this week', kind: 'secondary' }],
      pending: { actions: {
        apply: { op: 'proactive.prepared_apply', args: { program: opts.programNext, prevProgram: opts.prevProgram, title: p.title, startDate: p.startDate, endDate: p.endDate, checkBackAt: p.checkBackAt, measureLift: p.measureLift ?? null, changes: p.changes, eventId: opts.eventId, expiresAt: opts.expiresAt, sessionTime: opts.sessionTime }, status: 'applied', line: `Adjusted — ${p.title} · ${p.changes.length} change${p.changes.length === 1 ? '' : 's'} to ${range}` },
        keep: { kind: 'keep', line: 'Not this week' },
      } },
    };
  }
  // A coach runs the program: Anakin never edits it. The proposal becomes a message.
  const toInbox = opts.programOwner === 'coach_axiom';
  return {
    ...base,
    meta: { label: `Proposed · ${p.title} · ${range} · for your coach` },
    note: toInbox ? 'Goes to their inbox with the changes and the reasons — not your chat.' : 'Sends the changes and the reasons as a message — not your chat.',
    actions: [
      toInbox
        ? { id: 'send', label: 'Send to your coach', kind: 'primary' }
        : { id: 'send', label: 'Send to your coach', kind: 'primary', client: { action: 'share', args: { text: shareText(p) } } },
      { id: 'keep', label: 'Not this week', kind: 'secondary' },
    ],
    pending: { actions: {
      send: { op: 'proactive.coach_sent', args: { title: p.title, startDate: p.startDate, endDate: p.endDate, changes: p.changes, program: opts.programNext, prevProgram: opts.prevProgram, checkBackAt: p.checkBackAt, measureLift: p.measureLift ?? null, eventId: opts.eventId, via: toInbox ? 'inbox' : 'share' }, status: 'sent', line: `Sent — ${p.title} · ${toInbox ? 'to your coach’s inbox' : 'via your share sheet'}` },
      keep: { kind: 'keep', line: 'Not this week' },
    } },
  };
}

/** B6: the plain-text summary for the share sheet. The changes, the reasons, the event. No link, no install. */
export function shareText(p: PreparedWork, forName: string | null = null): string {
  const lines = [
    `${p.title} ${forName ? `for ${forName} ` : ''}· ${rangeLabel(p.startDate, p.endDate)}`,
    ...p.changes.map((c) => `• ${c.day.slice(0, 3)} ${c.exercise.toLowerCase()} ${c.from} → ${c.to}`),
    ...(p.reasons?.length ? [`Why: ${p.reasons.join('; ')}.`] : [`Why: ${p.rationale}`]),
    'Suggested by Axiom',
  ];
  return lines.join('\n');
}

/** B5 line under the collapsed card. */
export function expiredLine(p: Pick<PreparedWork, 'title'>, firstAffected: string | null): string {
  const day = firstAffected ? SHORT[new Date(firstAffected).getUTCDay()] : null;
  return `Expired — ${p.title} · ${day ? `${day === 'Sun' ? 'Sunday' : DAYS[SHORT.indexOf(day)].replace(/^./, (c) => c.toUpperCase())} started before it was applied` : 'not applied in time'}`;
}

/** B5: the one smaller re-offer. */
export function reofferCard(p: PreparedWork, today: string, eventId: string | null): CardDraft {
  const from = SHORT[new Date(`${addDays(today, 1)}T12:00:00Z`).getUTCDay()];
  const to = SHORT[new Date(`${p.endDate}T12:00:00Z`).getUTCDay()];
  return {
    fn: 'PRO-05', pattern: 'ask', rule: 'show', meta: { label: 'No changes made' },
    ask: { q: 'No changes made. Want the rest of this week lighter instead?', options: [`Yes, ${from}–${to}`, 'No, train as planned'] },
    why: 'Today’s session is as planned. This is the last time I’ll ask about this week.',
    pending: { answer: { op: 'proactive.reoffer', args: { title: p.title, from, to, eventId }, valueKey: 'value' } },
    entity: `prepared-reoffer:${p.title.toLowerCase()}:${p.startDate}`,
  };
}

/** B7: the next evening. */
export function coachFollowupCard(p: Pick<PreparedWork, 'title' | 'startDate' | 'endDate'>, threadId: string, eventId: string | null): CardDraft {
  return {
    fn: 'PRO-06', pattern: 'ask', rule: 'show', meta: { label: 'Your coach' },
    ask: { q: 'Did your coach get back to you about next week?', options: ['Yes — apply it as sent', 'They changed it', 'They said no', 'No answer yet'] },
    pending: { answer: { op: 'proactive.coach_reply', args: { threadId, eventId }, valueKey: 'value' } },
    entity: `coach-followup:${threadId}`,
  };
}

// ── DB ──────────────────────────────────────────────────────────────────────

/** Save the card's expiry on its row so the hourly sweep can find it. */
export async function stampExpiry(cardId: string, expiresAt: string): Promise<void> {
  await prisma.agentCard.update({ where: { id: cardId }, data: { expiresAt: new Date(expiresAt) } }).catch(() => {});
}

/** Hourly: live PRO-02 cards past their expiry collapse to the Expired line; one re-offer at most. */
export async function expirePreparedCards(now = new Date()): Promise<number> {
  const rows = await prisma.agentCard.findMany({ where: { fn: 'PRO-02', status: 'live', expiresAt: { lte: now } } });
  let n = 0;
  for (const row of rows) {
    try {
      const card = JSON.parse(row.payloadJson);
      const pending = row.pendingJson ? JSON.parse(row.pendingJson) : {};
      const args = pending.actions?.apply?.args ?? pending.actions?.send?.args ?? {};
      const p: PreparedWork = { title: String(args.title ?? 'Change'), startDate: String(args.startDate ?? ''), endDate: String(args.endDate ?? ''), rationale: card.why ?? '', changes: Array.isArray(args.changes) ? args.changes : [], checkBackAt: String(args.checkBackAt ?? '') };
      const first = p.startDate && p.endDate ? firstAffectedAt(p, args.sessionTime ?? null) : null;
      card.state = { status: 'expired', line: expiredLine(p, first), at: now.toISOString() };
      await prisma.agentCard.update({ where: { id: row.id }, data: { status: 'expired', payloadJson: JSON.stringify(card) } });
      if (typeof args.eventId === 'string') await prisma.proactiveEvent.update({ where: { id: args.eventId }, data: { outcome: 'expired', outcomeAt: now } }).catch(() => {});
      // One re-offer, and only while the week still has days left.
      const today = now.toISOString().slice(0, 10);
      const offered = await prisma.agentCard.findFirst({ where: { userId: row.userId, fn: 'PRO-05', pendingJson: { contains: `"title":${JSON.stringify(p.title)}` } } });
      if (!offered && p.endDate && addDays(today, 1) <= p.endDate) {
        const ev = await prisma.proactiveEvent.create({ data: { userId: row.userId, kind: 'prepared', topic: p.title.toLowerCase(), channel: 'chat', text: 'No changes made. Want the rest of this week lighter instead?' } });
        await postInitiatedTurn(row.userId, { text: 'No changes made. Want the rest of this week lighter instead?', cards: [reofferCard(p, today, ev.id)] });
      }
      n++;
    } catch (err: any) { console.error('[proactive] expire card failed:', err?.message ?? err); }
  }
  return n;
}

// ── Ops ─────────────────────────────────────────────────────────────────────

const noteEvent = async (eventId: unknown, outcome: string) => { if (typeof eventId === 'string') await prisma.proactiveEvent.update({ where: { id: eventId }, data: { outcome, outcomeAt: new Date() } }).catch(() => {}); };

/** B2: apply the week and open the experiment thread the outcome report will read. */
defineOp({
  name: 'proactive.prepared_apply',
  run: async (userId, args) => {
    const replace = getOp('program.replace');
    if (!replace) throw new Error('Program ops not loaded');
    const prev = await prisma.user.findUnique({ where: { id: userId }, select: { savedProgram: true } });
    const out = await replace.run(userId, { program: args.program, summary: `${args.title} · ${args.startDate}` });
    const title = String(args.title ?? 'Change');
    const thread = await createThread(userId, {
      kind: 'experiment', title, sourceQuote: `Applied ${title.toLowerCase()} for ${rangeLabel(String(args.startDate), String(args.endDate))}`,
      read: `Check-back ${shortDate(String(args.checkBackAt))}`, checkBackAt: String(args.checkBackAt), affects: (Array.isArray(args.changes) ? args.changes : []).map((c: any) => String(c.exercise)),
      sourceRole: 'assistant', status: 'running',
      metric: { lift: args.measureLift ?? null, startDate: args.startDate, title: title.toLowerCase(), prevProgram: prev?.savedProgram ?? null },
    });
    await noteEvent(args.eventId, 'applied');
    return {
      result: { threadId: thread.id, summary: out.summary },
      inverse: { op: 'proactive.prepared_undo', args: { savedProgram: prev?.savedProgram ?? null, threadId: thread.id } },
      summary: `${title} applied · ${rangeLabel(String(args.startDate), String(args.endDate))}`,
    };
  },
});
defineOp({
  name: 'proactive.prepared_undo',
  run: async (userId, args) => {
    if (typeof args.savedProgram === 'string') { const raw = getOp('program.set_raw'); if (raw) await raw.run(userId, { savedProgram: args.savedProgram }); }
    if (typeof args.threadId === 'string') await resolveThread(userId, args.threadId, 'Undone', 'closed');
    return { inverse: null, summary: 'Week restored' };
  },
});

/** B4/B6: sent to the coach. Opens the B7 question for the next evening. */
defineOp({
  name: 'proactive.coach_sent',
  run: async (userId, args) => {
    const title = String(args.title ?? 'Change');
    const tomorrow = addDays(new Date().toISOString().slice(0, 10), 1);
    const thread = await createThread(userId, {
      kind: 'question', title: `Did your coach get back to you about ${title.toLowerCase()}?`, sourceQuote: `Sent ${title.toLowerCase()} to your coach`,
      read: 'I’ll leave the week as it is until you tell me what they said.', checkBackAt: tomorrow, sourceRole: 'assistant',
      metric: { pendingProgram: args.program ?? null, prevProgram: args.prevProgram ?? null, title: title.toLowerCase(), startDate: args.startDate, endDate: args.endDate, checkBackAt: args.checkBackAt, measureLift: args.measureLift ?? null, changes: args.changes ?? [] },
    });
    await noteEvent(args.eventId, 'answered');
    if (args.via === 'inbox') {
      // Coach on Axiom: the inbox is built later; record the hand-off so nothing is lost.
      await prisma.proactiveEvent.create({ data: { userId, kind: 'prepared', topic: title.toLowerCase(), threadId: thread.id, channel: 'coach_inbox', text: shareText({ title, startDate: String(args.startDate), endDate: String(args.endDate), rationale: '', changes: Array.isArray(args.changes) ? args.changes : [], checkBackAt: String(args.checkBackAt) }) } });
    }
    return { result: { threadId: thread.id }, inverse: null, summary: `${title} sent to your coach` };
  },
});

/** B7 answers. */
defineOp({
  name: 'proactive.coach_reply',
  run: async (userId, args) => {
    const value = String(args.value ?? '');
    const threadId = String(args.threadId ?? '');
    const t = await getThread(userId, threadId);
    let metric: any = {};
    try { metric = t?.metricJson ? JSON.parse(t.metricJson) : {}; } catch { metric = {}; }
    if (/^Yes/.test(value)) {
      if (!metric.pendingProgram) throw new Error('I don’t have that week saved any more.');
      const replace = getOp('program.replace');
      const prev = await prisma.user.findUnique({ where: { id: userId }, select: { savedProgram: true } });
      await replace!.run(userId, { program: metric.pendingProgram, summary: `${metric.title} · as sent` });
      await resolveThread(userId, threadId, 'Applied by your coach');
      const exp = await createThread(userId, { kind: 'experiment', title: String(metric.title ?? 'change').replace(/^./, (c: string) => c.toUpperCase()), sourceQuote: 'Applied by your coach, as sent', checkBackAt: String(metric.checkBackAt ?? addDays(new Date().toISOString().slice(0, 10), 7)), sourceRole: 'assistant', status: 'running', affects: (metric.changes ?? []).map((c: any) => String(c.exercise)), metric: { lift: metric.measureLift ?? null, startDate: metric.startDate, title: metric.title, prevProgram: prev?.savedProgram ?? null } });
      return { result: { line: 'Applied by your coach', sendAsMessage: null, threadId: exp.id }, inverse: { op: 'proactive.prepared_undo', args: { savedProgram: prev?.savedProgram ?? null, threadId: exp.id } }, summary: `${metric.title} applied as sent` };
    }
    if (/changed/.test(value)) {
      await resolveThread(userId, threadId, 'Edited by your coach');
      return { result: { line: 'Edited by your coach — open Training to put their version in', sendAsMessage: 'My coach changed the week. Let me tell you what they set.' }, inverse: null, summary: 'Coach edited the week' };
    }
    if (/said no/.test(value)) {
      await resolveThread(userId, threadId, 'Your coach kept the week', 'closed');
      return { result: { line: 'Your coach kept the week', sendAsMessage: null }, inverse: null, summary: 'Coach kept the week' };
    }
    // No answer yet: wait two days, then it expires (B5) by closing quietly.
    const next = addDays(new Date().toISOString().slice(0, 10), 2);
    if (t && t.raisedCount >= 2) { await resolveThread(userId, threadId, 'No answer — expired', 'closed'); return { result: { line: 'No answer — I’ll leave it', sendAsMessage: null }, inverse: null, summary: 'Coach follow-up expired' }; }
    await updateThread(userId, threadId, { checkBackAt: next });
    return { result: { line: `No answer yet — I’ll ask once more on ${shortDate(next)}`, sendAsMessage: null }, inverse: null, summary: 'Waiting on the coach' };
  },
});

/** B5 re-offer answer. */
defineOp({
  name: 'proactive.reoffer',
  run: async (_userId, args) => {
    const value = String(args.value ?? '');
    await noteEvent(args.eventId, /^Yes/.test(value) ? 'answered' : 'not_now');
    return /^Yes/.test(value)
      ? { inverse: null, summary: 'Lighter rest of week requested', result: { line: value, sendAsMessage: `Make the rest of this week lighter — ${args.from} to ${args.to}. Keep the days, drop the volume.` } }
      : { inverse: null, summary: 'Train as planned', result: { line: 'Training as planned', sendAsMessage: null } };
  },
});
