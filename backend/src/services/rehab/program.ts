// Research-based rehab programs (Oct 2026, flag REHAB_PROGRAMS). For an
// athlete their surgeon or physio has cleared to start rehab: Anakin researches
// current protocols for the injury and stage, writes the program — phases by
// week since surgery, the criteria to move on, the protocol's hard limits,
// sources — and it's saved like a coach's program (transcribed faithfully,
// never auto-progressed) for them to take to their physio.
//
// The program generator's injury guard is untouched: without clearance and
// this flag, an operated limb stays out of the plan.

import type { CardDraft } from '../../agent/cards/types.js';

export interface RehabSource { title: string; year?: number | string | null; url?: string | null }
export interface RehabInput {
  area: string;
  side?: string | null;
  /** YYYY-MM-DD */
  surgeryDate?: string | null;
  clearedOn?: string | null;
  clearedBy?: string | null;
  /** What they're cleared for, in their words ("start physio, partial weight-bearing in the boot"). */
  clearedFor?: string | null;
  /** The program, written out: phases by week, days, exercises with sets × reps and load, notes. */
  program: string;
  /** Hard limits from the protocol ("no dorsiflexion past neutral before week 12"). */
  limits: string[];
  /** Criteria to move to the next phase (not only dates). */
  criteria: string[];
  sources: RehabSource[];
}

export interface RehabMeta {
  area: string; side: string | null; surgeryDate: string | null; clearedOn: string | null; clearedBy: string | null; clearedFor: string | null;
  limits: string[]; criteria: string[]; sources: RehabSource[]; builtAt: string;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const clean = (s: unknown, n = 300) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

/** Pure: why this input can't become a rehab program, or null. */
export function rehabProblem(i: Partial<RehabInput>): string | null {
  if (!clean(i.area)) return 'Say which injury or surgery the program is for.';
  if (!clean(i.clearedOn) && !clean(i.clearedFor)) return 'Confirm what their surgeon or physio has cleared (and when) before building it.';
  if (String(i.program ?? '').trim().length < 80) return 'Write the program out: phases by week, days, exercises with sets × reps and load.';
  if (!(i.limits ?? []).filter((x) => clean(x)).length) return 'List the protocol’s hard limits (what must not happen yet).';
  if (!(i.criteria ?? []).filter((x) => clean(x)).length) return 'List the criteria to move from one phase to the next.';
  if ((i.sources ?? []).filter((x) => clean(x?.title)).length < 2) return 'Cite at least two sources (reviews, consensus statements, published protocols) — research first.';
  if (i.surgeryDate && !DATE.test(i.surgeryDate)) return 'surgeryDate must be YYYY-MM-DD.';
  return null;
}

export function rehabMeta(i: RehabInput, now = new Date()): RehabMeta {
  return {
    area: clean(i.area, 80), side: clean(i.side, 20) || null,
    surgeryDate: i.surgeryDate && DATE.test(i.surgeryDate) ? i.surgeryDate : null,
    clearedOn: clean(i.clearedOn, 40) || null, clearedBy: clean(i.clearedBy, 80) || null, clearedFor: clean(i.clearedFor, 200) || null,
    limits: i.limits.map((x) => clean(x, 200)).filter(Boolean).slice(0, 12),
    criteria: i.criteria.map((x) => clean(x, 200)).filter(Boolean).slice(0, 12),
    sources: i.sources.filter((x) => clean(x?.title)).slice(0, 10).map((x) => ({ title: clean(x.title, 200), year: x.year ?? null, url: x.url && /^https?:\/\//.test(x.url) ? String(x.url).slice(0, 300) : null })),
    builtAt: now.toISOString(),
  };
}

/** Pure: weeks since surgery on a date ("week 3" = days 14–20). */
export function postOpWeek(surgeryDate: string | null, today: string): number | null {
  if (!surgeryDate || !DATE.test(surgeryDate) || !DATE.test(today)) return null;
  const days = Math.floor((Date.parse(`${today}T12:00:00Z`) - Date.parse(`${surgeryDate}T12:00:00Z`)) / 86_400_000);
  return days < 0 ? null : Math.floor(days / 7) + 1;
}

export interface RehabPreview { name: string; weeks: number; days: number; rows: { key: string; value: string; sub?: string }[] }

/** The proposal card: the plan, its limits and criteria up front, for review with their physio. */
export function rehabCard(meta: RehabMeta, preview: RehabPreview, program: unknown, week: number | null): CardDraft {
  return {
    fn: 'PRG-21', pattern: 'proposal', rule: 'propose',
    meta: { label: `Rehab · ${meta.area}${week ? ` · week ${week} post-op` : ''}`, open: { page: 'training' } },
    rows: [
      ...preview.rows,
      ...meta.limits.slice(0, 3).map((l) => ({ key: 'Limit', value: l })),
      ...meta.criteria.slice(0, 2).map((c) => ({ key: 'Move on when', value: c })),
    ],
    why: `Built from ${meta.sources.length} sources: ${meta.sources.slice(0, 2).map((s) => `${s.title}${s.year ? ` (${s.year})` : ''}`).join('; ')}${meta.sources.length > 2 ? '…' : ''}`.slice(0, 280),
    note: `For you and your physio to review — they can change anything. ${preview.weeks} weeks · ${preview.days} days a week. This isn’t medical advice.`,
    actions: [{ id: 'apply', label: 'Make it my program', kind: 'primary' }, { id: 'keep', label: 'Not now', kind: 'secondary' }],
    entity: 'program:rehab',
    undoLine: 'Undone — your previous program is back',
    pending: { actions: { apply: { op: 'program.activate', args: { program, summary: `Rehab program · ${meta.area}` }, line: 'Your rehab program is live' }, keep: { kind: 'keep', line: 'Not saved' } } },
  } as CardDraft;
}
