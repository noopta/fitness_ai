// Change log + undo. Every write Anakin makes is in the log with its
// inverse, so "undo that" / "undo what you changed yesterday" works from chat
// even after a card's Undo link has gone.

import { registerToolkit } from '../registry.js';
import { defineOp, listChanges, revertChange, UndoError } from '../ops.js';
import { tool, schema, str } from './kit.js';
import { clockTime, dayLabel } from '../cards/format.js';

defineOp({
  name: 'change.revert',
  run: async (userId, args) => {
    const r = await revertChange(userId, String(args.changeId), { ignoreWindow: true });
    return { result: r, inverse: null, summary: `Undid · ${r.summary}` };
  },
});

export const CORE_TOOLS = [
  tool({
    name: 'read_change_log',
    kind: 'read',
    core: true,
    fn: 'MEM-LOG',
    description: 'List the recent changes you (Anakin) made for the user — logs, settings, applied proposals — newest first, with ids. Use before undo_change when the user refers to an earlier change.',
    input_schema: schema({ limit: { type: 'number', description: 'How many. Default 10.' } }),
    receipt: () => ({ verb: 'Read', text: 'Change history' }),
    execute: async (input, userId) => ({ changes: await listChanges(userId, Number(input.limit ?? 10)) }),
    card: (_i, r, ctx) => ({
      fn: 'MEM-LOG', pattern: 'glance', rule: 'show',
      meta: { label: 'What I changed' },
      rows: (r.changes as any[]).slice(0, 8).map((c) => ({
        key: c.summary,
        value: c.status === 'reverted' ? 'Undone' : `${dayLabel(c.at.slice(0, 10))} ${clockTime(new Date(c.at), ctx.tz)}`,
        mark: c.status === 'reverted' ? 'muted' as const : undefined,
      })),
      empty: (r.changes as any[]).length ? undefined : 'Nothing changed yet.',
    }),
  }),
  tool({
    name: 'undo_change',
    kind: 'set',
    core: true,
    fn: 'MEM-UNDO',
    description: 'Undo a change you made earlier ("undo that", "put it back", "undo what you changed yesterday"). Pass changeId from read_change_log; omit it to undo the most recent change that can be undone. Works after the card’s Undo link has expired.',
    input_schema: schema({ changeId: { type: 'string' } }),
    receipt: () => ({ verb: 'Adjusted', text: 'Undo' }),
    execute: async (input, userId) => {
      let id = str(input.changeId);
      if (!id) {
        const last = (await listChanges(userId, 20)).find((c) => c.status === 'applied' && c.reversible);
        if (!last) throw new UndoError('There’s nothing I changed that can be undone.');
        id = last.id;
      }
      const r = await revertChange(userId, id, { ignoreWindow: true });
      return { undone: r.summary, alreadyReverted: r.alreadyReverted };
    },
    card: (_i, r) => ({ fn: 'MEM-UNDO', pattern: 'setting', rule: 'change_undo', meta: { label: 'Undone' }, rows: [{ key: r.undone, value: r.alreadyReverted ? 'Already undone' : 'Undone' }] }),
  }),
];
registerToolkit(CORE_TOOLS);
