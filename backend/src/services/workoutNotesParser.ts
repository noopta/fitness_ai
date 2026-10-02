// Reading workouts a user kept somewhere else — usually their phone's notes
// app — so they can log them without re-typing. The model only reads the
// text into a structure; every number it returns is coerced and range-checked
// here, and the user reviews each session in the normal log form before
// anything is saved.

import { chatComplete } from './chatClient.js';
import { parseModelJson } from './modelJson.js';
import type { UnitPreference } from './weightUnits.js';

export const MAX_NOTES_CHARS = 8000;
const MAX_WORKOUTS = 14;
const MAX_EXERCISES = 30;
const KG_PER_LB = 0.45359237;

export interface ParsedSet { weight: number | null; reps: number; rpe: number | null }
export interface ParsedExercise {
  name: string;
  sets: number;
  reps: string;
  /** In the user's own unit; null when unloaded or not written down. */
  weight: number | null;
  rpe: number | null;
  notes: string | null;
  bodyweight: boolean;
  /** Present when the sets differ (135x5, 145x5, 155x3). Weights in the user's unit. */
  setEntries: ParsedSet[] | null;
}
export interface ParsedWorkout { date: string | null; title: string | null; exercises: ParsedExercise[] }
export interface ParsedNotes { workouts: ParsedWorkout[]; unparsed: string[] }

export type Complete = (prompt: string) => Promise<string>;

const defaultComplete: Complete = async (prompt) => {
  const r = await chatComplete({ messages: [{ role: 'user', content: prompt }], max_completion_tokens: 4000, response_format: { type: 'json_object' } });
  return r.choices[0].message.content || '{}';
};

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** The last 14 days with their weekdays: models get "the most recent Monday" wrong when left to count. */
export function recentCalendar(today: string): string {
  return Array.from({ length: 14 }, (_, i) => {
    const d = shiftDay(today, -i);
    const label = i === 0 ? ' (today)' : i === 1 ? ' (yesterday)' : '';
    return `${WEEKDAYS[new Date(`${d}T12:00:00Z`).getUTCDay()]} ${d}${label}`;
  }).join('\n');
}

function prompt(text: string, unit: UnitPreference, today: string): string {
  const weekday = WEEKDAYS[new Date(`${today}T12:00:00Z`).getUTCDay()];
  const u = unit === 'metric' ? 'kg' : 'lb';
  return `A person pasted workouts they wrote in their phone's notes. Read them into structured sessions. Do not invent anything that is not written.

Today is ${weekday} ${today}. Their default unit is ${u}.

The last 14 days (use this to resolve weekdays and "yesterday"; do not count yourself):
${recentCalendar(today)}

Rules:
- One entry in "workouts" per training day. If the text has no dates at all, return a single workout with date null.
- date: YYYY-MM-DD. Resolve "yesterday", "Mon", "9/29", "29 Sept" relative to today; a weekday alone means the most recent such day on or before today. Never a date after today. Numeric dates: prefer month/day unless that is impossible. If unsure, null.
- title: the session name if written ("Push", "Leg day", "Upper A"), else null.
- For each exercise: name as written but tidied, first letter capitalised ("bench" -> "Bench press" only when obvious), sets (integer), reps (string, e.g. "8" or "8-10"), weight (number) with weightUnit "kg" or "lb" exactly as written, or null when no unit is written (then it is in their default unit), rpe if written, notes for anything else on that line.
- If sets differ ("135x5, 145x5, 155x3" or "3 sets: 60/8, 65/6, 65/6"), give setEntries [{ weight, reps, rpe }] in order and set sets to its length; weight/reps then describe the heaviest set.
- "Worked up to 405x1" is one set of 1 at 405; warm-ups that are only mentioned, not listed, are left out.
- "3x8 @ 135" means 3 sets of 8 reps at 135. "BW", "bodyweight", push-ups, pull-ups without load: weight null and bodyweight true. A time or distance (run 5k, plank 60s) goes in reps as written, sets 1.
- Lines you cannot read as training go in "unparsed" verbatim (skip blank lines and pure headings).

Return JSON only:
{"workouts":[{"date":"2026-09-29","title":"Push","exercises":[{"name":"Bench press","sets":3,"reps":"8","weight":135,"weightUnit":null,"rpe":null,"notes":null,"bodyweight":false,"setEntries":null}]}],"unparsed":[]}

NOTES:
"""
${text}
"""`;
}

const num = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v.replace(',', '.')) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? n : null;
};
const str = (v: unknown, max: number): string | null => (typeof v === 'string' && v.trim() ? v.trim().replace(/\s+/g, ' ').slice(0, max) : null);

/** A weight as written, in the user's unit. */
function toUserUnit(weight: unknown, written: unknown, unit: UnitPreference): number | null {
  const w = num(weight);
  if (w === null || w <= 0 || w > 1500) return null;
  const from = written === 'kg' ? 'kg' : written === 'lb' || written === 'lbs' ? 'lb' : null;
  const target = unit === 'metric' ? 'kg' : 'lb';
  const v = !from || from === target ? w : target === 'kg' ? w * KG_PER_LB : w / KG_PER_LB;
  return Math.round(v * 10) / 10;
}

const rpeOf = (v: unknown): number | null => { const n = num(v); return n !== null && n >= 1 && n <= 10 ? n : null; };

function shiftDay(d: string, days: number): string {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + days);
  return t.toISOString().slice(0, 10);
}

/** Everything the model said, checked: unknown shapes dropped, numbers in range, no future dates. */
export function coerceParsedNotes(raw: any, unit: UnitPreference, today: string, oldest = shiftDay(today, -365)): ParsedNotes {
  const workouts: ParsedWorkout[] = [];
  for (const w of Array.isArray(raw?.workouts) ? raw.workouts.slice(0, MAX_WORKOUTS) : []) {
    const exercises: ParsedExercise[] = [];
    for (const e of Array.isArray(w?.exercises) ? w.exercises.slice(0, MAX_EXERCISES) : []) {
      const name = str(e?.name, 80);
      if (!name) continue;
      const setEntries = Array.isArray(e?.setEntries)
        ? e.setEntries.slice(0, 30).map((x: any) => ({ weight: toUserUnit(x?.weight, x?.weightUnit ?? e?.weightUnit, unit), reps: Math.round(num(x?.reps) ?? -1), rpe: rpeOf(x?.rpe) }))
          .filter((x: ParsedSet) => x.reps >= 0 && x.reps <= 100)
        : [];
      const setsRaw = Math.round(num(e?.sets) ?? 0);
      const sets = setEntries.length >= 2 ? setEntries.length : setsRaw >= 1 && setsRaw <= 50 ? setsRaw : 1;
      const weight = toUserUnit(e?.weight, e?.weightUnit, unit);
      const reps = str(e?.reps === undefined || e?.reps === null ? null : String(e.reps), 20) ?? (setEntries[0] ? String(setEntries[0].reps) : '');
      exercises.push({
        name, sets, reps: reps || '1',
        weight: weight ?? (setEntries.length ? Math.max(0, ...setEntries.map((x: ParsedSet) => x.weight ?? 0)) || null : null),
        rpe: rpeOf(e?.rpe),
        notes: str(e?.notes, 200),
        bodyweight: e?.bodyweight === true || (weight === null && !setEntries.some((x: ParsedSet) => x.weight)),
        setEntries: setEntries.length >= 2 ? setEntries : null,
      });
    }
    if (!exercises.length) continue;
    const d = typeof w?.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(w.date) ? w.date : null;
    workouts.push({ date: d && d <= today && d >= oldest ? d : null, title: str(w?.title, 60), exercises });
  }
  workouts.sort((a, b) => (a.date ?? '9999') < (b.date ?? '9999') ? -1 : 1);
  const unparsed = (Array.isArray(raw?.unparsed) ? raw.unparsed : []).map((l: unknown) => str(l, 200)).filter(Boolean).slice(0, 20) as string[];
  return { workouts, unparsed };
}

export async function parseWorkoutNotes(text: string, unit: UnitPreference, today: string, complete: Complete = defaultComplete): Promise<ParsedNotes> {
  const clipped = text.slice(0, MAX_NOTES_CHARS);
  const raw = await complete(prompt(clipped, unit, today));
  return coerceParsedNotes(parseModelJson(raw), unit, today);
}
