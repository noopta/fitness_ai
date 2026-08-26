// Safe reads for the ~29 JSON-in-TEXT columns in the Prisma schema.
//
// SQLite stores these as TEXT, so nothing at the database level enforces that
// they hold JSON. The invariant lives only in the code that writes them — and
// on 2026-08-07 a writer that bypassed the zod schema (the agent's log_workout
// tool) put raw free text into WorkoutLog.exercises. Every reader did a bare
// JSON.parse, threw a SyntaxError, and returned 500 forever for that user.
//
// A bare JSON.parse on a column is therefore a latent 500 waiting for one bad
// writer. These helpers never throw: a malformed column degrades that one
// field instead of taking down the whole request.
//
// See also services/workoutExercises.ts, the column-specific version of this
// for WorkoutLog.exercises (it reconstructs placeholder entries from free text
// rather than just falling back).

/**
 * Parse a JSON column, returning `fallback` if it is null, empty, or malformed.
 *
 * `onMalformed` fires only for content that was present but unparseable —
 * never for a legitimately empty column — so it can be wired to logging
 * without drowning in noise from rows that were simply never set.
 */
export function parseJsonColumn<T>(
  raw: string | null | undefined,
  fallback: T,
  onMalformed?: (raw: string, err: unknown) => void,
): T {
  if (raw == null) return fallback;
  const trimmed = typeof raw === 'string' ? raw.trim() : '';
  if (trimmed === '') return fallback;
  try {
    const parsed = JSON.parse(trimmed);
    // `null` round-trips out of JSON.parse as a real value; callers asking for
    // an object or array fallback almost never want it.
    return (parsed === null ? fallback : (parsed as T));
  } catch (err) {
    onMalformed?.(trimmed, err);
    return fallback;
  }
}

/**
 * Parse a column expected to hold a JSON array.
 *
 * Returns [] for malformed content *and* for valid JSON that isn't an array —
 * a stored object or scalar would otherwise sail through JSON.parse and then
 * blow up at the first .map() or .forEach(), which is the same crash one frame
 * later.
 */
export function parseJsonArrayColumn<T>(
  raw: string | null | undefined,
  onMalformed?: (raw: string, err: unknown) => void,
): T[] {
  const parsed = parseJsonColumn<unknown>(raw, null, onMalformed);
  return Array.isArray(parsed) ? (parsed as T[]) : [];
}

/**
 * Parse a column expected to hold a JSON object (not an array, not a scalar).
 * Returns null when the column holds anything else.
 */
export function parseJsonObjectColumn<T extends object>(
  raw: string | null | undefined,
  onMalformed?: (raw: string, err: unknown) => void,
): T | null {
  const parsed = parseJsonColumn<unknown>(raw, null, onMalformed);
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as T;
  return null;
}
