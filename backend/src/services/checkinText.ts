// Check-in text and averages that respect unanswered fields (v2 H-04): mood,
// energy and stress are optional, and a blank is never read as a score.
// No imports on purpose — safe to use from any module.
/** "mood 4/5, sleep 7h, stress 3/10" — only the answers given; nothing for a blank. */
export function describeCheckin(c: { mood?: number | null; energy?: number | null; sleepHours?: number | null; stress?: number | null }): string {
  return [
    c.mood != null ? `mood ${c.mood}/5` : null,
    c.energy != null ? `energy ${c.energy}/5` : null,
    c.sleepHours != null ? `sleep ${c.sleepHours}h` : null,
    c.stress != null ? `stress ${c.stress}/10` : null,
  ].filter(Boolean).join(', ') || 'no answers';
}

/** Mean of the answered values; null when none were answered. */
export function meanAnswered(values: Array<number | null | undefined>): number | null {
  const v = values.filter((x): x is number => typeof x === 'number');
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}
