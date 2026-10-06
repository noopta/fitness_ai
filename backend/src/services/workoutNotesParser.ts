// Reading workouts a user kept somewhere else — usually their phone's notes
// app — so they can log them without re-typing. The model only reads the
// text into a structure; every number it returns is coerced and range-checked
// here, and the user reviews each session in the normal log form before
// anything is saved.

import { chatComplete } from './chatClient.js';
import { parseModelJson } from './modelJson.js';
import type { UnitPreference } from './weightUnits.js';

// A few months of notes. Longer text is read in chunks (CHUNK_CHARS each, a
// few at a time) so no single model reply gets near its token cap.
export const MAX_NOTES_CHARS = 40000;
// Output runs ~2 tokens of JSON per character of notes (6 Oct: 5k chars of
// notes → >12k tokens, cut off). 1500 chars keeps a chunk's reply around
// 3k tokens — ~20 s on the pinned providers.
const CHUNK_CHARS = 1500;
const CHUNK_CONCURRENCY = 5;
const MAX_WORKOUTS = 40; // per chunk
const MAX_TOTAL_WORKOUTS = 150;
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
  const r = await chatComplete(
    { messages: [{ role: 'user', content: prompt }], max_completion_tokens: 12000, response_format: { type: 'json_object' } },
    { timeoutMs: 90_000, requireJson: true, label: 'workout-notes' },
  );
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

/**
 * Anchors for older dates: each of the last 30 Monday-to-Sunday weeks, and the
 * weekday each of the last 13 months began on — enough to place "Week of
 * July 14 … Wed" or "Mon" under a dated heading without counting.
 */
export function olderCalendar(today: string): string {
  const dow = new Date(`${today}T12:00:00Z`).getUTCDay();
  const thisMonday = shiftDay(today, -((dow + 6) % 7));
  const weeks = Array.from({ length: 30 }, (_, i) => { const mon = shiftDay(thisMonday, -7 * i); return `${mon} to ${shiftDay(mon, 6)}`; }).join('; ');
  const [y, m] = today.split('-').map(Number);
  const firsts = Array.from({ length: 13 }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 1 - i, 1, 12));
    return `${d.toISOString().slice(0, 10)} is a ${WEEKDAYS[d.getUTCDay()]}`;
  }).join('; ');
  return `Weeks (Monday to Sunday), newest first: ${weeks}\nMonth starts: ${firsts}`;
}

function prompt(text: string, unit: UnitPreference, today: string, before: string | null = null): string {
  const weekday = WEEKDAYS[new Date(`${today}T12:00:00Z`).getUTCDay()];
  const u = unit === 'metric' ? 'kg' : 'lb';
  return `A person pasted workouts they kept somewhere else — a notes app, a spreadsheet, messages to themselves, or just a description in their own words. It can be tidy or a mess: shorthand, typos, prose, several weeks at once. Read it into structured sessions. Do not invent anything that is not written.

Today is ${weekday} ${today}. Their default unit is ${u}.

The last 14 days (use this to resolve weekdays and "yesterday"; do not count yourself):
${recentCalendar(today)}

Older dates (use these instead of counting):
${olderCalendar(today)}
${before ? `
This is a later part of a longer paste. The dated heading it falls under is:
<<<${before}>>>
Use it for dates only; do not output anything from it.
` : ''}
Rules:
- One entry in "workouts" per training session. If the text has no dates at all, return a single workout with date null (or one per clearly separate session, each with date null).
- date: YYYY-MM-DD. A date heading ("Mar 15", "Tues 3/16", "Week 3 — Mar 9") applies to the lines under it until the next one; a weekday under a week heading means that weekday in the Monday-to-Sunday week containing the heading's date (look up the week range that contains the heading's date: "Week of March 4" (a Wednesday) sits in the week starting Monday March 2, so "Mon" under it is March 2 and "Fri" is March 6). Resolve "yesterday", "Mon", "9/29", "29 Sept" relative to today; "mid July" alone is not a date (null). With no year, use the most recent such date on or before today. A weekday alone, with no heading, means the most recent such day on or before today. Never a date after today. Numeric dates: prefer month/day unless that is impossible. If unsure, null.
- Write exercise names out in full, as a lifter would read them in a log: bp/bench = Bench press, dl = Deadlift, ohp = Overhead press, rdl = Romanian deadlift, sq = Squat, bb row = Barbell row, db = Dumbbell (incline db = Incline dumbbell press), tri pushdowns = Triceps pushdown, pullups = Pull-ups; "225x5x3", "3x5 225", "3 sets of 5 at 225", "225 for 5, 3 sets" and "5 reps @ 225" are all 3 sets of 5 at 225. Prose counts: "did legs, squatted 3 sets of 5 at 225 then some leg press" is one workout: Squat 3x5 at 225, and Leg press with sets 1, reps "" and weight null.
- weekday: the day of the week written for this session in the text ("Mon", "wednesday", "Fri"), as Mon/Tue/Wed/Thu/Fri/Sat/Sun, else null. Copy it from the text; don't derive it from the date.
- title: the session name if written ("Push", "Leg day", "Upper A"), else null.
- For each exercise: name as written but tidied, first letter capitalised ("bench" -> "Bench press" only when obvious), sets (integer), reps (string, e.g. "8" or "8-10"), weight (number) with weightUnit "kg" or "lb" exactly as written, or null when no unit is written (then it is in their default unit), rpe if written, notes for anything else on that line.
- If sets differ ("135x5, 145x5, 155x3" or "3 sets: 60/8, 65/6, 65/6"), give setEntries [{ weight, reps, rpe }] in order and set sets to its length; weight/reps then describe the heaviest set.
- "Worked up to 405x1" is one set of 1 at 405; warm-ups that are only mentioned, not listed, are left out.
- "3x8 @ 135" means 3 sets of 8 reps at 135. "BW", "bodyweight", push-ups, pull-ups without load: weight null and bodyweight true. A time or distance (run 5k, plank 60s) goes in reps as written, sets 1.
- Lines you cannot read as training go in "unparsed" verbatim. Date headings, session names, blank lines and chatter like "sorry it's messy" are not unparsed — leave them out.
- Keep the JSON lean: leave out any key whose value would be null, false or empty (weightUnit, rpe, notes, bodyweight, setEntries, title, weekday).

Return JSON only:
{"workouts":[{"date":"2026-09-29","title":"Push","exercises":[{"name":"Bench press","sets":3,"reps":"8","weight":135},{"name":"Pull-ups","sets":3,"reps":"10","bodyweight":true}]}],"unparsed":[]}

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

const DOW: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };

/**
 * Models place "Mon" under "Week of July 21" a day out often enough to matter
 * (6 Oct: one run in two shifted a whole week by a day). When the text names
 * the weekday, trust the weekday and move the date onto it within the same
 * Monday-to-Sunday week; the model then only has to land in the right week.
 */
export function snapToWeekday(date: string, weekday: unknown): string {
  const want = typeof weekday === 'string' ? DOW[weekday.trim().slice(0, 3).toLowerCase()] : undefined;
  if (want === undefined) return date;
  const have = new Date(`${date}T12:00:00Z`).getUTCDay();
  if (have === want) return date;
  const monday = shiftDay(date, -((have + 6) % 7));
  return shiftDay(monday, (want + 6) % 7);
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
      const heaviest = setEntries.length >= 2 ? setEntries.reduce((a: ParsedSet, b: ParsedSet) => ((b.weight ?? 0) > (a.weight ?? 0) ? b : a)) : null;
      const reps = heaviest ? String(heaviest.reps) : str(e?.reps === undefined || e?.reps === null ? null : String(e.reps), 20) ?? (setEntries[0] ? String(setEntries[0].reps) : '');
      exercises.push({
        name, sets, reps: reps || '1',
        // With per-set entries the exercise is described by its heaviest set,
        // computed here rather than trusted to the model.
        weight: setEntries.length >= 2 ? (Math.max(0, ...setEntries.map((x: ParsedSet) => x.weight ?? 0)) || weight) : weight ?? (setEntries.length ? setEntries[0].weight : null),
        rpe: rpeOf(e?.rpe),
        notes: str(e?.notes, 200),
        bodyweight: e?.bodyweight === true || (weight === null && !setEntries.some((x: ParsedSet) => x.weight)),
        setEntries: setEntries.length >= 2 ? setEntries : null,
      });
    }
    if (!exercises.length) continue;
    const d = typeof w?.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(w.date) ? snapToWeekday(w.date, w?.weekday) : null;
    workouts.push({ date: d && d <= today && d >= oldest ? d : null, title: str(w?.title, 60), exercises });
  }
  workouts.sort((a, b) => (a.date ?? '9999') < (b.date ?? '9999') ? -1 : 1);
  const unparsed = (Array.isArray(raw?.unparsed) ? raw.unparsed : []).map((l: unknown) => str(l, 200)).filter(Boolean).slice(0, 20) as string[];
  return { workouts, unparsed };
}

const DATE_LINE = /\b(\d{1,2}[/.-]\d{1,2}([/.-]\d{2,4})?|\d{4}-\d{2}-\d{2}|(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}|\d{1,2}(st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)|week\s*(of|\d))/i;

/**
 * Split a long paste into chunks of about `size` chars, breaking before a
 * dated line or at a blank line where possible, never mid-line. Each chunk
 * after the first carries the last dated line before it, so "Mon" in chunk 3
 * still knows which week it is in.
 */
export function chunkNotes(text: string, size = CHUNK_CHARS): { text: string; before: string | null }[] {
  if (text.length <= size) return [{ text, before: null }];
  const chunks: { text: string; before: string | null }[] = [];
  let cur: string[] = [];
  let curLen = 0;
  let lastDated: string | null = null;
  let datedAtStart: string | null = null;
  const flush = () => {
    if (cur.join('').trim()) chunks.push({ text: cur.join('\n'), before: datedAtStart });
    cur = []; curLen = 0; datedAtStart = lastDated;
  };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.length > size ? raw.slice(0, size) : raw;
    const dated = line.trim().length <= 80 && DATE_LINE.test(line);
    const soft = curLen > size * 0.6 && (dated || !line.trim());
    if (cur.length && (curLen + line.length + 1 > size || soft)) flush();
    cur.push(line);
    curLen += line.length + 1;
    if (dated) lastDated = line.trim();
  }
  flush();
  return chunks;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i]); }
  }));
  return out;
}

/**
 * Parse each chunk, then stitch: a session split across a chunk boundary
 * (same date, last of one chunk and first of the next) becomes one again.
 * A chunk that fails to parse is reported in `unparsed` rather than sinking
 * the rest.
 */
export async function parseWorkoutNotes(text: string, unit: UnitPreference, today: string, complete: Complete = defaultComplete): Promise<ParsedNotes> {
  const chunks = chunkNotes(text.slice(0, MAX_NOTES_CHARS));
  const parts = await mapLimit(chunks, CHUNK_CONCURRENCY, async (c): Promise<ParsedNotes> => {
    try {
      return coerceParsedNotes(parseModelJson(await complete(prompt(c.text, unit, today, c.before))), unit, today);
    } catch (err) {
      if (chunks.length === 1) throw err;
      console.error('[workoutNotes] chunk parse failed:', (err as Error)?.message);
      const first = c.text.split(/\r?\n/).find((l) => l.trim()) ?? '';
      return { workouts: [], unparsed: [`(couldn't read the part starting "${first.trim().slice(0, 60)}")`] };
    }
  });
  const workouts: ParsedWorkout[] = [];
  for (const p of parts) {
    const head = p.workouts[0];
    const tail = workouts[workouts.length - 1];
    if (head && tail && head.date && head.date === tail.date && (!head.title || !tail.title || head.title === tail.title)) {
      tail.exercises.push(...head.exercises);
      tail.title = tail.title ?? head.title;
      workouts.push(...p.workouts.slice(1));
    } else workouts.push(...p.workouts);
  }
  if (chunks.length > 1) workouts.sort((a, b) => ((a.date ?? '9999') < (b.date ?? '9999') ? -1 : 1));
  return { workouts: workouts.slice(0, MAX_TOTAL_WORKOUTS), unparsed: parts.flatMap((p) => p.unparsed).slice(0, 40) };
}
