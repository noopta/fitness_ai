// Tolerant handling of the WorkoutLog.exercises column.
//
// The column is supposed to hold a JSON array of exercise objects (see the
// zod schema in routes/workouts.ts), but the agent's log_workout tool
// historically wrote raw free text ("Outdoor run, 5.02km in 31 minutes"),
// which made every JSON.parse call site 500 for the affected user. Readers
// should go through parseExercisesColumn; writers of free text should go
// through freeTextToExercises so only valid JSON lands in the column.

export interface StoredExercise {
  name: string;
  sets: number;
  reps: string;
  weightKg?: number | null;
  rpe?: number | null;
  notes?: string | null;
  bodyweight?: boolean;
  setEntries?: Array<{ weightKg?: number | null; reps: number; rpe?: number | null }> | null;
  // True when the entry was reconstructed from free text — sets/reps are
  // placeholders, not real training data. Engine/PR code must skip these.
  freeform?: boolean;
}

// Convert agent/user free text into a valid exercises array. One entry per
// line or semicolon-separated segment so history renders a readable list.
export function freeTextToExercises(raw: string): StoredExercise[] {
  const segments = String(raw ?? '')
    .split(/\r?\n|;/)
    .map(s => s.trim())
    .filter(Boolean);
  const names = segments.length > 0 ? segments : ['Workout'];
  return names.map(name => ({ name, sets: 1, reps: '1', freeform: true }));
}

// Parse the exercises column without ever throwing. Valid JSON arrays pass
// through untouched; a stray JSON object is wrapped; anything unparseable is
// treated as free text and converted to placeholder entries.
export function parseExercisesColumn(raw: string): StoredExercise[] {
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && typeof parsed === 'object') return [parsed as StoredExercise];
    // Bare JSON scalars (numbers, quoted strings) — treat as free text
    return freeTextToExercises(typeof parsed === 'string' ? parsed : String(raw));
  } catch {
    return freeTextToExercises(raw);
  }
}
