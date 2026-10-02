// The client dossier beyond the timeline (handoff §6.3): an overview built
// from the same facts and rules as the roster and briefing, the client's
// program as they see it (read-only), and the trainer's private notes.

import { bodyWeightKg, formatWeight, type UnitPreference } from '../weightUnits.js';
import { computePhaseState, parseSavedProgram } from '../programPhaseService.js';
import { candidatesFor, shortDay, type EngineOptions } from './briefingEngine.js';
import { prisma } from './db.js';
import type { ClientData } from './data.js';
import { LIFT_LABEL, liftHistory, liftTrend, prEvents, weeklyBest } from './lifts.js';
import type { Client, ClientNote, ClientOverview, ClientProgramView, Evidence, LiftKey, ProgramDayView, ProgressStatus, SourceRef, Tone } from './types.js';

const DAY_MS = 86_400_000;
const TREND_WEEKS = 6;
const MAIN_LIFTS: LiftKey[] = ['squat', 'deadlift', 'bench', 'ohp'];

export class DossierError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'DossierError';
    this.status = status;
  }
}

export interface LiftSnapshot { lift: LiftKey; label: string; latestKg: number; changeKg: number | null; status: ProgressStatus }

/** The main lifts this client actually trains, with where each stands over six weeks. */
export function liftSnapshots(d: ClientData, now: Date): LiftSnapshot[] {
  const out: LiftSnapshot[] = [];
  for (const lift of MAIN_LIFTS) {
    const trend = liftTrend(weeklyBest(liftHistory(d.workouts, lift), TREND_WEEKS, now));
    if (trend.latestKg !== null) out.push({ lift, label: LIFT_LABEL[lift], latestKg: trend.latestKg, changeKg: trend.changeKg, status: trend.status });
  }
  return out;
}

const signed = (text: string | null, n: number) => (text === null ? undefined : `${n > 0 ? '+' : n < 0 ? '−' : ''}${text}`);
const STATUS_WORD: Record<ProgressStatus, string> = { progressing: 'is progressing', plateau: 'has stalled', regressing: 'is going backwards', noData: 'has too little data to call' };
const STATUS_TONE: Record<ProgressStatus, Tone> = { progressing: 'green', plateau: 'amber', regressing: 'red', noData: 'zinc' };

/** Sessions logged in the last four weeks against what the program expects. */
export function adherence4w(c: Client, d: ClientData, now: Date): { logged: number; planned: number; pct: number } {
  const since = now.getTime() - 28 * DAY_MS;
  const logged = d.workouts.filter((w) => w.createdAt.getTime() > since).length;
  const planned = c.sessionsPerWeek * 4;
  return { logged, planned, pct: planned ? Math.min(100, Math.round((logged / planned) * 100)) : 0 };
}

export function buildOverview(c: Client, d: ClientData, pref: UnitPreference, now: Date, engine: EngineOptions): ClientOverview {
  const first = c.name.split(' ')[0];
  const fmt = (kg: number, decimals = 0) => formatWeight(kg, pref, decimals) ?? '';
  const lifts = liftSnapshots(d, now);
  const adherence = adherence4w(c, d, now);
  const active = c.contraindications.filter((x) => x.active);

  // Every sentence of the summary is one of these facts, so the paragraph can
  // always show what it was based on.
  const sentences: string[] = [];
  const reasons: string[] = [];
  const sources: SourceRef[] = [];
  const say = (sentence: string, reason: string, source?: SourceRef) => {
    sentences.push(sentence);
    reasons.push(reason);
    if (source && !sources.some((s) => s.kind === source.kind && s.id === source.id)) sources.push(source);
  };

  if (c.program) {
    say(
      `${first} is in week ${c.program.week} of ${c.program.weeks} of ${c.program.blockLabel}${c.program.goal ? `, working towards "${c.program.goal}"` : ''}.`,
      `Saved program: ${c.program.blockLabel}, week ${c.program.week} of ${c.program.weeks}`,
      { kind: 'program', id: c.id, label: 'Saved program' },
    );
  } else {
    say(`${first} has no program yet.`, 'No saved program on their account', { kind: 'program', id: c.id, label: 'Saved program' });
  }
  say(
    `They logged ${adherence.logged} of ${adherence.planned} planned sessions in the last four weeks, and engagement is ${c.engagementTrend}.`,
    `${adherence.logged} sessions logged in 28 days against ${c.sessionsPerWeek} a week; weekly engagement ${c.engagement8w.join(', ')}`,
    { kind: 'session', id: 'last-28-days', label: 'Sessions logged in the last 4 weeks' },
  );
  const trended = lifts.filter((l) => l.status !== 'noData');
  if (trended.length) {
    say(
      `${trended.map((l, i) => `${i === 0 ? l.label : l.label.toLowerCase()} ${STATUS_WORD[l.status]}`).join('; ')}.`,
      trended.map((l) => `${l.label}: estimated 1RM ${fmt(l.latestKg)}, ${l.changeKg === null ? 'no trend' : `${signed(fmt(Math.abs(l.changeKg)), l.changeKg)} over ${TREND_WEEKS} weeks`}`).join('; '),
      { kind: 'rule', id: 'PLAT-03', label: 'Lift trend rule' },
    );
  }
  if (c.statusReason) say(`${c.statusReason}.`, c.statusReason, { kind: 'rule', id: 'PT-STATUS', label: 'Roster status rules' });
  if (active.length) {
    say(
      `Active ${active.length === 1 ? 'injury' : 'injuries'} on file: ${active.map((x) => x.label).join(', ')}.`,
      `Injuries on file: ${active.map((x) => (x.note ? `${x.label} (${x.note})` : x.label)).join('; ')}`,
      { kind: 'intake', id: c.id, label: 'Injuries on file' },
    );
  }

  const stats: ClientOverview['stats'] = lifts.slice(0, 2).map((l) => ({
    label: `${l.label} est. 1RM`,
    value: fmt(l.latestKg),
    ...(l.changeKg !== null ? { delta: signed(fmt(Math.abs(l.changeKg)), l.changeKg) } : {}),
    tone: STATUS_TONE[l.status],
  }));
  const weights = d.weights
    .filter((w) => w.createdAt.getTime() > now.getTime() - TREND_WEEKS * 7 * DAY_MS)
    .map((w) => bodyWeightKg(w))
    .filter((kg): kg is number => kg !== null);
  if (weights.length) {
    const delta = weights[weights.length - 1] - weights[0];
    stats.push({ label: 'Bodyweight', value: fmt(weights[weights.length - 1], 1), ...(weights.length > 1 ? { delta: signed(fmt(Math.abs(delta), 1), delta) } : {}) });
  }
  stats.push({ label: '4-week adherence', value: `${adherence.pct}%`, delta: `${adherence.logged} of ${adherence.planned} sessions` });

  const monthAgo = now.getTime() - 30 * DAY_MS;
  const evidence: Evidence = { reasons, sources };
  return {
    summary: { text: sentences.join(' '), updatedAt: now.toISOString(), evidence },
    stats,
    block: c.program,
    openItems: candidatesFor(c, d, now, engine).map((x) => ({ id: x.ruleId, headline: x.headline, detail: x.detail, severity: x.severity })),
    recentPrs: prEvents(d.workouts)
      .filter((e) => e.at.getTime() > monthAgo)
      .slice(-5)
      .reverse()
      .map((e) => ({ lift: e.lift, value: fmt(e.e1rm), date: shortDay(e.at) })),
  };
}

// ── Program ──────────────────────────────────────────────────────────────────

/** The client's saved program shaped for reading. Returns null when they have none or it cannot be read. */
export function buildProgramView(
  user: { savedProgram: string | null; programStartDate: Date | null; coachGoal: string | null },
  proposals: { id: string; title: string; reasoning: string; createdAt: Date }[],
  pref: UnitPreference,
  now: Date,
): ClientProgramView | null {
  const program = parseSavedProgram(user.savedProgram) as any;
  if (!program || !Array.isArray(program.phases) || program.phases.length === 0) return null;
  const state = computePhaseState(program, user.programStartDate, now);

  const days = (phase: any): ProgramDayView[] =>
    (Array.isArray(phase?.trainingDays) ? phase.trainingDays : Array.isArray(phase?.days) ? phase.days : [])
      .filter((d: any) => d && typeof d === 'object')
      .map((d: any, i: number) => ({
        day: String(d.day ?? `Day ${i + 1}`),
        focus: String(d.focus ?? ''),
        exercises: (Array.isArray(d.exercises) ? d.exercises : Array.isArray(d.sessions) ? d.sessions : [])
          .filter((e: any) => e && (e.exercise || e.name))
          .map((e: any) => {
            const target = typeof e.targetWeightKg === 'number' && e.targetWeightKg > 0 ? formatWeight(e.targetWeightKg, pref) : null;
            return {
              name: String(e.exercise ?? e.name),
              scheme: [e.sets && e.reps ? `${e.sets}×${e.reps}` : '', e.intensity ?? ''].filter(Boolean).join(' · '),
              ...(target ? { target } : {}),
              ...(e.notes ? { notes: String(e.notes) } : {}),
            };
          }),
      }));

  let weekCursor = 0;
  return {
    goal: String(program.goal ?? user.coachGoal ?? ''),
    daysPerWeek: typeof program.daysPerWeek === 'number' ? program.daysPerWeek : state.trainingDays.length,
    totalWeeks: Math.max(state.totalWeeks, state.weekNumber),
    currentWeek: state.weekNumber,
    startedAt: user.programStartDate ? user.programStartDate.toISOString() : null,
    phases: program.phases.map((p: any, i: number) => {
      const duration = Number(p?.durationWeeks ?? p?.weeks ?? 1) || 1;
      const from = weekCursor + 1;
      weekCursor += duration;
      return {
        name: String(p?.phaseName ?? p?.name ?? `Phase ${i + 1}`),
        weeksLabel: String(p?.weeksLabel ?? (duration === 1 ? `Week ${from}` : `Weeks ${from} to ${weekCursor}`)),
        rationale: String(p?.rationale ?? p?.focus ?? ''),
        current: i === state.phaseIndex,
        days: days(p),
      };
    }),
    pending: proposals.map((p) => ({ id: p.id, title: p.title, reasoning: p.reasoning, proposedAt: p.createdAt.toISOString() })),
  };
}

// ── Notes ────────────────────────────────────────────────────────────────────

const NOTE_MAX = 4000;

function cleanBody(body: unknown): string {
  const text = typeof body === 'string' ? body.trim() : '';
  if (!text) throw new DossierError('A note cannot be empty', 400);
  if (text.length > NOTE_MAX) throw new DossierError(`A note can be at most ${NOTE_MAX} characters`, 400);
  return text;
}

async function shape(rows: { id: string; trainerId: string; body: string; createdAt: Date; updatedAt: Date }[]): Promise<ClientNote[]> {
  const authors = await prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.trainerId))] } }, select: { id: true, name: true } });
  const nameOf = new Map(authors.map((a) => [a.id, a.name?.trim() || 'Trainer']));
  return rows.map((r) => ({ id: r.id, body: r.body, authorName: nameOf.get(r.trainerId) ?? 'Trainer', createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString() }));
}

export async function listNotes(practiceId: string, clientId: string): Promise<ClientNote[]> {
  return shape(await prisma.ptNote.findMany({ where: { practiceId, clientId }, orderBy: { createdAt: 'desc' }, take: 200 }));
}

export async function addNote(practiceId: string, trainerId: string, clientId: string, body: unknown): Promise<ClientNote> {
  const row = await prisma.ptNote.create({ data: { practiceId, trainerId, clientId, body: cleanBody(body) } });
  return (await shape([row]))[0];
}

/** Notes belong to the practice: any of its trainers may edit or remove one, but never across practices. */
async function ownedNote(noteId: string, practiceId: string, clientId: string) {
  const row = await prisma.ptNote.findUnique({ where: { id: noteId } });
  if (!row || row.practiceId !== practiceId || row.clientId !== clientId) throw new DossierError('Note not found', 404);
  return row;
}

export async function updateNote(practiceId: string, clientId: string, noteId: string, body: unknown): Promise<ClientNote> {
  await ownedNote(noteId, practiceId, clientId);
  const row = await prisma.ptNote.update({ where: { id: noteId }, data: { body: cleanBody(body) } });
  return (await shape([row]))[0];
}

export async function deleteNote(practiceId: string, clientId: string, noteId: string): Promise<void> {
  await ownedNote(noteId, practiceId, clientId);
  await prisma.ptNote.delete({ where: { id: noteId } });
}
