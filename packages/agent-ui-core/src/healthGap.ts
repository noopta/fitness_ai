// What Apple Health isn't giving us, in words the Watch page can show. Apple never
// says whether a read was refused, so "nothing came back" names both causes. Pure.

export interface HealthReadReport { failed: string[]; empty: string[] }

/** Words for the types that matter to the read. Workouts, VO2 and the rest stay quiet: plenty of people have none. */
const NAMES: Record<string, string> = { sleep: 'sleep', restingHr: 'heart rate', hrv: 'heart rate' };

export const HEALTH_CONSENT_VERSION = '2026-11';

/** The report stored on the connection, or null for anything that isn't one (Fitbit's lastError is plain text). */
export function parseHealthReport(raw: string | null | undefined): HealthReadReport | null {
  if (!raw) return null;
  try {
    const r = JSON.parse(raw);
    return r && Array.isArray(r.failed) && Array.isArray(r.empty) ? { failed: r.failed.map(String), empty: r.empty.map(String) } : null;
  } catch {
    return null;
  }
}

/** The row at the top of the Watch page, or null when nothing's missing. */
export function healthGapNotice(raw: string | null | undefined): { title: string; sub: string } | null {
  const report = parseHealthReport(raw);
  if (!report) return null;
  const words = (types: string[]) => [...new Set(types.map((t) => NAMES[t]).filter(Boolean))];
  const failed = words(report.failed);
  const empty = words(report.empty).filter((w) => !failed.includes(w));
  const list = (w: string[]) => w.join(' or ');
  if (failed.length) return { title: `Couldn’t read your ${list(failed)}`, sub: 'Something went wrong on my side. Tap to open Health, then try Sync now.' };
  if (empty.length) return { title: `No ${list(empty)} from Apple Health`, sub: 'Check Health → Sharing → Apps → Axiom. An iPhone alone gives steps; a watch adds sleep and heart rate.' };
  return null;
}
