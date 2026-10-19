// Simulated watch data, end to end without hardware.
//
// Generates days around a personal baseline (ranges in line with what public
// Fitbit datasets — LifeSnaps, PMData — show for active adults), bends the last
// week into a scenario, and ingests it through the same ingest() the phone and
// Google Health use. It writes under provider 'simulator' so it never mixes
// with a user's real data and can be removed in one call.

import { ingest } from './ingest.js';
import type { DayInput, WorkoutInput } from './types.js';

export const SCENARIOS = ['normal', 'overreached', 'illness', 'poor_sleep', 'deload', 'travel'] as const;
export type Scenario = (typeof SCENARIOS)[number];

export const SCENARIO_LABEL: Record<Scenario, string> = {
  normal: 'A steady training block',
  overreached: 'Last week: training piled up, HRV sliding, resting HR creeping up',
  illness: 'Last 3 days: resting HR up 8, HRV down a third, warm wrist, barely moving',
  poor_sleep: 'Last week: 5 to 5.5 hour nights',
  deload: 'Last week: lighter, shorter sessions; recovery bouncing back',
  travel: 'Two short, late nights after a flight, then lots of walking',
};

/** Small deterministic PRNG so a scenario replays identically for a user. */
function rng(seed: string) {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) { h = Math.imul(h ^ seed.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  return () => { h = Math.imul(h ^ (h >>> 16), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); h ^= h >>> 16; return (h >>> 0) / 4294967296; };
}
const gauss = (r: () => number) => Math.sqrt(-2 * Math.log(r() || 1e-9)) * Math.cos(2 * Math.PI * r());
const shift = (d: string, n: number) => { const t = new Date(`${d}T12:00:00Z`); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };

export interface SimOptions { scenario: Scenario; days: number; endDate: string; seed: string; hrvMethod?: 'sdnn' | 'rmssd' }

/** The pure part: days and workouts for a scenario ending on endDate. */
export function simulate({ scenario, days, endDate, seed, hrvMethod = 'sdnn' }: SimOptions): { days: DayInput[]; workouts: WorkoutInput[] } {
  const r = rng(`${seed}:${scenario}`);
  const base = { rhr: 54 + r() * 8, hrv: (hrvMethod === 'sdnn' ? 45 : 32) + r() * 20, sleep: 405 + r() * 45, steps: 7000 + r() * 4000 };
  const out: DayInput[] = [];
  const workouts: WorkoutInput[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const date = shift(endDate, -i);
    const dow = new Date(`${date}T12:00:00Z`).getUTCDay();
    const last = i; // days before endDate; scenarios bend the final stretch
    let training = [1, 3, 5, 6].includes(dow);
    let hrvK = 1, rhrD = 0, sleepD = 0, stepsK = 1, temp = 0.1 * gauss(r), sessionK = 1;
    if (scenario === 'overreached' && last < 7) { const t = (7 - last) / 7; hrvK = 1 - 0.3 * t; rhrD = 6 * t; sleepD = -35 * t; training = training || dow === 2; sessionK = 1.3; }
    if (scenario === 'illness' && last < 3) { hrvK = 0.65; rhrD = 8 + r() * 2; temp = 0.6 + 0.2 * r(); stepsK = 0.35; training = false; sleepD = 40; }
    if (scenario === 'poor_sleep' && last < 7) { sleepD = 315 - base.sleep; hrvK = 0.86; rhrD = 2.5; }
    if (scenario === 'deload' && last < 7) { sessionK = 0.6; hrvK = 1.08 + 0.02 * (7 - last) / 7; rhrD = -1.5; }
    if (scenario === 'travel' && (last === 3 || last === 4)) { sleepD = -150; hrvK = 0.82; rhrD = 3; }
    if (scenario === 'travel' && last < 3) stepsK = 1.7;

    // Short-night scenarios stay short: less night-to-night noise than a normal week.
    const sleepNoise = scenario === 'poor_sleep' && last < 7 ? 8 : 25;
    const sleepMin = Math.max(180, Math.round(base.sleep + sleepD + sleepNoise * gauss(r)));
    const start = new Date(`${shift(date, -1)}T23:${String(Math.floor(r() * 50)).padStart(2, '0')}:00Z`);
    const end = new Date(start.getTime() + (sleepMin + 15) * 60_000);
    const steps = Math.max(300, Math.round(base.steps * stepsK * (1 + 0.25 * gauss(r)) + (training ? 1500 : 0)));
    const day: DayInput = {
      date,
      steps,
      activeKcal: Math.round(steps * 0.045 + (training ? 260 * sessionK : 0) + 40 * gauss(r)),
      restingHr: Math.round((base.rhr + rhrD + 1.5 * gauss(r)) * 10) / 10,
      hrvMs: Math.round(base.hrv * hrvK * (1 + 0.1 * gauss(r)) * 10) / 10,
      hrvMethod,
      sleep: {
        minutes: sleepMin,
        deep: Math.round(sleepMin * (0.15 + 0.03 * gauss(r))),
        rem: Math.round(sleepMin * (0.22 + 0.03 * gauss(r))),
        core: Math.round(sleepMin * 0.58),
        awake: Math.round(15 + 10 * r()),
        start: start.toISOString(),
        end: end.toISOString(),
      },
      vo2max: Math.round((44 + (seed.length % 5)) * 10) / 10,
      respiratoryRate: Math.round((14.5 + 0.6 * gauss(r) + (scenario === 'illness' && last < 3 ? 2 : 0)) * 10) / 10,
      wristTempDeltaC: Math.round(temp * 100) / 100,
      wornMinutes: 1300 + Math.round(100 * r()),
    };
    out.push(day);
    if (training) {
      const ws = new Date(`${date}T${17 + Math.floor(r() * 3)}:${String(Math.floor(r() * 60)).padStart(2, '0')}:00Z`);
      const dur = Math.round((55 + 15 * r()) * sessionK);
      workouts.push({
        id: `sim-${date}`,
        start: ws.toISOString(),
        end: new Date(ws.getTime() + dur * 60_000).toISOString(),
        activityType: 'traditionalStrengthTraining',
        activeKcal: Math.round(dur * (4.5 + r())),
        avgHr: Math.round(112 + 12 * r()),
        maxHr: Math.round(150 + 20 * r()),
        sourceName: 'Simulator',
      });
    }
  }
  return { days: out, workouts };
}

/** Simulate and store for a user (provider 'simulator'). */
export async function runSimulation(userId: string, opts: Omit<SimOptions, 'seed'> & { seed?: string }) {
  const data = simulate({ ...opts, seed: opts.seed ?? userId });
  const result = await ingest(userId, 'simulator', data);
  return { ...result, scenario: opts.scenario, from: data.days[0]?.date, to: data.days[data.days.length - 1]?.date };
}
