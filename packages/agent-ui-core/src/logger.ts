// The workout logger (design handoff T-01 – T-03): one page — a name, when it
// was, a note, and the exercises as set tables. Previous sets prefill in grey;
// typing a value or ticking a set makes it real. Only ticked sets are logged.
// Backdating is just the date. Pure, so the screen stays thin and this is tested.

export interface LoggerSet {
  /** What was lifted (display unit), null for bodyweight / not typed yet. */
  weight: number | null;
  reps: number | null;
  done: boolean;
  /** Last time's set at this position — shown grey, used when the field is left blank. */
  prev?: { weight: number | null; reps: number } | null;
}

export interface LoggerExercise {
  name: string;
  sets: LoggerSet[];
}

export interface LoggerState {
  title: string;
  /** YYYY-MM-DD, local. */
  date: string;
  note: string;
  exercises: LoggerExercise[];
}

export type LoggerAction =
  | { type: 'title'; title: string }
  | { type: 'date'; date: string }
  | { type: 'note'; note: string }
  | { type: 'add_exercise'; name: string; prev?: { weight: number | null; reps: number }[] }
  | { type: 'remove_exercise'; ex: number }
  | { type: 'add_set'; ex: number }
  | { type: 'remove_set'; ex: number; set: number }
  | { type: 'set_value'; ex: number; set: number; field: 'weight' | 'reps'; value: number | null }
  | { type: 'toggle_done'; ex: number; set: number }
  | { type: 'restore'; state: LoggerState };

export const emptyLogger = (date: string, title = ''): LoggerState => ({ title, date, note: '', exercises: [] });

export function loggerReducer(s: LoggerState, a: LoggerAction): LoggerState {
  const patchEx = (ex: number, fn: (e: LoggerExercise) => LoggerExercise) => ({ ...s, exercises: s.exercises.map((e, i) => (i === ex ? fn(e) : e)) });
  switch (a.type) {
    case 'title': return { ...s, title: a.title };
    case 'date': return { ...s, date: a.date };
    case 'note': return { ...s, note: a.note };
    case 'add_exercise': {
      const prev = a.prev ?? [];
      // As many sets as last time (3 if it's new), each prefilled grey from last time.
      const n = Math.max(1, prev.length || 3);
      const sets: LoggerSet[] = Array.from({ length: n }, (_, i) => ({ weight: null, reps: null, done: false, prev: prev[i] ?? prev[prev.length - 1] ?? null }));
      return { ...s, exercises: [...s.exercises, { name: a.name, sets }] };
    }
    case 'remove_exercise': return { ...s, exercises: s.exercises.filter((_, i) => i !== a.ex) };
    case 'add_set':
      return patchEx(a.ex, (e) => {
        const last = e.sets[e.sets.length - 1];
        // A new set starts from the one above it — the usual case is "same again".
        const seed = last ? { weight: last.weight ?? last.prev?.weight ?? null, reps: last.reps ?? last.prev?.reps ?? null } : { weight: null, reps: null };
        return { ...e, sets: [...e.sets, { ...seed, done: false, prev: null }] };
      });
    case 'remove_set': return patchEx(a.ex, (e) => ({ ...e, sets: e.sets.filter((_, i) => i !== a.set) }));
    case 'set_value':
      return patchEx(a.ex, (e) => ({ ...e, sets: e.sets.map((x, i) => (i === a.set ? { ...x, [a.field]: a.value } : x)) }));
    case 'toggle_done':
      return patchEx(a.ex, (e) => ({
        ...e,
        sets: e.sets.map((x, i) => {
          if (i !== a.set) return x;
          // Ticking a set with blank fields takes last time's numbers — the grey ones it showed.
          if (!x.done) return { ...x, done: true, weight: x.weight ?? x.prev?.weight ?? null, reps: x.reps ?? x.prev?.reps ?? null };
          return { ...x, done: false };
        }),
      }));
    case 'restore': return a.state;
    default: return s;
  }
}

/** Sets that will be logged: ticked, with reps. */
export const doneSets = (e: LoggerExercise) => e.sets.filter((x) => x.done && (x.reps ?? 0) > 0);
export const loggerHasWork = (s: LoggerState) => s.exercises.some((e) => doneSets(e).length > 0);

/**
 * The workout log body: one row per exercise with its ticked sets as entries.
 * The top-level weight / reps are the top set (heaviest, then most reps).
 * `toKg` converts the display unit; a set with no weight is bodyweight.
 */
export function loggerToLogBody(s: LoggerState, toKg: (w: number) => number) {
  const exercises = s.exercises.map((e) => {
    const sets = doneSets(e);
    if (!sets.length) return null;
    const top = [...sets].sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0) || (b.reps ?? 0) - (a.reps ?? 0))[0];
    const bodyweight = sets.every((x) => !x.weight);
    return {
      name: e.name.trim(),
      sets: sets.length,
      reps: String(top.reps ?? 0),
      weightKg: top.weight ? toKg(top.weight) : null,
      bodyweight,
      setEntries: sets.map((x) => ({ weightKg: x.weight ? toKg(x.weight) : null, reps: x.reps ?? 0, rpe: null })),
    };
  }).filter((x): x is NonNullable<typeof x> => !!x && !!x.name);
  return {
    date: s.date,
    title: s.title.trim() || null,
    notes: s.note.trim() || null,
    exercises,
  };
}

// ── Exercise search (T-02): the category tabs ───────────────────────────────

export type ExerciseCategory = 'chest' | 'back' | 'legs' | 'shoulders' | 'arms' | 'core' | 'other';
export const EXERCISE_CATEGORIES: ExerciseCategory[] = ['chest', 'back', 'legs', 'shoulders', 'arms'];

const CAT_RULES: [ExerciseCategory, RegExp][] = [
  // Order matters: "overhead press" is shoulders, "leg press" is legs, "close-grip bench" is chest.
  ['legs', /\b(squat|leg press|lunge|split squat|step[- ]?up|deadlift|rdl|romanian|hip thrust|glute|hamstring|leg curl|leg extension|calf|hack squat|good morning|nordic)\b/],
  ['shoulders', /\b(overhead press|ohp|shoulder press|military press|lateral raise|front raise|rear delt|face pull|arnold|upright row|landmine press|push press)\b/],
  // Back before chest: "chest-supported row" is a row.
  ['back', /\b(row|pull[- ]?up|chin[- ]?up|pulldown|pull[- ]?down|lat|shrug|back extension|pullover|rack pull)\b/],
  // Any press left after shoulders and legs (incline, dumbbell, machine…) is a chest press.
  ['chest', /\b(bench|chest|push[- ]?up|pec|fly|flye|dip|press)\b/],
  ['arms', /\b(curl|tricep|triceps|skull ?crusher|pressdown|push[- ]?down|kickback|hammer|preacher|extension)\b/],
  ['core', /\b(plank|crunch|sit[- ]?up|ab |abs|core|leg raise|russian twist|pallof|dead bug|hollow|carry)\b/],
];

/** Which tab an exercise falls under, by its name. */
export function exerciseCategory(name: string): ExerciseCategory {
  const n = ` ${name.toLowerCase()} `;
  for (const [cat, re] of CAT_RULES) if (re.test(n)) return cat;
  return 'other';
}

// ── Backdate (T-03) ─────────────────────────────────────────────────────────

/** "Today", "Yesterday", or "Sun 4 Oct" for the When row. */
export function whenLabel(date: string, today: string): string {
  if (date === today) return 'Today';
  const d = new Date(`${date}T12:00:00`);
  const t = new Date(`${today}T12:00:00`);
  const days = Math.round((t.getTime() - d.getTime()) / 86_400_000);
  if (days === 1) return 'Yesterday';
  const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${DAY[d.getDay()]} ${d.getDate()} ${MON[d.getMonth()]}`;
}

/** A logger draft worth offering back: under 3 days old, with something in it. */
export function resumableLogger(d: unknown, now: number): { state: LoggerState; savedAt: number } | null {
  const x = d as { v?: number; state?: LoggerState; savedAt?: number } | null;
  if (!x || x.v !== 1 || !x.state || typeof x.savedAt !== 'number') return null;
  if (now - x.savedAt > 3 * 86_400_000) return null;
  if (!x.state.exercises?.length) return null;
  return { state: x.state, savedAt: x.savedAt };
}
