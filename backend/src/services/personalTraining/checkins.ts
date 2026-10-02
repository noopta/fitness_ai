// Trainer check-ins (handoff §6.4): a schedule of questions, the client's
// answers, what the analysis read in them, and the missed-check-in
// escalation. The analysis is deterministic so its summary can always show
// what it was based on.

import { prisma } from './db.js';
import { audit, createDraft, DraftError, requestSend, sendAutomated, toDraft, writeDraftText } from './drafts.js';
import { shortDay } from './briefingEngine.js';
import { painMention } from './signals.js';
import { DEFAULT_TZ, hourIn } from './status.js';
import type {
  CheckIn, CheckInInbox, CheckInQuestion, CheckInRequest, CheckInSchedule, CheckInSignal, Client, Evidence, MissedCheckIn,
} from './types.js';

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://axiomtraining.io';

export class CheckInError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'CheckInError';
    this.status = status;
  }
}

export const DEFAULT_QUESTIONS: CheckInQuestion[] = [
  { id: 'energy', text: 'How was your energy this week?', type: 'scale', signal: 'energy' },
  { id: 'sleep', text: 'How well did you sleep?', type: 'scale', signal: 'sleep' },
  { id: 'stress', text: 'How stressed have you felt?', type: 'scale', signal: 'stress' },
  { id: 'pain', text: 'Any pain or niggles?', type: 'text', signal: 'pain' },
  { id: 'notes', text: 'Anything else you want me to know?', type: 'text' },
];

const SCHEDULE_DEFAULTS = {
  frequency: 'weekly' as const, dayOfWeek: 0, hour: 18, nudgeAfterHours: 24, flagAfterHours: 48, pauseAfterMisses: 2, active: false,
};

type ScheduleRow = Awaited<ReturnType<typeof prisma.ptCheckInSchedule.findFirst>>;

const parseQuestions = (json: string | null | undefined): CheckInQuestion[] => {
  try {
    const q = JSON.parse(json ?? '');
    return Array.isArray(q) && q.length ? q : DEFAULT_QUESTIONS;
  } catch {
    return DEFAULT_QUESTIONS;
  }
};

function toSchedule(row: NonNullable<ScheduleRow>, clientName?: string): CheckInSchedule {
  return {
    id: row.id, clientId: row.clientId, ...(clientName ? { clientName } : {}),
    frequency: row.frequency === 'biweekly' ? 'biweekly' : 'weekly',
    dayOfWeek: row.dayOfWeek, hour: row.hour, questions: parseQuestions(row.questionsJson),
    nudgeAfterHours: row.nudgeAfterHours, flagAfterHours: row.flagAfterHours, pauseAfterMisses: row.pauseAfterMisses, active: row.active,
  };
}

/** The practice default first (synthesised, switched off, until a trainer saves one), then per-client overrides. */
export async function listSchedules(practiceId: string, clients: Client[]): Promise<CheckInSchedule[]> {
  const rows = await prisma.ptCheckInSchedule.findMany({ where: { practiceId }, orderBy: { createdAt: 'asc' } });
  const names = new Map(clients.map((c) => [c.id, c.name]));
  const fallback = rows.find((r) => r.clientId === null);
  return [
    fallback ? toSchedule(fallback) : { id: null, clientId: null, ...SCHEDULE_DEFAULTS, questions: DEFAULT_QUESTIONS },
    ...rows.filter((r) => r.clientId !== null && names.has(r.clientId)).map((r) => toSchedule(r, names.get(r.clientId!))),
  ];
}

export function validateSchedule(body: any): Omit<CheckInSchedule, 'id' | 'clientName'> {
  const fail = (m: string): never => { throw new CheckInError(m, 400); };
  const int = (v: unknown, lo: number, hi: number, name: string) =>
    Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi ? (v as number) : fail(`${name} must be between ${lo} and ${hi}`);

  if (!Array.isArray(body?.questions) || body.questions.length < 1 || body.questions.length > 12) fail('A check-in needs between 1 and 12 questions');
  const seen = new Set<string>();
  const questions: CheckInQuestion[] = body.questions.map((q: any, i: number) => {
    const text = typeof q?.text === 'string' ? q.text.trim() : '';
    if (text.length < 3 || text.length > 200) fail('Each question must be between 3 and 200 characters');
    if (!['text', 'scale', 'number'].includes(q?.type)) fail('Question type must be free text, scale or number');
    const signal = ['energy', 'sleep', 'stress', 'pain'].includes(q?.signal) ? q.signal : undefined;
    let id = typeof q?.id === 'string' && /^[\w-]{1,40}$/.test(q.id) ? q.id : `q${i + 1}`;
    while (seen.has(id)) id = `${id}-${i + 1}`;
    seen.add(id);
    return { id, text, type: q.type, ...(signal ? { signal } : {}) };
  });

  const nudgeAfterHours = int(body.nudgeAfterHours, 1, 168, 'Nudge delay');
  const flagAfterHours = int(body.flagAfterHours, 2, 336, 'Flag delay');
  if (flagAfterHours <= nudgeAfterHours) fail('A missed check-in must be flagged after the nudge, not before');
  return {
    clientId: typeof body.clientId === 'string' && body.clientId ? body.clientId : null,
    frequency: body.frequency === 'biweekly' ? 'biweekly' : 'weekly',
    dayOfWeek: int(body.dayOfWeek, 0, 6, 'Day'),
    hour: int(body.hour, 0, 23, 'Time'),
    questions,
    nudgeAfterHours,
    flagAfterHours,
    pauseAfterMisses: int(body.pauseAfterMisses, 1, 10, 'Misses before pausing'),
    active: body.active === true,
  };
}

export async function saveSchedule(practiceId: string, trainerId: string, body: any, clientIds: Set<string>): Promise<CheckInSchedule> {
  const s = validateSchedule(body);
  if (s.clientId && !clientIds.has(s.clientId)) throw new CheckInError('That client is not on your roster', 404);
  const data = {
    frequency: s.frequency, dayOfWeek: s.dayOfWeek, hour: s.hour, questionsJson: JSON.stringify(s.questions),
    nudgeAfterHours: s.nudgeAfterHours, flagAfterHours: s.flagAfterHours, pauseAfterMisses: s.pauseAfterMisses, active: s.active,
  };
  const existing = await prisma.ptCheckInSchedule.findFirst({ where: { practiceId, clientId: s.clientId } });
  const row = existing
    ? await prisma.ptCheckInSchedule.update({ where: { id: existing.id }, data })
    : await prisma.ptCheckInSchedule.create({ data: { practiceId, clientId: s.clientId, ...data } });
  await audit({ practiceId, trainerId, clientId: s.clientId, action: 'schedule_changed', itemType: 'schedule', itemId: row.id, meta: { active: s.active, frequency: s.frequency } });
  return toSchedule(row);
}

export async function deleteOverride(practiceId: string, trainerId: string, clientId: string) {
  const row = await prisma.ptCheckInSchedule.findFirst({ where: { practiceId, clientId } });
  if (!row) return;
  await prisma.ptCheckInSchedule.delete({ where: { id: row.id } });
  await audit({ practiceId, trainerId, clientId, action: 'schedule_changed', itemType: 'schedule', itemId: row.id, meta: { removed: true } });
}

// ── Due check-ins and the missed escalation ──────────────────────────────────

const weekdayIn = (tz: string, d: Date) =>
  ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: tz }).format(d));

/** The most recent `dayOfWeek` at `hour` (trainer's timezone) at or before `now`. */
export function lastOccurrence(dayOfWeek: number, hour: number, now: Date, tz: string = DEFAULT_TZ): Date {
  let t = Math.floor(now.getTime() / HOUR_MS) * HOUR_MS;
  for (let i = 0; i < 24 * 8; i++, t -= HOUR_MS) {
    const d = new Date(t);
    if (weekdayIn(tz, d) === dayOfWeek && hourIn(tz, d) === hour) return d;
  }
  return new Date(t);
}

const linkFor = (id: string) => `${FRONTEND_URL}/personal-training/check-in/${id}`;

/** Misses in a row, counting back from the most recent check-in; a submission resets it. */
export function missStreak(history: { status: string }[]): number {
  let n = 0;
  for (const k of [...history].reverse()) {
    if (k.status === 'missed') n += 1;
    else if (k.status === 'submitted') break;
  }
  return n;
}

async function createCheckIn(practiceId: string, trainerId: string, clientId: string, schedule: { id: string | null; questions: CheckInQuestion[] }, dueAt: Date) {
  const row = await prisma.ptCheckIn.create({
    data: { practiceId, clientId, scheduleId: schedule.id, questionsJson: JSON.stringify(schedule.questions), dueAt },
  });
  await sendAutomated({
    practiceId, trainerId, clientId, action: 'checkin_prompt', itemId: row.id,
    body: `Your check-in is ready. It takes about two minutes: ${linkFor(row.id)}`,
  });
  return row;
}

/**
 * Create the check-ins that have come due under the schedules a trainer has
 * switched on, and walk overdue ones through nudge → missed. Idempotent.
 */
export async function runCheckInSchedule(practiceId: string, trainerId: string, clients: Client[], now: Date = new Date(), tz: string = DEFAULT_TZ) {
  const schedules = await listSchedules(practiceId, clients);
  const fallback = schedules[0];
  const overrides = new Map(schedules.slice(1).map((s) => [s.clientId!, s]));
  const rows = await prisma.ptCheckInSchedule.findMany({ where: { practiceId }, select: { id: true, updatedAt: true } });
  const changedAt = new Map(rows.map((r) => [r.id, r.updatedAt]));
  const history = await prisma.ptCheckIn.findMany({
    where: { practiceId, clientId: { in: clients.map((c) => c.id) }, dueAt: { gte: new Date(now.getTime() - 60 * DAY_MS) } },
    orderBy: { dueAt: 'asc' },
  });

  let created = 0;
  for (const c of clients) {
    const s = overrides.get(c.id) ?? fallback;
    const mine = history.filter((k) => k.clientId === c.id);
    const thresholds = s;

    // Overdue: nudge once, then mark missed.
    for (const k of mine.filter((x) => x.status === 'due')) {
      const overdueH = (now.getTime() - k.dueAt.getTime()) / HOUR_MS;
      if (overdueH >= thresholds.flagAfterHours) {
        await prisma.ptCheckIn.updateMany({ where: { id: k.id, status: 'due' }, data: { status: 'missed' } });
        k.status = 'missed';
      } else if (!k.nudgedAt && overdueH >= thresholds.nudgeAfterHours && missStreak(mine) < thresholds.pauseAfterMisses) {
        const claimed = await prisma.ptCheckIn.updateMany({ where: { id: k.id, nudgedAt: null }, data: { nudgedAt: now } });
        if (claimed.count === 1) {
          await sendAutomated({
            practiceId, trainerId, clientId: c.id, action: 'checkin_nudge', itemId: k.id,
            body: `A quick reminder about your check-in: ${linkFor(k.id)}`,
          });
        }
      }
    }

    if (!s.active || !s.id) continue;
    // Two misses in a row: stop asking and leave it to the trainer (it shows in the briefing).
    if (missStreak(mine) >= s.pauseAfterMisses) continue;
    const due = lastOccurrence(s.dayOfWeek, s.hour, now, tz);
    // Never backfill an occurrence from before the schedule was switched on or last changed.
    if (due.getTime() < (changedAt.get(s.id)?.getTime() ?? 0)) continue;
    const last = mine[mine.length - 1];
    if (last && last.dueAt.getTime() >= due.getTime()) continue;
    if (s.frequency === 'biweekly' && last && due.getTime() - last.dueAt.getTime() < 10 * DAY_MS) continue;
    await createCheckIn(practiceId, trainerId, c.id, s, due);
    created += 1;
  }
  return created;
}

/** "Send check-in" from the roster or inbox: ask these clients now, whatever the schedule says. */
export async function requestCheckIns(practiceId: string, trainerId: string, clients: Client[], now: Date = new Date()) {
  const schedules = await listSchedules(practiceId, clients);
  const overrides = new Map(schedules.slice(1).map((s) => [s.clientId!, s]));
  const open = await prisma.ptCheckIn.findMany({ where: { practiceId, clientId: { in: clients.map((c) => c.id) }, status: 'due' }, select: { clientId: true } });
  const waiting = new Set(open.map((k) => k.clientId));
  let created = 0;
  for (const c of clients) {
    if (waiting.has(c.id)) continue; // already has one outstanding
    await createCheckIn(practiceId, trainerId, c.id, overrides.get(c.id) ?? schedules[0], now);
    created += 1;
  }
  return created;
}

// ── Analysis ─────────────────────────────────────────────────────────────────

export interface Analysis {
  classification: 'flag' | 'look' | 'routine';
  summary: string;
  signals: CheckInSignal[];
  evidence: Evidence;
  pain: string | null;
}

export function analyse(
  questions: CheckInQuestion[], answers: Record<string, string | number>, sessions: { logged: number; target: number }, checkInId: string,
): Analysis {
  const signals: CheckInSignal[] = [];
  const reasons: string[] = [];
  const note = (label: string, tone: CheckInSignal['tone'], reason?: string) => {
    signals.push({ label, tone });
    if (reason && tone !== 'green') reasons.push(reason);
  };

  for (const q of questions) {
    const v = Number(answers[q.id]);
    if (q.type !== 'scale' || !Number.isFinite(v)) continue;
    if (q.signal === 'energy') note(`Energy ${v}/5`, v <= 2 ? 'red' : v === 3 ? 'amber' : 'green', `Rated energy ${v} out of 5`);
    if (q.signal === 'sleep') note(`Sleep ${v}/5`, v <= 2 ? 'red' : v === 3 ? 'amber' : 'green', `Rated sleep ${v} out of 5`);
    if (q.signal === 'stress') note(`Stress ${v}/5`, v >= 4 ? 'red' : v === 3 ? 'amber' : 'green', `Rated stress ${v} out of 5`);
  }

  const { logged, target } = sessions;
  note(
    `${logged} of ${target} sessions`,
    logged >= target ? 'green' : logged * 2 >= target ? 'amber' : 'red',
    `Logged ${logged} of ${target} planned sessions in the last 7 days`,
  );

  const texts = questions.filter((q) => q.type === 'text').map((q) => String(answers[q.id] ?? ''));
  const pain = texts.map((t) => painMention(t)).find(Boolean) ?? null;
  if (pain) {
    signals.push({ label: 'Pain mentioned', tone: 'red' });
    reasons.push(`Wrote "${pain.length > 100 ? `${pain.slice(0, 99)}…` : pain}"`);
  } else if (questions.some((q) => q.signal === 'pain')) {
    signals.push({ label: 'No pain reported', tone: 'green' });
  }

  const reds = signals.filter((s) => s.tone === 'red').length;
  const ambers = signals.filter((s) => s.tone === 'amber').length;
  const classification = pain || reds >= 2 ? 'flag' : reds === 1 || ambers >= 2 ? 'look' : 'routine';

  const notable = signals.filter((s) => s.tone === 'red' || s.tone === 'amber').map((s) => s.label.charAt(0).toLowerCase() + s.label.slice(1));
  const summary = classification === 'routine'
    ? `Steady week: ${signals.filter((s) => s.tone === 'green').map((s) => s.label.charAt(0).toLowerCase() + s.label.slice(1)).join(', ')}.`
    : `${notable.join(', ').replace(/^./, (ch) => ch.toUpperCase())}.${pain ? ` They wrote: "${pain}"` : ''}`;

  return {
    classification,
    summary,
    signals,
    // A routine check-in still says what it was judged on.
    evidence: {
      reasons: reasons.length ? reasons : [`Logged ${logged} of ${target} planned sessions and reported nothing outside the normal range`],
      sources: [{ kind: 'checkin', id: checkInId, label: 'This check-in' }, { kind: 'session', id: 'last-7-days', label: 'Sessions logged in the last 7 days' }],
    },
    pain,
  };
}

function replyFallback(firstName: string, a: Analysis): string {
  if (a.pain) return `Thanks for telling me, ${firstName}. Ease off anything that aggravates it and do not push through pain. I will adjust the plan and check in with you tomorrow.`;
  if (a.classification === 'flag') return `Thanks for being straight with me, ${firstName}. This reads like a week to pull back. Take the loads down and prioritise sleep, and I will lighten the plan.`;
  if (a.classification === 'look') return `Thanks for the check-in, ${firstName}. Let us keep this week manageable: hit the main lifts and leave the rest if you are short on time or energy.`;
  return `Thanks for checking in, ${firstName}. Solid week. Keep doing what you are doing and we will stay on plan.`;
}

// ── Client side ──────────────────────────────────────────────────────────────

async function practiceTrainer(practiceId: string) {
  const coach = await prisma.institutionMember.findFirst({
    where: { institutionId: practiceId, role: 'coach', active: true },
    orderBy: { joinedAt: 'asc' },
    select: { userId: true, user: { select: { name: true } }, institution: { select: { name: true } } },
  });
  if (!coach) throw new CheckInError('This practice has no trainer', 409);
  return coach;
}

export async function getRequest(checkInId: string, userId: string): Promise<CheckInRequest> {
  const row = await prisma.ptCheckIn.findUnique({ where: { id: checkInId } });
  // Someone else's check-in does not exist as far as this user is concerned.
  if (!row || row.clientId !== userId) throw new CheckInError('Check-in not found', 404);
  const coach = await practiceTrainer(row.practiceId);
  return {
    id: row.id, practiceName: coach.institution.name, trainerName: coach.user.name?.trim() || 'Your trainer',
    status: row.status as CheckInRequest['status'], dueAt: row.dueAt.toISOString(), questions: parseQuestions(row.questionsJson),
  };
}

export async function submitCheckIn(checkInId: string, userId: string, rawAnswers: unknown, now: Date = new Date()) {
  const row = await prisma.ptCheckIn.findUnique({ where: { id: checkInId } });
  if (!row || row.clientId !== userId) throw new CheckInError('Check-in not found', 404);
  if (row.status === 'submitted') throw new CheckInError('This check-in has already been submitted', 409);
  // Sharing stops when the client leaves the practice; so does checking in to it.
  const member = await prisma.institutionMember.findUnique({
    where: { institutionId_userId: { institutionId: row.practiceId, userId } },
    select: { active: true, role: true },
  });
  if (!member?.active || member.role !== 'athlete') throw new CheckInError('Check-in not found', 404);

  const questions = parseQuestions(row.questionsJson);
  const input = rawAnswers && typeof rawAnswers === 'object' ? (rawAnswers as Record<string, unknown>) : {};
  const answers: Record<string, string | number> = {};
  for (const q of questions) {
    const v = input[q.id];
    if (q.type === 'scale') {
      const n = Number(v);
      if (!Number.isInteger(n) || n < 1 || n > 5) throw new CheckInError(`Answer "${q.text}" on the 1 to 5 scale`, 400);
      answers[q.id] = n;
    } else if (q.type === 'number') {
      const n = Number(v);
      if (v === '' || v === undefined || v === null || !Number.isFinite(n)) throw new CheckInError(`"${q.text}" needs a number`, 400);
      answers[q.id] = n;
    } else {
      answers[q.id] = typeof v === 'string' ? v.trim().slice(0, 1000) : '';
    }
  }

  const [user, coach, sessions, program] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { name: true } }),
    practiceTrainer(row.practiceId),
    prisma.workoutLog.count({ where: { userId, createdAt: { gte: new Date(now.getTime() - 7 * DAY_MS) } } }),
    import('./roster.js').then((m) => m.loadClients(row.practiceId, { ids: [userId], now })),
  ]);
  const target = program[0]?.sessionsPerWeek ?? 3;
  const analysis = analyse(questions, answers, { logged: sessions, target }, row.id);
  const firstName = user?.name?.trim().split(/\s+/)[0] ?? 'there';

  const draft = await createDraft({
    practiceId: row.practiceId, trainerId: coach.userId, clientId: userId, kind: 'checkin_reply', sourceId: row.id,
    text: await writeDraftText({
      clientFirstName: firstName,
      trainerFirstName: coach.user.name?.split(' ')[0] ?? 'Your trainer',
      purpose: 'reply to a client check-in; acknowledge what they reported and say what happens next',
      facts: [...analysis.signals.map((s) => s.label), ...questions.filter((q) => q.type === 'text' && answers[q.id]).map((q) => `${q.text} ${answers[q.id]}`)],
      fallback: replyFallback(firstName, analysis),
    }),
  });

  const claimed = await prisma.ptCheckIn.updateMany({
    where: { id: row.id, status: { not: 'submitted' } },
    data: {
      status: 'submitted', submittedAt: now, classification: analysis.classification, summary: analysis.summary,
      signalsJson: JSON.stringify(analysis.signals), evidenceJson: JSON.stringify(analysis.evidence),
      answersJson: JSON.stringify(questions.map((q) => ({ question: q.text, answer: String(answers[q.id] ?? '') }))),
      draftId: draft.id,
    },
  });
  if (claimed.count !== 1) throw new CheckInError('This check-in has already been submitted', 409);
  return { ok: true };
}

// ── Trainer inbox ────────────────────────────────────────────────────────────

export async function inbox(practiceId: string, clients: Client[], opts: { since?: Date; now?: Date } = {}): Promise<CheckInInbox> {
  const now = opts.now ?? new Date();
  const since = opts.since ?? new Date(now.getTime() - 30 * DAY_MS);
  const byId = new Map(clients.map((c) => [c.id, c]));
  const rows = await prisma.ptCheckIn.findMany({
    where: { practiceId, clientId: { in: [...byId.keys()] }, OR: [{ submittedAt: { gte: since } }, { status: { in: ['due', 'missed'] }, dueAt: { gte: new Date(now.getTime() - 14 * DAY_MS) } }] },
    orderBy: { dueAt: 'desc' },
  });
  const drafts = await prisma.ptDraft.findMany({ where: { id: { in: rows.map((r) => r.draftId).filter((x): x is string => !!x) } } });
  const draftById = new Map(drafts.map((d) => [d.id, d]));
  const ref = (id: string) => { const c = byId.get(id)!; return { id: c.id, name: c.name, initials: c.initials }; };
  const json = <T>(s: string | null, fallback: T): T => { try { return s ? JSON.parse(s) : fallback; } catch { return fallback; } };

  const checkIns: CheckIn[] = [];
  for (const r of rows) {
    if (r.status !== 'submitted' || !r.submittedAt) continue;
    const draft = r.draftId ? draftById.get(r.draftId) : undefined;
    const evidence = json<Evidence>(r.evidenceJson, { reasons: [], sources: [] });
    // No evidence, no summary on screen (handoff §2.2).
    if (!draft || evidence.reasons.length === 0) { console.error('[personal-training] check-in withheld: no draft or evidence', r.id); continue; }
    checkIns.push({
      id: r.id, clientId: r.clientId, client: ref(r.clientId), submittedAt: r.submittedAt.toISOString(), channel: 'app',
      classification: (r.classification ?? 'routine') as CheckIn['classification'], summary: r.summary ?? '',
      signals: json<CheckInSignal[]>(r.signalsJson, []), answers: json(r.answersJson, []), evidence, draft: toDraft(draft),
      ...(r.reviewedAt ? { reviewedAt: r.reviewedAt.toISOString() } : {}),
    });
  }
  checkIns.sort((a, b) => (a.submittedAt < b.submittedAt ? 1 : -1));

  const missed: MissedCheckIn[] = rows
    .filter((r) => r.status === 'missed' || (r.status === 'due' && r.nudgedAt))
    .map((r) => ({
      id: r.id, client: ref(r.clientId), dueAt: r.dueAt.toISOString(), status: r.status as 'due' | 'missed',
      path: [
        `Check-in sent ${shortDay(r.dueAt)}`,
        ...(r.nudgedAt ? [`Nudged ${shortDay(r.nudgedAt)}, no reply`] : []),
        ...(r.status === 'missed' ? ['Flagged in your briefing'] : []),
      ],
    }));

  return {
    checkIns,
    missed,
    routinePending: checkIns.filter((c) => c.classification === 'routine' && !c.reviewedAt && c.draft.status === 'pending').length,
  };
}

async function ownedCheckIn(checkInId: string, practiceId: string) {
  const row = await prisma.ptCheckIn.findUnique({ where: { id: checkInId } });
  if (!row || row.practiceId !== practiceId) throw new CheckInError('Check-in not found', 404);
  return row;
}

/** "Mark read, no reply": reviewed, and the unsent draft is discarded. */
export async function markReviewed(checkInId: string, practiceId: string, trainerId: string) {
  const row = await ownedCheckIn(checkInId, practiceId);
  await prisma.ptCheckIn.update({ where: { id: row.id }, data: { reviewedAt: new Date() } });
  if (row.draftId) await prisma.ptDraft.updateMany({ where: { id: row.draftId, status: 'pending' }, data: { status: 'discarded' } });
  await audit({ practiceId, trainerId, clientId: row.clientId, action: 'marked_read', itemType: 'checkin', itemId: row.id });
}

/** Keep a check-in's reviewed state in step with its reply draft being sent or taken back. */
export async function syncReviewedWithDraft(draftId: string, sent: boolean) {
  await prisma.ptCheckIn.updateMany({ where: { draftId }, data: { reviewedAt: sent ? new Date() : null } });
}

/**
 * "Send all routine replies": only check-ins the server classified routine
 * are eligible. Flagged ones are never batch-sent, whatever the client asks.
 */
export async function sendRoutineReplies(practiceId: string, trainerId: string): Promise<number> {
  const rows = await prisma.ptCheckIn.findMany({
    where: { practiceId, status: 'submitted', classification: 'routine', reviewedAt: null, draftId: { not: null } },
  });
  let sent = 0;
  for (const r of rows) {
    try {
      await requestSend({ draftId: r.draftId!, practiceId, trainerId });
      await syncReviewedWithDraft(r.draftId!, true);
      sent += 1;
    } catch (err) {
      if (!(err instanceof DraftError)) throw err; // already sent or discarded: skip it
    }
  }
  return sent;
}
