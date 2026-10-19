// Apple Health export (Health app → profile → Export All Health Data →
// export.xml) into the normalised shape, so real Apple data can be loaded
// without the app build. Streams line by line — exports run to gigabytes and
// Apple writes one <Record> per line.
//
// Raw exports keep every source: the iPhone and the Watch both count steps and
// energy, so per day we take the largest single source rather than summing
// (summing double-counts). Sleep is credited to the morning the user woke,
// from the source that recorded the most sleep that night.

import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import type { DayInput, WorkoutInput } from './types.js';

const attr = (line: string, name: string): string | null => {
  const m = line.match(new RegExp(`\\b${name}="([^"]*)"`));
  return m ? m[1] : null;
};
/** "2026-07-01 08:00:00 -0400" → ISO with offset; the local date is the first 10 chars. */
const iso = (s: string) => `${s.slice(0, 10)}T${s.slice(11, 19)}${s.slice(20, 23)}:${s.slice(23, 25)}`;

interface DayAcc {
  steps: Map<string, number>; kcal: Map<string, number>;
  rhr: number[]; hrv: number[]; resp: number[]; vo2: number[];
  sleep: Map<string, { deep: number; rem: number; core: number; unspecified: number; awake: number; start: string; end: string }>;
}

export class AppleExportReader {
  private days = new Map<string, DayAcc>();
  private workouts: WorkoutInput[] = [];
  private openWorkout: (WorkoutInput & { lines: string[] }) | null = null;
  constructor(private readonly since?: string) {}

  private day(date: string): DayAcc {
    let d = this.days.get(date);
    if (!d) { d = { steps: new Map(), kcal: new Map(), rhr: [], hrv: [], resp: [], vo2: [], sleep: new Map() }; this.days.set(date, d); }
    return d;
  }

  /** Feed one line of export.xml. */
  line(raw: string) {
    const line = raw.trim();
    if (this.openWorkout) {
      if (line.startsWith('</Workout>')) { this.closeWorkout(); return; }
      this.openWorkout.lines.push(line);
      return;
    }
    if (line.startsWith('<Workout ')) {
      const start = attr(line, 'startDate'), end = attr(line, 'endDate');
      if (!start || !end || (this.since && start.slice(0, 10) < this.since)) return;
      const w = { id: `${attr(line, 'sourceName') ?? 'apple'}:${start}`, start: iso(start), end: iso(end), activityType: (attr(line, 'workoutActivityType') ?? '').replace('HKWorkoutActivityType', ''), sourceName: attr(line, 'sourceName'), lines: [line] };
      if (line.endsWith('/>')) { this.openWorkout = w; this.closeWorkout(); } else this.openWorkout = w;
      return;
    }
    if (!line.startsWith('<Record ')) return;
    const type = attr(line, 'type');
    const start = attr(line, 'startDate');
    if (!type || !start) return;
    const end = attr(line, 'endDate') ?? start;
    const source = attr(line, 'sourceName') ?? '?';
    const value = Number(attr(line, 'value'));
    if (type === 'HKCategoryTypeIdentifierSleepAnalysis') {
      const date = end.slice(0, 10);
      if (this.since && date < this.since) return;
      const mins = (Date.parse(iso(end)) - Date.parse(iso(start))) / 60_000;
      if (!(mins > 0)) return;
      const v = attr(line, 'value') ?? '';
      const s = this.day(date).sleep.get(source) ?? { deep: 0, rem: 0, core: 0, unspecified: 0, awake: 0, start: iso(start), end: iso(end) };
      if (/Deep/.test(v)) s.deep += mins; else if (/REM/.test(v)) s.rem += mins; else if (/Core/.test(v)) s.core += mins;
      else if (/Awake/.test(v)) s.awake += mins; else if (/Asleep/.test(v)) s.unspecified += mins; else return; // InBed doesn't count as sleep
      if (iso(start) < s.start) s.start = iso(start);
      if (iso(end) > s.end) s.end = iso(end);
      this.day(date).sleep.set(source, s);
      return;
    }
    const date = start.slice(0, 10);
    if (this.since && date < this.since) return;
    if (!Number.isFinite(value)) return;
    const d = this.day(date);
    switch (type) {
      case 'HKQuantityTypeIdentifierStepCount': d.steps.set(source, (d.steps.get(source) ?? 0) + value); break;
      case 'HKQuantityTypeIdentifierActiveEnergyBurned': d.kcal.set(source, (d.kcal.get(source) ?? 0) + (attr(line, 'unit') === 'kJ' ? value / 4.184 : value)); break;
      case 'HKQuantityTypeIdentifierRestingHeartRate': d.rhr.push(value); break;
      case 'HKQuantityTypeIdentifierHeartRateVariabilitySDNN': d.hrv.push(value); break;
      case 'HKQuantityTypeIdentifierRespiratoryRate': d.resp.push(value); break;
      case 'HKQuantityTypeIdentifierVO2Max': d.vo2.push(value); break;
    }
  }

  private closeWorkout() {
    const w = this.openWorkout!;
    this.openWorkout = null;
    for (const l of w.lines) {
      const type = attr(l, 'type');
      if (type === 'HKQuantityTypeIdentifierActiveEnergyBurned' && attr(l, 'sum')) w.activeKcal = Math.round(Number(attr(l, 'sum')) / (attr(l, 'unit') === 'kJ' ? 4.184 : 1));
      if (type === 'HKQuantityTypeIdentifierHeartRate') { if (attr(l, 'average')) w.avgHr = Number(attr(l, 'average')); if (attr(l, 'maximum')) w.maxHr = Number(attr(l, 'maximum')); }
      if (/DistanceWalkingRunning|DistanceCycling|DistanceSwimming/.test(type ?? '') && attr(l, 'sum')) w.distanceM = Number(attr(l, 'sum')) * (attr(l, 'unit') === 'km' ? 1000 : attr(l, 'unit') === 'mi' ? 1609.34 : 1);
    }
    // Older exports put energy on the <Workout> line itself.
    const head = w.lines[0];
    if (w.activeKcal == null && attr(head, 'totalEnergyBurned')) w.activeKcal = Math.round(Number(attr(head, 'totalEnergyBurned')));
    const { lines: _l, ...out } = w;
    this.workouts.push(out);
  }

  result(): { days: DayInput[]; workouts: WorkoutInput[] } {
    const maxOf = (m: Map<string, number>) => (m.size ? Math.max(...m.values()) : null);
    const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
    const r1 = (n: number | null) => (n == null ? null : Math.round(n * 10) / 10);
    const days: DayInput[] = [...this.days.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([date, d]) => {
      const night = [...d.sleep.values()].sort((a, b) => (b.deep + b.rem + b.core + b.unspecified) - (a.deep + a.rem + a.core + a.unspecified))[0];
      const asleep = night ? night.deep + night.rem + night.core + night.unspecified : 0;
      const steps = maxOf(d.steps), kcal = maxOf(d.kcal);
      return {
        date,
        steps: steps == null ? null : Math.round(steps),
        activeKcal: kcal == null ? null : Math.round(kcal),
        restingHr: r1(d.rhr.length ? d.rhr[d.rhr.length - 1] : null),
        hrvMs: r1(avg(d.hrv)),
        hrvMethod: d.hrv.length ? 'sdnn' : null,
        sleep: night && asleep > 0 ? { minutes: Math.round(asleep), deep: Math.round(night.deep), rem: Math.round(night.rem), core: Math.round(night.core + night.unspecified), awake: Math.round(night.awake), start: night.start, end: night.end } : null,
        vo2max: r1(d.vo2.length ? d.vo2[d.vo2.length - 1] : null),
        respiratoryRate: r1(avg(d.resp)),
      };
    });
    return { days, workouts: this.workouts };
  }
}

/** Read an export.xml from disk. `since` (YYYY-MM-DD) skips older records. */
export async function readAppleExport(path: string, since?: string) {
  const reader = new AppleExportReader(since);
  const rl = createInterface({ input: createReadStream(path, { encoding: 'utf8' }), crlfDelay: Infinity });
  for await (const line of rl) reader.line(line);
  return reader.result();
}
