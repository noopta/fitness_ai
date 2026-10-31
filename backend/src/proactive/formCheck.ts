// Form check in chat (design flow H). The analysis pipeline is unchanged
// (routes/formAnalysis.ts: upload → Gemini → reference stills); this module
// is what lands in the thread when it finishes, in the v4 grammar:
//
//   H2  receipts on the result turn — what was watched, computed, compared
//   H3  the card: eyebrow · one still with the fault bracketed · hairline
//       rows per fault · one Proposed cue + Add cue / Not now · Full analysis
//
// "Add cue" writes the cue onto that lift in the program (every phase it
// appears in) through the change log, so it is undoable and shows up in the
// guided session's notes. Pure parts are tested without Prisma.

import { PrismaClient } from '@prisma/client';
import type { CardDraft } from '../agent/cards/types.js';
import { defineOp, getOp } from '../agent/ops.js';
import { exerciseTouches, shortDate } from './threads.js';

const prisma = new PrismaClient();

export interface FormWeakness { issue: string; severity: 'minor' | 'moderate' | 'major'; cue: string; timestampSec?: number | null }
export interface FormAnalysisLike {
  exercise: string;
  formScore: number | null;
  repCount: number | null;
  strengths?: string[];
  weaknesses?: FormWeakness[];
  recommendedDrills?: { name: string; why: string; setsReps?: string }[];
  summary?: string;
  safetyFlags?: string[];
  referenceFrames?: { weaknessIndex: number; timestampSec: number; b64: string }[];
}
export interface PreviousCheck { id: string; date: string; formScore: number | null }

const SEVERITY_WORD: Record<string, string> = { major: 'Major', moderate: 'Moderate', minor: 'Minor' };
const rank: Record<string, number> = { major: 0, moderate: 1, minor: 2 };
const liftWord = (exercise: string) => exercise && exercise !== 'unknown' ? exercise : 'the lift';

/** The fault the card leads with: the most severe, earliest. */
export function leadWeakness(a: FormAnalysisLike): FormWeakness | null {
  const ws = [...(a.weaknesses ?? [])].sort((x, y) => (rank[x.severity] ?? 3) - (rank[y.severity] ?? 3) || ((x.timestampSec ?? 1e9) - (y.timestampSec ?? 1e9)));
  return ws[0] ?? null;
}

/** H2/H3 receipts: watched · computed · compared. Every line is a value the pipeline produced. */
export function formReceipts(a: FormAnalysisLike, previous: PreviousCheck | null): { verb: string; text: string }[] {
  const reps = a.repCount != null ? `${a.repCount} rep${a.repCount === 1 ? '' : 's'}` : 'the set';
  const out = [
    { verb: 'Read', text: `Video · ${reps}` },
    { verb: 'Computed', text: a.formScore != null ? `Form score ${a.formScore} of 10 · ${(a.weaknesses ?? []).length} fault${(a.weaknesses ?? []).length === 1 ? '' : 's'}` : 'Form read' },
  ];
  if (previous) out.push({ verb: 'Checked', text: `Your ${liftWord(a.exercise).toLowerCase()} check from ${shortDate(previous.date)}${previous.formScore != null ? ` · ${previous.formScore} of 10` : ''}` });
  return out;
}

/** The turn's text: the analysis summary, or a plain line when there is none. */
export function formTurnText(a: FormAnalysisLike): string {
  const s = (a.summary ?? '').replace(/\s+/g, ' ').trim();
  if (s) return s;
  const w = leadWeakness(a);
  return w ? `${liftWord(a.exercise)}: ${w.issue}. ${w.cue}` : `${liftWord(a.exercise)} looked clean on this set.`;
}

/** The first still, as the card's visual, with the fault it shows as the caption. */
export function formStill(a: FormAnalysisLike): CardDraft['media'] | undefined {
  const f = a.referenceFrames?.find((x) => x?.b64);
  if (!f) return undefined;
  const w = a.weaknesses?.[f.weaknessIndex];
  return { kind: 'photo', uri: `data:image/jpeg;base64,${f.b64}`, caption: `${f.timestampSec != null ? `${Math.round(f.timestampSec)}s · ` : ''}${w?.issue ?? 'the set'}` };
}

/**
 * H3 card. `analysisId` opens the full analysis; `lift` is what Add cue writes to.
 * No weaknesses → no Proposed line, just the rows and Full analysis.
 */
export function formResultCardV4(a: FormAnalysisLike, opts: { analysisId: string; previous: PreviousCheck | null; lift?: string | null }): CardDraft {
  const lead = leadWeakness(a);
  const lift = opts.lift || liftWord(a.exercise);
  const rows: NonNullable<CardDraft['rows']> = [];
  for (const w of [...(a.weaknesses ?? [])].sort((x, y) => (rank[x.severity] ?? 3) - (rank[y.severity] ?? 3)).slice(0, 3)) {
    rows.push({ key: w.issue, value: `${SEVERITY_WORD[w.severity] ?? w.severity}${w.timestampSec != null ? ` · ${Math.round(w.timestampSec)}s` : ''}`, mark: w.severity === 'major' ? 'chg' : undefined });
  }
  for (const s of (a.strengths ?? []).slice(0, rows.length ? 1 : 2)) rows.push({ key: 'Good', value: s });
  if (opts.previous && a.formScore != null && opts.previous.formScore != null) {
    const d = Math.round((a.formScore - opts.previous.formScore) * 10) / 10;
    rows.push({ key: `vs ${shortDate(opts.previous.date)}`, value: `${d > 0 ? '+' : ''}${d} · ${opts.previous.formScore} → ${a.formScore}` });
  }
  const actions: NonNullable<CardDraft['actions']> = [];
  const pending: NonNullable<NonNullable<CardDraft['pending']>['actions']> = {};
  if (lead) {
    actions.push({ id: 'cue', label: 'Add cue', kind: 'primary' }, { id: 'later', label: 'Not now', kind: 'secondary' });
    pending.cue = { op: 'form.add_cue', args: { lift, cue: lead.cue, analysisId: opts.analysisId }, status: 'applied', line: `Adjusted — "${lead.cue}" on your next ${lift.toLowerCase()}` };
    pending.later = { kind: 'keep', line: 'Not now' };
  }
  actions.push({ id: 'full', label: 'Full analysis', kind: 'secondary', client: { action: 'open_page', args: { page: 'form', id: opts.analysisId } } });
  return {
    fn: 'FRM-03', pattern: lead ? 'proposal' : 'glance', rule: lead ? 'propose' : 'show',
    meta: { label: `${liftWord(a.exercise)}${a.repCount != null ? ` · ${a.repCount} reps` : ''}${a.formScore != null ? ` · ${a.formScore} of 10` : ''}`, open: { page: 'form', params: { id: opts.analysisId } } },
    media: formStill(a),
    rows,
    ...(lead ? { why: `Cue on your next ${lift.toLowerCase()}: "${lead.cue}"` } : {}),
    ...(a.safetyFlags?.length ? { note: a.safetyFlags[0] } : {}),
    actions,
    pending: { actions: pending },
    entity: `form:${opts.analysisId}`,
  };
}

/**
 * Pure: write a cue onto every occurrence of the lift in the program. Returns
 * how many rows took it; the same cue is never added twice.
 */
export function applyCueToProgram(program: any, lift: string, cue: string): { program: any; count: number } {
  const next = JSON.parse(JSON.stringify(program ?? {}));
  let count = 0;
  const line = `Cue: ${cue.trim()}`;
  for (const phase of next?.phases ?? []) for (const day of phase?.trainingDays ?? []) for (const ex of day?.exercises ?? []) {
    const name = String(ex?.exercise ?? ex?.name ?? '');
    if (!name || !exerciseTouches([lift], name)) continue;
    const notes = String(ex.notes ?? '');
    if (notes.includes(line)) continue;
    ex.notes = notes ? `${notes} · ${line}` : line;
    count++;
  }
  return { program: next, count };
}

/** The user's last completed check of the same lift, before this one. */
export async function previousCheck(userId: string, exercise: string, beforeId: string): Promise<PreviousCheck | null> {
  const rows = await prisma.formAnalysis.findMany({ where: { userId, status: 'complete', id: { not: beforeId } }, orderBy: { createdAt: 'desc' }, take: 20, select: { id: true, exercise: true, formScore: true, createdAt: true } });
  const hit = rows.find((r) => exerciseTouches([exercise], r.exercise) || exerciseTouches([r.exercise], exercise));
  return hit ? { id: hit.id, date: hit.createdAt.toISOString().slice(0, 10), formScore: hit.formScore } : null;
}

defineOp({
  name: 'form.add_cue',
  run: async (userId, args) => {
    const lift = String(args.lift ?? '').trim();
    const cue = String(args.cue ?? '').trim();
    if (!lift || !cue) throw new Error('Nothing to add.');
    const u = await prisma.user.findUnique({ where: { id: userId }, select: { savedProgram: true } });
    if (!u?.savedProgram) throw new Error('There’s no program to put the cue on yet.');
    const { program, count } = applyCueToProgram(JSON.parse(u.savedProgram), lift, cue);
    if (!count) throw new Error(`${lift} isn’t on your program right now — I’ll keep the cue for when it is.`);
    const replace = getOp('program.replace');
    if (!replace) throw new Error('Program ops not loaded');
    await replace.run(userId, { program, summary: `Cue on ${lift}` });
    return { result: { count }, inverse: { op: 'program.set_raw', args: { savedProgram: u.savedProgram } }, summary: `Cue added to ${lift} · ${count} session${count === 1 ? '' : 's'}` };
  },
});
