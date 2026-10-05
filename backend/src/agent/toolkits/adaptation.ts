// Progression suggestions (catalog ADP-01…05). Confirm-first: the engine's
// proposal is shown as notice → numbers → reasoning → proposal; the user
// can edit the weights on the card, then taps Apply (or Not now / Don't
// suggest this). Undo is the engine's own server-side undo.

import { registerToolkit } from '../registry.js';
import { defineOp } from '../ops.js';
import { tool, schema, str } from './kit.js';
import { listPending, listRecent, decide, undo, type ProposalRow } from '../../adaptation/proposalService.js';
import { weight, dayLabel } from '../cards/format.js';
import type { CardDraft, CardRow } from '../cards/types.js';
import type { ToolCtx } from '../types.js';
import { PHASE_LABEL } from '../../services/trainingSummary.js';

defineOp({
  name: 'adapt.decide',
  run: async (userId, args) => {
    const action = String(args.action) as 'apply' | 'decline' | 'snooze';
    const r = await decide(userId, String(args.id), action, { edits: (args.edits as any[]) ?? undefined, snoozeDays: args.snoozeDays ? Number(args.snoozeDays) : undefined });
    return {
      result: { status: r.proposal.status },
      inverse: action === 'apply' ? { op: 'adapt.undo', args: { id: String(args.id) } } : null,
      summary: `${action === 'apply' ? 'Applied' : action === 'snooze' ? 'Snoozed' : 'Declined'} · ${r.proposal.title}`,
    };
  },
});
defineOp({
  name: 'adapt.undo',
  run: async (userId, args) => { const r = await undo(userId, String(args.id)); return { inverse: null, summary: `Undid · ${r.proposal.title}` }; },
});

/** The target-change rows of a proposal, editable before Apply. */
function targetRows(p: ProposalRow, ctx: ToolCtx): { rows: CardRow[]; edits: Record<string, any> } {
  const pay: any = p.proposal ?? {};
  const rows: CardRow[] = [];
  const edits: Record<string, any> = {};
  const add = (key: string, name: string, fromKg: number | null | undefined, toKg: number | null | undefined, extra = '') => {
    const field = `t_${key}`.replace(/[^a-z0-9_]/gi, '_').slice(0, 50);
    rows.push({ key: name, value: toKg ? `${weight(ctx.unit, toKg)}${extra}` : '—', sub: fromKg ? `was ${weight(ctx.unit, fromKg)}` : undefined, mark: 'chg', editable: { field, kind: 'number' } });
    edits[field] = { stage: { action: 'apply', key, unit: ctx.unit } };
  };
  if (p.kind === 'load_change') add(pay.key, pay.exercise ?? pay.key, pay.fromWeightKg, pay.toWeightKg);
  else if (p.kind === 'calibration') add(pay.key, pay.exercise ?? pay.key, null, pay.targetWeightKg, pay.targetRPE ? ` · RPE ${pay.targetRPE}` : '');
  else if (p.kind === 'set_targets' || p.kind === 'retrofit') for (const t of (pay.targets ?? []).slice(0, 8)) add(t.key, t.exercise ?? t.name ?? t.key, t.fromWeightKg ?? null, t.targetWeightKg, t.targetRPE ? ` · RPE ${t.targetRPE}` : '');
  else if (p.kind === 'program_from_logs') for (const ph of (pay.program?.phases ?? []).slice(0, 4)) rows.push({ key: ph.phaseName, value: `${ph.durationWeeks ?? '—'} wk` });
  // Freestyle-release kinds: the numbers before Apply, every time.
  else if (p.kind === 'next_session') {
    const name = pay.exercise ?? pay.key;
    if (pay.toWeightKg != null) add(pay.key, name, pay.fromWeightKg, pay.toWeightKg);
    else rows.push({ key: name, value: 'Bodyweight', mark: 'chg' });
    rows.push({ key: 'Sets × reps', value: `${pay.sets ?? '—'} × ${pay.reps ?? '—'}${pay.rpe != null ? ` @ RPE ${pay.rpe}` : ''}`, mark: 'chg' });
  } else if (p.kind === 'deload') {
    const names: string[] = pay.exercises ?? pay.keys ?? [];
    rows.push({ key: 'Lifts', value: `${names.slice(0, 4).join(', ')}${names.length > 4 ? ` +${names.length - 4} more` : ''}` || '—' });
    rows.push({ key: 'Volume', value: `−${pay.volumeCutPct ?? 40}% sets for ${pay.weeks ?? 1} week${(pay.weeks ?? 1) === 1 ? '' : 's'}`, sub: 'same weights, fewer sets', mark: 'chg' });
  } else if (p.kind === 'volume_balance') {
    const muscle = String(pay.muscle ?? 'muscle');
    rows.push({ key: `${muscle[0].toUpperCase()}${muscle.slice(1)} · hard sets / week`, value: `${pay.suggestedSets ?? '—'}`, sub: pay.currentSets != null ? `now ${pay.currentSets}` : undefined, mark: 'chg' });
  } else if (p.kind === 'phase_confirm') {
    const label = (ph: string | null | undefined) => (ph ? PHASE_LABEL[ph] ?? ph : null);
    const was = label(pay.previous);
    rows.push({ key: 'Training phase', value: label(pay.phase) ?? '—', sub: was ? `was ${was}` : undefined, mark: 'chg' });
  } else if (p.kind === 'calorie_adjust') {
    const kcal = (n: number | null | undefined) => (n != null ? `${Math.round(n).toLocaleString('en-US')} kcal` : '—');
    rows.push({ key: 'Daily calories', value: kcal(pay.toKcal), sub: pay.fromKcal != null ? `was ${kcal(pay.fromKcal)}` : undefined, mark: 'chg' });
  }
  return { rows, edits };
}

export function adaptationCard(p: ProposalRow, ctx: ToolCtx): CardDraft {
  const { rows, edits } = targetRows(p, ctx);
  const evidence: CardRow[] = (p.evidence ?? []).slice(0, 3).map((e) => ({ key: e.label, value: e.value, mark: 'muted' as const }));
  const fromLogs = p.kind === 'program_from_logs';
  return {
    fn: fromLogs ? 'ADP-05' : 'ADP-01', pattern: 'proposal', rule: 'propose',
    meta: { label: `Proposed · ${p.title}`.slice(0, 60), open: { page: 'training' } },
    rows: [...evidence, ...rows],
    why: p.reasoning,
    actions: [
      { id: 'apply', label: fromLogs ? 'Make this my program' : 'Apply', kind: 'primary' },
      { id: 'snooze', label: 'Not now', kind: 'secondary' },
      { id: 'decline', label: 'Don’t suggest this', kind: 'secondary' },
    ],
    entity: `adapt:${p.dedupeKey}`,
    pending: {
      actions: {
        apply: { op: 'adapt.decide', args: { id: p.id, action: 'apply', edits: [] } },
        snooze: { op: 'adapt.decide', args: { id: p.id, action: 'snooze', snoozeDays: 7 }, status: 'kept', line: 'Not now — I’ll ask again in a week' },
        decline: { op: 'adapt.decide', args: { id: p.id, action: 'decline' }, status: 'kept', line: 'Won’t suggest this again' },
      },
      edits,
    },
  };
}

export const ADAPTATION_TOOLS = [
  tool({
    name: 'read_adaptation', kind: 'read', core: true, fn: 'ADP-01',
    description: 'Read pending progression suggestions from the adaptation engine (load changes, new targets, a program inferred from logs). Each shows what was noticed, the numbers and why; the user applies, edits, snoozes or declines on the card. Never apply one yourself.',
    input_schema: schema({}),
    receipt: () => ({ verb: 'Checked', text: 'Progression suggestions' }),
    execute: async (_i, userId) => {
      const pending = await listPending(userId);
      return { count: pending.length, proposals: pending.slice(0, 3).map((p) => ({ id: p.id, title: p.title, kind: p.kind, reasoning: p.reasoning, evidence: p.evidence })), _rows: pending.slice(0, 2) };
    },
    card: (_i, r, ctx) => r._rows.length ? r._rows.map((p: ProposalRow) => adaptationCard(p, ctx)) : { fn: 'ADP-01', pattern: 'glance', rule: 'show', meta: { label: 'Progression' }, empty: 'No changes suggested right now — keep logging and I’ll flag when a lift is ready to move.' },
  }),
  tool({
    name: 'read_adaptation_history', kind: 'read', fn: 'ADP-04',
    description: 'Recent progression suggestions and what happened to them (applied, declined, snoozed). Applied ones can be undone from the card.',
    input_schema: schema({ limit: { type: 'number' } }),
    receipt: () => ({ verb: 'Read', text: 'Suggestion history' }),
    execute: async (input, userId) => ({ items: (await listRecent(userId, Number(input.limit ?? 10))).map((p) => ({ id: p.id, title: p.title, status: p.status, decidedAt: p.decidedAt })) }),
    card: (_i, r) => {
      const items = r.items as any[];
      if (!items.length) return { fn: 'ADP-04', pattern: 'glance', rule: 'show', meta: { label: 'Past suggestions' }, empty: 'No suggestions decided yet.' };
      const applied = items.filter((x) => x.status === 'applied').slice(0, 3);
      return {
        fn: 'ADP-04', pattern: 'glance', rule: 'show', meta: { label: 'Past suggestions', open: { page: 'training' } },
        rows: items.slice(0, 8).map((x) => ({ key: x.title, value: x.status[0].toUpperCase() + x.status.slice(1), sub: x.decidedAt ? dayLabel(new Date(x.decidedAt).toISOString().slice(0, 10)) : undefined, ...(x.status === 'applied' ? { action: `undo_${x.id}` } : {}) })),
        actions: applied.map((x) => ({ id: `undo_${x.id}`, label: `Undo · ${x.title}`.slice(0, 40), kind: 'secondary' as const })),
        pending: { actions: Object.fromEntries(applied.map((x) => [`undo_${x.id}`, { op: 'adapt.undo', args: { id: x.id }, line: 'Undone' }])) },
      };
    },
  }),
];
registerToolkit(ADAPTATION_TOOLS);
export { str };
