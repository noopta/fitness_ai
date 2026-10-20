// Carbs matched to training (Oct 2026): more on hard training days, less on
// rest days, the week's total about the same. For athletes training most days
// (a fighter's daily MMA), a flat 250 g (~3 g/kg) under-fuels the hard days;
// sport guidelines run ~4–7 g/kg on heavy days. A day counts as training when
// it's logged, or when they've trained that weekday in either of the last two
// weeks (fixed weekly schedules), so the target is right before they train.

export interface CarbCycling { trainingDayCarbs: number; restDayCarbs: number; setAt?: string }

const DAY = 86_400_000;
const t = (d: string) => Date.parse(`${d}T12:00:00Z`);
const dow = (d: string) => new Date(t(d)).getUTCDay();

/** Pure: is `date` a training day, from the days they've logged training in the 14 days before it (and that day itself). */
export function isTrainingDay(date: string, loggedDates: string[]): boolean {
  if (loggedDates.includes(date)) return true;
  const from = t(date) - 14 * DAY;
  return loggedDates.some((d) => t(d) >= from && t(d) < t(date) && dow(d) === dow(date));
}

/** Pure: the day's targets with carbs (and the calories they carry) set for the day type. */
export function applyCarbCycling<T extends { calories: number; carbsG: number | null }>(targets: T, c: CarbCycling | null | undefined, training: boolean): T & { dayType?: 'training' | 'rest' } {
  if (!c || targets.carbsG == null) return targets;
  const carbs = training ? c.trainingDayCarbs : c.restDayCarbs;
  return { ...targets, carbsG: carbs, calories: Math.round(targets.calories + (carbs - targets.carbsG) * 4), dayType: training ? 'training' : 'rest' };
}

export function readCarbCycling(coachProfile: string | null): CarbCycling | null {
  try {
    const c = coachProfile ? JSON.parse(coachProfile)?.carbCycling : null;
    return c && Number(c.trainingDayCarbs) > 0 && Number(c.restDayCarbs) > 0 ? { trainingDayCarbs: Number(c.trainingDayCarbs), restDayCarbs: Number(c.restDayCarbs), setAt: c.setAt } : null;
  } catch { return null; }
}
