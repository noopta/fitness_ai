// The v2 leaderboard (handoff S-09): which lift — bench, squat, deadlift,
// their total, or sessions — and whose — friends or one of your groups. Built
// from logged workouts (the old board read only diagnostic snapshots), ranked
// by best estimated 1RM over the last 90 days, or per kg of bodyweight. The
// month's change is each person's best this month against their best before.
// Only people the viewer already trains with — there is no public board.

import { e1rmWithRpe } from '../engine/e1rm.js';
import { canonicalizeSync } from './exerciseCanonical.js';
import { workingSets } from '../adaptation/history.js';

export type BoardLift = 'bench' | 'squat' | 'deadlift' | 'total' | 'sessions';
const CANON: Record<'bench' | 'squat' | 'deadlift', string> = { bench: 'Bench Press', squat: 'Squat', deadlift: 'Deadlift' };

export interface BoardLog { userId: string; date: string; exercises: any[] }
export interface BoardUser { id: string; name: string | null; username: string | null; weightKg: number | null }
export interface BoardEntry { userId: string; name: string | null; username: string | null; rank: number; value: number; perBw: number | null; monthDelta: number | null; isYou: boolean }

/** Best e1RM (kg) per canonical big-three lift in a set of logs. */
function bests(logs: BoardLog[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const w of logs) for (const ex of w.exercises ?? []) {
    const c = canonicalizeSync(String(ex?.name ?? ''))?.canonicalName;
    if (!c || !Object.values(CANON).includes(c)) continue;
    for (const s of workingSets(ex)) {
      if (!s.weightKg || s.reps <= 0 || s.reps > 12) continue;
      const e = e1rmWithRpe(s.weightKg, s.reps, s.rpe);
      if (e > (out[c] ?? 0)) out[c] = e;
    }
  }
  return out;
}

function valueOf(b: Record<string, number>, lift: BoardLift): number {
  if (lift === 'total') return Object.values(CANON).every((c) => b[c]) ? Object.values(CANON).reduce((s, c) => s + b[c], 0) : 0;
  if (lift === 'sessions') return 0;
  return b[CANON[lift]] ?? 0;
}

/** Rank `users` on `lift` from their logs. `today` is YYYY-MM-DD; the month starts on its 1st. Pure. */
export function rankBoard(users: BoardUser[], logs: BoardLog[], viewerId: string, lift: BoardLift, perBw: boolean, today: string): BoardEntry[] {
  const monthStart = `${today.slice(0, 7)}-01`;
  const since90 = new Date(`${today}T12:00:00Z`); since90.setUTCDate(since90.getUTCDate() - 90);
  const from90 = since90.toISOString().slice(0, 10);
  const byUser = new Map<string, BoardLog[]>();
  for (const l of logs) { const a = byUser.get(l.userId) ?? []; a.push(l); byUser.set(l.userId, a); }
  const rows = users.map((u) => {
    const mine = byUser.get(u.id) ?? [];
    if (lift === 'sessions') {
      const n = mine.filter((l) => l.date >= monthStart && l.date <= today).length;
      return { u, value: n, perBw: null, monthDelta: null };
    }
    const recent = valueOf(bests(mine.filter((l) => l.date >= from90 && l.date <= today)), lift);
    const before = valueOf(bests(mine.filter((l) => l.date < monthStart)), lift);
    const month = valueOf(bests(mine.filter((l) => l.date >= monthStart && l.date <= today)), lift);
    const pb = u.weightKg && u.weightKg > 0 && recent ? Math.round((recent / u.weightKg) * 100) / 100 : null;
    return { u, value: Math.round(recent * 10) / 10, perBw: pb, monthDelta: month && before ? Math.round((month - before) * 10) / 10 : null };
  }).filter((r) => r.value > 0 && (!perBw || r.perBw != null));
  rows.sort((a, b) => (perBw ? (b.perBw ?? 0) - (a.perBw ?? 0) : b.value - a.value));
  return rows.map((r, i) => ({ userId: r.u.id, name: r.u.name, username: r.u.username, rank: i + 1, value: r.value, perBw: r.perBw, monthDelta: r.monthDelta, isYou: r.u.id === viewerId }));
}
