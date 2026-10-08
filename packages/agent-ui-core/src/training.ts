// Training pages outside chat (design handoff Wave 2: H-02, H-03, T-06 – T-13).
// The decisions those screens make — what Swap offers, what Life happened
// proposes, how a program's weeks line up, which weekly points fall in a
// range — kept pure so the screens stay thin and this is tested.

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const dowOf = (date: string) => DOW[new Date(`${date.slice(0, 10)}T12:00:00`).getDay()];
export const addDays = (date: string, n: number) => { const d = new Date(`${date.slice(0, 10)}T12:00:00`); d.setDate(d.getDate() + n); return ymd(d); };

/** A proposal a screen can ask for: one of the server's native tools and its input. */
export interface ToolOption { title: string; sub: string; tool: string; input: Record<string, unknown> }

// ─── H-02 Swap ───────────────────────────────────────────────────────────────

export interface WeekDay { date: string; isLogged?: boolean; session: any | null }

/**
 * What Swap offers for today: up to two later sessions this week (they trade
 * places), a short version, a recovery day, and rest (today's session moves
 * to the next free day if there is one). Every option keeps the week's volume.
 */
export function swapOptions(session: any, week: WeekDay[], date: string, label: (s: any) => string, minutes: (s: any) => number | null): ToolOption[] {
  const name = label(session);
  const later = week.filter((d) => d.date.slice(0, 10) > date && d.session && !d.isLogged);
  const free = week.find((d) => d.date.slice(0, 10) > date && !d.session);
  const out: ToolOption[] = later.slice(0, 2).map((d) => {
    const day = d.date.slice(0, 10);
    const m = minutes(d.session);
    return { title: `${label(d.session)}${m ? ` · ${m} min` : ''}`, sub: `${dowOf(day)}’s session — ${name} moves there`, tool: 'propose_workout_swap', input: { sourceDate: day, date } };
  });
  out.push({ title: `Short ${name.toLowerCase()} · 30 min`, sub: 'Top sets only, one set fewer each', tool: 'propose_today_adjustment', input: { why: 'Short on time — top sets only.' } });
  out.push({ title: 'Mobility + walk · 25 min', sub: 'A recovery day', tool: 'propose_rest_days', input: { from: date, reason: 'Recovery day — mobility and a 25-minute walk' } });
  out.push(free
    ? { title: 'Rest', sub: `${name} moves to ${dowOf(free.date)}`, tool: 'propose_workout_swap', input: { sourceDate: date, date: free.date.slice(0, 10) } }
    : { title: 'Rest', sub: 'The rest of the week stays as planned', tool: 'propose_rest_days', input: { from: date, reason: 'Rest today' } });
  return out;
}

// ─── H-03 Life happened ──────────────────────────────────────────────────────

export type LifeReason = 'sick' | 'travel' | 'busy' | 'injured' | 'break';

/**
 * What Life happened proposes. Sick or a break → a pause (and, for more than
 * a day, pushing the program back instead). Travel, a busy week or an injury
 * need Anakin's judgement (equipment, where it hurts), so they go to chat.
 */
export function lifePlan(reason: LifeReason, days: number, date: string): { option: ToolOption; alt: ToolOption | null } | { chat: string } {
  const n = Math.max(1, Math.round(days));
  const span = n === 1 ? 'today' : `for ${n} days`;
  if (reason === 'sick' || reason === 'break') {
    const why = reason === 'sick' ? 'Sick' : 'A break';
    return {
      option: { title: 'Pause', sub: '', tool: 'propose_rest_days', input: { from: date, to: addDays(date, n - 1), reason: why } },
      alt: n > 1 ? { title: 'Push the program back instead', sub: '', tool: 'propose_program_shift', input: { days: n, reason: `${why} — every phase stays, the dates move.` } } : null,
    };
  }
  if (reason === 'travel') return { chat: `I'm travelling ${span}. Plan my sessions around what I'll have — ask me what equipment there is.` };
  if (reason === 'busy') return { chat: `Busy week ${span}. Make my sessions shorter but keep the main lifts.` };
  return { chat: 'I’m injured. Ask me where and how it happened, then adjust my program around it.' };
}

// ─── T-07 / T-08 Program ─────────────────────────────────────────────────────

export interface PhaseView { name: string; weeks: number; from: number; days: any[]; why: string | null }

/** The program's phases with the week each starts on. `label` tidies a phase name. */
export function phasesOf(program: any, label: (s: string) => string = (s) => s): PhaseView[] {
  let from = 1;
  return (program?.phases ?? []).map((p: any, i: number) => {
    const weeks = Math.max(1, Number(p.durationWeeks ?? p.weeks) || 1);
    const v = { name: label(p.phaseName || p.name || `Phase ${i + 1}`), weeks, from, days: p.trainingDays ?? p.days ?? [], why: p.rationale || p.description || p.focus || null };
    from += weeks;
    return v;
  });
}

/** Which program week a date falls in (1-based, clamped to the program). */
export function programWeek(start: string, date: string, totalWeeks: number): number {
  const days = Math.floor((new Date(`${date.slice(0, 10)}T12:00:00`).getTime() - new Date(`${start.slice(0, 10)}T12:00:00`).getTime()) / 86_400_000);
  return Math.min(Math.max(1, totalWeeks), Math.max(1, Math.floor(days / 7) + 1));
}

// ─── T-06 Progression suggestion ─────────────────────────────────────────────

/** A suggestion's rows: the change itself where it has one, else its evidence. `fmt` renders kg in the user's unit. */
export function proposalRows(p: any, fmt: (kg: number | null | undefined) => string): { key: string; from?: string; to: string }[] {
  const pl = p?.proposal ?? {};
  switch (pl.kind) {
    case 'next_session': return [{ key: pl.exercise, from: pl.fromWeightKg != null ? `${fmt(pl.fromWeightKg)} × ${pl.reps}` : undefined, to: `${fmt(pl.toWeightKg)} × ${pl.reps}` }];
    case 'load_change': return [{ key: pl.exercise, from: fmt(pl.fromWeightKg), to: fmt(pl.toWeightKg) }];
    case 'calibration': return [{ key: pl.exercise, to: fmt(pl.targetWeightKg) }];
    case 'deload': return [{ key: 'Next week', from: 'As planned', to: `${pl.volumeCutPct}% fewer sets` }];
    case 'volume_balance': return [{ key: pl.muscle, from: `${pl.currentSets} sets`, to: `${pl.suggestedSets} sets` }];
    case 'calorie_adjust': return [{ key: 'Calories', from: `${pl.fromKcal}`, to: `${pl.toKcal}` }];
    default: return (p?.evidence ?? []).slice(0, 3).map((e: any) => ({ key: String(e.label), to: String(e.value) }));
  }
}

// ─── T-10 Exercise ───────────────────────────────────────────────────────────

/** Program notes → up to 4 short cues; effort notes ("RPE 8") aren't cues. */
export const cuesFrom = (notes?: string | null) => String(notes ?? '').split(/[.;!]\s+|\n|•/).map((s) => s.replace(/[.;]+$/, '').trim()).filter((s) => s.length > 2 && !/^rpe\b/i.test(s)).slice(0, 4);

// ─── T-12 Lift trend ─────────────────────────────────────────────────────────

/** ISO week key ("2026-W07") — the same calendar as the server's weekly series. */
export function isoWeekKey(d: Date): string {
  const x = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7) + 3); // the week's Thursday
  const jan4 = new Date(Date.UTC(x.getUTCFullYear(), 0, 4));
  jan4.setUTCDate(jan4.getUTCDate() - ((jan4.getUTCDay() + 6) % 7) + 3); // week 1's Thursday
  const wk = 1 + Math.round((x.getTime() - jan4.getTime()) / (7 * 86_400_000));
  return `${x.getUTCFullYear()}-W${String(wk).padStart(2, '0')}`;
}

/** Weekly points inside the last `weeks` weeks (0 = all). */
export function inRange<P extends { week: string }>(series: P[], weeks: number, now = new Date()): P[] {
  if (!weeks) return series;
  const from = new Date(now); from.setDate(from.getDate() - weeks * 7);
  const key = isoWeekKey(from);
  return series.filter((p) => p.week >= key);
}

// ─── T-13 Movement patterns ──────────────────────────────────────────────────

/** "Carries and core are missing." from the coverage list. */
export function patternsHeadline(list: { label: string; status: string }[]): string {
  if (!list.length) return 'Not enough logged yet.';
  const missing = list.filter((p) => p.status === 'neglected').map((p) => p.label);
  if (!missing.length) return list.some((p) => p.status === 'light') ? 'Everything’s there. Some of it is light.' : 'Every pattern is covered.';
  const names = missing.length > 2 ? `${missing.slice(0, -1).join(', ')} and ${missing[missing.length - 1]}` : missing.join(' and ');
  return `${names.charAt(0).toUpperCase()}${names.slice(1)} ${missing.length === 1 ? 'is' : 'are'} missing.`;
}

// ─── T-15 Diagnostic ─────────────────────────────────────────────────────────

/** An Ask: the question up to its "?", the rest as its reason. Text without a question is all title. */
export function askParts(text: string): { title: string; reason: string | null } {
  const t = String(text ?? '').trim();
  const q = t.indexOf('?');
  if (q < 0) return { title: t, reason: null };
  // The question is the last sentence that ends in "?" (a lead-in sentence can come first).
  const dot = t.lastIndexOf('. ', q);
  const nl = t.lastIndexOf('\n', q);
  const start = Math.max(dot >= 0 ? dot + 2 : 0, nl >= 0 ? nl + 1 : 0);
  const lead = t.slice(0, start).trim();
  const rest = t.slice(q + 1).trim();
  return { title: t.slice(start, q + 1).trim(), reason: [lead, rest].filter(Boolean).join(' ') || null };
}

/** "3 / 10" → 0.3; "Done" → 1; anything else → 0. */
export function progressFraction(label: string): number {
  if (/done/i.test(label)) return 1;
  const m = /(\d+)\s*\/\s*(\d+)/.exec(label);
  return m ? Math.min(1, Number(m[1]) / Math.max(1, Number(m[2]))) : 0;
}
