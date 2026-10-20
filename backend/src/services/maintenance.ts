// What a user burns a day (maintenance), for planning a weight goal (Oct 2026).
//
// Measured beats estimated: with ~2 weeks of weigh-ins and logged intake, the
// energy balance gives their real number — intake minus what the weight trend
// says went to or came from tissue (≈7,700 kcal/kg). Until then, Mifflin-St
// Jeor × an activity factor that counts ALL training: lifting days plus sport /
// conditioning sessions (a fighter at 3 lifting days + daily MMA was being
// estimated at 1.55× — about 350 kcal/day low).

import { KCAL_PER_KG } from './goalPace.js';

export interface MaintenanceInput {
  weighIns: { date: string; kg: number }[];
  /** Logged intake per day (kcal), any order. */
  intake: { date: string; kcal: number }[];
  bmr: number | null;
  weightKg: number | null;
  liftingDays: number;
  conditioningDays: number;
  activityLevel?: string | null;
  today: string;
}
export interface Maintenance { kcal: number; basis: 'measured' | 'estimated'; detail: string }

const DAY = 86_400_000;
const t = (d: string) => Date.parse(`${d}T12:00:00Z`);

/** Activity factor from total weekly sessions (lifting + sport), nudged by the intake's daily-activity answer. */
export function activityFactor(liftingDays: number, conditioningDays: number, activityLevel?: string | null): number {
  const sessions = Math.max(0, liftingDays) + Math.max(0, conditioningDays);
  let f = sessions <= 0 ? 1.2 : sessions <= 2 ? 1.375 : sessions <= 4 ? 1.55 : sessions <= 6 ? 1.725 : sessions <= 9 ? 1.9 : 2.0;
  if (activityLevel === 'very_active') f += 0.05;
  if (activityLevel === 'sedentary') f -= 0.05;
  return Math.round(f * 1000) / 1000;
}

/** Pure: measured maintenance when the data allows, else the estimate. */
export function estimateMaintenance(i: MaintenanceInput): Maintenance {
  const from = new Date(t(i.today) - 28 * DAY).toISOString().slice(0, 10);
  const w = i.weighIns.filter((x) => x.date >= from && x.kg > 0).sort((a, b) => (a.date < b.date ? -1 : 1));
  // Partial days (under ~1,200 kcal logged) would read as a deficit that wasn't there.
  const days = i.intake.filter((x) => x.date >= from && x.date <= i.today && x.kcal >= 1200);
  if (w.length >= 4 && days.length >= 10 && (t(w[w.length - 1].date) - t(w[0].date)) / DAY >= 10) {
    const xs = w.map((p) => (t(p.date) - t(w[0].date)) / DAY), ys = w.map((p) => p.kg);
    const mx = xs.reduce((a, b) => a + b, 0) / xs.length, my = ys.reduce((a, b) => a + b, 0) / ys.length;
    const slope = xs.reduce((s, x, k) => s + (x - mx) * (ys[k] - my), 0) / Math.max(1e-9, xs.reduce((s, x) => s + (x - mx) ** 2, 0)); // kg/day
    const avgIntake = days.reduce((s, d) => s + d.kcal, 0) / days.length;
    const kcal = Math.round(avgIntake - slope * KCAL_PER_KG);
    if (kcal >= 1200 && kcal <= 6500) {
      return { kcal, basis: 'measured', detail: `measured: ${days.length} logged days averaging ${Math.round(avgIntake)} kcal while the weight trend moved ${(slope * 7).toFixed(2)} kg/week` };
    }
  }
  const factor = activityFactor(i.liftingDays, i.conditioningDays, i.activityLevel);
  const bmr = i.bmr ?? (i.weightKg ? Math.round(i.weightKg * 22) : 1700);
  return { kcal: Math.round(bmr * factor), basis: 'estimated', detail: `estimated: BMR ${bmr}${i.bmr ? '' : ' (approx — no age/height)'} × ${factor} for ${i.liftingDays} lifting + ${i.conditioningDays} sport/conditioning sessions a week; it becomes measured after ~2 weeks of weigh-ins and full logged days` };
}
