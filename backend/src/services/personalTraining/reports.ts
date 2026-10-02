// Monthly client report (handoff §6.5): the trainer previews exactly what the
// client will get, edits their note, and sends it. Sending goes through the
// same draft pipeline as every other message, so it has the same undo window
// and audit trail.

import { bodyWeightKg, formatWeight, type UnitPreference } from '../weightUnits.js';
import { shortDay } from './briefingEngine.js';
import { prisma } from './db.js';
import type { ClientData } from './data.js';
import { createDraft, requestSend, undoSend } from './drafts.js';
import { prEvents } from './lifts.js';
import type { Client, Report, ReportStats } from './types.js';

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export class ReportError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ReportError';
    this.status = status;
  }
}

export const isMonth = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);

export function monthRange(month: string): { start: Date; end: Date; label: string } {
  const [y, m] = month.split('-').map(Number);
  return { start: new Date(Date.UTC(y, m - 1, 1)), end: new Date(Date.UTC(y, m, 1)), label: MONTH_NAMES[m - 1] };
}

/** The last complete month — what a report is normally about. */
export function defaultMonth(now: Date): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function buildStats(client: Client, d: ClientData, month: string, pref: UnitPreference): ReportStats {
  const { start, end } = monthRange(month);
  const within = (t: Date) => t.getTime() >= start.getTime() && t.getTime() < end.getTime();
  const fmt = (kg: number, decimals = 0) => formatWeight(kg, pref, decimals) ?? '';

  const sessions = d.workouts.filter((w) => within(w.createdAt)).length;
  const weeksInMonth = (end.getTime() - start.getTime()) / (7 * 86_400_000);
  const adherence = Math.min(100, Math.round((sessions / (client.sessionsPerWeek * weeksInMonth)) * 100));
  const prs = prEvents(d.workouts).filter((e) => within(e.at)).map((e) => ({ lift: e.lift, value: fmt(e.e1rm), date: shortDay(e.at) }));

  const weights = d.weights.filter((w) => within(w.createdAt)).map((w) => ({ at: w.createdAt, kg: bodyWeightKg(w) })).filter((w): w is { at: Date; kg: number } => w.kg !== null);
  const bodyweight = weights.length >= 2
    ? (() => {
        const delta = weights[weights.length - 1].kg - weights[0].kg;
        const shown = fmt(Math.abs(delta), 1);
        return { start: fmt(weights[0].kg, 1), end: fmt(weights[weights.length - 1].kg, 1), change: `${delta > 0 ? '+' : delta < 0 ? '−' : ''}${shown}` };
      })()
    : null;

  return {
    sessions,
    adherence,
    prs,
    bodyweight,
    measurements: weights.map((w) => ({ date: shortDay(w.at), value: fmt(w.kg, 1) })),
    headline: [
      { label: 'Sessions', value: String(sessions) },
      { label: 'Adherence', value: `${adherence}%` },
      { label: 'New PRs', value: String(prs.length) },
    ],
  };
}

export function buildNarrative(stats: ReportStats, monthLabel: string): string {
  const parts = [`You trained ${stats.sessions} time${stats.sessions === 1 ? '' : 's'} in ${monthLabel}, ${stats.adherence}% of what we planned.`];
  if (stats.prs.length) {
    const top = stats.prs[stats.prs.length - 1];
    parts.push(`You set ${stats.prs.length} personal record${stats.prs.length === 1 ? '' : 's'}, most recently ${top.lift.toLowerCase()} at an estimated ${top.value}.`);
  } else if (stats.sessions > 0) {
    parts.push('No new records this month, which is normal in a building phase.');
  }
  if (stats.bodyweight) parts.push(`Bodyweight moved from ${stats.bodyweight.start} to ${stats.bodyweight.end}.`);
  return parts.join(' ');
}

function nextLineFor(client: Client): string {
  if (!client.program) return 'Next month: we will set your next block together.';
  const { blockLabel, week, weeks } = client.program;
  return week >= weeks ? 'Next month: a new block, built on what this one showed us.' : `Next month: ${blockLabel} continues, weeks ${week + 1} to ${Math.min(weeks, week + 4)} of ${weeks}.`;
}

interface Who { trainerName: string; practiceName: string }

function toReport(row: NonNullable<Awaited<ReturnType<typeof prisma.ptReport.findUnique>>>, client: Client, stats: ReportStats, who: Who, undoUntil?: Date | null): Report {
  const { label } = monthRange(row.month);
  return {
    id: row.id, clientId: client.id, client: { id: client.id, name: client.name, initials: client.initials },
    month: row.month, monthLabel: label, status: row.status as Report['status'],
    title: `Your ${label}, ${client.name.split(' ')[0]}.`,
    narrative: row.narrative, coachNote: row.coachNote, nextLine: row.nextLine, stats,
    trainerName: who.trainerName, practiceName: who.practiceName,
    ...(row.sentAt ? { sentAt: row.sentAt.toISOString() } : {}),
    ...(undoUntil ? { undoUntil: undoUntil.toISOString() } : {}),
  };
}

/** The draft report for a client and month, created on first view. While it is a draft its numbers follow the data. */
export async function getReport(input: {
  practiceId: string; trainerId: string; client: Client; data: ClientData; month: string; pref: UnitPreference; who: Who;
}): Promise<Report> {
  const { practiceId, trainerId, client, data, month, pref, who } = input;
  const fresh = buildStats(client, data, month, pref);
  const existing = await prisma.ptReport.findUnique({ where: { practiceId_clientId_month: { practiceId, clientId: client.id, month } } });
  if (!existing) {
    const created = await prisma.ptReport.create({
      data: {
        practiceId, trainerId, clientId: client.id, month, statsJson: JSON.stringify(fresh),
        narrative: buildNarrative(fresh, monthRange(month).label), nextLine: nextLineFor(client),
      },
    });
    return toReport(created, client, fresh, who);
  }
  // A sent report is a record of what the client received: its numbers are frozen.
  if (existing.status === 'sent') {
    const draft = existing.draftId ? await prisma.ptDraft.findUnique({ where: { id: existing.draftId }, select: { status: true, undoUntil: true } }) : null;
    return toReport(existing, client, JSON.parse(existing.statsJson), who, draft?.status === 'sending' ? draft.undoUntil : null);
  }
  await prisma.ptReport.update({ where: { id: existing.id }, data: { statsJson: JSON.stringify(fresh) } });
  return toReport(existing, client, fresh, who);
}

async function owned(reportId: string, practiceId: string) {
  const row = await prisma.ptReport.findUnique({ where: { id: reportId } });
  if (!row || row.practiceId !== practiceId) throw new ReportError('Report not found', 404);
  return row;
}

export async function patchReport(reportId: string, practiceId: string, body: any) {
  const row = await owned(reportId, practiceId);
  if (row.status !== 'draft') throw new ReportError('A sent report cannot be edited', 409);
  const data: Record<string, string> = {};
  for (const [key, max] of [['coachNote', 1500], ['narrative', 1500], ['nextLine', 300]] as const) {
    if (body?.[key] === undefined) continue;
    if (typeof body[key] !== 'string' || body[key].length > max) throw new ReportError(`${key} must be text of at most ${max} characters`, 400);
    data[key] = body[key].trim();
  }
  if (Object.keys(data).length === 0) throw new ReportError('Nothing to update', 400);
  await prisma.ptReport.update({ where: { id: row.id }, data });
}

/** The report as the client receives it in their messages. */
export function composeReportText(r: Pick<Report, 'title' | 'narrative' | 'coachNote' | 'nextLine' | 'trainerName'> & { stats: ReportStats }): string {
  const lines = [r.title, '', r.narrative, '', r.stats.headline.map((h) => `${h.label}: ${h.value}`).join(' · ')];
  if (r.stats.prs.length) lines.push('', ...r.stats.prs.map((p) => `PR — ${p.lift}: ${p.value} (${p.date})`));
  if (r.coachNote) lines.push('', `From ${r.trainerName.split(' ')[0]}: ${r.coachNote}`);
  if (r.nextLine) lines.push('', r.nextLine);
  return lines.join('\n');
}

export async function sendReport(input: { report: Report; practiceId: string; trainerId: string }) {
  const { report, practiceId, trainerId } = input;
  if (report.status !== 'draft') throw new ReportError('This report has already been sent', 409);
  const draft = await createDraft({ practiceId, trainerId, clientId: report.clientId, kind: 'report', sourceId: report.id, text: composeReportText(report) });
  const sending = await requestSend({ draftId: draft.id, practiceId, trainerId });
  await prisma.ptReport.update({ where: { id: report.id }, data: { status: 'sent', sentAt: new Date(), draftId: draft.id } });
  return sending;
}

export async function undoReport(reportId: string, practiceId: string, trainerId: string) {
  const row = await owned(reportId, practiceId);
  if (row.status !== 'sent' || !row.draftId) throw new ReportError('This report has not been sent', 409);
  await undoSend({ draftId: row.draftId, practiceId, trainerId }); // throws once delivered
  await prisma.ptDraft.updateMany({ where: { id: row.draftId, status: 'pending' }, data: { status: 'discarded' } });
  await prisma.ptReport.update({ where: { id: row.id }, data: { status: 'draft', sentAt: null, draftId: null } });
}
