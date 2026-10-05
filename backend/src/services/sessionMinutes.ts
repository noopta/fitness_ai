// How long a programmed session takes. A session's own `estimatedMinutes`
// (written by the program generator) wins; older programs don't carry one, so
// we estimate from the session itself — sets × (work + rest) per exercise,
// plus warm-up and cool-down — instead of a flat per-exercise guess that made
// every day read the same.

const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').match(/\d+(?:\.\d+)?/)?.[0]);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** Seconds of work in one set: "30s" / "45 sec" holds, otherwise ~4 s a rep (mid of "8-10"). */
function workSeconds(reps: unknown): number {
  const s = String(reps ?? '').toLowerCase();
  const secs = s.match(/(\d+)\s*(?:s|sec|secs|seconds)\b/);
  if (secs) return Number(secs[1]);
  const range = s.match(/(\d+)\s*[-–]\s*(\d+)/);
  const r = range ? (Number(range[1]) + Number(range[2])) / 2 : num(s) ?? 8;
  return Math.min(r, 30) * 4 + 15; // + unrack / set-up
}

/** Rest after a set: heavy low-rep work rests longest. An explicit "rest 90s / 2 min" wins. */
function restSeconds(e: any): number {
  const text = `${e?.notes ?? ''} ${e?.intensity ?? ''}`.toLowerCase();
  const m = text.match(/rest\s*(\d+(?:\.\d+)?)\s*(min|m|s|sec)/);
  if (m) return m[2].startsWith('m') ? Number(m[1]) * 60 : Number(m[1]);
  const reps = num(e?.reps) ?? 8;
  return reps <= 5 ? 180 : reps <= 8 ? 120 : 75;
}

/** Minutes for one programmed session, rounded to 5; null for a rest day. */
export function sessionMinutes(session: any): number | null {
  if (!session) return null;
  const given = num(session.estimatedMinutes);
  if (given) return Math.round(given);
  const exercises: any[] = Array.isArray(session.exercises) ? session.exercises : [];
  if (!exercises.length) return null;
  let sec = 0;
  for (const e of exercises) {
    const sets = Math.min(num(e?.sets) ?? 3, 10);
    sec += sets * workSeconds(e?.reps) + (sets - 1) * restSeconds(e) + 60; // + changeover
  }
  const warm: unknown[] = Array.isArray(session.warmup) ? session.warmup : [];
  const cool: unknown[] = Array.isArray(session.cooldown) ? session.cooldown : [];
  sec += (warm.length ? warm.length * 90 : 300) + cool.length * 60;
  return Math.max(10, Math.round(sec / 300) * 5);
}
