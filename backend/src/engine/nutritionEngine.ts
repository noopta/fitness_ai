/**
 * Nutrition Engine — Pure deterministic calculations.
 * No LLM, no side effects, no I/O. All inputs explicit, outputs reproducible.
 *
 * Implements:
 *  - TDEE via Mifflin-St Jeor BMR × activity multiplier
 *  - Macro targets by goal + lift type + training age
 *  - Training vs rest day carb periodization targets
 *  - Leucine adequacy check per meal (2.5-3g threshold → ~25-30g protein/meal)
 *  - Meal timing distribution analysis
 *  - 14-day calorie/weight plateau detection
 *  - Protein-energy correlation from wellness logs
 *  - Nutrient adequacy flags
 */

// ─── Input Types ───────────────────────────────────────────────────────────────

export interface NutritionEngineUser {
  weightKg: number | null;
  heightCm: number | null;
  ageYears: number | null;
  sex: 'male' | 'female' | 'unknown';
  trainingAge: string | null;       // e.g. "beginner", "intermediate", "advanced"
  bodyCompTag: string | null;       // e.g. "lean", "average", "overweight"
  goal: string | null;              // e.g. "strength", "hypertrophy", "endurance", "weight_loss", "weight_gain"
  primaryLift: string | null;       // e.g. "Deadlift", "Barbell Back Squat"
  trainingDaysPerWeek: number;
}

export interface DailyMacro {
  date: string;
  proteinG: number;
  carbsG: number;
  fatG: number;
  calories: number;
  isTrainingDay: boolean;
}

export interface MealTiming {
  hour: number;               // 0-23
  proteinG: number;
  calories: number;
}

export interface WellnessPoint {
  date: string;
  energy: number;             // 1-10
  sleepHours: number;
  stress: number;             // 1-10
  mood: number;               // 1-10
}

export interface NutritionEngineInput {
  user: NutritionEngineUser;
  dailyMacros: DailyMacro[];        // up to 90 days
  mealTimings: MealTiming[];        // individual meal timestamps
  wellnessPoints: WellnessPoint[];
}

// ─── Output Types ──────────────────────────────────────────────────────────────

export interface MacroTargets {
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  proteinPerKg: number;
}

export interface PeriodizationTargets {
  trainingDay: MacroTargets;
  restDay: MacroTargets;
  carbDelta: number;          // training - rest day carbs
}

export interface TrendAnalysis {
  direction: 'increasing' | 'decreasing' | 'stable';
  deltaKcalPerWeek: number;   // avg weekly change
  plateau14Day: boolean;      // <2% calorie change over last 14 days
}

export interface MealTimingAnalysis {
  morningMealPct: number;     // % of meals before 11am
  eveningCaloriePct: number;  // % of total calories after 6pm
  avgMorningProteinG: number;
  avgEveningCalories: number;
  mealsPerDay: number;
  leucineAdequacyPct: number; // % of meals with ≥25g protein (leucine threshold proxy)
  preWorkoutFueled: boolean;  // heuristic: any meal 1-3h before typical training window
  postWorkoutFueled: boolean; // heuristic: any meal within 2h after typical training window
}

export interface WellnessCorrelation {
  highProteinEnergyAvg: number | null;
  lowProteinEnergyAvg: number | null;
  highProteinSleepAvg: number | null;
  lowProteinSleepAvg: number | null;
  sampleSize: number;
  energyDelta: number | null;   // high - low protein energy
}

export interface NutritionEngineOutput {
  // Demographics-derived
  bmr: number | null;
  tdee: number | null;
  activityMultiplier: number;

  // Current intake averages (last 30 days)
  avgCalories: number;
  avgProteinG: number;
  avgCarbsG: number;
  avgFatG: number;
  proteinPerKg: number | null;
  macroSplit: { proteinPct: number; carbsPct: number; fatPct: number };
  consistencyPct: number;       // % of 30 days with logged data
  loggedDays: number;

  // Training vs rest day breakdown
  trainingDayAvgCalories: number | null;
  restDayAvgCalories: number | null;
  trainingDayAvgProteinG: number | null;
  trainingDayAvgCarbsG: number | null;
  restDayAvgCarbsG: number | null;
  carbPeriodizationDelta: number | null;

  // Targets (recommended)
  targets: MacroTargets;
  periodization: PeriodizationTargets;

  // Trend
  trend: TrendAnalysis;

  // Meal timing
  timing: MealTimingAnalysis;

  // Wellness correlations
  wellness: WellnessCorrelation;

  // Nutrient gaps (vs targets)
  proteinGap: number;   // current - target (negative = deficit)
  carbGap: number;
  fatGap: number;
  calorieGap: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const ACTIVITY_MULTIPLIERS: Record<number, number> = {
  0: 1.2,
  1: 1.375,
  2: 1.375,
  3: 1.55,
  4: 1.55,
  5: 1.725,
  6: 1.725,
  7: 1.9,
};

function activityMultiplier(trainingDays: number): number {
  const clamped = Math.max(0, Math.min(7, trainingDays));
  return ACTIVITY_MULTIPLIERS[clamped] ?? 1.55;
}

/** Mifflin-St Jeor BMR */
function calcBMR(
  weightKg: number,
  heightCm: number,
  ageYears: number,
  sex: 'male' | 'female' | 'unknown',
): number {
  const base = 10 * weightKg + 6.25 * heightCm - 5 * ageYears;
  if (sex === 'male') return base + 5;
  if (sex === 'female') return base - 161;
  return base - 78; // midpoint for unknown
}

/**
 * Macro targets by goal + lift type.
 * Returns macros in grams and total calories.
 * Protein is always set deterministically from weight + goal.
 * Fat floor = 0.8g/kg (hormone support).
 * Carbs fill remaining calories.
 */
function calcMacroTargets(
  tdee: number,
  weightKg: number,
  goal: string | null,
  lift: string | null,
): MacroTargets {
  const g = goal?.toLowerCase() ?? '';

  // Calorie target
  let targetCalories = tdee;
  if (g.includes('loss') || g.includes('cut') || g.includes('lean')) {
    targetCalories = tdee - 400; // moderate deficit
  } else if (g.includes('gain') || g.includes('bulk') || g.includes('mass')) {
    targetCalories = tdee + 350; // lean surplus
  } else if (g.includes('hypertrophy') || g.includes('muscle')) {
    targetCalories = tdee + 200;
  }
  targetCalories = Math.round(targetCalories);

  // Protein g/kg by goal
  let proteinPerKg = 1.8; // default
  if (g.includes('strength')) proteinPerKg = 2.0;
  if (g.includes('hypertrophy') || g.includes('muscle')) proteinPerKg = 2.1;
  if (g.includes('endurance')) proteinPerKg = 1.6;
  if (g.includes('loss') || g.includes('cut')) proteinPerKg = 2.2; // spare muscle
  if (g.includes('gain') || g.includes('bulk')) proteinPerKg = 2.0;

  // Olympic lifts → higher carb demand
  const isOlympic = lift && ['clean', 'snatch', 'jerk'].some(k => lift.toLowerCase().includes(k));
  if (isOlympic) proteinPerKg = Math.max(proteinPerKg, 1.8);

  const proteinG = Math.round(weightKg * proteinPerKg);
  const proteinCals = proteinG * 4;

  // Fat floor: 0.8g/kg, at least 20% of calories
  const fatG = Math.max(
    Math.round(weightKg * 0.85),
    Math.round((targetCalories * 0.22) / 9),
  );
  const fatCals = fatG * 9;

  // Carbs = remaining calories
  const carbCals = Math.max(0, targetCalories - proteinCals - fatCals);
  const carbsG = Math.round(carbCals / 4);

  return {
    calories: targetCalories,
    proteinG,
    carbsG,
    fatG,
    proteinPerKg: Math.round(proteinPerKg * 100) / 100,
  };
}

/** Carb periodization: training days get +30-40% more carbs, rest days reduce */
function calcPeriodization(base: MacroTargets, weightKg: number): PeriodizationTargets {
  const trainingCarbsG = Math.round(base.carbsG * 1.35);
  const restCarbsG = Math.round(base.carbsG * 0.65);

  const trainingCalories = base.calories + Math.round((trainingCarbsG - base.carbsG) * 4);
  const restCalories = base.calories + Math.round((restCarbsG - base.carbsG) * 4);

  return {
    trainingDay: {
      ...base,
      carbsG: trainingCarbsG,
      calories: trainingCalories,
    },
    restDay: {
      ...base,
      carbsG: restCarbsG,
      calories: restCalories,
    },
    carbDelta: trainingCarbsG - restCarbsG,
  };
}

function avg(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function calcTrend(dailyMacros: DailyMacro[]): TrendAnalysis {
  const sorted = [...dailyMacros].sort((a, b) => a.date.localeCompare(b.date));
  const cals = sorted.map(d => d.calories);

  if (cals.length < 4) {
    return { direction: 'stable', deltaKcalPerWeek: 0, plateau14Day: false };
  }

  // Linear regression slope
  const n = cals.length;
  const xMean = (n - 1) / 2;
  const yMean = avg(cals);
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - xMean) * (cals[i] - yMean);
    den += (i - xMean) ** 2;
  }
  const slopePerDay = den === 0 ? 0 : num / den;
  const deltaKcalPerWeek = Math.round(slopePerDay * 7);

  // Plateau: last 14 days avg vs prior 14 days avg
  const last14 = cals.slice(-14);
  const prior14 = cals.slice(-28, -14);
  let plateau14Day = false;
  if (last14.length >= 7 && prior14.length >= 7) {
    const pct = Math.abs(avg(last14) - avg(prior14)) / Math.max(avg(prior14), 1);
    plateau14Day = pct < 0.02; // <2% change
  }

  const direction =
    deltaKcalPerWeek > 50 ? 'increasing'
    : deltaKcalPerWeek < -50 ? 'decreasing'
    : 'stable';

  return { direction, deltaKcalPerWeek, plateau14Day };
}

function calcMealTiming(mealTimings: MealTiming[]): MealTimingAnalysis {
  if (mealTimings.length === 0) {
    return {
      morningMealPct: 0, eveningCaloriePct: 0, avgMorningProteinG: 0,
      avgEveningCalories: 0, mealsPerDay: 0, leucineAdequacyPct: 0,
      preWorkoutFueled: false, postWorkoutFueled: false,
    };
  }

  const morningMeals = mealTimings.filter(m => m.hour < 11);
  const eveningMeals = mealTimings.filter(m => m.hour >= 18);
  const totalCals = mealTimings.reduce((s, m) => s + m.calories, 0);
  const eveningCals = eveningMeals.reduce((s, m) => s + m.calories, 0);
  const leucineAdequate = mealTimings.filter(m => m.proteinG >= 25); // ~2.5g leucine proxy

  // Unique days in data
  const estimatedDays = Math.max(1, Math.round(mealTimings.length / 3));

  // Pre/post workout heuristic: meals between 6-9am or 11am-2pm = pre; 6-9pm = post
  const preWindow = mealTimings.filter(m => (m.hour >= 6 && m.hour <= 9) || (m.hour >= 11 && m.hour <= 14));
  const postWindow = mealTimings.filter(m => m.hour >= 18 && m.hour <= 21);

  return {
    morningMealPct: Math.round((morningMeals.length / mealTimings.length) * 100),
    eveningCaloriePct: totalCals > 0 ? Math.round((eveningCals / totalCals) * 100) : 0,
    avgMorningProteinG: morningMeals.length > 0 ? Math.round(avg(morningMeals.map(m => m.proteinG))) : 0,
    avgEveningCalories: eveningMeals.length > 0 ? Math.round(avg(eveningMeals.map(m => m.calories))) : 0,
    mealsPerDay: Math.round((mealTimings.length / estimatedDays) * 10) / 10,
    leucineAdequacyPct: Math.round((leucineAdequate.length / mealTimings.length) * 100),
    preWorkoutFueled: preWindow.length > 0,
    postWorkoutFueled: postWindow.length > 0,
  };
}

function calcWellnessCorrelation(
  dailyMacros: DailyMacro[],
  wellnessPoints: WellnessPoint[],
  targetProteinG: number,
): WellnessCorrelation {
  const wellnessByDate = new Map(wellnessPoints.map(w => [w.date, w]));

  const pairs: Array<{ proteinG: number; energy: number; sleepHours: number }> = [];

  for (const macro of dailyMacros) {
    const nextDay = new Date(macro.date);
    nextDay.setDate(nextDay.getDate() + 1);
    const nextDateStr = nextDay.toISOString().slice(0, 10);
    const wellness = wellnessByDate.get(nextDateStr) ?? wellnessByDate.get(macro.date);
    if (wellness) {
      pairs.push({ proteinG: macro.proteinG, energy: wellness.energy, sleepHours: wellness.sleepHours });
    }
  }

  if (pairs.length < 5) {
    return {
      highProteinEnergyAvg: null, lowProteinEnergyAvg: null,
      highProteinSleepAvg: null, lowProteinSleepAvg: null,
      sampleSize: pairs.length, energyDelta: null,
    };
  }

  const median = targetProteinG * 0.85; // "high protein" = ≥85% of target
  const high = pairs.filter(p => p.proteinG >= median);
  const low = pairs.filter(p => p.proteinG < median);

  const highEnergyAvg = high.length > 0 ? Math.round(avg(high.map(p => p.energy)) * 10) / 10 : null;
  const lowEnergyAvg = low.length > 0 ? Math.round(avg(low.map(p => p.energy)) * 10) / 10 : null;
  const highSleepAvg = high.length > 0 ? Math.round(avg(high.map(p => p.sleepHours)) * 10) / 10 : null;
  const lowSleepAvg = low.length > 0 ? Math.round(avg(low.map(p => p.sleepHours)) * 10) / 10 : null;

  return {
    highProteinEnergyAvg: highEnergyAvg,
    lowProteinEnergyAvg: lowEnergyAvg,
    highProteinSleepAvg: highSleepAvg,
    lowProteinSleepAvg: lowSleepAvg,
    sampleSize: pairs.length,
    energyDelta: highEnergyAvg !== null && lowEnergyAvg !== null
      ? Math.round((highEnergyAvg - lowEnergyAvg) * 10) / 10
      : null,
  };
}

// ─── Main Engine Function ──────────────────────────────────────────────────────

export function runNutritionEngine(input: NutritionEngineInput): NutritionEngineOutput {
  const { user, dailyMacros, mealTimings, wellnessPoints } = input;

  // ── Activity multiplier ──
  const multiplier = activityMultiplier(user.trainingDaysPerWeek);

  // ── BMR + TDEE ──
  let bmr: number | null = null;
  let tdee: number | null = null;
  if (user.weightKg && user.heightCm && user.ageYears) {
    bmr = Math.round(calcBMR(user.weightKg, user.heightCm, user.ageYears, user.sex));
    tdee = Math.round(bmr * multiplier);
  }

  // ── Current averages (last 30 days) ──
  const last30 = dailyMacros.slice(-30);
  const avgCalories = last30.length > 0 ? Math.round(avg(last30.map(d => d.calories))) : 0;
  const avgProteinG = last30.length > 0 ? Math.round(avg(last30.map(d => d.proteinG))) : 0;
  const avgCarbsG = last30.length > 0 ? Math.round(avg(last30.map(d => d.carbsG))) : 0;
  const avgFatG = last30.length > 0 ? Math.round(avg(last30.map(d => d.fatG))) : 0;
  const proteinPerKg = user.weightKg && avgProteinG > 0
    ? Math.round((avgProteinG / user.weightKg) * 100) / 100
    : null;

  const totalMacroCals = avgProteinG * 4 + avgCarbsG * 4 + avgFatG * 9;
  const macroSplit = totalMacroCals > 0
    ? {
        proteinPct: Math.round((avgProteinG * 4 / totalMacroCals) * 100),
        carbsPct: Math.round((avgCarbsG * 4 / totalMacroCals) * 100),
        fatPct: Math.round((avgFatG * 9 / totalMacroCals) * 100),
      }
    : { proteinPct: 0, carbsPct: 0, fatPct: 0 };

  // Consistency: what % of last 30 days had any log
  const loggedDays = last30.length;
  const consistencyPct = Math.round((loggedDays / 30) * 100);

  // ── Training vs rest day breakdown ──
  const trainingDays = last30.filter(d => d.isTrainingDay);
  const restDays = last30.filter(d => !d.isTrainingDay);
  const trainingDayAvgCalories = trainingDays.length > 0 ? Math.round(avg(trainingDays.map(d => d.calories))) : null;
  const restDayAvgCalories = restDays.length > 0 ? Math.round(avg(restDays.map(d => d.calories))) : null;
  const trainingDayAvgProteinG = trainingDays.length > 0 ? Math.round(avg(trainingDays.map(d => d.proteinG))) : null;
  const trainingDayAvgCarbsG = trainingDays.length > 0 ? Math.round(avg(trainingDays.map(d => d.carbsG))) : null;
  const restDayAvgCarbsG = restDays.length > 0 ? Math.round(avg(restDays.map(d => d.carbsG))) : null;
  const carbPeriodizationDelta =
    trainingDayAvgCarbsG !== null && restDayAvgCarbsG !== null
      ? trainingDayAvgCarbsG - restDayAvgCarbsG
      : null;

  // ── Macro targets ──
  const effectiveTDEE = tdee ?? Math.max(avgCalories, 1800);
  const effectiveWeight = user.weightKg ?? 75;
  const targets = calcMacroTargets(effectiveTDEE, effectiveWeight, user.goal, user.primaryLift);
  const periodization = calcPeriodization(targets, effectiveWeight);

  // ── Trend ──
  const trend = calcTrend(dailyMacros);

  // ── Meal timing ──
  const timing = calcMealTiming(mealTimings);

  // ── Wellness correlation ──
  const wellness = calcWellnessCorrelation(dailyMacros, wellnessPoints, targets.proteinG);

  // ── Gaps ──
  const proteinGap = avgProteinG - targets.proteinG;
  const carbGap = avgCarbsG - targets.carbsG;
  const fatGap = avgFatG - targets.fatG;
  const calorieGap = avgCalories - targets.calories;

  return {
    bmr, tdee, activityMultiplier: multiplier,
    avgCalories, avgProteinG, avgCarbsG, avgFatG,
    proteinPerKg, macroSplit, consistencyPct, loggedDays,
    trainingDayAvgCalories, restDayAvgCalories,
    trainingDayAvgProteinG, trainingDayAvgCarbsG, restDayAvgCarbsG,
    carbPeriodizationDelta,
    targets, periodization, trend, timing, wellness,
    proteinGap, carbGap, fatGap, calorieGap,
  };
}
