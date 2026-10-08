// "Turn my workouts into a program" (Tarek, Oct 2026). The last seven days as
// logged — each weekday's exercises with their sets, reps and top load — as a
// one-phase program; a day with nothing logged is a rest day. Programs map
// trainingDays[i] to the i-th day from the start date, and a program starts
// the day it's applied, so the week is rotated to begin today: Monday's push
// stays on Monday. Pure, so it's tested.

import { workingSets } from '../adaptation/history.js';

const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export interface LoggedWorkout { date: string; title?: string | null; exercises: any[] }

function dayExercises(workouts: LoggedWorkout[]) {
  const byName = new Map<string, { name: string; sets: number; reps: number; weightKg: number | null; rpe: number | null }>();
  for (const w of workouts) for (const ex of w.exercises ?? []) {
    const name = String(ex?.name ?? '').trim();
    if (!name) continue;
    const sets = workingSets(ex);
    const n = Math.max(sets.length, Number(ex.sets) || 0, 1);
    const top = [...sets].sort((a, b) => (b.weightKg ?? 0) - (a.weightKg ?? 0) || b.reps - a.reps)[0];
    const prev = byName.get(name.toLowerCase());
    if (!prev || (top?.weightKg ?? 0) > (prev.weightKg ?? 0)) {
      byName.set(name.toLowerCase(), { name, sets: Math.min(8, prev ? Math.max(prev.sets, n) : n), reps: top?.reps ?? (Number(String(ex.reps ?? '').match(/\d+/)?.[0]) || 8), weightKg: top?.weightKg ?? null, rpe: top?.rpe ?? null });
    }
  }
  return [...byName.values()];
}

/** The program a week of logs describes, starting at `today` (YYYY-MM-DD). Null when nothing was logged. */
export function programFromRecentLogs(workouts: LoggedWorkout[], today: string, opts: { weeks?: number; goal?: string | null; unit?: 'kg' | 'lb' } = {}): any | null {
  const t = new Date(`${today}T12:00:00Z`);
  const from = new Date(t); from.setUTCDate(from.getUTCDate() - 6);
  const inWeek = workouts.filter((w) => w.date >= from.toISOString().slice(0, 10) && w.date <= today);
  if (!inWeek.length) return null;
  const byDow = new Map<number, LoggedWorkout[]>();
  for (const w of inWeek) { const d = new Date(`${w.date}T12:00:00Z`).getUTCDay(); byDow.set(d, [...(byDow.get(d) ?? []), w]); }
  const unit = opts.unit ?? 'kg';
  const load = (kg: number | null) => (kg == null ? null : unit === 'lb' ? `${Math.round(kg * 2.2046 / 5) * 5} lb` : `${Math.round(kg * 2) / 2} kg`);
  const startDow = t.getUTCDay();
  const trainingDays = Array.from({ length: 7 }, (_, i) => {
    const dow = (startDow + i) % 7;
    const ws = byDow.get(dow) ?? [];
    const exercises = dayExercises(ws).map((e) => ({
      name: e.name, sets: e.sets, reps: String(e.reps),
      intensity: e.rpe ? `RPE ${e.rpe}` : 'RPE 7–8',
      notes: e.weightKg != null ? `Last week: ${load(e.weightKg)} × ${e.reps}` : 'Bodyweight',
    }));
    const title = ws.find((w) => w.title)?.title;
    return exercises.length
      ? { day: `${DOW[dow]} — ${title || 'Session'}`, focus: title || 'As logged', exercises }
      : { day: `${DOW[dow]} — Rest`, focus: 'Rest', exercises: [] };
  });
  const sessions = trainingDays.filter((d) => d.exercises.length).length;
  const weeks = Math.max(1, Math.min(16, opts.weeks ?? 4));
  return {
    goal: opts.goal ?? 'Keep training the way you have been',
    durationWeeks: weeks,
    daysPerWeek: sessions,
    phases: [{
      phaseName: 'Your week', durationWeeks: weeks,
      rationale: 'Built from the sessions you logged this week, on the same days. Add a little load or a rep when the last set feels easy.',
      trainingDays,
    }],
    source: 'from_logs',
  };
}
