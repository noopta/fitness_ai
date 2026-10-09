// Workouts + strength (catalog WRK-01…12, STR-01…07). Logs go through the
// shared workout service, so chat logging updates streaks, PRs, the strength
// profile and progression suggestions exactly like the app does.

import { registerToolkit } from '../registry.js';
import { defineOp, executeOp, UNDO_DELETE_MS } from '../ops.js';
import { callApi } from '../loopback.js';
import { tool, schema, str, numOr, prisma, parseJson, dateArg } from './kit.js';
import { createWorkoutLog, createWorkoutLogsBulk, updateWorkoutLog, deleteWorkoutLog, restoreWorkoutLog, type WorkoutLogInput } from '../../services/workoutLogService.js';
import { parseWorkoutNotes } from '../../services/workoutNotesParser.js';
import { buildPreview, takePreview, peekPreview, withoutLogged, previewBatch, previewInputs, rangeLabel, bestsLine, shortDay, type BackfillPreview } from '../../services/workoutBackfill.js';
import { applyCardAction, findLiveCard, userTz } from '../cards/store.js';
import { todayIn } from '../cards/format.js';
import { turnMessage } from '../turnMessage.js';
import { computeStrengthProfile } from '../../routes/strength.js';
import { cacheGet } from '../../services/cacheService.js';
import { lastForExercises } from '../../adaptation/proposalService.js';
import { loadCanonicalResolver } from '../../services/liftCanonical.js';
import { adaptationCard } from './adaptation.js';
import { weight, toKg, kgTo, dayLabel, plural, num } from '../cards/format.js';
import type { CardDraft, CardRow } from '../cards/types.js';
import type { ToolCtx } from '../types.js';

type Unit = 'metric' | 'imperial';
interface ChatExercise { name: string; sets?: number; reps?: string | number; weight?: number; rpe?: number; bodyweight?: boolean; notes?: string; setEntries?: { weight?: number; reps: number; rpe?: number }[] }

/** Chat input (user's unit) → the service's schema (kg). */
function toServiceExercises(exs: ChatExercise[], unit: Unit): WorkoutLogInput['exercises'] {
  return exs.filter((e) => str(e.name)).map((e) => {
    const entries = (e.setEntries ?? []).filter((s) => Number.isFinite(Number(s.reps)));
    const top = entries.length ? entries.reduce((a, b) => ((Number(b.weight) || 0) > (Number(a.weight) || 0) ? b : a)) : null;
    const w = top?.weight ?? e.weight;
    return {
      name: str(e.name).slice(0, 80),
      sets: Math.max(1, Math.min(100, Math.round(entries.length || Number(e.sets) || 1))),
      reps: String(top?.reps ?? e.reps ?? 1),
      weightKg: w != null && !e.bodyweight ? Math.round(toKg(unit, Number(w)) * 100) / 100 : null,
      rpe: e.rpe != null ? Number(e.rpe) : top?.rpe != null ? Number(top.rpe) : null,
      notes: e.notes ?? null,
      bodyweight: !!e.bodyweight || w == null,
      ...(entries.length ? { setEntries: entries.map((s) => ({ weightKg: s.weight != null ? Math.round(toKg(unit, Number(s.weight)) * 100) / 100 : null, reps: Math.round(Number(s.reps)), rpe: s.rpe != null ? Number(s.rpe) : null })) } : {}),
    };
  });
}
function exLine(e: any, unit: Unit): string {
  const entries = Array.isArray(e.setEntries) && e.setEntries.length ? e.setEntries : null;
  if (entries) {
    const same = entries.every((s: any) => s.weightKg === entries[0].weightKg && s.reps === entries[0].reps);
    if (same) return `${entries.length} × ${entries[0].reps}${entries[0].weightKg ? ` · ${weight(unit, entries[0].weightKg, { unit: false })}` : ''}`;
    return entries.map((s: any) => `${s.weightKg ? weight(unit, s.weightKg, { unit: false }) : 'BW'} × ${s.reps}`).join(', ');
  }
  return `${e.sets} × ${e.reps}${e.weightKg ? ` · ${weight(unit, e.weightKg, { unit: false })}` : ''}${e.rpe ? ` · RPE ${e.rpe}` : ''}`;
}
const e1rm = (kg: number, reps: number) => (reps <= 1 ? kg : kg * (1 + Math.min(reps, 10) / 30));

// ── Ops ──────────────────────────────────────────────────────────────────────
defineOp({
  name: 'workout.create',
  run: async (userId, args) => {
    const r = await createWorkoutLog(userId, args.input as WorkoutLogInput, 'agent');
    return { result: { id: r.log.id, prs: r.prs, adaptationIds: (r.adaptationProposals as any[]).map((p) => p.id), exercises: r.exercises, date: r.log.date }, inverse: { op: 'workout.remove', args: { id: r.log.id } }, summary: `Logged · ${r.log.title ?? 'Workout'} · ${plural(r.exercises.length, 'exercise')}` };
  },
});
defineOp({
  name: 'workout.remove',
  undoMs: UNDO_DELETE_MS,
  run: async (userId, args) => {
    const row = await deleteWorkoutLog(userId, String(args.id));
    if (!row) throw new Error('That workout is already gone.');
    return { result: { row }, inverse: { op: 'workout.restore', args: { row } }, summary: `Deleted · ${row.title ?? 'Workout'} · ${dayLabel(row.date)}` };
  },
});
// Backfill: many sessions in one change, so one Undo takes the whole batch back.
defineOp({
  name: 'workout.create_many',
  run: async (userId, args) => {
    // Already-logged sessions are skipped, so a card tap after a "yes" in chat
    // (or a second tap) can't log the batch twice.
    const { fresh, dupes } = await withoutLogged(userId, (args.inputs ?? []) as WorkoutLogInput[]);
    if (!fresh.length) throw new Error(dupes.length ? 'Those workouts are already in your log.' : 'Nothing to log.');
    const r = await createWorkoutLogsBulk(userId, fresh, 'agent');
    if (!r.created.length) throw new Error(`None of those could be logged (${r.failed[0]?.error ?? 'unknown error'}).`);
    const ids = r.created.map((c) => c.id);
    const dates = r.created.map((c) => c.date).sort();
    const bests = bestsLine(r.created, fresh, args.unit === 'metric' ? 'metric' : 'imperial');
    return {
      result: {
        ...r, skipped: dupes.length, from: dates[0], to: dates[dates.length - 1], bests,
        // For the card that ran this: "Logged 8 workouts" (the count after ticks) and the bests line.
        stateLine: `Logged ${plural(r.created.length, 'workout')}`,
        // Logged state (spec E): Open → history on the meta line, bests under the state line.
        cardPatch: { meta: { open: { page: 'history' } }, ...(bests ? { batch: { bests } } : {}) },
      },
      inverse: { op: 'workout.remove_many', args: { ids } },
      summary: `Logged · ${plural(r.created.length, 'past workout')} · ${dayLabel(dates[0])} to ${dayLabel(dates[dates.length - 1])}`,
    };
  },
});
defineOp({
  name: 'workout.remove_many',
  undoMs: UNDO_DELETE_MS,
  run: async (userId, args) => {
    const rows: any[] = [];
    for (const id of (args.ids ?? []) as string[]) { const row = await deleteWorkoutLog(userId, String(id)); if (row) rows.push(row); }
    if (!rows.length) throw new Error('Those workouts are already gone.');
    return { result: { removed: rows.length }, inverse: { op: 'workout.restore_many', args: { rows } }, summary: `Removed · ${plural(rows.length, 'workout')}` };
  },
});
defineOp({
  name: 'workout.restore_many',
  run: async (userId, args) => {
    const ids: string[] = [];
    for (const row of (args.rows ?? []) as any[]) ids.push((await restoreWorkoutLog(userId, row)).id);
    return { inverse: { op: 'workout.remove_many', args: { ids } }, summary: `Restored · ${plural(ids.length, 'workout')}` };
  },
});
defineOp({
  name: 'workout.restore',
  run: async (userId, args) => { const r = await restoreWorkoutLog(userId, args.row); return { inverse: { op: 'workout.remove', args: { id: r.id } }, summary: 'Workout restored' }; },
});
defineOp({
  name: 'workout.update',
  run: async (userId, args) => {
    const r = await updateWorkoutLog(userId, String(args.id), args.input as WorkoutLogInput);
    if (!r) throw new Error('That workout isn’t in your log.');
    const before = { date: r.before.date, title: r.before.title, exercises: parseJson(r.before.exercises, []), notes: r.before.notes, duration: r.before.duration };
    return { result: { id: r.updated.id }, inverse: { op: 'workout.update', args: { id: r.updated.id, input: before } }, summary: String(args.summary ?? 'Workout corrected') };
  },
});
// Inline edit of one exercise on a Logged card: value = { weight, reps } in the user's unit.
defineOp({
  name: 'workout.edit_set',
  run: async (userId, args) => {
    const log = await prisma.workoutLog.findFirst({ where: { id: String(args.id), userId } });
    if (!log) throw new Error('That workout isn’t in your log.');
    const unit = (args.unit as Unit) ?? 'imperial';
    const exs = parseJson<any[]>(log.exercises, []);
    const ex = exs[Number(args.exIndex)];
    if (!ex) throw new Error('That exercise isn’t in this workout.');
    const v = args.value as { weight: number; reps: number };
    const kg = Math.round(toKg(unit, v.weight) * 100) / 100;
    const before = exLine(ex, unit);
    if (Array.isArray(ex.setEntries) && ex.setEntries.length) ex.setEntries = ex.setEntries.map((s: any) => ({ ...s, weightKg: kg, reps: v.reps }));
    ex.weightKg = kg; ex.reps = String(v.reps); ex.bodyweight = false;
    const input = { date: log.date, title: log.title, exercises: exs, notes: log.notes, duration: log.duration };
    const r = await updateWorkoutLog(userId, log.id, input as any);
    const prev = { date: log.date, title: log.title, exercises: parseJson(log.exercises, []), notes: log.notes, duration: log.duration };
    return { result: { display: exLine(ex, unit), id: r?.updated.id }, inverse: { op: 'workout.update', args: { id: log.id, input: prev } }, summary: `Corrected · ${ex.name} ${before} → ${exLine(ex, unit)}` };
  },
});
// Add one set to today's workout (creating it if needed).
defineOp({
  name: 'workout.add_set',
  run: async (userId, args) => {
    const unit = (args.unit as Unit) ?? 'imperial';
    const date = String(args.date);
    const name = str(args.exercise);
    const v = args.value as { weight: number; reps: number };
    const set = { weightKg: v.weight ? Math.round(toKg(unit, v.weight) * 100) / 100 : null, reps: Math.round(v.reps), rpe: args.rpe != null ? Number(args.rpe) : null };
    const log = await prisma.workoutLog.findFirst({ where: { userId, date }, orderBy: { createdAt: 'desc' } });
    if (!log) {
      const r = await createWorkoutLog(userId, { date, title: 'Quick sets', exercises: [{ name, sets: 1, reps: String(set.reps), weightKg: set.weightKg, rpe: set.rpe, bodyweight: !set.weightKg, setEntries: [set] }] }, 'agent');
      return { result: { id: r.log.id, created: true, prs: r.prs, display: `${set.weightKg ? weight(unit, set.weightKg, { unit: false }) : 'BW'} × ${set.reps}` }, inverse: { op: 'workout.remove', args: { id: r.log.id } }, summary: `Logged · ${name} ${set.weightKg ? weight(unit, set.weightKg) : 'BW'} × ${set.reps}` };
    }
    const prev = { date: log.date, title: log.title, exercises: parseJson(log.exercises, []), notes: log.notes, duration: log.duration };
    const exs = parseJson<any[]>(log.exercises, []);
    const i = exs.findIndex((e) => String(e.name).toLowerCase() === name.toLowerCase());
    if (i >= 0) {
      const e = exs[i];
      const entries = Array.isArray(e.setEntries) && e.setEntries.length ? e.setEntries : Array.from({ length: Number(e.sets) || 1 }, () => ({ weightKg: e.weightKg ?? null, reps: Number(e.reps) || 0, rpe: e.rpe ?? null }));
      entries.push(set);
      const top = entries.reduce((a: any, b: any) => ((b.weightKg ?? 0) > (a.weightKg ?? 0) ? b : a));
      exs[i] = { ...e, setEntries: entries, sets: entries.length, weightKg: top.weightKg, reps: String(top.reps), bodyweight: !top.weightKg };
    } else {
      exs.push({ name, sets: 1, reps: String(set.reps), weightKg: set.weightKg, rpe: set.rpe, bodyweight: !set.weightKg, setEntries: [set] });
    }
    await updateWorkoutLog(userId, log.id, { ...prev, exercises: exs } as any);
    return { result: { id: log.id, created: false, display: `${set.weightKg ? weight(unit, set.weightKg, { unit: false }) : 'BW'} × ${set.reps}` }, inverse: { op: 'workout.update', args: { id: log.id, input: prev } }, summary: `Logged · ${name} ${set.weightKg ? weight(unit, set.weightKg) : 'BW'} × ${set.reps}` };
  },
});
// Inline logger row ("Log a set" on an empty lift card).
defineOp({
  name: 'workout.quick_set',
  run: async (userId, args) => (await import('../ops.js')).getOp('workout.add_set')!.run(userId, args),
});

async function findLog(userId: string, input: Record<string, unknown>, ctx: ToolCtx) {
  if (str(input.logId)) return prisma.workoutLog.findFirst({ where: { id: str(input.logId), userId } });
  if (str(input.date)) return prisma.workoutLog.findFirst({ where: { userId, date: dateArg(input.date, ctx) }, orderBy: { createdAt: 'desc' } });
  const ex = str(input.exercise).toLowerCase();
  const recent = await prisma.workoutLog.findMany({ where: { userId }, orderBy: [{ date: 'desc' }, { createdAt: 'desc' }], take: 10 });
  return (ex ? recent.find((l) => l.exercises.toLowerCase().includes(ex)) : null) ?? recent[0] ?? null;
}

/**
 * "Does this logged name mean the exercise the user asked about?" — the same
 * canonical key the adaptation engine uses ("bench" ≠ "Bench Press" by key,
 * but "barbell bench press" = "Bench Press"), with the old substring match
 * kept for fragments ("bench", "squat"). Empty query matches everything.
 */
export async function exerciseMatcher(query: string, names: string[]): Promise<(name: string) => boolean> {
  const q = str(query).toLowerCase();
  if (!q) return () => true;
  const resolver = await loadCanonicalResolver(prisma, [query, ...names]);
  const qKey = resolver.key(query);
  const qCanon = resolver.resolve(query)?.canonicalName.toLowerCase() ?? null;
  return (name: string) => {
    const n = String(name ?? '');
    if (!n) return false;
    if (n.toLowerCase().includes(q)) return true;
    const k = resolver.key(n);
    if (qKey && k === qKey) return true;
    // A fragment that names a canonical lift ("bench") also matches its variants.
    const canon = resolver.resolve(n)?.canonicalName.toLowerCase() ?? null;
    return !!canon && (canon.includes(q) || (!!qCanon && canon === qCanon));
  };
}

function loggedCard(fn: string, logId: string, date: string, title: string | null, exercises: any[], ctx: ToolCtx, extra: Partial<CardDraft> = {}): CardDraft {
  const rows: CardRow[] = exercises.map((e, i) => ({ key: e.name, value: exLine(e, ctx.unit), editable: { field: `ex${i}`, kind: 'weightReps' } }));
  const edits = Object.fromEntries(exercises.map((_e, i) => [`ex${i}`, { op: 'workout.edit_set', args: { id: logId, exIndex: i, unit: ctx.unit }, valueKey: 'value', parse: 'weightReps' as const }]));
  const sets = exercises.reduce((n, e) => n + (Array.isArray(e.setEntries) && e.setEntries.length ? e.setEntries.length : Number(e.sets) || 0), 0);
  return { fn, pattern: 'logged', rule: 'log_undo', meta: { label: `Logged · ${title ?? 'Workout'} · ${date === ctx.today ? 'today' : dayLabel(date)}`, open: { page: 'history' } }, rows, note: `${plural(sets, 'set')}.`, pending: { edits }, undoLine: 'Undone — nothing logged', ...extra };
}

export const WORKOUT_TOOLS = [
  tool({
    name: 'log_workout', kind: 'log', core: true, fn: 'WRK-02',
    description: 'Log a workout the user did (today or another date). exercises = [{ name, sets, reps, weight (their unit), rpe?, bodyweight?, setEntries?: [{ weight, reps, rpe? }] }] — use setEntries when sets differ. Log it on the same turn they tell you; don’t ask to confirm. Streaks, PRs and progression suggestions update automatically.',
    input_schema: schema({
      exercises: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, sets: { type: 'number' }, reps: { type: 'string' }, weight: { type: 'number' }, rpe: { type: 'number' }, bodyweight: { type: 'boolean' }, notes: { type: 'string' }, setEntries: { type: 'array', items: { type: 'object', properties: { weight: { type: 'number' }, reps: { type: 'number' }, rpe: { type: 'number' } }, required: ['reps'] } } }, required: ['name'] } },
      date: { type: 'string', description: 'YYYY-MM-DD, default today' }, title: { type: 'string' }, durationMin: { type: 'number' }, notes: { type: 'string' },
    }, ['exercises']),
    receipt: (i) => ({ verb: 'Logged', text: str(i.title) || 'Workout' }),
    execute: async (input, userId) => {
      const u = await prisma.user.findUnique({ where: { id: userId }, select: { unitPreference: true } });
      const unit: Unit = u?.unitPreference === 'metric' ? 'metric' : 'imperial';
      const exercises = toServiceExercises((input.exercises ?? []) as ChatExercise[], unit);
      if (!exercises.length) throw new Error('Tell me at least one exercise.');
      const tz = (await import('../cards/store.js')).userTz;
      const today = (await import('../cards/format.js')).todayIn(await tz(userId));
      const date = /^\d{4}-\d{2}-\d{2}$/.test(str(input.date)) ? str(input.date) : today;
      // Link today's log to the planned day so the adaptation engine can score it.
      let programDayRef: any = null;
      if (date === today) { try { programDayRef = ((await callApi<any>(userId, 'GET', '/coach/today')) ?? {}).programDayRef ?? null; } catch { /* ad-hoc */ } }
      const change = await executeOp(userId, 'workout.create', { input: { date, title: str(input.title) || null, exercises, notes: str(input.notes) || null, duration: numOr(input.durationMin) ? Math.round(numOr(input.durationMin)!) : null, programDayRef } });
      const r = change.result as any;
      return { logged: change.summary, id: r.id, date, prs: r.prs.map((p: any) => p.displayName), adaptationIds: r.adaptationIds, _exercises: r.exercises, _change: change };
    },
    card: async (input, r, ctx) => {
      const cards: CardDraft[] = [loggedCard(str(input.date) && str(input.date) !== ctx.today ? 'WRK-04' : 'WRK-02', r.id, r.date, str(input.title) || null, r._exercises, ctx, r.prs.length ? { why: `New best: ${r.prs.join(', ')}.` } : {})];
      if (r.adaptationIds.length) {
        const { listPending } = await import('../../adaptation/proposalService.js');
        const p = (await listPending(ctx.userId)).find((x) => r.adaptationIds.includes(x.id));
        if (p) cards.push(adaptationCard(p, ctx));
      }
      return cards;
    },
  }),
  tool({
    name: 'log_past_workouts', kind: 'log', core: true, fn: 'WRK-13',
    description: 'Fill in workout history: several past sessions at once, any distance back (up to a year). Use when the user wants to log workouts they did on earlier days — pasted notes, a spreadsheet, a list, or a description in their own words, however messy. Two steps. 1) Preview: pass useMessage: true when the workouts are in the user\'s latest message (don\'t copy the text), or notes for text from earlier in the chat, or workouts [{ date, title?, exercises }] you already have. Nothing is saved yet; the result lists what will be logged, what has no date, what was left out. To drop part of a preview ("skip the week of 27 Jul", "not the 3rd"), call again with its previewId plus skipWeeksOf / skipDates — a fresh preview replaces the old one. 2) Only after they say yes in chat: call again with confirm: true and the previewId (the card, if shown, flips to Logged). For one session today use log_workout instead. If mode is "none", tell them nothing was found using the `say` line.',
    input_schema: schema({
      useMessage: { type: 'boolean', description: 'Read the workouts from the user\'s latest message.' },
      notes: { type: 'string', description: 'Workout text from earlier in the conversation.' },
      workouts: { type: 'array', items: { type: 'object', properties: { date: { type: 'string', description: 'YYYY-MM-DD' }, title: { type: 'string' }, exercises: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, sets: { type: 'number' }, reps: { type: 'string' }, weight: { type: 'number' }, rpe: { type: 'number' }, bodyweight: { type: 'boolean' }, notes: { type: 'string' }, setEntries: { type: 'array', items: { type: 'object', properties: { weight: { type: 'number' }, reps: { type: 'number' }, rpe: { type: 'number' } }, required: ['reps'] } } }, required: ['name'] } } }, required: ['date', 'exercises'] } },
      previewId: { type: 'string', description: 'A preview from an earlier call: to confirm it, or to re-preview it without some weeks or days.' },
      skipWeeksOf: { type: 'array', items: { type: 'string' }, description: 'With previewId: drop every session in the Monday–Sunday week containing each YYYY-MM-DD.' },
      skipDates: { type: 'array', items: { type: 'string' }, description: 'With previewId: drop the sessions on these YYYY-MM-DD days.' },
      confirm: { type: 'boolean', description: 'Log the preview — only after the user said yes in chat.' },
    }),
    receipt: (i, userId) => {
      if (i.confirm) return { verb: 'Logged', text: 'Past workouts' };
      if (i.useMessage && userId) return { verb: 'Reading', text: `Your notes · ${turnMessage(userId).length.toLocaleString('en-US')} characters` };
      return { verb: 'Reading', text: 'Workout history' };
    },
    refine: (r) => {
      if (!r || typeof r !== 'object') return null;
      if (r.mode === 'none') return { verb: 'Read', text: 'Your notes · no workouts' };
      if (r.mode === 'logged') return { verb: 'Logged', text: `${plural(r.count, 'past workout')} · ${shortDay(r.from)} – ${shortDay(r.to)}` };
      return { verb: 'Read', text: `Workout history · ${plural(r.found, 'session')}` };
    },
    execute: async (input, userId) => {
      const u = await prisma.user.findUnique({ where: { id: userId }, select: { unitPreference: true } });
      const unit: Unit = u?.unitPreference === 'metric' ? 'metric' : 'imperial';
      const { todayIn } = await import('../cards/format.js');
      const { userTz } = await import('../cards/store.js');
      const today = todayIn(await userTz(userId));
      const previewId = str(input.previewId);

      if (input.confirm) {
        // The new app showed a card for this preview: log through it, so the card
        // itself flips to Logged (one source of truth — spec Q7).
        const live = previewId ? await findLiveCard(userId, 'WRK-13', (p) => (p.actions?.apply as any)?.args?.previewId === previewId) : null;
        if (live) {
          takePreview(userId, previewId);
          const card = await applyCardAction(userId, live.id, 'apply');
          const n = Number((card.state?.line ?? '').match(/\d+/)?.[0] ?? 0);
          return { mode: 'logged', logged: card.state?.line, count: n, from: card.batch?.sessions.find((x) => x.date)?.date ?? today, to: [...(card.batch?.sessions ?? [])].reverse().find((x) => x.date)?.date ?? today, bests: card.batch?.bests ?? null, undoable: true, _cardUpdates: [card] };
        }
        const p = takePreview(userId, previewId);
        if (!p) throw new Error('That preview has expired or was already logged. Read the workouts again with a fresh preview.');
        if (!p.ready.length) throw new Error('That preview had nothing with a date to log.');
        const change = await executeOp(userId, 'workout.create_many', { inputs: p.ready, unit });
        const r = change.result as any;
        return { mode: 'logged', logged: change.summary, count: r.created.length, skippedAlreadyLogged: r.skipped, failed: r.failed, from: r.from, to: r.to, bests: r.bests ?? null, _created: r.created, _change: change };
      }

      let p: BackfillPreview;
      if (previewId && !input.useMessage && !str(input.notes) && !Array.isArray(input.workouts)) {
        // Re-preview: the same sessions minus the weeks or days the user dropped.
        const prev = peekPreview(userId, previewId);
        if (!prev) throw new Error('That preview has expired. Read the workouts again.');
        const weekOf = (d: string) => { const t = new Date(`${d}T12:00:00Z`); t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7)); return t.toISOString().slice(0, 10); };
        const dropWeeks = new Set(((input.skipWeeksOf as string[] | undefined) ?? []).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).map(weekOf));
        const dropDays = new Set(((input.skipDates as string[] | undefined) ?? []).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)));
        const kept = prev.ready.filter((x) => !dropDays.has(x.date) && !dropWeeks.has(weekOf(x.date)));
        p = await buildPreview(userId, [...kept.map((x) => ({ date: x.date, title: x.title ?? null, exercises: x.exercises })), ...prev.undated.map((x) => ({ date: null, title: x.title, exercises: x.exercises }))], today, prev.unparsed);
        p.duplicates = [...prev.duplicates, ...p.duplicates];
        p.future = [...prev.future, ...p.future];
      } else {
        const text = input.useMessage ? turnMessage(userId) : str(input.notes);
        const parsed = text.trim() ? await parseWorkoutNotes(text, unit, today) : { workouts: [], unparsed: [] };
        const candidates = [
          ...parsed.workouts.map((w) => ({ date: w.date, title: w.title, exercises: toServiceExercises(w.exercises as unknown as ChatExercise[], unit) })),
          ...((Array.isArray(input.workouts) ? input.workouts : []) as any[]).map((w) => ({
            date: /^\d{4}-\d{2}-\d{2}$/.test(str(w?.date)) ? str(w.date) : null,
            title: str(w?.title) || null,
            exercises: toServiceExercises((Array.isArray(w?.exercises) ? w.exercises : []) as ChatExercise[], unit),
          })),
        ];
        if (!candidates.some((c) => c.exercises.length)) {
          // Spec state I: no card, one line on what to paste.
          return { mode: 'none', found: 0, say: 'I couldn’t find any workouts in that. Paste sessions with the lifts and sets — like “bench 185 3×5” — any format works.' };
        }
        p = await buildPreview(userId, candidates, today, parsed.unparsed);
      }
      const dates = p.ready.map((w) => w.date);
      return {
        mode: 'preview', previewId: p.previewId, toLog: p.ready.length, found: p.ready.length + p.undated.length + p.duplicates.length,
        from: dates[0] ?? null, to: dates[dates.length - 1] ?? null,
        sessions: p.ready.map((w) => ({ date: w.date, title: w.title ?? null, exercises: w.exercises.map((e) => e.name) })),
        undated: p.undated.map((x) => ({ title: x.title, exercises: x.exercises.map((e) => e.name) })),
        alreadyLogged: p.duplicates, futureDatesSkipped: p.future, unreadLines: p.unparsed.slice(0, 8),
        _preview: p, _unit: unit,
      };
    },
    card: (_input, r) => {
      if (r.mode === 'none' || r.mode === 'logged') return null; // none: text only; logged: the preview card itself flips
      const p = r._preview as BackfillPreview;
      if (!p.ready.length && !p.undated.length) {
        // Spec state H: everything was already in the log (or dated ahead).
        const ds = p.duplicates.map((d) => d.date).sort();
        const why = p.duplicates.length
          ? `All ${plural(p.duplicates.length, 'session')} ${p.duplicates.length === 1 ? 'is' : 'are'} already in your log${ds.length ? ` (${ds[0] === ds[ds.length - 1] ? shortDay(ds[0]) : `${shortDay(ds[0])} – ${shortDay(ds[ds.length - 1])}`})` : ''}. Nothing to add.`
          : 'Nothing with a date to add.';
        return {
          fn: 'WRK-13', pattern: 'glance', rule: 'show', meta: { label: 'Past workouts' }, empty: why, entity: 'workouts:backfill',
          actions: [{ id: 'history', label: 'Open history', kind: 'primary', client: { action: 'open_page', args: { page: 'history' } } }],
        };
      }
      const batch = previewBatch(p, r._unit);
      const n = p.ready.length; // undated rows start unticked; the client recounts as ticks change
      return {
        fn: 'WRK-13', pattern: 'proposal', rule: 'propose',
        meta: { label: rangeLabel(p.ready.map((x) => x.date)) },
        batch,
        actions: [{ id: 'apply', label: `Log ${plural(n, 'workout')}`, kind: 'primary' }, { id: 'keep', label: 'Not now', kind: 'secondary' }],
        entity: 'workouts:backfill',
        undoLine: 'Undone — those workouts are out of your log',
        pending: {
          actions: { apply: { op: 'workout.create_many', args: { inputs: previewInputs(p), unit: r._unit, previewId: p.previewId }, status: 'applied' }, keep: { kind: 'keep', line: 'Not logged' } },
          batch: { action: 'apply' },
        },
      };
    },
  }),
  tool({
    name: 'log_set', kind: 'log', core: true, fn: 'WRK-03',
    description: 'Log a single set ("just hit 225 for 3"): adds it to today’s workout, or starts one. Weight in the user’s unit; 0 for bodyweight.',
    input_schema: schema({ exercise: { type: 'string' }, weight: { type: 'number' }, reps: { type: 'number' }, rpe: { type: 'number' }, date: { type: 'string' } }, ['exercise', 'reps']),
    receipt: (i) => ({ verb: 'Logged', text: `${str(i.exercise)} · ${i.weight ?? 'BW'} × ${i.reps}` }),
    execute: async (input, userId) => {
      const ctxU = await prisma.user.findUnique({ where: { id: userId }, select: { unitPreference: true } });
      const unit: Unit = ctxU?.unitPreference === 'metric' ? 'metric' : 'imperial';
      const { todayIn } = await import('../cards/format.js');
      const { userTz } = await import('../cards/store.js');
      const date = /^\d{4}-\d{2}-\d{2}$/.test(str(input.date)) ? str(input.date) : todayIn(await userTz(userId));
      const change = await executeOp(userId, 'workout.add_set', { exercise: str(input.exercise), value: { weight: Number(input.weight ?? 0), reps: Number(input.reps) }, rpe: input.rpe ?? null, date, unit });
      return { logged: change.summary, ...(change.result as any), exercise: str(input.exercise), _change: change };
    },
    card: (_i, r) => ({ fn: 'WRK-03', pattern: 'logged', rule: 'log_undo', meta: { label: `Logged · ${r.exercise}`, open: { page: 'history' } }, rows: [{ key: r.exercise, value: r.display }], note: r.created ? 'Started today’s workout.' : 'Added to today’s workout.', undoLine: 'Undone — set removed' }),
  }),
  tool({
    name: 'update_workout', kind: 'log', fn: 'WRK-05',
    description: 'Correct a logged workout ("that was 195 not 185", "I did 4 sets"). Finds the workout by logId, date, or the most recent one with that exercise. Pass the corrected weight (user’s unit), reps and/or sets for the exercise.',
    input_schema: schema({ logId: { type: 'string' }, date: { type: 'string' }, exercise: { type: 'string' }, weight: { type: 'number' }, reps: { type: 'number' }, sets: { type: 'number' }, newName: { type: 'string' } }, ['exercise']),
    receipt: (i) => ({ verb: 'Corrected', text: str(i.exercise) }),
    execute: async (input, userId) => {
      const u = await prisma.user.findUnique({ where: { id: userId }, select: { unitPreference: true, timezone: true } });
      const unit: Unit = u?.unitPreference === 'metric' ? 'metric' : 'imperial';
      const tz = u?.timezone || 'America/New_York';
      const log = await findLog(userId, input, { userId, unit, tz, today: todayIn(tz) });
      if (!log) throw new Error('I couldn’t find that workout.');
      const exs = parseJson<any[]>(log.exercises, []);
      const name = str(input.exercise).toLowerCase();
      const i = exs.findIndex((e) => String(e.name).toLowerCase().includes(name));
      if (i < 0) throw new Error(`${str(input.exercise)} isn’t in that workout (${exs.map((e) => e.name).join(', ')}).`);
      const e = exs[i];
      const before = exLine(e, unit);
      if (numOr(input.weight) != null) { const kg = Math.round(toKg(unit, numOr(input.weight)!) * 100) / 100; e.weightKg = kg; e.bodyweight = false; if (Array.isArray(e.setEntries)) e.setEntries = e.setEntries.map((s: any) => ({ ...s, weightKg: kg })); }
      if (numOr(input.reps) != null) { e.reps = String(Math.round(numOr(input.reps)!)); if (Array.isArray(e.setEntries)) e.setEntries = e.setEntries.map((s: any) => ({ ...s, reps: Math.round(numOr(input.reps)!) })); }
      if (numOr(input.sets) != null) { const n = Math.max(1, Math.round(numOr(input.sets)!)); e.sets = n; if (Array.isArray(e.setEntries) && e.setEntries.length) { const last = e.setEntries[e.setEntries.length - 1]; e.setEntries = Array.from({ length: n }, (_x, k) => e.setEntries[k] ?? { ...last }); } }
      if (str(input.newName)) e.name = str(input.newName);
      const change = await executeOp(userId, 'workout.update', { id: log.id, input: { date: log.date, title: log.title, exercises: exs, notes: log.notes, duration: log.duration }, summary: `Corrected · ${e.name} ${before} → ${exLine(e, unit)}` });
      return { corrected: change.summary, id: log.id, date: log.date, title: log.title, index: i, before, _exercises: exs, _change: change };
    },
    card: (_i, r, ctx) => {
      const c = loggedCard('WRK-05', r.id, r.date, r.title, r._exercises, ctx);
      if (c.rows?.[r.index]) c.rows[r.index].was = r.before;
      return c;
    },
  }),
  tool({
    name: 'delete_workout', kind: 'confirm', fn: 'WRK-06',
    description: 'The user wants a logged workout deleted. Finds it by logId or date (or the latest). The card lists what goes; the tap deletes it (Undo for 30 seconds).',
    input_schema: schema({ logId: { type: 'string' }, date: { type: 'string' } }),
    receipt: () => ({ verb: 'Read', text: 'Workout to delete' }),
    execute: async (input, userId) => {
      const tz = await userTz(userId);
      const log = await findLog(userId, input, { userId, unit: 'imperial', tz, today: todayIn(tz) });
      if (!log) throw new Error('I couldn’t find that workout.');
      const exs = parseJson<any[]>(log.exercises, []);
      const sets = exs.reduce((n, e) => n + (Array.isArray(e.setEntries) && e.setEntries.length ? e.setEntries.length : Number(e.sets) || 0), 0);
      return { id: log.id, date: log.date, title: log.title ?? 'Workout', sets, exercises: exs.map((e) => e.name) };
    },
    card: (_i, r) => ({
      fn: 'WRK-06', pattern: 'confirm', rule: 'confirm_delete', meta: { label: 'Delete workout' },
      lose: { items: [`${r.sets} sets from ${dayLabel(r.date)} · ${r.title}`, 'Any best set in it is recalculated', 'Your streak is recalculated'] },
      actions: [{ id: 'delete', label: 'Delete', kind: 'destructive' }, { id: 'keep', label: 'Keep', kind: 'cancel' }],
      pending: { actions: { delete: { op: 'workout.remove', args: { id: r.id }, status: 'deleted', line: 'Deleted · Undo' }, keep: { kind: 'keep' } } },
    }),
  }),
  tool({
    name: 'read_recent_workouts', kind: 'read', core: true, fn: 'WRK-07',
    description: 'Logged workouts in a window (default last 14 days), optionally only those with one exercise. Use for "what did I do last week", "when did I last deadlift".',
    input_schema: schema({ days: { type: 'number' }, from: { type: 'string' }, to: { type: 'string' }, exercise: { type: 'string' } }),
    receipt: (i) => ({ verb: 'Pulled', text: str(i.exercise) ? `Workouts · ${str(i.exercise)}` : 'Recent workouts' }),
    execute: async (input, userId) => {
      const u = await prisma.user.findUnique({ where: { id: userId }, select: { unitPreference: true } });
      const unit: Unit = u?.unitPreference === 'metric' ? 'metric' : 'imperial';
      const to = /^\d{4}-\d{2}-\d{2}$/.test(str(input.to)) ? str(input.to) : '9999-12-31';
      const from = /^\d{4}-\d{2}-\d{2}$/.test(str(input.from)) ? str(input.from) : new Date(Date.now() - (numOr(input.days) ?? 14) * 86400000).toISOString().slice(0, 10);
      const logs = await prisma.workoutLog.findMany({ where: { userId, date: { gte: from, lte: to } }, orderBy: [{ date: 'desc' }, { createdAt: 'desc' }], take: 40 });
      const parsed = logs.map((l) => ({ id: l.id, date: l.date, title: l.title, duration: l.duration, exercises: parseJson<any[]>(l.exercises, []) }));
      const match = await exerciseMatcher(str(input.exercise), parsed.flatMap((l) => l.exercises.map((e) => String(e?.name ?? ''))));
      const list = parsed.filter((l) => l.exercises.some((e) => match(String(e?.name ?? ''))));
      return { count: list.length, workouts: list.map((l) => ({ ...l, exercises: l.exercises.map((e) => ({ name: e.name, line: exLine(e, unit), ...(str(input.exercise) && match(String(e?.name ?? '')) ? { hit: true } : {}) })) })) };
    },
    card: (input, r) => {
      if (!r.count) return { fn: 'WRK-07', pattern: 'glance', rule: 'show', meta: { label: 'Workout history' }, empty: str(input.exercise) ? `No ${str(input.exercise)} in that window.` : 'No workouts logged in that window.', actions: [{ id: 'log', label: 'Log a workout', kind: 'primary', client: { action: 'send_message', args: { text: 'Log a workout.' } } }] };
      const ex = str(input.exercise).toLowerCase();
      return {
        fn: 'WRK-07', pattern: 'glance', rule: 'show', meta: { label: ex ? `History · ${str(input.exercise)}` : `Workouts · ${plural(r.count, 'session')}`, open: { page: 'history' } },
        rows: r.workouts.slice(0, 10).map((w: any) => {
          const hit = ex ? w.exercises.find((e: any) => e.hit) ?? w.exercises.find((e: any) => String(e.name).toLowerCase().includes(ex)) : null;
          return { key: dayLabel(w.date), value: hit ? hit.line : (w.title ?? 'Workout'), sub: hit ? undefined : w.exercises.map((e: any) => e.name).slice(0, 4).join(', ') };
        }),
      };
    },
  }),
  tool({
    name: 'read_exercise_history', kind: 'read', fn: 'WRK-08',
    description: 'The last few sessions of one exercise (top set, all sets, e1RM) and today’s target. Use for "what did I squat last time", "what should I use today".',
    input_schema: schema({ exercise: { type: 'string' } }, ['exercise']),
    receipt: (i) => ({ verb: 'Pulled', text: `${str(i.exercise)} · last sessions` }),
    execute: async (input, userId) => {
      const [last] = await lastForExercises(userId, [str(input.exercise)]);
      return { name: last?.name ?? str(input.exercise), exposures: last?.exposures ?? [], target: last?.target ?? null };
    },
    card: (_i, r, ctx) => ({
      fn: 'WRK-08', pattern: 'glance', rule: 'show', meta: { label: r.name, open: { page: 'lift', params: { name: r.name } } },
      rows: [
        ...(r.target?.targetWeightKg ? [{ key: 'Today’s target', value: `${weight(ctx.unit, r.target.targetWeightKg)} × ${r.target.reps}${r.target.targetRPE ? ` · RPE ${r.target.targetRPE}` : ''}`, mark: 'chg' as const }] : []),
        ...r.exposures.slice(0, 3).map((x: any) => ({ key: dayLabel(x.date), value: x.top ? `${x.top.weightKg ? weight(ctx.unit, x.top.weightKg, { unit: false }) : 'BW'} × ${x.top.reps}` : '—', sub: `${plural(x.sets.length, 'set')}` })),
        { key: 'Log a set', value: 'weight × reps', editable: { field: 'log', kind: 'weightReps' } },
      ],
      ...(r.exposures.length ? {} : { empty: `No ${r.name} sets yet.` }),
      pending: { edits: { log: { op: 'workout.quick_set', args: { exercise: r.name, date: ctx.today, unit: ctx.unit }, valueKey: 'value', parse: 'weightReps' } } },
    }),
  }),
  tool({
    name: 'read_prs', kind: 'read', fn: 'WRK-09',
    description: 'The user’s best lifts: estimated 1RM per lift and the set it came from, with dates.',
    input_schema: schema({ lift: { type: 'string' } }),
    receipt: () => ({ verb: 'Computed', text: 'Personal records' }),
    execute: async (input, userId) => {
      const logs = await prisma.workoutLog.findMany({ where: { userId }, select: { date: true, exercises: true }, orderBy: { date: 'asc' } });
      const best = new Map<string, { name: string; e1rmKg: number; weightKg: number; reps: number; date: string }>();
      const parsed = logs.map((l) => ({ date: l.date, exercises: parseJson<any[]>(l.exercises, []).filter((e) => e?.name) }));
      // One lift, many spellings: group by the canonical key so "Bench Press"
      // and "barbell bench press" share one best.
      const names = await loadCanonicalResolver(prisma, parsed.flatMap((l) => l.exercises.map((e) => String(e.name))));
      for (const l of parsed) for (const e of l.exercises) {
        const sets = Array.isArray(e.setEntries) && e.setEntries.length ? e.setEntries : [{ weightKg: e.weightKg, reps: Number(e.reps) || 0 }];
        const k = names.key(String(e.name)) || String(e.name).toLowerCase().trim();
        const display = names.resolve(String(e.name))?.canonicalName ?? e.name;
        for (const s of sets) {
          if (!s.weightKg || !s.reps) continue;
          const v = e1rm(s.weightKg, s.reps);
          if (!best.has(k) || best.get(k)!.e1rmKg < v) best.set(k, { name: display, e1rmKg: v, weightKg: s.weightKg, reps: s.reps, date: l.date });
        }
      }
      const match = await exerciseMatcher(str(input.lift), [...best.values()].map((b) => b.name));
      const list = [...best.values()].filter((b) => match(b.name)).sort((a, b) => b.e1rmKg - a.e1rmKg).slice(0, 10);
      return { prs: list };
    },
    card: (_i, r, ctx) => r.prs.length
      ? { fn: 'WRK-09', pattern: 'glance', rule: 'show', meta: { label: 'Personal records', open: { page: 'strength' } }, rows: r.prs.slice(0, 8).map((p: any) => ({ key: p.name, value: weight(ctx.unit, p.e1rmKg), sub: `${weight(ctx.unit, p.weightKg, { unit: false })} × ${p.reps} · ${dayLabel(p.date)}` })), actions: [{ id: 'share', label: 'Share', kind: 'secondary', client: { action: 'share', args: { card: 'strength' } } }] }
      : { fn: 'WRK-09', pattern: 'glance', rule: 'show', meta: { label: 'Personal records' }, empty: 'No weighted sets logged yet.' },
  }),
  tool({
    name: 'start_session', kind: 'intent', fn: 'WRK-01',
    description: 'Open today’s guided session (set by set, rest timer, load adjustments).',
    input_schema: schema({}),
    receipt: () => ({ verb: 'Opened', text: 'Session' }),
    execute: async (_i, userId) => { const t: any = await callApi(userId, 'GET', '/coach/today').catch(() => null); return { name: t?.dayName ?? t?.session?.name ?? null, count: (t?.exercises ?? t?.session?.exercises ?? []).length }; },
    card: (_i, r) => r.count
      ? { fn: 'WRK-01', pattern: 'handoff', rule: 'handoff', meta: { label: `${String(r.name ?? 'Today').split(/[—–·/]/)[0].trim()} · ${Math.round(r.count * 9 + 8)} min` }, handoff: { label: 'Begin', action: 'start_session' } }
      : { fn: 'WRK-01', pattern: 'glance', rule: 'show', meta: { label: 'Today' }, empty: 'Nothing is scheduled today.', actions: [{ id: 'pull', label: 'Pull a session forward', kind: 'primary', client: { action: 'send_message', args: { text: 'Can I train today? Pull a session forward.' } } }] },
  }),
];

// ── Strength ─────────────────────────────────────────────────────────────────
async function strengthProfile(userId: string): Promise<any> {
  // Same cache the /strength/profile route warms after every workout mutation.
  return cacheGet<any>(`strength:profile:${userId}`) ?? computeStrengthProfile(userId);
}
const TIERS = ['Novice', 'Beginner', 'Intermediate', 'Advanced', 'Elite'];

export const STRENGTH_TOOLS = [
  tool({
    name: 'read_strength_profile', kind: 'read', core: true, fn: 'STR-01',
    description: 'The user’s strength profile: tier, overall index, top lifts (e1RM, × bodyweight), strength ratios against healthy bands, movement-pattern coverage, and insights. view = overview (default) | ratios | coverage | tiers.',
    input_schema: schema({ view: { type: 'string', enum: ['overview', 'ratios', 'coverage', 'tiers'] } }),
    receipt: (i) => ({ verb: 'Computed', text: i.view === 'ratios' ? 'Strength ratios' : i.view === 'coverage' ? 'Movement coverage' : 'Strength profile' }),
    execute: async (input, userId) => {
      const p = await strengthProfile(userId);
      const u = await prisma.user.findUnique({ where: { id: userId }, select: { weightKg: true } });
      const bw = u?.weightKg ?? null;
      return {
        view: str(input.view) || 'overview', tier: p.strengthTier, index: p.overallStrengthIndex, totalLogs: p.totalLogs, confidence: p.athleteModel?.confidence ?? null,
        lifts: (p.lifts ?? []).slice(0, 8).map((l: any) => ({ name: l.canonicalName, e1rmKg: l.current1RMkg, xBw: bw ? Math.round((l.current1RMkg / bw) * 100) / 100 : null, monthlyGainPct: l.monthlyGainPct, sessions: l.sessionCount })),
        ratios: (p.athleteModel?.ratios ?? []).map((r: any) => ({ name: r.name, value: r.value, band: r.band, status: r.status, note: r.note })),
        coverage: (p.athleteModel?.patternCoverage ?? []).map((c: any) => ({ label: c.label, sets: c.trailingSets, status: c.status })),
        insights: (p.athleteModel?.insights ?? []).slice(0, 3).map((i: any) => ({ title: i.title, detail: i.detail })),
      };
    },
    card: (_i, r, ctx) => {
      if (!r.lifts.length) return { fn: 'STR-01', pattern: 'glance', rule: 'show', meta: { label: 'Strength' }, empty: 'No weighted sets yet — log a workout and your profile fills in.' };
      if (r.view === 'ratios') return { fn: 'STR-03', pattern: 'glance', rule: 'show', meta: { label: 'Balance and ratios', open: { page: 'ratios' } },
        rows: r.ratios.filter((x: any) => x.value != null).map((x: any) => ({ key: x.name, value: num(x.value, 2), sub: `Healthy ${num(x.band[0], 2)}–${num(x.band[1], 2)}${x.status !== 'in_band' && x.status !== 'ok' ? ` · ${String(x.status).replace(/_/g, ' ')}` : ''}`, mark: x.status === 'in_band' || x.status === 'ok' ? undefined : 'chg' as const })),
        actions: [{ id: 'fix', label: 'Fix it', kind: 'primary', client: { action: 'send_message', args: { text: 'Add the smallest change to my program that fixes my weakest ratio.' } } }] };
      if (r.view === 'coverage') return { fn: 'STR-04', pattern: 'glance', rule: 'show', meta: { label: 'Movement coverage · 4 weeks', open: { page: 'strength' } },
        rows: r.coverage.map((c: any) => ({ key: c.label, value: `${c.sets} sets`, sub: c.status === 'covered' ? undefined : c.status === 'light' ? 'Light' : 'Missing', mark: c.status === 'neglected' ? 'chg' as const : undefined })),
        actions: [{ id: 'fix', label: 'Fix it', kind: 'primary', client: { action: 'send_message', args: { text: 'Add something for my most neglected movement pattern.' } } }] };
      if (r.view === 'tiers') return { fn: 'STR-06', pattern: 'glance', rule: 'show', meta: { label: 'Strength tiers' }, rows: TIERS.map((t) => ({ key: t, value: t === r.tier ? 'You' : '', mark: t === r.tier ? 'chg' as const : undefined })) };
      return {
        fn: 'STR-01', pattern: 'glance', rule: 'show', meta: { label: 'Strength', open: { page: 'strength' } },
        hero: { value: String(r.tier ?? '—'), ...(r.index != null ? { unit: `index ${r.index}` } : {}) },
        rows: r.lifts.slice(0, 6).map((l: any) => ({ key: l.name, value: weight(ctx.unit, l.e1rmKg), sub: l.xBw ? `${num(l.xBw, 2)} × bodyweight` : undefined })),
        ...(r.insights[0] ? { why: `${r.insights[0].title}. ${r.insights[0].detail}` } : {}),
      };
    },
  }),
  tool({
    name: 'read_lift_progress', kind: 'read', core: true, fn: 'STR-02',
    description: 'One lift’s estimated 1RM over time, its change, and a 6-week forecast. lift can be a fragment ("bench", "squat", "deadlift"). Empty if never logged — the card offers an inline logger.',
    input_schema: schema({ lift: { type: 'string' } }, ['lift']),
    receipt: (i) => ({ verb: 'Read', text: `${str(i.lift)} · progress` }),
    execute: async (input, userId) => {
      const p = await strengthProfile(userId);
      const f = str(input.lift).toLowerCase();
      const l = (p.lifts ?? []).find((x: any) => String(x.canonicalName).toLowerCase() === f) ?? (p.lifts ?? []).find((x: any) => String(x.canonicalName).toLowerCase().includes(f));
      if (!l) return { lift: str(input.lift), empty: true };
      const series = (l.weekSeries ?? []).map((w: any) => w.rm);
      return { lift: l.canonicalName, e1rmKg: l.current1RMkg, series, deltaKg: series.length > 1 ? series[series.length - 1] - series[0] : null, weeks: series.length, forecast: l.forecast ?? null, sessions: l.sessionCount };
    },
    card: (_i, r, ctx) => {
      if (r.empty) return { fn: 'STR-02', pattern: 'glance', rule: 'show', meta: { label: `${r.lift} · estimated 1RM` }, empty: `No ${r.lift} sets yet.`, rows: [{ key: 'Log a set', value: 'weight × reps', editable: { field: 'log', kind: 'weightReps' } }], pending: { edits: { log: { op: 'workout.quick_set', args: { exercise: r.lift, date: ctx.today, unit: ctx.unit }, valueKey: 'value', parse: 'weightReps' } } } };
      const d = r.deltaKg != null ? kgTo(ctx.unit, r.deltaKg)! : null;
      return {
        fn: 'STR-02', pattern: 'glance', rule: 'show', meta: { label: `${r.lift} · estimated 1RM`, open: { page: 'lift', params: { name: r.lift } } },
        hero: { value: weight(ctx.unit, r.e1rmKg, { unit: false }), unit: ctx.unit === 'metric' ? 'kg' : 'lb', ...(d != null && Math.abs(d) >= 1 ? { delta: `${d > 0 ? '+' : '−'}${Math.round(Math.abs(d))}` } : {}) },
        line: r.series.map((v: number) => Math.round(kgTo(ctx.unit, v)! * 10) / 10),
        ...(r.forecast ? { note: `At this rate ${weight(ctx.unit, r.forecast.value)} by ${new Date(r.forecast.week).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })}.` } : {}),
        actions: [{ id: 'log', label: 'Log a set', kind: 'secondary', client: { action: 'send_message', args: { text: `Log a set of ${r.lift}.` } } }],
      };
    },
  }),
];

registerToolkit([...WORKOUT_TOOLS, ...STRENGTH_TOOLS]);
