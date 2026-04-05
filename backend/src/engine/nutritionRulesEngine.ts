/**
 * Nutrition Rules Engine — Expert dietitian logic expressed as deterministic rules.
 * Operates on NutritionEngineOutput + user context.
 * Returns a set of triggered flags the LLM uses as pre-verified facts — never re-derives them.
 *
 * Each flag has:
 *  - id:         machine-readable key
 *  - severity:   'critical' | 'warning' | 'info' | 'positive'
 *  - category:   which dimension it affects
 *  - title:      short human-readable label
 *  - detail:     specific numbers from the engine (so LLM can cite them)
 *  - science:    the physiological mechanism (passed to LLM as verified fact)
 */

import type { NutritionEngineOutput } from './nutritionEngine.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export type RuleSeverity = 'critical' | 'warning' | 'info' | 'positive';
export type RuleCategory =
  | 'protein'
  | 'carbohydrates'
  | 'fat'
  | 'calories'
  | 'meal_timing'
  | 'recovery'
  | 'energy'
  | 'body_composition'
  | 'periodization'
  | 'consistency';

export interface NutritionFlag {
  id: string;
  severity: RuleSeverity;
  category: RuleCategory;
  title: string;
  detail: string;
  science: string;
}

export interface NutritionRulesOutput {
  flags: NutritionFlag[];
  criticalCount: number;
  warningCount: number;
  positiveCount: number;
  topPriority: NutritionFlag | null;
}

// ─── Rule Definitions ─────────────────────────────────────────────────────────

export function runNutritionRules(
  engine: NutritionEngineOutput,
  goal: string | null,
  wellnessAvgEnergy: number | null,
  wellnessAvgSleep: number | null,
): NutritionRulesOutput {
  const flags: NutritionFlag[] = [];
  const g = (goal ?? '').toLowerCase();

  // ── PROTEIN RULES ──────────────────────────────────────────────────────────

  if (engine.proteinPerKg !== null) {
    if (engine.proteinPerKg < 1.2) {
      flags.push({
        id: 'protein_severely_low',
        severity: 'critical',
        category: 'protein',
        title: 'Severely Low Protein Intake',
        detail: `Current: ${engine.proteinPerKg}g/kg. Minimum for muscle retention: 1.6g/kg. Target: ${engine.targets.proteinPerKg}g/kg (${engine.targets.proteinG}g/day). Gap: ${Math.abs(engine.proteinGap)}g/day.`,
        science: 'Below 1.2g/kg is insufficient to achieve positive net protein balance (NPB). mTORC1 signaling — the primary driver of muscle protein synthesis — requires adequate leucine and substrate availability. Muscle catabolism accelerates at this intake.',
      });
    } else if (engine.proteinPerKg < 1.6) {
      flags.push({
        id: 'protein_below_optimal',
        severity: 'warning',
        category: 'protein',
        title: 'Protein Below Optimal Range',
        detail: `Current: ${engine.proteinPerKg}g/kg. ISSN optimal range: 1.6–2.2g/kg. Target: ${engine.targets.proteinPerKg}g/kg (${engine.targets.proteinG}g/day). Gap: ${Math.abs(engine.proteinGap)}g/day.`,
        science: 'The ISSN Position Stand (2017) identifies 1.6–2.2g/kg as the range that maximizes muscle protein synthesis and supports lean mass retention during caloric restriction. Below 1.6g/kg, muscle building is suboptimal even with adequate training.',
      });
    } else if (engine.proteinPerKg >= 1.6 && engine.proteinPerKg <= 2.4) {
      flags.push({
        id: 'protein_optimal',
        severity: 'positive',
        category: 'protein',
        title: 'Protein Intake in Optimal Range',
        detail: `Current: ${engine.proteinPerKg}g/kg (${engine.avgProteinG}g/day). ISSN optimal: 1.6–2.2g/kg. Target: ${engine.targets.proteinG}g/day.`,
        science: 'Protein intake in the 1.6–2.2g/kg range maximizes mTOR activation, supports leucine threshold achievement at each meal (~2.5g leucine ≈ 25-30g protein), and minimizes muscle protein breakdown.',
      });
    } else if (engine.proteinPerKg > 2.4) {
      flags.push({
        id: 'protein_excessive',
        severity: 'info',
        category: 'protein',
        title: 'Protein May Be Excessive',
        detail: `Current: ${engine.proteinPerKg}g/kg (${engine.avgProteinG}g/day). Above 2.4g/kg shows diminishing returns for most populations.`,
        science: 'Research shows minimal additional benefit above 2.2g/kg for muscle protein synthesis. Excess protein is oxidized for energy. Calories could potentially be reallocated to carbohydrates for improved training performance and glycogen storage.',
      });
    }
  }

  // ── LEUCINE / PER-MEAL PROTEIN ─────────────────────────────────────────────

  if (engine.timing.leucineAdequacyPct < 50) {
    flags.push({
      id: 'leucine_threshold_missed',
      severity: 'warning',
      category: 'protein',
      title: 'Leucine Threshold Missed in Most Meals',
      detail: `Only ${engine.timing.leucineAdequacyPct}% of meals contain ≥25g protein (the leucine threshold proxy). Target: ≥80% of meals.`,
      science: 'The leucine threshold (2.5–3g leucine ≈ 25–30g protein per meal) is required to maximally activate mTORC1. Spreading protein across 3-5 meals of ≥25g each provides superior muscle protein synthesis compared to the same total protein in fewer, larger doses (Norton & Layman, 2006).',
    });
  } else if (engine.timing.leucineAdequacyPct >= 75) {
    flags.push({
      id: 'leucine_threshold_met',
      severity: 'positive',
      category: 'protein',
      title: 'Good Per-Meal Protein Distribution',
      detail: `${engine.timing.leucineAdequacyPct}% of meals meet the leucine threshold (≥25g protein).`,
      science: 'Consistent leucine threshold achievement across meals ensures sustained mTORC1 activation throughout the day, optimizing the muscle protein synthesis-to-breakdown ratio.',
    });
  }

  // ── CALORIE / TDEE RULES ───────────────────────────────────────────────────

  if (engine.tdee !== null) {
    const deficit = engine.tdee - engine.avgCalories;
    const surplusOrDeficit = engine.calorieGap; // current - target

    // Goal-calorie mismatches
    if ((g.includes('gain') || g.includes('bulk') || g.includes('hypertrophy')) && engine.calorieGap < -300) {
      flags.push({
        id: 'calorie_deficit_gain_goal',
        severity: 'critical',
        category: 'calories',
        title: 'Calorie Deficit Conflicts with Muscle-Building Goal',
        detail: `Current avg: ${engine.avgCalories} kcal. Target for ${goal}: ${engine.targets.calories} kcal. Gap: ${engine.calorieGap} kcal/day. TDEE estimate: ${engine.tdee} kcal.`,
        science: 'Muscle hypertrophy requires a positive energy balance. Research by Slater & Phillips (2011) confirms that caloric deficits >300 kcal/day during resistance training significantly impair muscle protein accretion, diverting amino acids toward gluconeogenesis rather than structural muscle.',
      });
    }

    if ((g.includes('loss') || g.includes('cut')) && engine.calorieGap > 200) {
      flags.push({
        id: 'calorie_surplus_loss_goal',
        severity: 'warning',
        category: 'calories',
        title: 'Calorie Surplus Conflicts with Weight-Loss Goal',
        detail: `Current avg: ${engine.avgCalories} kcal. Target for ${goal}: ${engine.targets.calories} kcal. Surplus: +${engine.calorieGap} kcal/day.`,
        science: 'A sustained caloric surplus above TDEE will result in fat accumulation regardless of macronutrient quality. A 3,500 kcal surplus = approximately 1 lb of fat stored.',
      });
    }

    // Severe restriction
    if (engine.avgCalories < 1200 && engine.avgCalories > 0) {
      flags.push({
        id: 'very_low_calorie',
        severity: 'critical',
        category: 'calories',
        title: 'Dangerously Low Caloric Intake',
        detail: `Current avg: ${engine.avgCalories} kcal/day. Below 1200 kcal in females or 1500 kcal in males is generally considered a very-low-calorie diet (VLCD).`,
        science: 'VLCDs below 1200 kcal trigger adaptive thermogenesis — a metabolic down-regulation of up to 15-25% of TDEE (Rosenbaum & Leibel, 2010). This blunts fat loss over time and accelerates lean mass catabolism, reducing resting metabolic rate permanently if sustained.',
      });
    }
  }

  // ── CARBOHYDRATE / PERIODIZATION RULES ────────────────────────────────────

  if (engine.carbPeriodizationDelta !== null) {
    if (engine.carbPeriodizationDelta < 0) {
      flags.push({
        id: 'inverted_carb_periodization',
        severity: 'warning',
        category: 'periodization',
        title: 'Inverted Carb Periodization Detected',
        detail: `Training days avg: ${engine.trainingDayAvgCarbsG}g carbs. Rest days avg: ${engine.restDayAvgCarbsG}g carbs. Training days should be ${Math.abs(engine.carbPeriodizationDelta)}g higher.`,
        science: 'Carbohydrate periodization (more carbs on training days) optimizes glycogen resynthesis via GLUT-4 upregulation and insulin-mediated uptake post-exercise. Muscle glycogen stores deplete by 30-60% during moderate-high intensity training; replenishment requires a carbohydrate surplus on training days (Burke et al., 2011).',
      });
    } else if (engine.carbPeriodizationDelta >= 30) {
      flags.push({
        id: 'good_carb_periodization',
        severity: 'positive',
        category: 'periodization',
        title: 'Carb Periodization in Practice',
        detail: `Training days: +${engine.carbPeriodizationDelta}g more carbs than rest days. This supports glycogen resynthesis and training performance.`,
        science: 'Appropriate carb periodization ensures glycogen stores are maximally replenished before each training session, supporting higher training volume and intensity.',
      });
    }
  }

  // ── MEAL TIMING RULES ─────────────────────────────────────────────────────

  if (engine.timing.mealsPerDay > 0) {
    if (engine.timing.mealsPerDay < 2) {
      flags.push({
        id: 'too_few_meals',
        severity: 'warning',
        category: 'meal_timing',
        title: 'Too Few Eating Occasions',
        detail: `Avg ${engine.timing.mealsPerDay} meals/day. Optimal: 3-5 meals to distribute protein for sustained mTOR activation.`,
        science: 'Consuming protein in fewer than 3 meals limits the number of daily mTORC1 activation windows. Research by Areta et al. (2013) showed 4 doses of 20g protein every 3h produced superior MPS compared to 2 large doses, even when total daily protein was identical.',
      });
    }

    if (engine.timing.eveningCaloriePct > 45) {
      flags.push({
        id: 'back_loaded_calories',
        severity: 'warning',
        category: 'meal_timing',
        title: 'Calorie Back-Loading Detected',
        detail: `${engine.timing.eveningCaloriePct}% of daily calories consumed after 6pm. Optimal: <35% of calories in the evening.`,
        science: 'Back-loaded calorie patterns (>40% after 6pm) are associated with reduced diet-induced thermogenesis, impaired glucose tolerance, and elevated insulin resistance due to circadian misalignment of metabolic processes (Sutton et al., 2018). Morning calories generate higher satiety and thermogenic response.',
      });
    }

    if (engine.timing.morningMealPct < 20 && engine.timing.mealsPerDay >= 2) {
      flags.push({
        id: 'skipping_morning_nutrition',
        severity: 'info',
        category: 'meal_timing',
        title: 'Low Morning Nutrition',
        detail: `Only ${engine.timing.morningMealPct}% of meals logged before 11am. Avg morning protein: ${engine.timing.avgMorningProteinG}g.`,
        science: 'Breakfast consumption, particularly protein-rich, activates protein synthesis after the overnight fasted state. Skipping breakfast extends the catabolic overnight fast, suppressing mTOR signaling for an additional 4-6 hours during a period of elevated cortisol.',
      });
    }
  }

  // ── PLATEAU RULES ─────────────────────────────────────────────────────────

  if (engine.trend.plateau14Day) {
    const adjustType = (g.includes('loss') || g.includes('cut')) ? 'reduce' : 'increase';
    const adjustAmount = 150;
    flags.push({
      id: 'calorie_plateau',
      severity: 'warning',
      category: 'calories',
      title: '14-Day Calorie Plateau Detected',
      detail: `Calorie intake has been stable (<2% change) for ≥14 days. Current avg: ${engine.avgCalories} kcal. Consider ${adjustType === 'reduce' ? 'a further deficit of' : 'adding'} ~${adjustAmount} kcal/day.`,
      science: 'Metabolic adaptation to sustained caloric patterns reduces TDEE through decreased NEAT (non-exercise activity thermogenesis) and hormonal downregulation of leptin and thyroid hormones. A diet break or caloric adjustment every 2 weeks prevents this adaptive response (Byrne et al., 2018).',
    });
  }

  // ── CONSISTENCY RULES ─────────────────────────────────────────────────────

  if (engine.consistencyPct < 40) {
    flags.push({
      id: 'low_tracking_consistency',
      severity: 'warning',
      category: 'consistency',
      title: 'Low Nutrition Tracking Consistency',
      detail: `Only ${engine.consistencyPct}% of days logged in the last 30 days (${engine.loggedDays}/30 days). Accurate analysis requires ≥70% consistency.`,
      science: 'Self-monitoring is one of the strongest predictors of dietary adherence. Inconsistent tracking limits the accuracy of calorie averaging, macro trend analysis, and wellness correlations — making recommendations less precise.',
    });
  } else if (engine.consistencyPct >= 80) {
    flags.push({
      id: 'high_tracking_consistency',
      severity: 'positive',
      category: 'consistency',
      title: 'Excellent Tracking Consistency',
      detail: `${engine.consistencyPct}% of days logged (${engine.loggedDays}/30 days). This enables high-confidence analysis.`,
      science: 'Consistent food tracking is associated with better dietary adherence and is the #1 behavioral predictor of successful nutritional outcomes in clinical research.',
    });
  }

  // ── WELLNESS / RECOVERY RULES ──────────────────────────────────────────────

  if (wellnessAvgEnergy !== null && wellnessAvgEnergy < 5) {
    flags.push({
      id: 'low_avg_energy',
      severity: 'warning',
      category: 'energy',
      title: 'Chronically Low Energy Levels',
      detail: `Average energy rating: ${wellnessAvgEnergy}/10. Potential nutritional drivers: insufficient total calories, inadequate carbohydrates, iron/B12 deficiency, or cortisol dysregulation.`,
      science: 'Persistent low energy in athletes is frequently caused by Relative Energy Deficiency in Sport (RED-S), formerly known as the Female Athlete Triad. Even modest caloric deficits (200-300 kcal below TDEE) can suppress HPA axis function and reduce training adaptations.',
    });
  }

  if (wellnessAvgSleep !== null && wellnessAvgSleep < 7) {
    flags.push({
      id: 'insufficient_sleep',
      severity: 'warning',
      category: 'recovery',
      title: 'Insufficient Sleep Affecting Recovery',
      detail: `Average sleep: ${wellnessAvgSleep}h/night. Optimal for athletes: 7-9 hours. Sub-7h sleep reduces muscle protein synthesis and elevates cortisol.`,
      science: 'Sleep is the primary anabolic window. During deep sleep (N3/REM), growth hormone secretion peaks and IGF-1 drives muscle protein synthesis. Restricting sleep to <7h reduces MPS by ~18% and elevates morning cortisol by 37%, accelerating muscle catabolism (Dattilo et al., 2011).',
    });
  }

  // ── FAT RULES ─────────────────────────────────────────────────────────────

  if (engine.avgFatG > 0 && engine.avgFatG < (engine.targets.fatG * 0.6)) {
    flags.push({
      id: 'fat_too_low',
      severity: 'warning',
      category: 'fat',
      title: 'Dietary Fat Below Minimum',
      detail: `Current avg: ${engine.avgFatG}g fat/day. Minimum for hormone production: ${engine.targets.fatG}g/day. Below 0.6g/kg is associated with hormonal disruption.`,
      science: 'Dietary fat is the primary substrate for steroid hormone synthesis (testosterone, estrogen, cortisol). Fat restriction below 20% of calories reduces total testosterone by 10-15% in males (Hamalainen et al., 1984) and disrupts menstrual function in females, impairing both anabolic signaling and recovery.',
    });
  }

  // ── WELLNESS CORRELATION ───────────────────────────────────────────────────

  if (engine.wellness.energyDelta !== null && Math.abs(engine.wellness.energyDelta) >= 1.5) {
    const dir = engine.wellness.energyDelta > 0 ? 'higher' : 'lower';
    flags.push({
      id: 'protein_energy_correlation',
      severity: 'info',
      category: 'energy',
      title: `Protein Intake Strongly Correlates with Energy`,
      detail: `High-protein days → energy avg ${engine.wellness.highProteinEnergyAvg}/10. Low-protein days → ${engine.wellness.lowProteinEnergyAvg}/10. Difference: ${Math.abs(engine.wellness.energyDelta)} points. Sample: ${engine.wellness.sampleSize} data pairs.`,
      science: 'Protein provides tyrosine and tryptophan as precursors for dopamine, norepinephrine, and serotonin. Consistent protein intake stabilizes neurotransmitter synthesis and prevents the afternoon energy dip associated with high-carbohydrate, low-protein meals.',
    });
  }

  // ── Sort: critical → warning → info → positive ────────────────────────────
  const order: Record<RuleSeverity, number> = { critical: 0, warning: 1, info: 2, positive: 3 };
  flags.sort((a, b) => order[a.severity] - order[b.severity]);

  return {
    flags,
    criticalCount: flags.filter(f => f.severity === 'critical').length,
    warningCount: flags.filter(f => f.severity === 'warning').length,
    positiveCount: flags.filter(f => f.severity === 'positive').length,
    topPriority: flags.find(f => f.severity === 'critical' || f.severity === 'warning') ?? null,
  };
}
