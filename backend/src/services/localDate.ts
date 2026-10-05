// The user's own calendar day. WorkoutLog.date / MealEntry.date are the
// user's LOCAL date (YYYY-MM-DD), so anything that compares them to "today"
// must use this, not `now.toISOString().slice(0, 10)` (the UTC date — a day
// off for every US evening and every Asia-Pacific morning). Dependency-free
// so pure modules and loaders can share it without import cycles.

/** `now` as YYYY-MM-DD in the user's timezone (ET when unknown). */
export function todayForTz(tz: string | null | undefined, now = new Date()): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz || 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}
