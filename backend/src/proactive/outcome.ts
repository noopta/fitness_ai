// Outcome reports (design B3): after a change ran, Anakin compares what was
// logged before and after and says how it went — in one of five states, with
// copy that says "fits", never "worked":
//
//   too_few     fewer sessions than needed → "Too early to call…"
//   no_change   the move is inside the normal session-to-session swing
//   fits        up by more than the swing, nothing else moved, no flags
//   worse       down by more than the swing, or the exercise got flagged twice
//   confounded  up — but something else changed the same week
//
// classifyOutcome is pure; buildOutcomeInput reads the rows.

import { PrismaClient } from '@prisma/client';
import type { CardDraft } from '../agent/cards/types.js';
import { defineOp, getOp, revertChange } from '../agent/ops.js';
import { loadTrainingHistory } from '../services/trainingSummary.js';
import { addDays, exerciseTouches, getThread, parseList, resolveThread, shortDate, updateThread, type ThreadRow } from './threads.js';

const prisma = new PrismaClient();

export type OutcomeState = 'too_few' | 'no_change' | 'fits' | 'worse' | 'confounded';

export interface Point { date: string; e1rmKg: number }
export interface Confounder { label: string; delta: string; from: string }
export interface OutcomeInput {
  title: string;        // "the second pull day"
  lift: string;         // display name of the lift measured
  unit: 'lb' | 'kg';
  startDate: string;    // when the change landed
  today: string;
  before: Point[];      // ascending, up to the change
  after: Point[];       // ascending, since the change
  /** Sessions of the lift needed before a call (design: 6). */
  needed: number;
  flagsAfter: number;
  flagsBefore: number;
  confounders: Confounder[];
  ratio?: { label: string; before: string; after: string } | null;
}

export interface OutcomeResult {
  state: OutcomeState;
  /** Change vs the baseline, as a fraction (0.06 = +6%). */
  pct: number;
  swing: number;
  /** kg per week, from the linear slope over each window. */
  rateBefore: number | null;
  rateAfter: number | null;
  baselineKg: number;
  latestKg: number;
}

export const NEEDED_SESSIONS = 6;
const MIN_SWING = 0.02;

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : 0; };

/** kg/week from a least-squares slope over dated points. Null with < 2 points. */
export function weeklyRate(points: Point[]): number | null {
  if (points.length < 2) return null;
  const t0 = Date.parse(`${points[0].date}T00:00:00Z`);
  const xs = points.map((p) => (Date.parse(`${p.date}T00:00:00Z`) - t0) / (7 * 86_400_000));
  const ys = points.map((p) => p.e1rmKg);
  const mx = mean(xs), my = mean(ys);
  const den = xs.reduce((a, x) => a + (x - mx) ** 2, 0);
  if (den === 0) return 0;
  return xs.reduce((a, x, i) => a + (x - mx) * (ys[i] - my), 0) / den;
}

/** The typical session-to-session move before the change, as a fraction (≥ 2%). */
export function normalSwing(before: Point[]): number {
  const moves: number[] = [];
  for (let i = 1; i < before.length; i++) if (before[i - 1].e1rmKg > 0) moves.push(Math.abs(before[i].e1rmKg - before[i - 1].e1rmKg) / before[i - 1].e1rmKg);
  return Math.max(MIN_SWING, median(moves));
}

export function classifyOutcome(i: OutcomeInput): OutcomeResult {
  const baselineKg = i.before.length ? mean(i.before.slice(-3).map((p) => p.e1rmKg)) : (i.after[0]?.e1rmKg ?? 0);
  const latestKg = i.after.length ? mean(i.after.slice(-2).map((p) => p.e1rmKg)) : baselineKg;
  const pct = baselineKg > 0 ? (latestKg - baselineKg) / baselineKg : 0;
  const swing = normalSwing(i.before);
  const base = { pct, swing, rateBefore: weeklyRate(i.before), rateAfter: weeklyRate(i.after), baselineKg, latestKg };
  if (i.after.length < i.needed) return { state: 'too_few', ...base };
  if (i.flagsAfter >= 2 || pct <= -swing) return { state: 'worse', ...base };
  if (Math.abs(pct) <= swing) return { state: 'no_change', ...base };
  return { state: i.confounders.length ? 'confounded' : 'fits', ...base };
}

const toUnit = (kg: number, unit: 'lb' | 'kg') => Math.round(unit === 'kg' ? kg : kg * 2.20462);
const signed = (n: number) => `${n >= 0 ? '+' : '−'}${Math.abs(n)}`;
const pctText = (pct: number) => `${Math.abs(Math.round(pct * 100))}%`;
const weeksSince = (from: string, to: string) => Math.max(1, Math.round((Date.parse(to) - Date.parse(from)) / (7 * 86_400_000)));

/** The headline per state. Honest copy: "fits", "doesn't prove it", "I can't separate the two". */
export function outcomeHeadline(i: OutcomeInput, r: OutcomeResult): string {
  const lift = i.lift.toLowerCase().replace(/^chest-supported /, '');
  const wk = weeksSince(i.startDate, i.today);
  const period = wk === 1 ? 'A week' : wk === 2 ? 'Two weeks' : wk === 3 ? 'Three weeks' : `${wk} weeks`;
  switch (r.state) {
    case 'too_few': return `Too early to call ${i.title} — you've logged ${i.after.length} of the ${i.needed} I need.`;
    case 'no_change': return `${period} in, ${lift} is flat: ${toUnit(r.baselineKg, i.unit)} → ${toUnit(r.latestKg, i.unit)} ${i.unit}.`;
    case 'worse': return i.flagsAfter >= 2
      ? `Since ${i.title}, ${lift} is ${r.pct < 0 ? `down ${pctText(r.pct)}` : 'flat'} and you flagged it ${i.flagsAfter} times.`
      : `Since ${i.title}, ${lift} is down ${pctText(r.pct)}.`;
    case 'confounded': { const c = i.confounders[0]; return `${lift.charAt(0).toUpperCase()}${lift.slice(1)} is up ${pctText(r.pct)} — but your ${c.label} went ${c.delta} the same week.`; }
    default: return `${period} with ${i.title}: ${lift} up ${pctText(r.pct)}${i.flagsAfter === 0 && (i.flagsBefore > 0 || /elbow|knee|shoulder|hip|wrist|back/i.test(i.lift + i.title)) ? ', no flags' : ''}. That fits it working — it doesn't prove it. Keep it?`;
  }
}

export function outcomeSub(i: OutcomeInput, r: OutcomeResult): string | null {
  switch (r.state) {
    case 'too_few': return `I'll look again on ${shortDate(addDays(i.today, 14))}. Nothing changes until then.`;
    case 'no_change': return `That's inside your normal session-to-session swing. Not hurting, not clearly helping.`;
    case 'worse': return `Could be the change, could be everything else that week. Either way I'd take it out.`;
    case 'confounded': return `I can't separate the two. Keeping both is fine; testing one tells us which.`;
    default: return null;
  }
}

/** The B3 card: hero e1RM + the series with a marker where the change landed, rate before → after, flags, the decision. */
export function outcomeCard(i: OutcomeInput, r: OutcomeResult, ctx: { threadId: string; changeId: string | null; eventId: string }): CardDraft {
  const series = [...i.before, ...i.after].map((p) => toUnit(p.e1rmKg, i.unit));
  const rate = (x: number | null) => x == null ? '–' : `${signed(toUnit(x, i.unit))} ${i.unit}/wk`;
  const rows: CardDraft['rows'] = [];
  if (r.state !== 'too_few') rows.push({ key: 'Rate before → after', value: `${rate(r.rateBefore)} → ${rate(r.rateAfter)}` });
  if (r.state === 'no_change') rows.push({ key: `${i.lift} e1RM`, sub: `${shortDate(i.startDate)} → ${shortDate(i.today)}`, value: `${signed(toUnit(r.latestKg - r.baselineKg, i.unit))} ${i.unit}` });
  if (r.state !== 'too_few') rows.push({ key: 'Flags', value: `${i.flagsAfter} in ${i.after.length} sessions` });
  for (const c of i.confounders.slice(0, 2)) rows.push({ key: c.label.charAt(0).toUpperCase() + c.label.slice(1), value: `${c.delta} from ${shortDate(c.from)}`, mark: 'chg' });
  if (r.state === 'too_few') rows.push({ key: 'Sessions logged', value: `${i.after.length} of ${i.needed}` });

  const args = { threadId: ctx.threadId, changeId: ctx.changeId, eventId: ctx.eventId, title: i.title };
  const actions: Record<OutcomeState, { actions: CardDraft['actions']; pending: NonNullable<CardDraft['pending']>['actions'] }> = {
    fits: { actions: [{ id: 'keep', label: 'Keep it', kind: 'primary' }, { id: 'revert', label: 'Revert', kind: 'secondary' }],
      pending: { keep: { op: 'proactive.outcome_keep', args, status: 'kept', line: `Kept — ${i.title}` }, revert: { op: 'proactive.outcome_revert', args, status: 'applied', line: `Adjusted — ${i.title} reverted` } } },
    too_few: { actions: [{ id: 'wait', label: 'Give it 2 weeks', kind: 'primary' }, { id: 'drop', label: 'Drop it', kind: 'secondary' }],
      pending: { wait: { op: 'proactive.outcome_wait', args: { ...args, days: 14 }, status: 'kept', line: `Noted — I'll check again on ${shortDate(addDays(i.today, 14))}` }, drop: { op: 'proactive.outcome_revert', args, status: 'applied', line: `Adjusted — ${i.title} dropped` } } },
    no_change: { actions: [{ id: 'keep', label: 'Keep it', kind: 'primary' }, { id: 'else', label: 'What else could I try?', kind: 'secondary', client: { action: 'send_message', args: { text: `${i.title.charAt(0).toUpperCase()}${i.title.slice(1)} hasn't moved my ${i.lift.toLowerCase()}. What else could I try?` } } }],
      pending: { keep: { op: 'proactive.outcome_keep', args, status: 'kept', line: `Kept — ${i.title}` } } },
    worse: { actions: [{ id: 'apply', label: 'Apply', kind: 'primary' }, { id: 'later', label: 'Not this week', kind: 'secondary' }],
      pending: { apply: { op: 'proactive.outcome_revert', args, status: 'applied', line: `Adjusted — back to before ${i.title}` }, later: { kind: 'keep', line: 'Not this week' } } },
    confounded: { actions: [{ id: 'both', label: 'Keep both', kind: 'primary' }, { id: 'more', label: 'Tell me more', kind: 'secondary', client: { action: 'send_message', args: { text: `Tell me more about ${i.title} and the ${i.confounders[0]?.label ?? 'other change'} — which one is doing the work?` } } }],
      pending: { both: { op: 'proactive.outcome_keep', args, status: 'kept', line: `Kept both — ${i.title}` } } },
  };
  const a = actions[r.state];
  return {
    fn: 'PRO-03', pattern: 'proposal', rule: 'propose',
    meta: { label: `Result · ${i.title}` },
    ...(r.state === 'too_few' ? {} : { hero: { value: String(toUnit(r.latestKg, i.unit)), unit: i.unit, delta: `${signed(toUnit(r.latestKg - r.baselineKg, i.unit))} over ${weeksSince(i.startDate, i.today)} wk` }, line: series }),
    rows,
    why: outcomeSub(i, r) ?? undefined,
    actions: a.actions,
    pending: { actions: a.pending },
    entity: `outcome:${ctx.threadId}`,
  };
}

/** Receipts for the turn: what was compared. */
export function outcomeReceipts(i: OutcomeInput): { verb: string; text: string }[] {
  const r = [{ verb: 'Checked', text: `Compared ${i.after.length} session${i.after.length === 1 ? '' : 's'} of ${i.lift.toLowerCase()}` }];
  if (i.confounders.length) r.push({ verb: 'Checked', text: `${Math.min(21, Math.max(7, Math.round((Date.parse(i.today) - Date.parse(i.startDate)) / 86_400_000)))} days of meals` });
  return r;
}

// ── Loader ──────────────────────────────────────────────────────────────────

export interface ExperimentMetric { lift: string; startDate: string; changeId?: string | null; title?: string }

/** Read the thread's experiment metric and the rows around it. Null when the metric is missing or the lift was never logged. */
export async function buildOutcomeInput(userId: string, thread: ThreadRow, today: string, unit: 'lb' | 'kg'): Promise<OutcomeInput | null> {
  let metric: ExperimentMetric | null = null;
  try { metric = thread.metricJson ? JSON.parse(thread.metricJson) : null; } catch { metric = null; }
  if (!metric?.lift || !metric.startDate) return null;
  const history = await loadTrainingHistory(userId, addDays(metric.startDate, -60));
  const key = history.names.of(metric.lift).key;
  const exps = (history.exposures.get(key) ?? []).filter((e) => e.e1rmKg > 0).sort((a, b) => a.date.localeCompare(b.date));
  if (!exps.length) return null;
  const before = exps.filter((e) => e.date < metric!.startDate).slice(-8).map((e) => ({ date: e.date, e1rmKg: e.e1rmKg }));
  const after = exps.filter((e) => e.date >= metric!.startDate).map((e) => ({ date: e.date, e1rmKg: e.e1rmKg }));
  const affects = [...parseList(thread.affectsJson), history.displayName(key)];
  const flags = await prisma.sessionFlag.findMany({ where: { userId, date: { gte: addDays(metric.startDate, -28) } }, select: { date: true, exercise: true } });
  const touches = (ex: string) => exerciseTouches(affects, ex);
  const flagsAfter = flags.filter((f) => f.date >= metric!.startDate && touches(f.exercise)).length;
  const flagsBefore = flags.filter((f) => f.date < metric!.startDate && touches(f.exercise)).length;
  // Confounder: protein moved by ≥ 30 g/day between the 7 days before and the 7 after the change.
  const meals = await prisma.mealEntry.findMany({ where: { userId, date: { gte: addDays(metric.startDate, -7), lt: addDays(metric.startDate, 8) } }, select: { date: true, proteinG: true } });
  const byDay = (from: string, to: string) => { const m = new Map<string, number>(); for (const r of meals) if (r.date >= from && r.date < to) m.set(r.date, (m.get(r.date) ?? 0) + (r.proteinG ?? 0)); return [...m.values()]; };
  const pBefore = byDay(addDays(metric.startDate, -7), metric.startDate), pAfter = byDay(metric.startDate, addDays(metric.startDate, 8));
  const confounders: Confounder[] = [];
  if (pBefore.length >= 3 && pAfter.length >= 3) {
    const d = Math.round(mean(pAfter) - mean(pBefore));
    if (Math.abs(d) >= 30) confounders.push({ label: 'protein', delta: `${d > 0 ? 'up' : 'down'} ${Math.abs(d)} g a day`, from: metric.startDate });
  }
  return { title: metric.title ?? thread.title.toLowerCase(), lift: history.displayName(key), unit, startDate: metric.startDate, today, before, after, needed: NEEDED_SESSIONS, flagsAfter, flagsBefore, confounders };
}

// ── Ops ─────────────────────────────────────────────────────────────────────

const noteEvent = async (eventId: unknown, outcome: string) => { if (typeof eventId === 'string') await prisma.proactiveEvent.update({ where: { id: eventId }, data: { outcome, outcomeAt: new Date() } }).catch(() => {}); };

defineOp({
  name: 'proactive.outcome_keep',
  run: async (userId, args) => {
    const threadId = String(args.threadId ?? '');
    await resolveThread(userId, threadId, `Kept · ${String(args.title ?? 'the change')}`);
    await noteEvent(args.eventId, 'kept');
    return { inverse: null, summary: `Kept · ${String(args.title ?? 'the change')}` };
  },
});

defineOp({
  name: 'proactive.outcome_revert',
  run: async (userId, args) => {
    const changeId = typeof args.changeId === 'string' ? args.changeId : null;
    if (changeId) await revertChange(userId, changeId, { ignoreWindow: true });
    else {
      // No change id (the week was applied by the prepared-work op): the thread kept the program as it was.
      const t = await getThread(userId, String(args.threadId ?? ''));
      let prev: string | null = null;
      try { prev = t?.metricJson ? JSON.parse(t.metricJson).prevProgram ?? null : null; } catch { prev = null; }
      if (typeof prev === 'string') { const raw = getOp('program.set_raw'); if (raw) await raw.run(userId, { savedProgram: prev }); }
    }
    await resolveThread(userId, String(args.threadId ?? ''), `Reverted · ${String(args.title ?? 'the change')}`, 'closed');
    await noteEvent(args.eventId, 'reverted');
    // Reverting a revert = re-applying the original change; the change log knows how, but we keep it one-way here.
    return { inverse: null, summary: `Reverted · ${String(args.title ?? 'the change')}` };
  },
});

defineOp({
  name: 'proactive.outcome_wait',
  run: async (userId, args) => {
    const days = Number(args.days ?? 14);
    const today = new Date().toISOString().slice(0, 10);
    await updateThread(userId, String(args.threadId ?? ''), { checkBackAt: addDays(today, days) });
    await noteEvent(args.eventId, 'kept');
    return { inverse: null, summary: `Checking again in ${days} days` };
  },
});
