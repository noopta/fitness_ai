// Which day a log belongs on, from the user's own words (Oct 2026).
//
// Saeed, Tue 27 Oct (Regina): at 11:28 "Yesterday I also did Muay Thai…"
// (logged Mon 26, right); at 14:43 "First session of the day: back squat…"
// and at 23:36 "Ended the night with BJJ…" — both logged Mon 26 too. The
// model knew it was Tuesday; the chat had been about Monday, and the history
// it reads had no times, so "the day" read as the day under discussion. The
// next day went to delete cards and re-logging ("Bro cmon man").
//
// So the date isn't the model's call. The log tools read the day from what
// the user wrote, by rule:
//   no day named, "today", "tonight", "the night"  → today
//   "yesterday", "last night"                      → the day before
//   a weekday ("Monday", "last Monday")            → the latest one, ≤ 7 days back
//   a date ("the 26th", "Oct 26", "10/26", ISO)    → that date
//   "3 days ago", "day before yesterday"           → counted back
//   "that day", "same day"                         → the day of their last log (≤ 6 h)
//   "the other day", "last week", "the weekend"    → vague: the model's date if it's ≤ 14 days back, else TODAY, said so
//   two days named, no usable model date           → the latest one, said so
// Nobody is made to specify a date (31 Oct 2026): a log with no clear day goes
// on today at the time it was sent, the reply says so, and the card can move
// it. The only question left is a day that hasn't happened yet.
// The model's date stands only when the user's words point to it. Pure.

export type DayBasis = 'today' | 'said' | 'context' | 'picked' | 'overruled' | 'assumed';

export interface DayPhrase {
  words: string;
  /** YYYY-MM-DD, or null when the words name no single day ("last week"). */
  date: string | null;
  kind: 'day' | 'vague' | 'ref';
}

export interface DayChoice {
  date: string;
  basis: DayBasis;
  /** The user's words that named the day. */
  said?: string;
  /** What the model asked for, when it was set aside. */
  modelDate?: string;
}

export interface DayAsk { ask: string }

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const NUM: Record<string, number> = { a: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, couple: 2 };
/** Words ending in "day" that aren't weekdays (so a typo match never fires on them). */
const NOT_WEEKDAY = new Set(['today', 'birthday', 'someday', 'everyday', 'holiday', 'payday', 'midday', 'workday', 'heyday', 'doomsday', 'leg day', 'legday', 'gameday', 'raceday', 'weekday', 'yesterday', 'saturday', 'sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'rest day', 'restday', 'birthdays', 'holidays', 'midsday', 'noonday', 'workaday', 'mayday', 'dday']);

const COMPARED = /\b(as|than|like|since|from|vs\.?|versus|compared to)\s+(on\s+|last\s+|this\s+past\s+)?$/;

export function shift(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
const weekdayOf = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay();

function lev(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  }
  return d[a.length][b.length];
}

/** "Monday", "tues", "thurs", or a near miss like "tueasay" → 0–6; else null. */
export function weekdayIndex(word: string): number | null {
  const w = word.toLowerCase().replace(/[^a-z]/g, '');
  const abbr: Record<string, number> = { mon: 1, tue: 2, tues: 2, wed: 3, weds: 3, thu: 4, thur: 4, thurs: 4, fri: 5, sat: 6, sun: 0 };
  if (w in abbr && w.length >= 4) return abbr[w];
  const exact = WEEKDAYS.indexOf(w);
  if (exact >= 0) return exact;
  if (NOT_WEEKDAY.has(w) || w.length < 5 || !/d[a-z]?y$|ay$/.test(w)) return null;
  let best: number | null = null;
  let bestD = 3;
  WEEKDAYS.forEach((name, i) => { const dist = lev(w, name); if (dist < bestD) { bestD = dist; best = i; } });
  return bestD <= 2 ? best : null;
}

/** The latest past (or today's) date with this day of the month. */
function latestDom(today: string, dom: number, month?: number): string | null {
  if (dom < 1 || dom > 31) return null;
  const [y, m] = today.split('-').map(Number);
  const months = month != null ? [month, month - 12] : Array.from({ length: 13 }, (_, k) => m - 1 - k);
  for (const mi of months) {
    const d = new Date(Date.UTC(y, mi, dom, 12));
    if (d.getUTCDate() !== dom) continue; // 31 Sep isn't a day
    const iso = d.toISOString().slice(0, 10);
    if (iso <= shift(today, 1)) return iso;
  }
  return null;
}

/**
 * Every phrase in the text that names a day, in order. `localHour` matters
 * after midnight: at 1 am "tonight" is the evening that just ended. Pure.
 */
export function dayPhrases(text: string, today: string, localHour = 12): DayPhrase[] {
  const t = ` ${String(text ?? '').replace(/<app_note>[\s\S]*?<\/app_note>/g, ' ').toLowerCase().replace(/[’']/g, "'")} `;
  const found: { at: number; p: DayPhrase }[] = [];
  const taken: [number, number][] = [];
  const add = (re: RegExp, make: (m: RegExpExecArray) => DayPhrase | null) => {
    for (const m of t.matchAll(new RegExp(re.source, 'gi')) as IterableIterator<RegExpExecArray>) {
      const s = m.index!, e = s + m[0].length;
      if (taken.some(([a, b]) => s < b && e > a)) continue;
      // "Same as yesterday", "heavier than Monday", "since Tuesday": a day compared to, not the day it happened.
      if (COMPARED.test(t.slice(Math.max(0, s - 16), s))) { taken.push([s, e]); continue; }
      const p = make(m);
      if (!p) continue;
      taken.push([s, e]);
      found.push({ at: s, p: { ...p, words: m[0].trim() } });
    }
  };
  const early = localHour < 4;
  add(/\b(the )?day before yesterday\b/, () => ({ words: '', date: shift(today, -2), kind: 'day' }));
  add(/\b(\d{1,2}|a|one|two|three|four|five|six|seven|couple(?: of)?) days? ago\b/, (m) => {
    const n = NUM[m[1].replace(/ of$/, '')] ?? Number(m[1]);
    return n >= 1 && n <= 60 ? { words: '', date: shift(today, -n), kind: 'day' } : null;
  });
  add(/\b(yesterday|yday|last night|last evening)\b/, () => ({ words: '', date: shift(today, -1), kind: 'day' }));
  add(/\b(earlier today|today|this morning|this afternoon|this am|this pm|just now)\b/, () => ({ words: '', date: today, kind: 'day' }));
  add(/\b(tonight|this evening|the night|the evening)\b/, () => ({ words: '', date: early ? shift(today, -1) : today, kind: 'day' }));
  add(/\b(that|the same|same) (day|night|morning|evening|afternoon|session)\b/, () => ({ words: '', date: null, kind: 'ref' }));
  add(/\b(the other day|last week|this week|earlier this week|(this past |last |over the |on the )?weekend|a few days ago|few days back|recently|last month)\b/, () => ({ words: '', date: null, kind: 'vague' }));
  add(/\b(\d{4})-(\d{2})-(\d{2})\b/, (m) => (DATE.test(`${m[1]}-${m[2]}-${m[3]}`) ? { words: '', date: `${m[1]}-${m[2]}-${m[3]}`, kind: 'day' } : null));
  const mon = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
  add(new RegExp(`\\b${mon}\\.? (\\d{1,2})(?:st|nd|rd|th)?\\b`), (m) => { const d = latestDom(today, Number(m[2]), MONTHS.indexOf(m[1].slice(0, 3))); return d ? { words: '', date: d, kind: 'day' } : null; });
  add(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)? (?:of )?${mon}\\b`), (m) => { const d = latestDom(today, Number(m[1]), MONTHS.indexOf(m[2].slice(0, 3))); return d ? { words: '', date: d, kind: 'day' } : null; });
  add(/(?<![\d/])(\d{1,2})\/(\d{1,2})(?![\d/])/, (m) => { const mo = Number(m[1]); if (mo < 1 || mo > 12) return null; const d = latestDom(today, Number(m[2]), mo - 1); return d ? { words: '', date: d, kind: 'day' } : null; });
  add(/\bthe (\d{1,2})(?:st|nd|rd|th)\b/, (m) => { const d = latestDom(today, Number(m[1])); return d ? { words: '', date: d, kind: 'day' } : null; });
  add(/\b(next|this coming|coming) ([a-z]+day|tues|thurs|weds)\b/, (m) => (weekdayIndex(m[2]) != null ? { words: '', date: null, kind: 'vague' } : null));
  add(/\b(last |this past |on |this )?([a-z]{4,10})\b/, (m) => {
    const i = weekdayIndex(m[2]);
    if (i == null) return null;
    const back = (weekdayOf(today) - i + 7) % 7;
    const days = back === 0 && /last|past/.test(m[1] ?? '') ? 7 : back;
    return { words: '', date: shift(today, -days), kind: 'day' };
  });
  return found.sort((a, b) => a.at - b.at).map((f) => f.p);
}

export interface DayInput {
  /** The date the model passed, if any. */
  modelDate?: string | null;
  today: string;
  localHour?: number;
  /** The user's message this turn. */
  text: string;
  /**
   * Their previous message, only when sent within a few minutes of this one
   * (a session split across two messages). Older ones don't carry a day forward.
   */
  recentUserText?: string | null;
  /** Anakin's last reply, only when it asked them about a day ("What did you do Monday?"). */
  askedText?: string | null;
  /** The day of their last log in the past 6 hours, for "that day". */
  lastLogDate?: string | null;
}

/** How far back a named day can be for a single log (backfill goes through log_past_workouts). */
export const MAX_BACK_DAYS = 60;
const pastOk = (d: string, today: string) => d <= shift(today, 1);

/** Pure: the day to log on, or a question to ask when their words don't settle it. */
export function chooseLogDate(i: DayInput): DayChoice | DayAsk {
  const today = i.today;
  const model = i.modelDate && DATE.test(i.modelDate) ? i.modelDate : null;
  let phrases = dayPhrases(i.text, today, i.localHour);
  let basisIfSaid: DayBasis = 'said';
  if (!phrases.length) {
    const ctx = [...dayPhrases(i.recentUserText ?? '', today, i.localHour), ...dayPhrases(i.askedText ?? '', today, i.localHour)];
    if (ctx.length) { phrases = ctx; basisIfSaid = 'context'; }
  }
  const resolved = phrases
    .map((p) => (p.kind === 'ref' ? { ...p, date: i.lastLogDate ?? null, kind: (i.lastLogDate ? 'day' : 'vague') as DayPhrase['kind'] } : p))
    // A named date over 60 days back is a year's slip more often than a log ("Oct 30" on 27 Oct): ask.
    .map((p) => (p.kind === 'day' && p.date && p.date < shift(today, -MAX_BACK_DAYS) ? { ...p, date: null, kind: 'vague' as const } : p));
  const days = resolved.filter((p) => p.kind === 'day' && p.date && pastOk(p.date, today));
  const vague = resolved.some((p) => p.kind === 'vague');
  const wordsFor = (d: string) => days.find((p) => p.date === d)?.words;

  if (!days.length && !vague) {
    return model && model !== today ? { date: today, basis: 'overruled', modelDate: model } : { date: today, basis: 'today' };
  }
  if (model && days.some((p) => p.date === model)) return { date: model, basis: model === today && basisIfSaid === 'said' && !wordsFor(model) ? 'today' : basisIfSaid, said: wordsFor(model) };
  const distinct = [...new Set(days.map((p) => p.date!))];
  if (distinct.length === 1 && !vague) {
    const d = distinct[0];
    return { date: d, basis: model && model !== d ? 'overruled' : basisIfSaid, said: wordsFor(d), ...(model && model !== d ? { modelDate: model } : {}) };
  }
  if (vague && model && model <= today && model >= shift(today, -14)) return { date: model, basis: 'picked', said: resolved.find((p) => p.kind === 'vague')?.words };
  if (!model && distinct.length === 1) return { date: distinct[0], basis: basisIfSaid, said: wordsFor(distinct[0]) };
  const named = resolved.map((p) => p.words).filter(Boolean).slice(0, 3).join('", "');
  // A day that hasn't happened ("next Monday", a date ahead) isn't a log yet — the one case still worth a question.
  const monthDayAhead = (w: string) => { const t = Date.parse(`${w} ${today.slice(0, 4)} 12:00:00Z`); return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) > today; };
  const futureOnly = !days.length && resolved.some((p) => (p.kind === 'day' && p.date && !pastOk(p.date, today)) || (p.kind === 'vague' && (/^(next|this coming)\b|\btomorrow\b/.test(p.words) || monthDayAhead(p.words))));
  if (futureOnly) return { ask: `Their words point to a day that hasn't happened yet ("${named}"). Don't log it — ask in one short line whether it already happened, or treat it as a plan.` };
  // Nobody is made to specify: two days named → the latest; a vague day with no usable date → today. The reply says so and the card can move it.
  if (distinct.length >= 2) { const latest = [...distinct].sort().pop()!; return { date: latest, basis: 'assumed', said: wordsFor(latest) }; }
  return { date: today, basis: 'assumed', said: resolved.find((p) => p.kind === 'vague')?.words ?? (named || undefined) };
}

/** "Tue 27 Oct" for a YYYY-MM-DD. */
export function shortDayLabel(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString('en-GB', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' });
}

/** Line for the tool result, so the reply names the day the log really went on. */
export function dayNote(c: DayChoice, today: string): string {
  const day = c.date === today ? `today (${shortDayLabel(c.date)})` : shortDayLabel(c.date);
  if (c.basis === 'assumed') return `Logged on ${day} — their words ("${c.said ?? ''}") don't name one exact day. Say which day it went on and that they can tell you if it was another day; never ask before logging.`;
  if (c.basis === 'overruled') return `Logged on ${day}, not ${shortDayLabel(c.modelDate!)}: their message doesn't name ${shortDayLabel(c.modelDate!)}${c.said ? ` — it says "${c.said}"` : ' — with no day named, a log goes on the day they sent it'}. Say ${day} in your reply.`;
  return `Logged on ${day}.`;
}
