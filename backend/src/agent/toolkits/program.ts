// Program + schedule (catalog PRG-01…16, SCH-01…06, WEL-03). Every program
// change is a PROPOSE: the card shows before → after and the user taps
// Apply. Ops snapshot what they replace so Undo restores it exactly.

import { registerToolkit } from '../registry.js';
import { defineOp } from '../ops.js';
import { callApi } from '../loopback.js';
import { tool, schema, str, numOr, prisma, parseJson } from './kit.js';
import { getCurrentWeekSchedule, buildSwapProposal, applyProposedWeek, generateProgramForUser, saveProgramForUser, SwapProposalError } from '../../routes/coach.js';
import { buildPlanPatchProposal, issueRebuild, REBUILD_MARKER } from '../applyTools.js';
import { lastForExercises } from '../../adaptation/proposalService.js';
import { cacheDelete, cacheClearByPrefix } from '../../services/cacheService.js';
import { dayLabel, shiftDate, weight, plural } from '../cards/format.js';
import type { CardDraft, CardRow } from '../cards/types.js';
import type { ToolCtx } from '../types.js';
import { sessionMinutes } from '../../services/sessionMinutes.js';

function invalidateProgram(userId: string) {
  cacheDelete(`program:${userId}`);
  cacheClearByPrefix(`today:${userId}:`);
  cacheClearByPrefix(`schedule:${userId}:`);
  cacheClearByPrefix(`dashboard:${userId}:`);
  cacheDelete(`userctx:${userId}`);
  cacheClearByPrefix(`brief:${userId}:`);
}

async function loadProgram(userId: string): Promise<any | null> {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { savedProgram: true } });
  return parseJson<any>(u?.savedProgram, null);
}
const exName = (e: any) => String(e?.exercise ?? e?.name ?? e?.exerciseName ?? 'Exercise');
const scheme = (e: any) => `${e?.sets ?? '—'} × ${e?.reps ?? '—'}`;

// ── Ops ──────────────────────────────────────────────────────────────────────
// Replace savedProgram without touching dailyCalorieTarget (a user-set
// calorie target must survive training edits) or the start date.
defineOp({
  name: 'program.replace',
  run: async (userId, args) => {
    const prev = await prisma.user.findUnique({ where: { id: userId }, select: { savedProgram: true } });
    if (!prev?.savedProgram) throw new Error('There’s no program to change yet.');
    const next = args.program as any;
    const cur = JSON.parse(prev.savedProgram);
    if (!next?.phases?.length) throw new Error('That program has no phases.');
    // An edit keeps the goal. A reworded goal string ("Strength" vs "Build
    // strength") used to refuse the whole edit; now the existing goal is kept
    // unless the change was explicitly a goal change.
    const program = cur.goal && next.goal !== cur.goal && !args.goalChange ? { ...next, goal: cur.goal } : next;
    await prisma.user.update({ where: { id: userId }, data: { savedProgram: JSON.stringify(program) } });
    invalidateProgram(userId);
    return { inverse: { op: 'program.set_raw', args: { savedProgram: prev.savedProgram } }, summary: String(args.summary ?? 'Program updated') };
  },
});
defineOp({
  name: 'program.set_raw',
  run: async (userId, args) => {
    await prisma.user.update({ where: { id: userId }, data: { savedProgram: String(args.savedProgram) } });
    invalidateProgram(userId);
    return { inverse: null, summary: 'Program restored' };
  },
});
// Make a new (or restored) program the active one: archives the current one,
// resets the start date. Undo puts the old program, start date and split back
// and removes the archive row this created.
defineOp({
  name: 'program.activate',
  run: async (userId, args) => {
    const prev = await prisma.user.findUnique({ where: { id: userId }, select: { savedProgram: true, programStartDate: true, splitLabel: true } });
    const before = new Date();
    await saveProgramForUser(userId, args.program);
    const archive = await prisma.completedProgram.findFirst({ where: { userId, createdAt: { gte: before } }, orderBy: { createdAt: 'desc' }, select: { id: true } });
    invalidateProgram(userId);
    return {
      inverse: { op: 'program.restore_snapshot', args: { savedProgram: prev?.savedProgram ?? null, programStartDate: prev?.programStartDate?.toISOString() ?? null, splitLabel: prev?.splitLabel ?? null, archiveId: archive?.id ?? null } },
      summary: String(args.summary ?? 'New program started'),
    };
  },
});
defineOp({
  name: 'program.restore_snapshot',
  run: async (userId, args) => {
    await prisma.user.update({ where: { id: userId }, data: {
      savedProgram: (args.savedProgram as string | null) ?? null,
      programStartDate: args.programStartDate ? new Date(String(args.programStartDate)) : null,
      splitLabel: (args.splitLabel as string | null) ?? null,
    } });
    if (args.archiveId) await prisma.completedProgram.delete({ where: { id: String(args.archiveId) } }).catch(() => {});
    invalidateProgram(userId);
    return { inverse: null, summary: 'Previous program restored' };
  },
});
// Schedule overrides for specific dates (moves, skips, pauses, deloads,
// lighter days). Undo restores exactly what each date had before.
defineOp({
  name: 'schedule.set_days',
  run: async (userId, args) => {
    const days = args.days as { date: string; session: any | null }[];
    const dates = days.map((d) => d.date);
    const prior = await prisma.scheduleOverride.findMany({ where: { userId, date: { in: dates } } });
    const priorMap = new Map(prior.map((p) => [p.date, p]));
    await applyProposedWeek(userId, days.map((d) => ({ date: d.date, session: d.session })), String(args.reason ?? 'Changed in chat'));
    invalidateProgram(userId);
    return {
      inverse: { op: 'schedule.restore_days', args: { days: dates.map((date) => { const p = priorMap.get(date); return p ? { date, sessionJson: p.sessionJson, reason: p.reason } : { date, remove: true }; }) } },
      summary: String(args.summary ?? `Schedule · ${plural(days.length, 'day')} changed`),
    };
  },
});
defineOp({
  name: 'schedule.restore_days',
  run: async (userId, args) => {
    for (const d of args.days as any[]) {
      if (d.remove) await prisma.scheduleOverride.deleteMany({ where: { userId, date: d.date } });
      else await prisma.scheduleOverride.upsert({ where: { userId_date: { userId, date: d.date } }, create: { userId, date: d.date, sessionJson: d.sessionJson, reason: d.reason }, update: { sessionJson: d.sessionJson, reason: d.reason } });
    }
    invalidateProgram(userId);
    return { inverse: null, summary: 'Schedule restored' };
  },
});
defineOp({
  name: 'schedule.shift',
  run: async (userId, args) => {
    const days = Math.round(Number(args.days));
    await callApi(userId, 'POST', '/coach/apply-adjustment', { shiftDays: days });
    invalidateProgram(userId);
    return { inverse: { op: 'schedule.shift', args: { days: -days } }, summary: `Program ${days >= 0 ? 'pushed back' : 'brought forward'} ${plural(Math.abs(days), 'day')}` };
  },
});

// ── Program edit operations (small, checkable) ───────────────────────────────
type EditOp =
  | { type: 'set_scheme'; day: string; exercise: string; sets?: number | string; reps?: string; intensity?: string }
  | { type: 'add'; day: string; exercise: string; sets: number | string; reps: string; intensity?: string; after?: string }
  | { type: 'remove'; day: string; exercise: string }
  | { type: 'reorder'; day: string; order: string[] }
  | { type: 'focus'; day: string; focus: string }
  | { type: 'set_target'; day?: string; exercise: string; targetWeightKg: number }
  | { type: 'add_day'; day: string; focus?: string; exercises?: Array<{ exercise: string; sets?: number | string; reps?: string; intensity?: string }>; copyFrom?: string; after?: string }
  | { type: 'remove_day'; day: string }
  | { type: 'set_days_per_week'; daysPerWeek: number };

function norm(s: string) { return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
function findDay(phase: any, label: string): any | null {
  const days = phase?.trainingDays ?? [];
  const l = norm(label);
  return days.find((d: any) => norm(d.day ?? '') === l) ?? days.find((d: any) => norm(d.day ?? '').includes(l) || l.includes(norm(d.day ?? ''))) ?? days.find((d: any) => norm(d.focus ?? '').includes(l)) ?? null;
}
function findEx(day: any, name: string): number {
  const exs = day?.exercises ?? [];
  const n = norm(name);
  let i = exs.findIndex((e: any) => norm(exName(e)) === n);
  if (i < 0) i = exs.findIndex((e: any) => norm(exName(e)).includes(n) || n.includes(norm(exName(e))));
  return i;
}

/** Apply edit ops to the current phase (or all phases) of a program copy. Returns the copy and diff rows. */
export function applyProgramEdits(program: any, edits: EditOp[], opts: { phaseIndex: number; allPhases?: boolean }): { program: any; diff: { key: string; from?: string; to: string; removed?: boolean }[] } {
  const p = JSON.parse(JSON.stringify(program));
  const diff: { key: string; from?: string; to: string; removed?: boolean }[] = [];
  const phases = opts.allPhases ? p.phases.map((_: any, i: number) => i) : [Math.min(opts.phaseIndex, p.phases.length - 1)];
  for (const e of edits) {
    // Day-level edits (add / remove a training day, days per week) change
    // the week's shape: the schedule maps trainingDays[i] to the i-th
    // training day of the week, so daysPerWeek follows the day count.
    if (e.type === 'add_day' || e.type === 'remove_day' || e.type === 'set_days_per_week') {
      applyDayEdit(p, e, phases, diff);
      continue;
    }
    let touched = false;
    for (const pi of phases) {
      const phase = p.phases[pi];
      const day = 'day' in e && e.day ? findDay(phase, e.day) : null;
      if (e.type !== 'set_target' && !day) continue;
      const first = !touched;
      if (e.type === 'set_scheme') {
        const i = findEx(day, e.exercise); if (i < 0) continue;
        const ex = day.exercises[i]; const before = `${scheme(ex)}${ex.intensity ? ` · ${ex.intensity}` : ''}`;
        if (e.sets != null) ex.sets = e.sets; if (e.reps != null) ex.reps = String(e.reps); if (e.intensity) ex.intensity = e.intensity;
        if (first) diff.push({ key: `${exName(ex)} · ${day.day}`, from: before, to: `${scheme(ex)}${ex.intensity ? ` · ${ex.intensity}` : ''}` });
      } else if (e.type === 'add') {
        const ex = { exercise: e.exercise, sets: e.sets, reps: String(e.reps), intensity: e.intensity ?? 'RPE 7' };
        const at = e.after ? findEx(day, e.after) : -1;
        if (at >= 0) day.exercises.splice(at + 1, 0, ex); else day.exercises.push(ex);
        if (first) diff.push({ key: `+ ${e.exercise} · ${day.day}`, to: scheme(ex) });
      } else if (e.type === 'remove') {
        const i = findEx(day, e.exercise); if (i < 0) continue;
        if (day.exercises.length <= 1) throw new Error(`${day.day} needs at least one exercise.`);
        const [ex] = day.exercises.splice(i, 1);
        if (first) diff.push({ key: `− ${exName(ex)} · ${day.day}`, from: scheme(ex), to: 'Removed', removed: true });
      } else if (e.type === 'reorder') {
        const before = day.exercises.map(exName).join(', ');
        const ordered: any[] = [];
        for (const name of e.order) { const i = findEx({ exercises: day.exercises.filter((x: any) => !ordered.includes(x)) }, name); if (i >= 0) ordered.push(day.exercises.filter((x: any) => !ordered.includes(x))[i]); }
        day.exercises = [...ordered, ...day.exercises.filter((x: any) => !ordered.includes(x))];
        if (first) diff.push({ key: `Order · ${day.day}`, from: before, to: day.exercises.map(exName).join(', ') });
      } else if (e.type === 'focus') {
        const before = day.focus ?? '';
        day.focus = e.focus;
        if (first) diff.push({ key: `Focus · ${day.day}`, from: before, to: e.focus });
      } else if (e.type === 'set_target') {
        const targetDays = e.day ? [findDay(phase, e.day)].filter(Boolean) : phase.trainingDays;
        for (const d of targetDays) {
          const i = findEx(d, e.exercise); if (i < 0) continue;
          const ex = d.exercises[i];
          if (first && !touched) diff.push({ key: `${exName(ex)} target`, from: ex.targetWeightKg ? `${Math.round(ex.targetWeightKg)} kg` : 'None', to: `${Math.round(e.targetWeightKg)} kg` });
          ex.targetWeightKg = e.targetWeightKg; ex.targetBasis = 'set in chat'; ex.targetSetAt = new Date().toISOString();
          touched = true;
        }
        continue;
      }
      touched = true;
    }
    if (!touched) throw new Error(`Couldn’t find ${'exercise' in e ? `"${e.exercise}"` : ''}${'day' in e && e.day ? ` on "${e.day}"` : ''} in the program. Read the schedule for exact names.`);
  }
  return { program: p, diff };
}

const MIN_DAYS = 1;
const MAX_DAYS = 7;
const dayExerciseCount = (d: any) => (d?.exercises ?? []).length;

function syncDaysPerWeek(p: any, phases: number[]) {
  const n = p.phases[phases[0]]?.trainingDays?.length;
  if (n) p.daysPerWeek = n;
}

/** add_day / remove_day / set_days_per_week on the selected phases (mutates p). */
function applyDayEdit(p: any, e: Extract<EditOp, { type: 'add_day' | 'remove_day' | 'set_days_per_week' }>, phases: number[], diff: { key: string; from?: string; to: string; removed?: boolean }[]) {
  let first = true;
  for (const pi of phases) {
    const phase = p.phases[pi];
    const days: any[] = phase.trainingDays ?? (phase.trainingDays = []);
    if (e.type === 'add_day') {
      if (days.length >= MAX_DAYS) throw new Error(`There are already ${days.length} training days — remove one first.`);
      if (!str(e.day)) throw new Error('Name the new day (e.g. "Arms" or "Day 5 — Upper").');
      if (days.some((d) => norm(d.day ?? '') === norm(e.day))) throw new Error(`There’s already a day called "${e.day}".`);
      const source = e.copyFrom ? findDay(phase, e.copyFrom) : null;
      if (e.copyFrom && !source) throw new Error(`Couldn’t find "${e.copyFrom}" to copy. Read the schedule for exact day names.`);
      const exercises = (e.exercises ?? []).filter((x) => str(x?.exercise)).map((x) => ({ exercise: str(x.exercise), sets: x.sets ?? 3, reps: String(x.reps ?? '8-12'), intensity: x.intensity ?? 'RPE 7' }));
      const list = exercises.length ? exercises : source ? JSON.parse(JSON.stringify(source.exercises ?? [])) : [];
      if (!list.length) throw new Error('A new day needs exercises — list them, or copyFrom an existing day.');
      const day = { day: str(e.day), focus: e.focus ?? source?.focus ?? str(e.day), exercises: list };
      const at = e.after ? days.indexOf(findDay(phase, e.after)) : -1;
      if (at >= 0) days.splice(at + 1, 0, day); else days.push(day);
      if (first) diff.push({ key: `+ ${day.day}`, to: `${list.length} exercises${source ? ` · copy of ${source.day}` : ''}` });
    } else if (e.type === 'remove_day') {
      const day = findDay(phase, e.day);
      if (!day) throw new Error(`Couldn’t find "${e.day}" in the program. Read the schedule for exact day names.`);
      if (days.length <= MIN_DAYS) throw new Error('The program needs at least one training day.');
      days.splice(days.indexOf(day), 1);
      if (first) diff.push({ key: `− ${day.day}`, from: `${dayExerciseCount(day)} exercises`, to: 'Removed', removed: true });
    } else {
      const target = Math.round(Number(e.daysPerWeek));
      if (!Number.isFinite(target) || target < MIN_DAYS || target > MAX_DAYS) throw new Error(`Days per week must be ${MIN_DAYS}–${MAX_DAYS}.`);
      const before = days.length;
      if (target < before) {
        // Drop from the end of the week; the remaining days keep their order.
        const dropped = days.splice(target);
        if (first) diff.push({ key: 'Days per week', from: String(before), to: `${target} · drops ${dropped.map((d) => d.day).join(', ')}` });
      } else if (target > before) {
        if (!before) throw new Error('There are no days to build from — add a day with its exercises.');
        // Add days by repeating the existing ones in order (A/B rotation),
        // labelled so the user sees what was repeated. Specific new content
        // goes through add_day instead.
        const added: string[] = [];
        for (let i = before; i < target; i++) {
          const src = days[(i - before) % before];
          const label = `${String(src.day ?? `Day ${i + 1}`).split(/[—–·]/)[0].trim()} (repeat)`;
          days.push({ ...JSON.parse(JSON.stringify(src)), day: days.some((d) => d.day === label) ? `${label} ${i + 1}` : label });
          added.push(days[days.length - 1].day);
        }
        if (first) diff.push({ key: 'Days per week', from: String(before), to: `${target} · adds ${added.join(', ')}` });
      } else if (first) {
        diff.push({ key: 'Days per week', from: String(before), to: `${target} · unchanged` });
      }
    }
    first = false;
  }
  syncDaysPerWeek(p, phases);
}

async function currentPhaseIndex(userId: string, program: any): Promise<number> {
  const s = await getCurrentWeekSchedule(userId).catch(() => null) as any;
  const name = s?.phaseName;
  const i = (program?.phases ?? []).findIndex((ph: any) => ph.phaseName === name);
  return i >= 0 ? i : 0;
}

function weekTiles(weekDays: any[]) {
  return weekDays.map((d: any) => ({
    d: new Date(`${d.date}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' }),
    n: d.session ? String(d.session.name ?? d.session.day ?? d.session.focus ?? '').split(/[—–·/]/)[0].trim().split(/\s+/)[0] : undefined,
    s: (d.isLogged ? 'done' : d.isToday ? 'today' : d.session ? 'planned' : 'rest') as 'done' | 'today' | 'planned' | 'rest',
    date: d.date,
  }));
}

function sessionRows(exs: any[], loads: Map<string, number | null>, ctx: ToolCtx): CardRow[] {
  return exs.map((e) => {
    const kg = loads.get(exName(e).toLowerCase()) ?? null;
    return { key: exName(e), value: `${scheme(e)}${kg ? ` · ${weight(ctx.unit, kg, { unit: false })}` : ''}` };
  });
}
async function loadsFor(userId: string, names: string[]): Promise<Map<string, number | null>> {
  const out = new Map<string, number | null>();
  try {
    const last = await lastForExercises(userId, names.slice(0, 20));
    for (const l of last) out.set(l.name.toLowerCase(), l.target?.targetWeightKg ?? l.exposures?.[0]?.top?.weightKg ?? null);
  } catch { /* loads are best-effort */ }
  return out;
}

// ── Rebuild inputs ───────────────────────────────────────────────────────────
type SplitId = 'ppl' | 'upper_lower' | 'full_body' | 'bro_split' | 'custom';
const SPLITS: Record<Exclude<SplitId, 'custom'>, { label: string; hint: string; match: RegExp }> = {
  ppl: { label: 'Push/Pull/Legs', hint: 'push days: chest, shoulders, triceps; pull days: back, biceps; leg days', match: /\bppl\b|push.?pull.?legs?/i },
  upper_lower: { label: 'Upper/Lower', hint: 'alternate upper-body and lower-body days', match: /upper.?lower|\bul\b/i },
  full_body: { label: 'Full body', hint: 'every session trains the whole body', match: /full.?body|total.?body|\bfb\b/i },
  bro_split: { label: 'Body-part split', hint: 'one or two muscle groups per day (chest, back, shoulders, arms, legs)', match: /bro.?split|body.?part/i },
};
const SPLIT_DAYS: Record<SplitId, number | null> = { ppl: 6, upper_lower: 4, full_body: 3, bro_split: 5, custom: null };

/** Free-text split → a known split (or the user's words). */
export function splitLabel(v: unknown): { id: SplitId; label: string; hint: string } | null {
  const s = str(v);
  if (!s) return null;
  const k = s.toLowerCase().replace(/[\s-]+/g, '_');
  for (const [id, sp] of Object.entries(SPLITS) as [Exclude<SplitId, 'custom'>, typeof SPLITS['ppl']][]) {
    if (k === id || sp.match.test(s)) return { id, label: sp.label, hint: sp.hint };
  }
  return { id: 'custom', label: s.slice(0, 60), hint: 'as the user described' };
}
const LEVELS = ['beginner', 'intermediate', 'advanced', 'elite'] as const;
export function levelOf(v: unknown): typeof LEVELS[number] | null {
  const s = str(v).toLowerCase();
  if (!s) return null;
  return LEVELS.find((l) => s.includes(l)) ?? (/novice|new/.test(s) ? 'beginner' : /intermed/.test(s) ? 'intermediate' : /advan|experienced/.test(s) ? 'advanced' : null);
}

export const PROGRAM_TOOLS = [
  tool({
    name: 'read_program', kind: 'read', core: true, fn: 'PRG-01',
    description: 'Read the user’s saved training program: goal, phases (name, weeks, rationale), each training day with its exercises (sets, reps, intensity, notes), and where they are in it. Use for "show my program", "what’s in phase 2", "what’s on upper day".',
    input_schema: schema({ phase: { type: 'number', description: 'Phase number to focus on (1-based). Omit for the current phase.' } }),
    receipt: () => ({ verb: 'Read', text: 'Program' }),
    execute: async (input, userId) => {
      const program = await loadProgram(userId);
      if (!program) return { empty: true };
      const sched: any = await getCurrentWeekSchedule(userId).catch(() => null);
      const cur = await currentPhaseIndex(userId, program);
      const focus = numOr(input.phase) != null ? Math.max(0, Math.min(program.phases.length - 1, numOr(input.phase)! - 1)) : cur;
      return {
        goal: program.goal, durationWeeks: program.durationWeeks, weekNumber: sched?.weekNumber ?? null, currentPhase: cur + 1,
        phases: program.phases.map((ph: any, i: number) => ({ number: i + 1, name: ph.phaseName, weeks: ph.durationWeeks, weeksLabel: ph.weeksLabel, rationale: ph.rationale, ...(i === focus ? { trainingDays: ph.trainingDays?.map((d: any) => ({ day: d.day, focus: d.focus, exercises: (d.exercises ?? []).map((e: any) => ({ exercise: exName(e), sets: e.sets, reps: e.reps, intensity: e.intensity, notes: e.notes })) })) } : {}) })),
        focusPhase: focus + 1,
      };
    },
    card: (_i, r) => {
      if (r.empty) return { fn: 'PRG-01', pattern: 'glance', rule: 'show', meta: { label: 'Program' }, empty: 'You don’t have a program yet.', actions: [{ id: 'build', label: 'Build one', kind: 'primary', client: { action: 'send_message', args: { text: 'Build me a program.' } } }] };
      const total = r.durationWeeks ?? r.phases.reduce((n: number, p: any) => n + (p.weeks ?? 0), 0);
      const focus = r.phases[r.focusPhase - 1];
      if (focus?.trainingDays && r.focusPhase !== r.currentPhase) {
        return { fn: 'PRG-02', pattern: 'glance', rule: 'show', meta: { label: `Phase ${r.focusPhase} · ${focus.name}`, open: { page: 'phase', params: { i: String(r.focusPhase - 1) } } }, rows: focus.trainingDays.map((d: any) => ({ key: d.day, value: `${d.exercises.length} exercises`, sub: d.focus })) };
      }
      return {
        fn: 'PRG-01', pattern: 'glance', rule: 'show', meta: { label: r.goal ? `Program · ${String(r.goal).slice(0, 40)}` : 'Program', open: { page: 'training' } },
        hero: r.weekNumber ? { value: `Week ${r.weekNumber}`, unit: total ? `of ${total}` : undefined } : undefined,
        bars: { v: r.phases.map((p: any) => p.weeks ?? 1), labels: r.phases.map((p: any) => p.name), hi: r.currentPhase - 1 },
        rows: r.phases.map((p: any) => ({ key: `${p.number}. ${p.name}`, value: p.weeksLabel ?? `${p.weeks} wk`, mark: p.number === r.currentPhase ? 'chg' as const : undefined })),
      };
    },
  }),
  tool({
    name: 'read_schedule_week', kind: 'read', core: true, fn: 'SCH-01',
    description: "Read this week's resolved schedule (swaps and skips applied): each day's date, label, planned session (name, focus, exercises) or rest, whether it's today or already logged, plus week number and phase. Use for today, this week, tomorrow, or before moving/swapping anything.",
    input_schema: schema({}),
    receipt: () => ({ verb: 'Read', text: 'This week' }),
    execute: async (_i, userId) => getCurrentWeekSchedule(userId),
    card: (_i, r) => {
      if (!r?.weekDays?.length) return { fn: 'SCH-01', pattern: 'glance', rule: 'show', meta: { label: 'This week' }, empty: 'No program yet, so nothing is scheduled.' };
      return { fn: 'SCH-01', pattern: 'glance', rule: 'show', meta: { label: `This week${r.weekNumber ? ` · week ${r.weekNumber}` : ''}`, open: { page: 'training' } }, tiles: weekTiles(r.weekDays),
        pending: { actions: {} } };
    },
  }),
  tool({
    name: 'read_today', kind: 'read', core: true, fn: 'SCH-04',
    description: 'Today’s session with the loads to use (from progression targets or last time), or rest-day guidance if it’s a rest day. Use for "what am I doing today", "what weight for squats today".',
    input_schema: schema({}),
    receipt: () => ({ verb: 'Read', text: 'Today' }),
    execute: async (_i, userId) => {
      const t: any = await callApi(userId, 'GET', '/coach/today');
      const session = t?.session ?? t?.todaySession ?? null;
      const exs: any[] = session?.exercises ?? t?.exercises ?? [];
      const loads = await loadsFor(userId, exs.map(exName));
      return { restDay: !exs.length, minutes: sessionMinutes(session ?? { exercises: exs }), name: session?.name ?? t?.dayName ?? null, focus: session?.focus ?? t?.dayFocus ?? null, exercises: exs.map((e) => ({ exercise: exName(e), sets: e.sets, reps: e.reps, intensity: e.intensity, loadKg: loads.get(exName(e).toLowerCase()) ?? null })), tips: t?.tips ?? t?.coachingTips ?? null, phaseName: t?.phaseName ?? null, weekNumber: t?.weekNumber ?? null };
    },
    card: (_i, r, ctx) => {
      if (r.restDay) return { fn: 'SCH-05', pattern: 'glance', rule: 'show', meta: { label: 'Rest day' }, rows: (Array.isArray(r.tips) ? r.tips.slice(0, 3) : ['A 20–30 minute walk', '10 minutes of mobility for your hips and upper back', 'Hit your protein target — recovery happens today']).map((t: any) => ({ key: typeof t === 'string' ? t : t.text ?? String(t) })) };
      const minutes = r.minutes ?? sessionMinutes({ exercises: r.exercises });
      const loads = new Map<string, number | null>(r.exercises.map((e: any) => [e.exercise.toLowerCase(), e.loadKg]));
      return {
        fn: 'SCH-04', pattern: 'glance', rule: 'show', meta: { label: `Today · ${String(r.name ?? 'Session').split(/[—–·/]/)[0].trim()} · ${minutes} min`, open: { page: 'session' } },
        rows: sessionRows(r.exercises, loads, ctx), ...(r.focus ? { why: r.focus } : {}),
        actions: [
          { id: 'begin', label: 'Begin', kind: 'primary', client: { action: 'start_session' } },
          { id: 'move', label: 'Move it', kind: 'secondary', client: { action: 'send_message', args: { text: 'I can’t train today. Move today’s session.' } } },
        ],
      };
    },
  }),
  tool({
    name: 'propose_workout_swap', kind: 'propose', core: true, fn: 'SCH-02',
    description: "Propose moving a session to another day, either way. Earlier (sourceDate after date): the session is pulled into date and the rest of the week is rebalanced for recovery. Later (sourceDate before date, e.g. \"can't train today, do it tomorrow\": sourceDate = today, date = tomorrow): the session moves to date, date's own session (if any) takes sourceDate, otherwise sourceDate becomes a rest day. Read the week first. The user taps Apply on the week card; nothing changes until then. Describe the move the card shows — don't add changes it doesn't make.",
    input_schema: schema({ sourceDate: { type: 'string', description: 'YYYY-MM-DD whose session moves.' }, date: { type: 'string', description: 'YYYY-MM-DD day it moves to. Default today.' } }, ['sourceDate']),
    receipt: () => ({ verb: 'Proposed', text: 'Session move' }),
    execute: async (input, userId) => {
      const s: any = await getCurrentWeekSchedule(userId);
      const date = str(input.date) || s.today;
      try {
        const { proposedWeek, rationale, chosenSessionName } = await buildSwapProposal(userId, date, str(input.sourceDate));
        return { _proposal: true, kind: 'workout_swap', proposedWeek, rationale, sourceDate: str(input.sourceDate), chosenSessionName, summary: `Move ${chosenSessionName} to ${dayLabel(date)}`, weekDays: s.weekDays };
      } catch (err) {
        if (err instanceof SwapProposalError) return { error: err.message };
        throw err;
      }
    },
    card: (_i, r) => {
      if (r.error) return null;
      const byDate = new Map<string, any>(r.proposedWeek.map((d: any) => [d.date, d]));
      const tiles = weekTiles(r.weekDays.map((d: any) => ({ ...d, session: byDate.has(d.date) ? byDate.get(d.date).session : d.session }))).map((t: any) => {
        const before = r.weekDays.find((d: any) => d.date === t.date);
        // Sessions are named by `day` ("Upper Vertical Push/Pull"); a day is moved when its session changed.
        const after = byDate.has(t.date) ? byDate.get(t.date).session : before?.session;
        const moved = (before?.session?.day ?? null) !== (after?.day ?? null);
        return moved ? { ...t, s: 'moved' as const } : t;
      });
      return {
        fn: 'SCH-02', pattern: 'proposal', rule: 'propose', meta: { label: 'Proposed · this week', open: { page: 'training' } }, tiles, why: r.rationale,
        actions: [{ id: 'apply', label: 'Apply', kind: 'primary' }, { id: 'keep', label: 'Keep', kind: 'secondary' }],
        entity: 'schedule:week',
        pending: { actions: { apply: { op: 'schedule.set_days', args: { days: r.proposedWeek.filter((d: any) => !d.locked).map((d: any) => ({ date: d.date, session: d.session ?? null })), reason: 'Moved in chat', summary: r.summary } }, keep: { kind: 'keep' } } },
      };
    },
  }),
  tool({
    name: 'propose_rest_days', kind: 'propose', fn: 'SCH-03',
    description: 'Propose turning dates into rest days — skip today, or pause training for a trip or illness (from–to). The card shows the days affected; the user applies it. Sessions aren’t lost: the program continues after.',
    input_schema: schema({ from: { type: 'string', description: 'YYYY-MM-DD' }, to: { type: 'string', description: 'YYYY-MM-DD, default = from' }, reason: { type: 'string' } }, ['from']),
    receipt: (i) => ({ verb: 'Proposed', text: i.to && i.to !== i.from ? 'Pause' : 'Rest day' }),
    execute: async (input, userId) => {
      const from = str(input.from); const to = str(input.to) || from;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || to < from) throw new Error('Give dates as YYYY-MM-DD, from before to.');
      const days: string[] = []; for (let d = from; d <= to && days.length < 60; d = shiftDate(d, 1)) days.push(d);
      const s: any = await getCurrentWeekSchedule(userId).catch(() => null);
      const known = new Map<string, any>((s?.weekDays ?? []).map((d: any) => [d.date, d.session]));
      return { days, affected: days.map((d) => ({ date: d, session: known.get(d)?.name ?? null })), reason: str(input.reason) };
    },
    card: (_i, r) => ({
      fn: r.days.length > 1 ? 'PRG-11' : 'SCH-03', pattern: 'proposal', rule: 'propose', meta: { label: r.days.length > 1 ? `Proposed · pause ${dayLabel(r.days[0])} – ${dayLabel(r.days[r.days.length - 1])}` : `Proposed · rest ${dayLabel(r.days[0])}` },
      diff: r.affected.filter((a: any) => a.session).slice(0, 8).map((a: any) => ({ key: dayLabel(a.date), from: a.session, to: 'Rest' })),
      why: r.days.length > 1 ? `${plural(r.days.length, 'day')} off. Your program picks up where it left off.` : 'The rest of the week stays as planned.',
      actions: [{ id: 'apply', label: 'Apply', kind: 'primary' }, { id: 'keep', label: 'Keep', kind: 'secondary' }],
      pending: { actions: { apply: { op: 'schedule.set_days', args: { days: r.days.map((date: string) => ({ date, session: null })), reason: r.reason || 'Rest in chat', summary: r.days.length > 1 ? `Paused ${plural(r.days.length, 'day')}` : `Rest day ${dayLabel(r.days[0])}` } }, keep: { kind: 'keep' } } },
    }),
  }),
  tool({
    name: 'propose_program_shift', kind: 'propose', fn: 'PRG-10',
    description: 'Life happened (sick, travel, missed days): propose pushing the whole program back by N days so no phase is skipped (negative brings it forward). Explain the training impact in your text; the card applies the shift.',
    input_schema: schema({ days: { type: 'number' }, reason: { type: 'string' } }, ['days']),
    receipt: () => ({ verb: 'Proposed', text: 'Program shift' }),
    execute: async (input) => {
      const days = Math.round(numOr(input.days, 0)!);
      if (!days || Math.abs(days) > 60) throw new Error('Shift by 1–60 days.');
      return { days, reason: str(input.reason) };
    },
    card: (_i, r) => ({
      fn: 'PRG-10', pattern: 'proposal', rule: 'propose', meta: { label: 'Proposed · program' },
      diff: [{ key: 'Program', from: 'As planned', to: `${r.days > 0 ? 'Pushed back' : 'Brought forward'} ${plural(Math.abs(r.days), 'day')}` }],
      why: r.reason || 'Every phase stays; the dates move.',
      actions: [{ id: 'apply', label: 'Apply', kind: 'primary' }, { id: 'keep', label: 'Keep as is', kind: 'secondary' }],
      pending: { actions: { apply: { op: 'schedule.shift', args: { days: r.days } }, keep: { kind: 'keep' } } },
    }),
  }),
  tool({
    name: 'propose_program_edit', kind: 'propose', core: true, fn: 'PRG-05',
    description: 'Propose program edits the user asked for. edits = list of: set_scheme {day, exercise, sets?, reps?, intensity?}; add {day, exercise, sets, reps, intensity?, after?}; remove {day, exercise}; reorder {day, order:[names]}; focus {day, focus}; set_target {exercise, day?, targetWeight (user unit)}; add_day {day (new label), focus?, exercises?:[{exercise, sets, reps, intensity?}], copyFrom? (existing day), after?}; remove_day {day}; set_days_per_week {daysPerWeek} (fewer drops days from the end of the week, more repeats existing days — use add_day for new content). Applies to the current phase unless allPhases (use allPhases for day changes so every phase keeps the same week). Use exact day labels and exercise names from read_schedule_week or read_program. Keep the goal; change as little as possible.',
    input_schema: schema({
      edits: { type: 'array', items: { type: 'object', properties: { type: { type: 'string', enum: ['set_scheme', 'add', 'remove', 'reorder', 'focus', 'set_target', 'add_day', 'remove_day', 'set_days_per_week'] }, day: { type: 'string' }, exercise: { type: 'string' }, sets: { type: 'number' }, reps: { type: 'string' }, intensity: { type: 'string' }, after: { type: 'string' }, order: { type: 'array', items: { type: 'string' } }, focus: { type: 'string' }, targetWeight: { type: 'number' }, exercises: { type: 'array', items: { type: 'object', properties: { exercise: { type: 'string' }, sets: { type: 'number' }, reps: { type: 'string' }, intensity: { type: 'string' } }, required: ['exercise'] } }, copyFrom: { type: 'string' }, daysPerWeek: { type: 'number' } }, required: ['type'] } },
      allPhases: { type: 'boolean' },
      why: { type: 'string', description: 'One sentence shown on the card.' },
    }, ['edits']),
    receipt: () => ({ verb: 'Proposed', text: 'Program edit' }),
    execute: async (input, userId) => {
      const program = await loadProgram(userId);
      if (!program) throw new Error('There’s no program yet — build one first.');
      const u = await prisma.user.findUnique({ where: { id: userId }, select: { unitPreference: true } });
      const edits = (Array.isArray(input.edits) ? input.edits : []).map((e: any) => e.type === 'set_target' ? { ...e, targetWeightKg: u?.unitPreference === 'metric' ? Number(e.targetWeight) : Number(e.targetWeight) * 0.45359237 } : e) as EditOp[];
      if (!edits.length) throw new Error('Say what to change.');
      const { program: next, diff } = applyProgramEdits(program, edits, { phaseIndex: await currentPhaseIndex(userId, program), allPhases: !!input.allPhases });
      const kinds = new Set(edits.map((e) => e.type));
      const summary = diff.map((d) => d.key).join('; ');
      // _proposal/updatedProgram: the classic app renders this as its program diff card.
      return { diff, why: str(input.why), fn: kinds.has('set_target') ? 'PRG-15' : kinds.has('add') || kinds.has('remove') || kinds.has('add_day') || kinds.has('remove_day') || kinds.has('set_days_per_week') ? 'PRG-06' : kinds.has('reorder') || kinds.has('focus') ? 'PRG-08' : 'PRG-05', _programNext: next, summary,
        _proposal: true, kind: 'program_update', updatedProgram: next, changedDays: [...new Set(edits.map((e: any) => e.day).filter(Boolean))] };
    },
    card: (_i, r, ctx) => ({
      fn: r.fn, pattern: 'proposal', rule: 'propose', meta: { label: 'Proposed · program', open: { page: 'training' } },
      diff: r.diff.map((d: any) => r.fn === 'PRG-15' ? { ...d, from: d.from?.replace(/(\d+) kg/, (_m: string, kg: string) => weight(ctx.unit, Number(kg))), to: d.to.replace(/(\d+) kg/, (_m: string, kg: string) => weight(ctx.unit, Number(kg))) } : d),
      ...(r.why ? { why: r.why } : {}),
      actions: [{ id: 'apply', label: 'Apply', kind: 'primary' }, { id: 'keep', label: 'Keep', kind: 'secondary' }],
      pending: { actions: { apply: { op: 'program.replace', args: { program: r._programNext, summary: `Program · ${r.summary}` } }, keep: { kind: 'keep' } } },
    }),
  }),
  tool({
    // Feed · Saved → "Try it" (bug fixes 5 Oct 2026, 3d): the client sends
    // "program.fitWorkout(<id>)"; this reads the workout next to the program
    // so the reply can be a propose_program_edit card.
    name: 'fit_workout', kind: 'read', fn: 'PRG-16',
    description: 'Read a workout the user saved or posted from the feed (by post id, e.g. from "program.fitWorkout(<id>)") next to their program days, to fit it in. Follow with propose_program_edit — usually add_day, or add/remove on the closest day — so the reply is a Proposal card. Change as little as possible.',
    input_schema: schema({ id: { type: 'string', description: 'The post id.' } }, ['id']),
    receipt: () => ({ verb: 'Read', text: 'Saved workout' }),
    execute: async (input, userId) => {
      const id = str(input.id).replace(/^program\.fitWorkout\(|\)$/g, '');
      // Only a workout the user saved or posted — the feed decided they could see it then.
      const post = await prisma.sharedItem.findFirst({
        where: { id, OR: [{ sharerId: userId }, { saves: { some: { userId } } }] },
        select: { payload: true, caption: true, sharer: { select: { name: true, username: true } } },
      });
      if (!post) throw new Error('That workout isn’t in your saved list.');
      const p = parseJson<any>(post.payload, {});
      const exercises: any[] = Array.isArray(p?.exercises) ? p.exercises : [];
      if (!exercises.length) throw new Error('That post has no exercises to fit in.');
      const program = await loadProgram(userId);
      const phase = program ? program.phases?.[await currentPhaseIndex(userId, program)] : null;
      return {
        workout: { title: p.title ?? post.caption ?? null, from: post.sharer?.name ?? post.sharer?.username ?? null, exercises: exercises.map((e) => ({ exercise: String(e.name ?? e.exercise ?? 'Exercise'), sets: e.sets ?? null, reps: e.reps ?? null })) },
        program: program ? { goal: program.goal ?? null, days: (phase?.trainingDays ?? []).map((d: any) => ({ day: d.day, focus: d.focus ?? null, exercises: (d.exercises ?? []).map((e: any) => e.exercise ?? e.name) })) } : null,
      };
    },
  }),
  tool({
    name: 'propose_exercise_swap', kind: 'propose', core: true, fn: 'PRG-07',
    description: "Propose swapping ONE exercise for another. Read the week first for exact stored names and today's day label. scope 'day' (default, that day only) or 'program' (everywhere). If the name is ambiguous you get { error, candidates } — call again with the exact name. Give a one-line rationale.",
    input_schema: schema({ fromExerciseName: { type: 'string' }, toExerciseName: { type: 'string' }, scope: { type: 'string', enum: ['day', 'program'] }, day: { type: 'string' }, toSets: { type: 'string' }, toReps: { type: 'string' }, rationale: { type: 'string' } }, ['fromExerciseName', 'toExerciseName']),
    receipt: () => ({ verb: 'Proposed', text: 'Exercise swap' }),
    execute: async (input, userId) => {
      const program = await loadProgram(userId);
      if (!program) return { error: 'No saved program yet — build one first.' };
      const base = { fromName: str(input.fromExerciseName), toName: str(input.toExerciseName), day: input.day != null ? str(input.day) : undefined, toSets: input.toSets != null ? str(input.toSets) : undefined, toReps: input.toReps != null ? str(input.toReps) : undefined, rationale: str(input.rationale) };
      const day = buildPlanPatchProposal(program, { ...base, scope: 'day' });
      const everywhere = buildPlanPatchProposal(program, { ...base, scope: 'program' });
      const chosen = input.scope === 'program' ? everywhere : day;
      if (!chosen.ok) return { error: chosen.reason, candidates: chosen.candidates };
      return { _proposal: true, ...chosen.proposal, _alts: { day: day.ok ? day.proposal.updatedProgram : null, program: everywhere.ok ? everywhere.proposal.updatedProgram : null } };
    },
    card: (_i, r) => {
      if (r.error) return null;
      const alts = [r._alts.day, r._alts.program];
      return {
        fn: 'PRG-07', pattern: 'proposal', rule: 'propose', meta: { label: `Proposed · ${r.day ?? 'program'}`, open: { page: 'training' } },
        diff: [{ key: 'Exercise', from: r.from.name, to: r.to.name }, ...(r.from.sets !== r.to.sets || r.from.reps !== r.to.reps ? [{ key: 'Scheme', from: `${r.from.sets} × ${r.from.reps}`, to: `${r.to.sets} × ${r.to.reps}` }] : [])],
        ...(r.rationale ? { why: r.rationale } : {}),
        choice: { options: ['This day', 'Everywhere'], value: r.scope === 'program' ? 1 : 0, field: 'scope' },
        actions: [{ id: 'apply', label: 'Apply', kind: 'primary' }, { id: 'keep', label: 'Keep', kind: 'secondary' }],
        pending: {
          actions: { apply: { op: 'program.replace', args: { program: r.scope === 'program' ? alts[1] : alts[0], summary: `Swap · ${r.from.name} → ${r.to.name}` } }, keep: { kind: 'keep' } },
          choice: { field: 'scope', argKey: 'program', values: alts },
        },
      };
    },
  }),
  tool({
    name: 'propose_deload', kind: 'propose', fn: 'PRG-09',
    description: 'Propose a deload for the next 7 days: same exercises, about 40% fewer sets and easier effort (RPE 6). Doesn’t change the program; only those dates.',
    input_schema: schema({ startDate: { type: 'string', description: 'YYYY-MM-DD, default tomorrow' } }),
    receipt: () => ({ verb: 'Proposed', text: 'Deload week' }),
    execute: async (input, userId) => {
      const s: any = await getCurrentWeekSchedule(userId);
      const start = str(input.startDate) || shiftDate(s.today, 1);
      const byDate = new Map<string, any>((s.weekDays ?? []).map((d: any) => [d.date, d.session]));
      // Next week's dates reuse this week's weekday pattern.
      const days: { date: string; session: any | null; before?: any }[] = [];
      for (let i = 0; i < 7; i++) {
        const date = shiftDate(start, i);
        const same = byDate.get(date) ?? byDate.get(shiftDate(date, -7)) ?? null;
        if (!same) continue;
        const light = { ...same, name: `${same.name ?? same.day} · deload`, exercises: (same.exercises ?? []).map((e: any) => ({ ...e, sets: Math.max(1, Math.ceil(Number(e.sets) * 0.6) || 2), intensity: 'RPE 6', notes: 'Deload: leave 4 in the tank.' })) };
        days.push({ date, session: light, before: same });
      }
      if (!days.length) throw new Error('No sessions in the next 7 days to deload.');
      return { days };
    },
    card: (_i, r) => ({
      fn: 'PRG-09', pattern: 'proposal', rule: 'propose', meta: { label: 'Proposed · deload week' },
      diff: r.days.map((d: any) => ({ key: `${dayLabel(d.date)} · ${String(d.before?.name ?? '').split(/[—–·/]/)[0].trim()}`, from: `${(d.before?.exercises ?? []).reduce((n: number, e: any) => n + (Number(e.sets) || 0), 0)} sets`, to: `${d.session.exercises.reduce((n: number, e: any) => n + (Number(e.sets) || 0), 0)} sets · RPE 6` })),
      why: 'Lighter week so fatigue drops and the next block starts fresh.',
      actions: [{ id: 'apply', label: 'Apply', kind: 'primary' }, { id: 'keep', label: 'Keep', kind: 'secondary' }],
      pending: { actions: { apply: { op: 'schedule.set_days', args: { days: r.days.map((d: any) => ({ date: d.date, session: d.session })), reason: 'Deload', summary: 'Deload week' } }, keep: { kind: 'keep' } } },
    }),
  }),
  tool({
    name: 'propose_today_adjustment', kind: 'propose', fn: 'WEL-03',
    description: 'The user feels rough (bad sleep, sore, stressed): propose a lighter version of today’s session — one set fewer per exercise and easier effort. Only today changes.',
    input_schema: schema({ why: { type: 'string' } }),
    receipt: () => ({ verb: 'Proposed', text: 'Lighter today' }),
    execute: async (input, userId) => {
      const s: any = await getCurrentWeekSchedule(userId);
      const today = (s.weekDays ?? []).find((d: any) => d.isToday);
      if (!today?.session) throw new Error('Nothing is scheduled today.');
      const light = { ...today.session, exercises: (today.session.exercises ?? []).map((e: any) => ({ ...e, sets: Math.max(1, (Number(e.sets) || 3) - 1), intensity: 'RPE 6–7', notes: [e.notes, 'Lighter day — stop 3 reps short.'].filter(Boolean).join(' ') })) };
      return { date: today.date, before: today.session, session: light, why: str(input.why) };
    },
    card: (_i, r) => ({
      fn: 'WEL-03', pattern: 'proposal', rule: 'propose', meta: { label: 'Proposed · today' },
      diff: (r.before.exercises ?? []).slice(0, 6).map((e: any, i: number) => ({ key: exName(e), from: scheme(e), to: scheme(r.session.exercises[i]) })),
      why: r.why || 'Same session, less fatigue. Tomorrow goes back to plan.',
      actions: [{ id: 'apply', label: 'Apply', kind: 'primary' }, { id: 'keep', label: 'Keep', kind: 'secondary' }],
      pending: { actions: { apply: { op: 'schedule.set_days', args: { days: [{ date: r.date, session: r.session }], reason: 'Lighter day', summary: 'Today · lighter session' } }, keep: { kind: 'keep' } } },
    }),
  }),
  tool({
    name: 'propose_new_program', kind: 'propose', fn: 'PRG-04',
    description: 'Build a new program: a new goal, a new schedule, a different split ("give me a PPL split", "upper/lower"), a level change ("I\'m intermediate now", "make it more advanced"), or when the current one is finished. Ask for anything important that\'s missing first (days per week, weeks). Pass goal ONLY when the user wants a different goal — otherwise their current goal is kept. trainingAge = the level they state (call update_coaching_profile with trainingAge first so it sticks); split = ppl | upper_lower | full_body | bro_split | or their words. The card shows the phases; the user taps to make it their program. Their current program is archived; Undo restores it. Pro feature when they already have a program.',
    input_schema: schema({
      goal: { type: 'string', description: 'Only for a goal change.' },
      daysPerWeek: { type: 'number' }, durationWeeks: { type: 'number' },
      bodyCompositionGoal: { type: 'string', enum: ['fat_loss', 'muscle_gain', 'recomp', 'maintenance'] },
      trainingAge: { type: 'string', description: 'beginner | intermediate | advanced | elite' },
      split: { type: 'string', description: 'ppl | upper_lower | full_body | bro_split | free text' },
    }),
    receipt: () => ({ verb: 'Proposed', text: 'New program' }),
    execute: async (input, userId) => {
      const u = await prisma.user.findUnique({ where: { id: userId }, select: { coachGoal: true, tier: true, coachProfile: true, trainingAge: true, savedProgram: true } });
      const blob = parseJson<any>(u?.coachProfile, {});
      const current = parseJson<any>(u?.savedProgram, null);
      const split = splitLabel(input.split);
      const level = levelOf(input.trainingAge);
      const daysPerWeek = Math.min(6, Math.max(2, Math.round(numOr(input.daysPerWeek) ?? (split ? SPLIT_DAYS[split.id] : null) ?? numOr(blob.daysPerWeek) ?? numOr(current?.daysPerWeek) ?? 4)));
      const durationWeeks = Math.min(16, Math.max(2, Math.round(numOr(input.durationWeeks) ?? 12)));
      // Goal: an explicit new goal is a goal change; otherwise keep what the
      // current program trains for (a split or level change isn't a new goal).
      const keepGoal: string | null = current?.goal ?? null;
      const askedGoal = str(input.goal);
      const goalChange = !!askedGoal && (!keepGoal || norm(askedGoal) !== norm(keepGoal));
      const baseGoal = askedGoal || keepGoal || u?.coachGoal || undefined;
      const levelChanged = !!level && level !== String(u?.trainingAge ?? '').toLowerCase();
      // generateProgramForUser has no split / level inputs: the brief rides on
      // the goal line it puts in the prompt (and the level is also read from the
      // profile, which update_coaching_profile updates). The clean goal is
      // restored on the result below.
      const brief = [
        baseGoal ?? 'balanced strength and muscle',
        split ? `structure the week as a ${split.label} split (${split.hint})` : '',
        level ? `program it for a${/^[aeiou]/.test(level) ? 'n' : ''} ${level} lifter` : '',
      ].filter(Boolean).join(' — ');
      try {
        const generated = await generateProgramForUser(userId, { goal: split || level ? brief : baseGoal, daysPerWeek, durationWeeks, bodyCompositionGoal: input.bodyCompositionGoal as any, save: false });
        const program = { ...generated, goal: goalChange ? (generated?.goal || askedGoal) : (keepGoal ?? (split || level ? baseGoal ?? generated?.goal : generated?.goal)) };
        const phases = (program?.phases ?? []).map((ph: any) => `${ph.phaseName} (${ph.durationWeeks} wk)`);
        const firstDays = ((program?.phases ?? [])[0]?.trainingDays ?? []).map((d: any) => String(d.day ?? '')).filter(Boolean);
        const summary = `New ${program.durationWeeks ?? durationWeeks}-week program · ${program.daysPerWeek ?? daysPerWeek} days a week${split ? ` · ${split.label}` : ''}${level ? ` · ${level}` : ''}. ${phases.length ? `Phases: ${phases.join(', ')}. ` : ''}${current ? 'Your current program is saved in past programs.' : ''}`.trim();
        return {
          program, daysPerWeek, durationWeeks, phases, goal: program?.goal, goalChange, split: split?.label ?? null, trainingAge: level,
          ...(levelChanged ? { profileNote: `Their saved level is "${u?.trainingAge ?? 'not set'}" — call update_coaching_profile with trainingAge "${level}" so it sticks.` } : {}),
          // Classic app (card contract 1): rendered as its program-change card;
          // Apply goes through confirm-proposal → applyProgramUpdate, which sees
          // the rebuild marker and activates it like "Make this my program".
          _proposal: true, kind: 'program_update', summary, changedDays: firstDays,
          // The marker is only an opaque id; the program + goalChange are kept
          // server-side (issueRebuild) so the confirm tap can't be forged.
          updatedProgram: { ...program, [REBUILD_MARKER]: { id: issueRebuild(userId, program, goalChange) } },
        };
      } catch (err: any) {
        if (err?.status === 403) return { proOnly: true, daysPerWeek, durationWeeks, goal: baseGoal ?? null };
        throw err;
      }
    },
    card: (_i, r) => {
      if (r.proOnly) return { fn: 'PRG-04', pattern: 'proposal', rule: 'propose', pro: true, meta: { label: 'New program · Pro' }, rows: [{ key: 'Goal', value: String(r.goal ?? '—').slice(0, 60) }, { key: 'Length', value: `${r.durationWeeks} weeks` }, { key: 'Days', value: `${r.daysPerWeek} a week` }], actions: [{ id: 'pro', label: 'Unlock with Pro', kind: 'primary', client: { action: 'purchase' } }] };
      const p = r.program;
      return {
        fn: 'PRG-04', pattern: 'proposal', rule: 'propose', meta: { label: `Proposed · ${p.durationWeeks ?? r.durationWeeks}-week program`, open: { page: 'training' } },
        rows: (p.phases ?? []).map((ph: any) => ({ key: ph.phaseName, value: ph.weeksLabel ?? `${ph.durationWeeks} wk`, sub: String(ph.rationale ?? '').slice(0, 90) })),
        why: `${p.daysPerWeek ?? r.daysPerWeek} days a week toward ${String(p.goal ?? 'your goal').slice(0, 60)}.${(p.sources ?? []).length ? ` Built on ${plural(p.sources.length, 'source')}.` : ''}`,
        actions: [{ id: 'apply', label: 'Make this my program', kind: 'primary' }, { id: 'keep', label: 'Keep current', kind: 'secondary' }],
        entity: 'program:new',
        pending: { actions: { apply: { op: 'program.activate', args: { program: p, summary: 'New program started' }, line: 'Started' }, keep: { kind: 'keep', line: 'Kept your current program' } } },
      };
    },
  }),
  tool({
    name: 'read_past_programs', kind: 'read', fn: 'PRG-12',
    description: 'List finished or replaced programs (dates, goal, workouts logged, weight change), or one in detail with its phases.',
    input_schema: schema({ id: { type: 'string', description: 'Program id for detail.' } }),
    receipt: () => ({ verb: 'Read', text: 'Past programs' }),
    execute: async (input, userId) => {
      if (str(input.id)) {
        const p = await prisma.completedProgram.findFirst({ where: { id: str(input.id), userId } });
        if (!p) throw new Error('That program isn’t in your history.');
        const program = parseJson<any>(p.programJson, {});
        return { detail: { id: p.id, goal: p.goal, startDate: p.startDate, endDate: p.endDate, reason: p.reason, stats: parseJson(p.stats, {}), phases: (program.phases ?? []).map((ph: any) => ({ name: ph.phaseName, weeks: ph.durationWeeks })) } };
      }
      const list = await prisma.completedProgram.findMany({ where: { userId }, orderBy: { endDate: 'desc' }, take: 10 });
      return { programs: list.map((p) => ({ id: p.id, goal: p.goal, startDate: p.startDate, endDate: p.endDate, reason: p.reason, stats: parseJson<any>(p.stats, {}) })) };
    },
    card: (_i, r) => {
      const range = (p: any) => `${new Date(p.startDate).toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' })} – ${new Date(p.endDate).toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' })}`;
      if (r.detail) return { fn: 'PRG-12', pattern: 'glance', rule: 'show', meta: { label: String(r.detail.goal ?? 'Past program').slice(0, 50), open: { page: 'pastprogram', params: { id: r.detail.id } } }, rows: [{ key: 'When', value: range(r.detail) }, { key: 'Workouts', value: String(r.detail.stats.workoutsLogged ?? '—') }, ...r.detail.phases.map((ph: any) => ({ key: ph.name, value: `${ph.weeks} wk` }))],
        actions: [{ id: 'restore', label: 'Go back to this program', kind: 'secondary', client: { action: 'send_message', args: { text: `Put me back on my old program (${r.detail.id}).` } } }] };
      if (!r.programs.length) return { fn: 'PRG-12', pattern: 'glance', rule: 'show', meta: { label: 'Past programs' }, empty: 'No finished programs yet.' };
      return { fn: 'PRG-12', pattern: 'glance', rule: 'show', meta: { label: 'Past programs', open: { page: 'past' } }, rows: r.programs.map((p: any) => ({ key: String(p.goal ?? 'Program').slice(0, 40), value: `${p.stats.workoutsLogged ?? 0} workouts`, sub: `${range(p)} · ${p.reason === 'replaced' ? 'Replaced' : 'Completed'}` })) };
    },
  }),
  tool({
    name: 'propose_restore_program', kind: 'propose', fn: 'PRG-13',
    description: 'Propose going back to a past program (id from read_past_programs). It restarts from week 1; the current one is archived; Undo reverses it.',
    input_schema: schema({ id: { type: 'string' } }, ['id']),
    receipt: () => ({ verb: 'Proposed', text: 'Restore program' }),
    execute: async (input, userId) => {
      const p = await prisma.completedProgram.findFirst({ where: { id: str(input.id), userId } });
      if (!p) throw new Error('That program isn’t in your history.');
      const program = parseJson<any>(p.programJson, null);
      if (!program?.phases?.length) throw new Error('That program can’t be restored — its plan is missing.');
      const current = await loadProgram(userId);
      return { program, goal: p.goal, currentGoal: current?.goal ?? null, phases: program.phases.map((ph: any) => ph.phaseName) };
    },
    card: (_i, r) => ({
      fn: 'PRG-13', pattern: 'proposal', rule: 'propose', meta: { label: 'Proposed · restore program' },
      diff: [{ key: 'Program', from: String(r.currentGoal ?? 'Current').slice(0, 40), to: String(r.goal ?? 'Past program').slice(0, 40) }, { key: 'Phases', to: r.phases.join(', ') }],
      why: 'Starts again from week 1. Your current program is saved in past programs.',
      actions: [{ id: 'apply', label: 'Restore', kind: 'primary' }, { id: 'keep', label: 'Keep current', kind: 'secondary' }],
      pending: { actions: { apply: { op: 'program.activate', args: { program: r.program, summary: 'Restored a past program' }, line: 'Restored' }, keep: { kind: 'keep' } } },
    }),
  }),
  tool({
    name: 'find_exercise_video', kind: 'read', fn: 'PRG-14',
    description: 'Find a demo video for an exercise ("how do I do a Bulgarian split squat"). Give 2–3 cues in your text.',
    input_schema: schema({ exercise: { type: 'string' } }, ['exercise']),
    receipt: (i) => ({ verb: 'Searched', text: `Demo · ${str(i.exercise)}` }),
    execute: async (input, userId) => ({ exercise: str(input.exercise), video: await callApi(userId, 'GET', `/coach/exercise-video?name=${encodeURIComponent(str(input.exercise))}`).catch(() => null) }),
    card: (_i, r) => {
      const v = r.video as any;
      const id = v?.videoId ?? v?.id ?? null;
      if (!id) return { fn: 'PRG-14', pattern: 'glance', rule: 'show', meta: { label: r.exercise }, empty: 'I couldn’t find a demo for that one.' };
      return { fn: 'PRG-14', pattern: 'glance', rule: 'show', meta: { label: r.exercise }, media: { kind: 'video', uri: v.thumbnailUrl ?? `https://i.ytimg.com/vi/${id}/hqdefault.jpg`, caption: String(v.channelTitle ?? v.title ?? 'Demo').slice(0, 40) },
        actions: [{ id: 'play', label: 'Play video', kind: 'primary', client: { action: 'play_video', args: { videoId: id, title: v.title ?? r.exercise } } }, { id: 'swap', label: 'Swap it', kind: 'secondary', client: { action: 'send_message', args: { text: `Swap ${r.exercise} for something similar.` } } }] };
    },
  }),
];

registerToolkit(PROGRAM_TOOLS);
