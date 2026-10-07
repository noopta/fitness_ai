// The morning briefing's rules. Deterministic and side-effect free: given a
// snapshot of the practice, decide who needs the trainer, why, and what the
// evidence is. The language model never makes these claims — it is only asked
// afterwards to word the suggested message (see drafts.ts), which is why every
// item here always has reasons and sources (handoff §2.2).

import { checkContraindications, type GuardrailResult } from './guardrails.js';
import { LIFT_LABEL, liftHistory, liftKeyOf, liftMentioned, liftTrend, prEvents, weeklyBest } from './lifts.js';
import { painMention } from './signals.js';
import type { ClientData, PracticeData } from './data.js';
import type { Client, LiftKey, Severity, SourceRef, Tier } from './types.js';

const DAY_MS = 86_400_000;
const PLATEAU_WEEKS = 6;
const PAIN_WINDOW_DAYS = 14;

export interface Candidate {
  clientId: string;
  ruleId: string;
  eventType: string;
  severity: Severity;
  priority: number;
  headline: string;
  detail: string;
  reasons: string[];
  sources: SourceRef[];
  primaryLabel: string;
  /** What the drafted message is for, the facts it may use, and the wording used when the model is unavailable. */
  draft: { purpose: string; facts: string[]; fallback: string };
  /** A draft that already exists for this (a check-in reply) — reuse it rather than writing another. */
  existingDraftId?: string;
  guardrail?: GuardrailResult;
  dataThrough: Date;
}

export interface EngineOptions {
  /** Format a canonical kg value in the trainer's unit. */
  fmt: (kg: number) => string;
  tierOf: (eventType: string, clientId: string) => Tier;
  /** Check-in reply drafts keyed by check-in id. */
  checkInDraftIds?: Map<string, string>;
}

const firstName = (c: Client) => c.name.split(' ')[0];
const daysSince = (d: Date, now: Date) => Math.floor((now.getTime() - d.getTime()) / DAY_MS);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const shortDay = (d: Date) => `${d.getDate()} ${MONTHS[d.getMonth()]}`;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const quote = (s: string, max = 140) => `"${s.length > max ? `${s.slice(0, max - 1)}…` : s}"`;
const injuryReasons = (c: Client) =>
  c.contraindications.filter((x) => x.active).map((x) => `Active injury on file: ${x.label}`);
const injurySources = (c: Client): SourceRef[] =>
  c.contraindications.some((x) => x.active) ? [{ kind: 'intake', id: c.id, label: 'Injuries on file' }] : [];

type Rule = (c: Client, d: ClientData, now: Date, o: EngineOptions) => Candidate | null;

// BRF-PAIN — the client wrote about pain in the last two weeks and has not heard back since.
// The window is deliberately long: a pain mention nobody answered gets more urgent with age, not less.
const pain: Rule = (c, d, now) => {
  const since = now.getTime() - PAIN_WINDOW_DAYS * DAY_MS;
  const lastFromTrainer = [...d.messages].reverse().find((m) => !m.fromClient)?.createdAt.getTime() ?? 0;
  const found: { at: Date; snippet: string; where: string; source: SourceRef }[] = [];

  for (const m of d.messages) {
    if (!m.fromClient || m.createdAt.getTime() < since) continue;
    const snippet = painMention(m.body);
    if (snippet) found.push({ at: m.createdAt, snippet, where: 'a message', source: { kind: 'message', id: m.id, label: `Message, ${shortDay(m.createdAt)}` } });
  }
  for (const w of d.workouts) {
    if (w.createdAt.getTime() < since) continue;
    const snippet = painMention(w.notes);
    if (snippet) found.push({ at: w.createdAt, snippet, where: 'a workout note', source: { kind: 'session', id: w.id, label: `${w.title?.trim() || 'Workout'}, ${shortDay(w.createdAt)}` } });
  }
  for (const k of d.checkIns) {
    if (!k.submittedAt || k.submittedAt.getTime() < since || !k.answersJson) continue;
    let answers: { answer?: string }[] = [];
    try { answers = JSON.parse(k.answersJson); } catch { /* unreadable answers carry no signal */ }
    const snippet = answers.map((a) => painMention(a.answer)).find(Boolean);
    if (snippet) found.push({ at: k.submittedAt, snippet, where: 'a check-in', source: { kind: 'checkin', id: k.id, label: `Check-in, ${shortDay(k.submittedAt)}` } });
  }

  const fresh = found.filter((f) => f.at.getTime() > lastFromTrainer).sort((a, b) => b.at.getTime() - a.at.getTime());
  if (fresh.length === 0) return null;
  const top = fresh[0];
  const name = firstName(c);
  return {
    clientId: c.id, ruleId: 'BRF-PAIN', eventType: 'painReported', severity: 'attention', priority: 100,
    headline: `${name} mentioned pain`,
    detail: `${quote(top.snippet)} — in ${top.where} on ${shortDay(top.at)}.`,
    reasons: [
      ...fresh.map((f) => `Wrote ${quote(f.snippet, 100)} in ${f.where} on ${shortDay(f.at)}`),
      ...injuryReasons(c),
      'You have not messaged them since',
    ],
    sources: [...fresh.map((f) => f.source), ...injurySources(c)],
    primaryLabel: top.where === 'a message' ? 'Send reply' : 'Send message',
    draft: {
      purpose: 'reply to a client who mentioned pain; acknowledge it, tell them to ease off, say you will adjust the plan',
      facts: [`They wrote: ${top.snippet}`, ...c.contraindications.filter((x) => x.active).map((x) => `Known injury: ${x.label}`)],
      fallback: `Thanks for telling me, ${name}. Ease off anything that aggravates it for now and do not push through pain. I will adjust this week's plan and check in with you tomorrow.`,
    },
    guardrail: checkContraindications(c.contraindications, null),
    dataThrough: top.at,
  };
};

// BRF-UNANSWERED — the last word in the thread is the client's.
const unanswered: Rule = (c, d, now) => {
  const last = d.messages[d.messages.length - 1];
  if (!last?.fromClient) return null;
  const days = daysSince(last.createdAt, now);
  const name = firstName(c);
  return {
    clientId: c.id, ruleId: 'BRF-UNANSWERED', eventType: 'messageWaiting', severity: 'attention', priority: 90,
    headline: `${name} is waiting on a reply`,
    detail: `${quote(last.body)} — sent ${days === 0 ? 'today' : `${plural(days, 'day')} ago`}.`,
    reasons: [`Their message of ${shortDay(last.createdAt)} is the last one in your thread`],
    sources: [{ kind: 'message', id: last.id, label: `Message, ${shortDay(last.createdAt)}` }],
    primaryLabel: 'Send reply',
    draft: {
      purpose: 'reply to the client message below',
      facts: [`They wrote: ${last.body.slice(0, 400)}`],
      fallback: `Thanks for the message, ${name}. I have read it and will come back to you properly today.`,
    },
    dataThrough: last.createdAt,
  };
};

// BRF-CHECKIN — a submitted check-in the analysis flagged and nobody has reviewed.
const flaggedCheckIn: Rule = (c, d, _now, o) => {
  const k = [...d.checkIns].reverse().find((x) => x.status === 'submitted' && !x.reviewedAt && x.classification && x.classification !== 'routine');
  if (!k?.submittedAt) return null;
  const draftId = o.checkInDraftIds?.get(k.id);
  if (!draftId) return null;
  const flag = k.classification === 'flag';
  return {
    clientId: c.id, ruleId: 'BRF-CHECKIN', eventType: 'checkInSubmitted', severity: flag ? 'attention' : 'look', priority: flag ? 85 : 65,
    headline: `${firstName(c)}'s check-in needs a look`,
    detail: k.summary ?? 'Submitted and not yet reviewed.',
    reasons: [`Check-in submitted ${shortDay(k.submittedAt)} was classified "${flag ? 'needs attention' : 'worth a look'}"`, ...(k.summary ? [k.summary] : [])],
    sources: [{ kind: 'checkin', id: k.id, label: `Check-in, ${shortDay(k.submittedAt)}` }],
    primaryLabel: 'Send reply',
    draft: { purpose: '', facts: [], fallback: '' },
    existingDraftId: draftId,
    dataThrough: k.submittedAt,
  };
};

// BRF-INACTIVE — a week or more without a logged session.
const inactive: Rule = (c, _d, now) => {
  if (!c.statusReason?.startsWith('No session logged')) return null;
  const anchor = new Date(c.lastSessionAt ?? c.joinedAt);
  const days = daysSince(anchor, now);
  const name = firstName(c);
  return {
    clientId: c.id, ruleId: 'BRF-INACTIVE', eventType: 'noSession7d', severity: days >= 10 ? 'attention' : 'look', priority: days >= 10 ? 80 : 60,
    headline: c.lastSessionAt ? `No session logged in ${plural(days, 'day')}` : `No session logged since joining`,
    detail: c.lastSessionAt
      ? `Last session was ${shortDay(anchor)}.${c.program ? ` ${c.program.blockLabel}, week ${c.program.week} of ${c.program.weeks}.` : ''}`
      : `Joined ${shortDay(anchor)} and has not logged a session yet.`,
    reasons: [c.statusReason, ...(c.program ? [`Program expects sessions each week (${c.program.blockLabel}, week ${c.program.week})`] : [])],
    sources: [{ kind: 'rule', id: 'PT-STATUS-01', label: 'No session in 7 days' }],
    primaryLabel: 'Send message',
    draft: {
      purpose: 'check in with a client who has not logged a session for a while; no guilt, offer to adjust the plan',
      facts: [c.lastSessionAt ? `Days since last logged session: ${days}` : `Joined ${days} days ago and has not logged a session`],
      fallback: c.lastSessionAt
        ? `Hi ${name}, it has been ${plural(days, 'day')} since your last logged session. Is anything getting in the way? Tell me what your week looks like and I will adjust the plan to fit.`
        : `Hi ${name}, I have not seen a first session come through yet. Is anything unclear in the plan? Tell me what your week looks like and we will find a day to start.`,
    },
    dataThrough: anchor,
  };
};

// BRF-ENGAGEMENT — engagement halved against the client's own baseline.
const engagementDrop: Rule = (c, _d, now) => {
  if (!c.statusReason?.startsWith('Engagement down')) return null;
  const name = firstName(c);
  return {
    clientId: c.id, ruleId: 'BRF-ENGAGEMENT', eventType: 'engagementDrop', severity: 'look', priority: 55,
    headline: 'Engagement has dropped',
    detail: `${c.statusReason}.`,
    reasons: [c.statusReason, `Weekly engagement, last 8 weeks: ${c.engagement8w.join(', ')}`],
    sources: [{ kind: 'rule', id: 'PT-STATUS-02', label: 'Engagement halved against own baseline' }],
    primaryLabel: 'Send message',
    draft: {
      purpose: 'check in with a client whose training has dipped; offer to reduce the schedule for a while',
      facts: ['Sessions and logging have roughly halved over the last two weeks compared with the month before'],
      fallback: `Hi ${name}, your training has dipped over the last two weeks compared with the month before. If life is busy we can drop to fewer sessions for a while. What would be realistic right now?`,
    },
    dataThrough: now,
  };
};

// BRF-RECOVERY — the client reported high stress and low energy this week.
const recovery: Rule = (c, d, now) => {
  const w = d.wellness[d.wellness.length - 1];
  // Both answered, or no flag — a blank is never read as high stress or low energy.
  if (!w || w.stress == null || w.energy == null || daysSince(w.createdAt, now) >= 7 || w.stress < 4 || w.energy > 2) return null;
  const name = firstName(c);
  return {
    clientId: c.id, ruleId: 'BRF-RECOVERY', eventType: 'recoveryTrend', severity: 'look', priority: 50,
    headline: 'High stress and low energy reported',
    detail: `Wellness check-in on ${shortDay(w.createdAt)}: stress ${w.stress}/5, energy ${w.energy}/5, sleep ${w.sleepHours} h.`,
    reasons: [`Stress ${w.stress}/5 and energy ${w.energy}/5 on ${shortDay(w.createdAt)}`, `Slept ${w.sleepHours} h`],
    sources: [{ kind: 'checkin', id: w.id, label: `Wellness check-in, ${shortDay(w.createdAt)}` }],
    primaryLabel: 'Send message',
    draft: {
      purpose: 'respond to a client who reported high stress and low energy; suggest keeping sessions light rather than skipping',
      facts: [`Stress ${w.stress} out of 5`, `Energy ${w.energy} out of 5`, `Sleep ${w.sleepHours} hours`],
      fallback: `Thanks for the honest check-in, ${name}. With stress high and energy low I would rather you keep this week's sessions light than skip them. Take the loads down and stop each set a rep or two early. How has sleep been?`,
    },
    dataThrough: w.createdAt,
  };
};

// BRF-PLATEAU — PLAT-03 on a main lift the client is still training.
const plateau: Rule = (c, d, now, o) => {
  for (const lift of ['squat', 'bench', 'deadlift'] as LiftKey[]) {
    const history = liftHistory(d.workouts, lift);
    const latest = history[history.length - 1];
    if (!latest || daysSince(latest.at, now) > 14) continue;
    const trend = liftTrend(weeklyBest(history, PLATEAU_WEEKS, now));
    if (trend.status !== 'plateau' || trend.latestKg === null) continue;
    const guardrail = checkContraindications(c.contraindications, lift);
    const label = LIFT_LABEL[lift].toLowerCase();
    const name = firstName(c);
    const blocked = guardrail.conflicts.length > 0;
    return {
      clientId: c.id, ruleId: 'BRF-PLATEAU', eventType: blocked ? 'guardrailBlocked' : 'plateau', severity: 'look', priority: 40,
      headline: `${LIFT_LABEL[lift]} has stalled`,
      detail: `Estimated 1RM has held at ${o.fmt(trend.latestKg)} across ${trend.exposures} of the last ${PLATEAU_WEEKS} weeks.${blocked ? ` No load increase suggested: ${guardrail.conflicts.join(', ')} on file.` : ''}`,
      reasons: [
        `Estimated 1RM changed by under 1 kg over ${trend.exposures} weekly exposures (rule PLAT-03)`,
        ...(blocked ? [`A load increase was ruled out by an active injury: ${guardrail.conflicts.join(', ')}`] : []),
      ],
      sources: [{ kind: 'rule', id: 'PLAT-03', label: 'Plateau rule' }, { kind: 'session', id: latest.logId, label: `Latest ${label} session, ${shortDay(latest.at)}` }, ...(blocked ? injurySources(c) : [])],
      primaryLabel: 'Send message',
      draft: {
        purpose: blocked
          ? 'tell a client their lift has stalled and that you are holding the load because of their injury, progressing accessories instead'
          : 'tell a client their lift has stalled and that you will change the approach in the next block',
        facts: [`Lift: ${label}`, `Estimated 1RM has held at ${o.fmt(trend.latestKg)} for about ${PLATEAU_WEEKS} weeks`, ...(blocked ? [`Active injury: ${guardrail.conflicts.join(', ')}`] : [])],
        fallback: blocked
          ? `${name}, your ${label} has held at around ${o.fmt(trend.latestKg)} for a few weeks. I am keeping the load where it is while your ${guardrail.conflicts[0].toLowerCase()} settles, and we will progress the accessories instead.`
          : `${name}, your ${label} has held at around ${o.fmt(trend.latestKg)} for a few weeks. I want to change the stimulus rather than keep grinding the same load, so I will adjust the next block and explain the plan.`,
      },
      guardrail,
      dataThrough: latest.at,
    };
  }
  return null;
};

// BRF-PROPOSAL — Axiom proposed a program change and the client has sat on it.
const proposal: Rule = (c, d, now) => {
  const p = d.proposals.find((x) => daysSince(x.createdAt, now) >= 3);
  if (!p) return null;
  const guardrail = checkContraindications(c.contraindications, liftMentioned(p.title));
  const blocked = guardrail.conflicts.length > 0;
  const name = firstName(c);
  const days = daysSince(p.createdAt, now);
  return {
    clientId: c.id, ruleId: 'BRF-PROPOSAL', eventType: blocked ? 'guardrailBlocked' : 'anakinSuggestion', severity: 'look', priority: 35,
    headline: `A suggested program change is waiting on ${name}`,
    detail: `${quote(p.title, 90)} — proposed ${plural(days, 'day')} ago. ${p.reasoning}`,
    reasons: [
      `Axiom proposed ${quote(p.title, 90)} on ${shortDay(p.createdAt)} and it has not been accepted or declined`,
      ...(blocked ? [`It touches a lift an active injury loads: ${guardrail.conflicts.join(', ')}`] : []),
    ],
    sources: [{ kind: 'program', id: p.id, label: `Program suggestion, ${shortDay(p.createdAt)}` }, ...(blocked ? injurySources(c) : [])],
    primaryLabel: 'Send recommendation',
    draft: {
      purpose: blocked
        ? 'tell the client to hold off on a suggested program change because of their injury'
        : 'tell the client you agree with a suggested program change and they can accept it in the app',
      facts: [`Suggested change: ${p.title}`, `Reason given: ${p.reasoning}`, ...(blocked ? [`Active injury: ${guardrail.conflicts.join(', ')}`] : [])],
      fallback: blocked
        ? `${name}, Axiom suggested "${p.title}" in your app. I would hold off on that one while your ${guardrail.conflicts[0].toLowerCase()} settles. Leave it for now and we will revisit it together.`
        : `${name}, Axiom suggested "${p.title}" in your app. I agree with it. Have a look and accept it when you are ready.`,
    },
    guardrail,
    dataThrough: p.createdAt,
  };
};

// BRF-PR — a personal record in the last day and a half.
const pr: Rule = (c, d, now, o) => {
  const recent = prEvents(d.workouts).filter((e) => now.getTime() - e.at.getTime() <= 1.5 * DAY_MS);
  if (recent.length === 0) return null;
  // Lead with a main lift when one of the records is on it; a row PR is not the headline next to a squat PR.
  const top = [...recent].reverse().find((e) => liftKeyOf(e.lift)) ?? recent[recent.length - 1];
  const name = firstName(c);
  return {
    clientId: c.id, ruleId: 'BRF-PR', eventType: 'pr', severity: 'look', priority: 20,
    headline: `New PR: ${top.lift}`,
    detail: `Estimated 1RM of ${o.fmt(top.e1rm)} on ${shortDay(top.at)}${recent.length > 1 ? `, plus ${plural(recent.length - 1, 'other PR')}` : ''}.`,
    reasons: recent.map((e) => `${e.lift}: estimated 1RM ${o.fmt(e.e1rm)} beat the previous best`),
    sources: recent.map((e) => ({ kind: 'session' as const, id: e.logId, label: `Session, ${shortDay(e.at)}` })),
    primaryLabel: 'Send congratulations',
    draft: {
      purpose: 'congratulate a client on a personal record, briefly, and tell them to keep the same approach',
      facts: [`Lift: ${top.lift}`, `New estimated 1RM: ${o.fmt(top.e1rm)}`],
      fallback: `Nice work on the ${top.lift.toLowerCase()} PR, ${name}. That is the consistency paying off. Same approach next week.`,
    },
    dataThrough: top.at,
  };
};

// BRF-MISSED — a check-in went unanswered through the nudge.
const missedCheckIn: Rule = (c, d, now) => {
  const missed = d.checkIns.filter((k) => k.status === 'missed');
  const last = missed[missed.length - 1];
  if (!last || daysSince(last.dueAt, now) > 10) return null;
  // Counted from the most recent backwards: a submitted one in between resets it.
  let streak = 0;
  for (const k of [...d.checkIns].reverse()) {
    if (k.status === 'missed') streak += 1;
    else if (k.status === 'submitted') break;
  }
  const name = firstName(c);
  return {
    clientId: c.id, ruleId: 'BRF-MISSED', eventType: 'missedCheckIn', severity: streak >= 2 ? 'attention' : 'look', priority: streak >= 2 ? 75 : 45,
    headline: streak >= 2 ? `${name} has missed ${streak} check-ins in a row` : `${name} missed their check-in`,
    detail: `Due ${shortDay(last.dueAt)}.${last.nudgedAt ? ' Nudged, no reply.' : ''}${streak >= 2 ? ' Automatic nudges are paused until you decide what to do.' : ''}`,
    reasons: [`Check-in due ${shortDay(last.dueAt)} was not submitted`, ...(last.nudgedAt ? [`Automatic nudge sent ${shortDay(last.nudgedAt)}, no reply`] : [])],
    sources: [{ kind: 'checkin', id: last.id, label: `Check-in due ${shortDay(last.dueAt)}` }],
    primaryLabel: 'Send nudge',
    draft: {
      purpose: 'gently ask a client who missed their check-in for a short update; no pressure',
      facts: [`Check-ins missed in a row: ${streak}`],
      fallback: `Hi ${name}, I did not get your check-in this week. No pressure. A two-line update on how training and energy have been is plenty.`,
    },
    dataThrough: last.dueAt,
  };
};

const RULES: Rule[] = [pain, unanswered, flaggedCheckIn, inactive, missedCheckIn, engagementDrop, recovery, plateau, proposal, pr];

/** Every rule that fires for one client, strongest first. */
export function candidatesFor(c: Client, d: ClientData, now: Date, o: EngineOptions): Candidate[] {
  return RULES
    .map((rule) => rule(c, d, now, o))
    .filter((x): x is Candidate => x !== null && o.tierOf(x.eventType, c.id) !== 'timeline')
    .sort((a, b) => b.priority - a.priority);
}

export interface BriefingPlan {
  items: Candidate[];
  onPlanClientIds: string[];
  summary: { attention: number; look: number; onPlan: number };
}

/**
 * One card per client: the strongest rule leads, and anything else that fired
 * for them is folded into its evidence so the trainer sees the whole picture
 * on one card instead of three.
 */
export function planBriefing(data: PracticeData, o: EngineOptions): BriefingPlan {
  const items: Candidate[] = [];
  const onPlanClientIds: string[] = [];
  for (const c of data.clients) {
    const [lead, ...rest] = candidatesFor(c, data.byClient.get(c.id)!, data.now, o);
    if (!lead) { onPlanClientIds.push(c.id); continue; }
    const seen = new Set(lead.sources.map((s) => `${s.kind}:${s.id}`));
    items.push({
      ...lead,
      severity: rest.some((r) => r.severity === 'attention') ? 'attention' : lead.severity,
      reasons: [...lead.reasons, ...rest.map((r) => `Also: ${r.headline}`)],
      sources: [...lead.sources, ...rest.flatMap((r) => r.sources).filter((s) => !seen.has(`${s.kind}:${s.id}`) && seen.add(`${s.kind}:${s.id}`))],
    });
  }
  items.sort((a, b) => (a.severity === b.severity ? b.priority - a.priority : a.severity === 'attention' ? -1 : 1));
  return {
    items,
    onPlanClientIds,
    summary: { attention: items.filter((i) => i.severity === 'attention').length, look: items.filter((i) => i.severity === 'look').length, onPlan: onPlanClientIds.length },
  };
}
