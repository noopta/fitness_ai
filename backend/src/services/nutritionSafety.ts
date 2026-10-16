// Hard nutrition safety rails (Oct 2026 audit HIGH-1 + INFO "nutrition numbers").
//
// 1. Daily calorie floors. No code path may write a daily calorie target below
//    1,200 kcal (female) / 1,500 kcal (male or unknown), nor below 0.8 x BMR
//    when BMR is computable (Mifflin-St Jeor). Values below are clamped UP and
//    a note is returned for the user to see — the write still happens so a
//    "set 1100" request doesn't dead-end, it lands on the floor instead.
// 2. Meal numbers. Model-asserted meal calories/macros are clamped to
//    [0, 5000] per meal, and calories are recomputed from macros (Atwater
//    4/4/9) when they disagree by more than 35%.
//
// Pure functions plus one helper that takes the caller's Prisma client; no
// imports, so every route and service can use it without import cycles.

function parseBlob(raw: unknown): Record<string, any> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, any>;
  if (typeof raw !== 'string' || !raw) return {};
  try { const o = JSON.parse(raw); return o && typeof o === 'object' && !Array.isArray(o) ? o : {}; } catch { return {}; }
}

export type Sex = 'female' | 'male' | 'unknown';

export const CALORIE_FLOORS: Record<Sex, number> = { female: 1200, male: 1500, unknown: 1500 };
/** Fraction of BMR a target may not go below. */
export const BMR_FLOOR_FRACTION = 0.8;

export interface FloorProfile {
  sex?: string | null;
  weightKg?: number | null;
  heightCm?: number | null;
  /** Age in years, or a date of birth to derive it from. */
  ageYears?: number | null;
  dateOfBirth?: Date | string | null;
}

export function normalizeSex(v: unknown): Sex {
  const s = String(v ?? '').trim().toLowerCase();
  if (s === 'female' || s === 'f' || s === 'woman') return 'female';
  if (s === 'male' || s === 'm' || s === 'man') return 'male';
  return 'unknown';
}

export function ageFromDob(dob: Date | string | null | undefined, now: Date = new Date()): number | null {
  if (!dob) return null;
  const d = dob instanceof Date ? dob : new Date(dob);
  if (Number.isNaN(d.getTime()) || d.getTime() > now.getTime()) return null;
  let age = now.getUTCFullYear() - d.getUTCFullYear();
  const m = now.getUTCMonth() - d.getUTCMonth();
  if (m < 0 || (m === 0 && now.getUTCDate() < d.getUTCDate())) age--;
  return age >= 0 && age < 130 ? age : null;
}

function ageOf(p: FloorProfile): number | null {
  if (typeof p.ageYears === 'number' && Number.isFinite(p.ageYears) && p.ageYears > 0) return p.ageYears;
  return ageFromDob(p.dateOfBirth ?? null);
}

/** Mifflin-St Jeor BMR, or null when weight, height or age is missing. Unknown sex uses the midpoint. */
export function mifflinBmr(p: FloorProfile): number | null {
  const w = Number(p.weightKg), h = Number(p.heightCm), a = ageOf(p);
  if (!Number.isFinite(w) || w < 20 || w > 400) return null;
  if (!Number.isFinite(h) || h < 50 || h > 260) return null;
  if (a == null || a < 10 || a > 110) return null;
  const sex = normalizeSex(p.sex);
  const s = sex === 'male' ? 5 : sex === 'female' ? -161 : -78;
  return Math.round(10 * w + 6.25 * h - 5 * a + s);
}

export interface CalorieFloor { floor: number; bmr: number | null; sex: Sex; basis: string }

export function calorieFloorFor(p: FloorProfile = {}): CalorieFloor {
  const sex = normalizeSex(p.sex);
  const base = CALORIE_FLOORS[sex];
  const bmr = mifflinBmr(p);
  const fromBmr = bmr != null ? Math.ceil((bmr * BMR_FLOOR_FRACTION) / 10) * 10 : 0;
  if (fromBmr > base) return { floor: fromBmr, bmr, sex, basis: '80% of your estimated resting energy needs' };
  return { floor: base, bmr, sex, basis: 'the minimum Axiom sets for anyone' };
}

export interface ClampedCalories { calories: number; clamped: boolean; floor: number; note: string | null }

/** Clamp a daily calorie target up to the floor. Non-finite input → the floor. */
export function clampDailyCalories(kcal: number, p: FloorProfile = {}): ClampedCalories {
  const f = calorieFloorFor(p);
  const v = Number(kcal);
  if (Number.isFinite(v) && v >= f.floor) return { calories: Math.round(v), clamped: false, floor: f.floor, note: null };
  return {
    calories: f.floor,
    clamped: true,
    floor: f.floor,
    note: `Set to ${f.floor} kcal instead of ${Number.isFinite(v) ? Math.round(v) : 'that'}: Axiom doesn't set daily targets below ${f.floor} kcal (${f.basis}). For a lower target, work with a doctor or registered dietitian.`,
  };
}

/** Read what the floor needs for a user. Never throws (a missing row → generic floors). */
export async function floorProfileFor(prisma: any, userId: string): Promise<FloorProfile> {
  try {
    const u = await prisma.user.findUnique({ where: { id: userId }, select: { weightKg: true, heightCm: true, dateOfBirth: true, coachProfile: true } });
    if (!u) return {};
    const blob = parseBlob(u.coachProfile);
    return { sex: blob.gender ?? blob.biologicalSex ?? blob.sex ?? null, weightKg: u.weightKg, heightCm: u.heightCm, dateOfBirth: u.dateOfBirth ?? null, ageYears: typeof blob.age === 'number' ? blob.age : null };
  } catch {
    return {};
  }
}

// ── Meals ────────────────────────────────────────────────────────────────────

export const MEAL_MAX = 5000;
/** Calories vs 4/4/9 macros may disagree by this much before calories are recomputed. */
export const ATWATER_TOLERANCE = 0.35;

export interface MealMacros { calories: number; proteinG: number; carbsG: number; fatG: number }

function clampMeal(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(MEAL_MAX, n);
}

export function atwaterKcal(m: { proteinG: number; carbsG: number; fatG: number }): number {
  return 4 * m.proteinG + 4 * m.carbsG + 9 * m.fatG;
}

/**
 * Clamp a model-asserted meal into [0, 5000] per field, then — when the
 * macros are given — check calories against 4/4/9. A >35% mismatch means the
 * model's calorie figure is rejected and recomputed from the macros (scaled
 * down so the meal stays within 5000 kcal). `atwater: false` clamps only
 * (for numbers the user typed themselves, where a partial set is normal).
 */
export function sanitizeMealMacros<T extends Partial<MealMacros>>(m: T, opts: { atwater?: boolean } = {}): T & MealMacros & { adjusted: boolean } {
  let calories = clampMeal(m.calories);
  let proteinG = clampMeal(m.proteinG), carbsG = clampMeal(m.carbsG), fatG = clampMeal(m.fatG);
  let adjusted = calories !== Number(m.calories ?? 0) || proteinG !== Number(m.proteinG ?? 0) || carbsG !== Number(m.carbsG ?? 0) || fatG !== Number(m.fatG ?? 0);
  if (opts.atwater !== false) {
    let atw = atwaterKcal({ proteinG, carbsG, fatG });
    if (atw > MEAL_MAX) {
      const k = MEAL_MAX / atw;
      proteinG = Math.round(proteinG * k * 10) / 10; carbsG = Math.round(carbsG * k * 10) / 10; fatG = Math.round(fatG * k * 10) / 10;
      atw = atwaterKcal({ proteinG, carbsG, fatG });
      adjusted = true;
    }
    // Tiny items (black coffee, a stick of gum) are noise for this check.
    if (atw >= 40 || calories >= 40) {
      const ref = Math.max(atw, 1);
      if (Math.abs(calories - atw) / ref > ATWATER_TOLERANCE && atw > 0) {
        calories = Math.min(MEAL_MAX, Math.round(atw));
        adjusted = true;
      }
    }
  }
  return { ...m, calories, proteinG, carbsG, fatG, adjusted };
}
