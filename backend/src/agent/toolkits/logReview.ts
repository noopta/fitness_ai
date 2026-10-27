// Log review ops (design "Log review 1a", Oct 2026). A flag's fix is applied
// through the same workout ops the agent uses, so each one records its inverse
// and Undo restores the log exactly. Keep as is is reversible too.

import { defineOp, getOp } from '../ops.js';
import { prisma, parseJson } from './kit.js';
import './workouts.js'; // defines workout.remove / workout.update, which fixes run through

type Inverse = { op: string; args: Record<string, unknown> };

async function runOp(userId: string, name: string, args: Record<string, unknown>): Promise<Inverse | null> {
  const op = getOp(name);
  if (!op) throw new Error(`Unknown operation: ${name}`);
  const out = await op.run(userId, args);
  return (out.inverse as Inverse | null) ?? null;
}

/** Pure: an exercise with a review patch applied (name, equipment, weight, reps). */
export function patchExercise(e: any, patch: Record<string, any>): any {
  const x = { ...e, ...(Array.isArray(e.setEntries) ? { setEntries: e.setEntries.map((s: any) => ({ ...s })) } : {}) };
  if (patch.name) x.name = patch.name;
  if (patch.equipment) x.equipment = patch.equipment;
  if (patch.weightKg != null) {
    x.weightKg = patch.weightKg; x.bodyweight = false;
    if (Array.isArray(x.setEntries)) x.setEntries = x.setEntries.map((s: any) => ({ ...s, weightKg: patch.weightKg }));
  }
  if (patch.reps != null) {
    x.reps = String(patch.reps);
    if (Array.isArray(x.setEntries)) x.setEntries = x.setEntries.map((s: any) => ({ ...s, reps: patch.reps }));
  }
  if (patch.repsFrom != null && patch.repsTo != null) {
    if (Number.parseInt(String(x.reps), 10) === patch.repsFrom) x.reps = String(patch.repsTo);
    if (Array.isArray(x.setEntries)) x.setEntries = x.setEntries.map((s: any) => (s.reps === patch.repsFrom ? { ...s, reps: patch.repsTo } : s));
  }
  return x;
}

async function editLog(userId: string, logId: string, edit: (exs: any[]) => any[], summary: string): Promise<Inverse[]> {
  const log = await prisma.workoutLog.findFirst({ where: { id: logId, userId } });
  if (!log) throw new Error('That workout isn’t in your log any more.');
  const exs = edit(parseJson<any[]>(log.exercises, []));
  if (!exs.length) { const inv = await runOp(userId, 'workout.remove', { id: logId }); return inv ? [inv] : []; }
  const inv = await runOp(userId, 'workout.update', { id: logId, input: { date: log.date, title: log.title, exercises: exs, notes: log.notes, duration: log.duration }, summary });
  return inv ? [inv] : [];
}

defineOp({
  name: 'logflag.apply',
  run: async (userId, args) => {
    const f = await (prisma as any).logFlag.findFirst({ where: { id: String(args.flagId), userId } });
    if (!f) throw new Error('That review item is gone.');
    const s = parseJson<{ op: string; payload: any }>(f.suggestion, { op: '', payload: {} });
    const p = s.payload ?? {};
    const inverses: Inverse[] = [];
    if (s.op === 'delete') {
      for (const id of (p.logIds ?? (p.logId ? [p.logId] : [])) as string[]) { const inv = await runOp(userId, 'workout.remove', { id }); if (inv) inverses.push(inv); }
    } else if (s.op === 'merge') {
      inverses.push(...await editLog(userId, p.logId, (exs) => exs.filter((_e, i) => i !== p.index), `Merged · ${f.title}`));
    } else if (s.op === 'update' || s.op === 'fill') {
      if (!p.patch || !Object.keys(p.patch).length) throw new Error('This one needs your number — edit the entry instead.');
      inverses.push(...await editLog(userId, p.logId, (exs) => exs.map((e, i) => (i === p.index ? patchExercise(e, p.patch) : e)), `Corrected · ${f.title}`));
    } else {
      throw new Error('Unknown fix.');
    }
    await (prisma as any).logFlag.update({ where: { id: f.id }, data: { status: 'applied', resolvedAt: new Date(), resolvedVia: String(args.via ?? 'row') } });
    return { result: { flagId: f.id }, inverse: { op: 'logflag.revert', args: { flagId: f.id, inverses } }, summary: `${f.doneLabel} · ${f.title}` };
  },
});

defineOp({
  name: 'logflag.revert',
  run: async (userId, args) => {
    const inverses = ((args.inverses ?? []) as Inverse[]).slice().reverse();
    for (const inv of inverses) await runOp(userId, inv.op, inv.args);
    await (prisma as any).logFlag.updateMany({ where: { id: String(args.flagId), userId }, data: { status: 'pending', resolvedAt: null, resolvedVia: null, changeId: null } });
    return { inverse: { op: 'logflag.apply', args: { flagId: args.flagId } }, summary: 'Review fix undone' };
  },
});

defineOp({
  name: 'logflag.keep',
  run: async (userId, args) => {
    const f = await (prisma as any).logFlag.findFirst({ where: { id: String(args.flagId), userId } });
    if (!f) throw new Error('That review item is gone.');
    await (prisma as any).logFlag.update({ where: { id: f.id }, data: { status: 'dismissed', resolvedAt: new Date(), resolvedVia: 'row' } });
    return { inverse: { op: 'logflag.unkeep', args: { flagId: f.id } }, summary: `Kept as is · ${f.title}` };
  },
});

defineOp({
  name: 'logflag.unkeep',
  run: async (userId, args) => {
    await (prisma as any).logFlag.updateMany({ where: { id: String(args.flagId), userId }, data: { status: 'pending', resolvedAt: null, resolvedVia: null, changeId: null } });
    return { inverse: { op: 'logflag.keep', args: { flagId: args.flagId } }, summary: 'Back to review' };
  },
});
