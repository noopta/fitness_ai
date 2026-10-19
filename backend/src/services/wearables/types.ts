// The one shape every wearable source is turned into. Apple Health (sent up by
// the phone), Google Health (pulled by the server) and the simulator all
// produce DayInput / WorkoutInput; everything downstream reads WearableDay /
// WearableWorkout rows and never asks which watch they came from.

import { z } from 'zod';

export const PROVIDERS = ['apple_health', 'google_health', 'simulator'] as const;
export type Provider = (typeof PROVIDERS)[number];

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
// Out-of-range values are dropped to null rather than failing the whole sync:
// one bad reading from a watch shouldn't cost the user a month of history.
const bounded = (min: number, max: number) => z.number().finite().nullish().transform((v) => (v == null || v < min || v > max ? null : v));
const minutes = bounded(0, 24 * 60);

export const sleepSchema = z.object({
  minutes: minutes,
  deep: minutes,
  rem: minutes,
  core: minutes,
  awake: minutes,
  start: z.string().datetime({ offset: true }).nullish(),
  end: z.string().datetime({ offset: true }).nullish(),
});

export const dayInputSchema = z.object({
  date: day,
  steps: bounded(0, 150_000),
  activeKcal: bounded(0, 10_000),
  restingHr: bounded(25, 150),
  hrvMs: bounded(1, 400),
  hrvMethod: z.enum(['sdnn', 'rmssd']).nullish(),
  sleep: sleepSchema.nullish(),
  vo2max: bounded(10, 100),
  respiratoryRate: bounded(4, 60),
  wristTempDeltaC: bounded(-5, 5),
  wornMinutes: minutes,
});
export type DayInput = z.input<typeof dayInputSchema>;

export const workoutInputSchema = z.object({
  id: z.string().min(1).max(200),
  start: z.string().datetime({ offset: true }),
  end: z.string().datetime({ offset: true }),
  /** As the source names it (HealthKit activity type, Google exercise type); normalised on ingest. */
  activityType: z.string().max(80).nullish(),
  activeKcal: bounded(0, 10_000),
  avgHr: bounded(30, 230),
  maxHr: bounded(30, 240),
  distanceM: bounded(0, 500_000),
  sourceName: z.string().max(120).nullish(),
});
export type WorkoutInput = z.input<typeof workoutInputSchema>;

export const syncSchema = z.object({
  days: z.array(dayInputSchema).max(400).default([]),
  workouts: z.array(workoutInputSchema).max(2000).default([]),
});

/**
 * Activity names as the sources write them → our handful. Unknown names are
 * kept as 'other', never rejected (descriptive labels don't gate).
 */
const ACTIVITY: [RegExp, string][] = [
  [/strength|weight|functional|core|crossfit|powerlift|cross_training|crosstraining/i, 'strength'],
  [/run/i, 'run'],
  [/walk|hik/i, 'walk'],
  [/cycl|bik|spin/i, 'cycle'],
  [/hiit|interval|bootcamp/i, 'hiit'],
  [/swim/i, 'swim'],
  [/yoga|pilates|flexib|stretch|mind/i, 'yoga'],
];
export function normaliseActivity(raw: string | null | undefined): string {
  if (!raw) return 'other';
  return ACTIVITY.find(([re]) => re.test(raw))?.[1] ?? 'other';
}
