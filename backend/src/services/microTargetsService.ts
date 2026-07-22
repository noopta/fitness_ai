// Deterministic personalized micronutrient targets — no LLM, no side effects.
// Mirrors the diagnostic-engine philosophy: pure input → output, fully
// unit-testable, with the LLM layer (nutritionPlanService) consuming the
// result rather than inventing numbers.
//
// Baselines are adult RDA/AI values (NIH ODS); adjustments are deliberately
// conservative multipliers for sex, dietary style, and training volume.
// Sodium/sugar/saturated fat are UPPER bounds (direction: 'limit').

export type DietaryStyle = 'omnivore' | 'pescatarian' | 'vegetarian' | 'vegan';
export type NutritionGoal =
  | 'energy'
  | 'gut_comfort'
  | 'recovery'
  | 'sleep'
  | 'cognition'
  | 'body_comp'
  | 'general_health';

export interface MicroTargetInput {
  sex?: 'male' | 'female' | null;
  weightKg?: number | null;
  calorieTarget?: number | null;
  trainingDaysPerWeek?: number | null;
  dietaryStyle?: DietaryStyle | null;
  goals?: NutritionGoal[] | null;      // ranked, most important first
  sleepQualityLow?: boolean | null;    // from assessment energy/sleep answers
}

export interface MicroTarget {
  key: string;            // matches Micronutrients keys, plus 'fiberG'
  label: string;
  unit: 'g' | 'mg' | 'mcg' | 'IU';
  target: number;
  direction: 'meet' | 'limit';
  rationale: string[];    // machine-readable adjustment codes, e.g. 'training_bump'
}

export interface MicroTargetResult {
  targets: MicroTarget[];
  focus: string[];        // 5–6 target keys, ranked
}

interface BaseDef {
  key: string;
  label: string;
  unit: MicroTarget['unit'];
  male: number;
  female: number;
  direction: 'meet' | 'limit';
}

// Order here is the tie-break order for focus selection.
const BASES: BaseDef[] = [
  { key: 'fiberG',       label: 'Fiber',       unit: 'g',   male: 34,   female: 28,   direction: 'meet'  },
  { key: 'ironMg',       label: 'Iron',        unit: 'mg',  male: 8,    female: 18,   direction: 'meet'  },
  { key: 'magnesiumMg',  label: 'Magnesium',   unit: 'mg',  male: 420,  female: 320,  direction: 'meet'  },
  { key: 'potassiumMg',  label: 'Potassium',   unit: 'mg',  male: 3400, female: 2600, direction: 'meet'  },
  { key: 'omega3G',      label: 'Omega-3',     unit: 'g',   male: 1.6,  female: 1.1,  direction: 'meet'  },
  { key: 'vitaminDIU',   label: 'Vitamin D',   unit: 'IU',  male: 600,  female: 600,  direction: 'meet'  },
  { key: 'vitaminB12Mcg',label: 'Vitamin B12', unit: 'mcg', male: 2.4,  female: 2.4,  direction: 'meet'  },
  { key: 'zincMg',       label: 'Zinc',        unit: 'mg',  male: 11,   female: 8,    direction: 'meet'  },
  { key: 'calciumMg',    label: 'Calcium',     unit: 'mg',  male: 1000, female: 1000, direction: 'meet'  },
  { key: 'folateMcg',    label: 'Folate',      unit: 'mcg', male: 400,  female: 400,  direction: 'meet'  },
  { key: 'vitaminCMg',   label: 'Vitamin C',   unit: 'mg',  male: 90,   female: 75,   direction: 'meet'  },
  { key: 'vitaminEMg',   label: 'Vitamin E',   unit: 'mg',  male: 15,   female: 15,   direction: 'meet'  },
  { key: 'vitaminAIU',   label: 'Vitamin A',   unit: 'IU',  male: 3000, female: 2333, direction: 'meet'  },
  { key: 'sodiumMg',     label: 'Sodium',      unit: 'mg',  male: 2300, female: 2300, direction: 'limit' },
  { key: 'sugarG',       label: 'Added sugar', unit: 'g',   male: 36,   female: 25,   direction: 'limit' },
  { key: 'saturatedFatG',label: 'Saturated fat', unit: 'g', male: 22,   female: 20,   direction: 'limit' },
];

// Goal → nutrients that matter most for it (focus scoring).
const GOAL_AFFINITY: Record<NutritionGoal, string[]> = {
  energy:         ['ironMg', 'vitaminB12Mcg', 'magnesiumMg', 'fiberG'],
  gut_comfort:    ['fiberG', 'magnesiumMg', 'potassiumMg'],
  recovery:       ['omega3G', 'magnesiumMg', 'zincMg', 'vitaminDIU'],
  sleep:          ['magnesiumMg', 'potassiumMg'],
  cognition:      ['omega3G', 'vitaminB12Mcg', 'ironMg', 'folateMcg'],
  body_comp:      ['fiberG', 'calciumMg', 'vitaminDIU'],
  general_health: ['fiberG', 'vitaminDIU', 'omega3G'],
};

// Dietary styles raise deficiency risk for specific nutrients.
const STYLE_RISK: Record<DietaryStyle, string[]> = {
  omnivore:    [],
  pescatarian: ['ironMg'],
  vegetarian:  ['ironMg', 'zincMg', 'vitaminB12Mcg', 'omega3G', 'vitaminDIU'],
  vegan:       ['ironMg', 'zincMg', 'vitaminB12Mcg', 'omega3G', 'vitaminDIU', 'calciumMg'],
};

function round(value: number, unit: MicroTarget['unit']): number {
  // Sub-10 values (omega-3 g, B12 mcg, iron mg) keep one decimal — rounding
  // 2.4mcg B12 to "2" would misstate the RDA.
  if (unit === 'g' || value < 10) return Math.round(value * 10) / 10;
  return Math.round(value);
}

export function computeMicroTargets(input: MicroTargetInput): MicroTargetResult {
  const sex = input.sex === 'female' ? 'female' : 'male';
  const style: DietaryStyle = input.dietaryStyle ?? 'omnivore';
  const goals = (input.goals ?? []).filter((g): g is NutritionGoal => g in GOAL_AFFINITY);
  const heavyTraining = (input.trainingDaysPerWeek ?? 0) >= 4;

  const targets: MicroTarget[] = BASES.map((base) => {
    let value = base[sex];
    const rationale: string[] = [`rda_${sex}`];

    if (base.key === 'fiberG' && input.calorieTarget) {
      // 14g / 1000 kcal (Institute of Medicine), clamped to a sane band.
      value = Math.min(45, Math.max(25, (input.calorieTarget / 1000) * 14));
      rationale.push('per_1000kcal');
    }

    if (heavyTraining) {
      if (base.key === 'magnesiumMg') { value *= 1.15; rationale.push('training_bump'); }
      if (base.key === 'potassiumMg') { value *= 1.1;  rationale.push('training_bump'); }
      if (base.key === 'vitaminDIU')  { value = Math.max(value, 800); rationale.push('training_bump'); }
      if (base.key === 'sodiumMg')    { value += 500;  rationale.push('sweat_allowance'); }
    }

    if (style === 'vegan' || style === 'vegetarian') {
      // Plant-source iron/zinc absorb worse — higher intake target.
      if (base.key === 'ironMg') { value *= 1.8; rationale.push('plant_absorption'); }
      if (base.key === 'zincMg') { value *= 1.5; rationale.push('plant_absorption'); }
    }

    return {
      key: base.key,
      label: base.label,
      unit: base.unit,
      target: round(value, base.unit),
      direction: base.direction,
      rationale,
    };
  });

  // Focus selection: score every 'meet' nutrient by goal affinity (ranked
  // goals weigh more), dietary-style deficiency risk, and sleep flag; break
  // ties by BASES order. Fiber always makes the cut — it anchors the gut
  // baseline that applies to everyone.
  const scores = new Map<string, number>();
  for (const t of targets) {
    if (t.direction === 'meet') scores.set(t.key, 0);
  }
  goals.forEach((goal, idx) => {
    const weight = Math.max(1, 4 - idx); // 1st goal = 4, 2nd = 3, ...
    for (const key of GOAL_AFFINITY[goal]) {
      if (scores.has(key)) scores.set(key, scores.get(key)! + weight);
    }
  });
  for (const key of STYLE_RISK[style]) {
    if (scores.has(key)) scores.set(key, scores.get(key)! + 3);
  }
  if (input.sleepQualityLow && scores.has('magnesiumMg')) {
    scores.set('magnesiumMg', scores.get('magnesiumMg')! + 2);
  }
  if (sex === 'female' && scores.has('ironMg')) {
    scores.set('ironMg', scores.get('ironMg')! + 2);
  }
  scores.set('fiberG', scores.get('fiberG')! + 100); // always first

  const order = BASES.map((b) => b.key);
  const focus = [...scores.entries()]
    .sort((a, b) => b[1] - a[1] || order.indexOf(a[0]) - order.indexOf(b[0]))
    .slice(0, 6)
    .map(([key]) => key);

  return { targets, focus };
}

export type MicroStatus = 'ok' | 'low' | 'vlow';

// Status bands (data honesty: bands, not precision). 'meet' nutrients:
// ≥70% on track, 40–70% low, <40% very low. 'limit' nutrients invert:
// ≤100% of the cap is on track, 100–130% low, >130% very low.
export function statusFor(target: MicroTarget, actual: number): MicroStatus {
  const pct = target.target > 0 ? actual / target.target : 0;
  if (target.direction === 'limit') {
    if (pct <= 1) return 'ok';
    if (pct <= 1.3) return 'low';
    return 'vlow';
  }
  if (pct >= 0.7) return 'ok';
  if (pct >= 0.4) return 'low';
  return 'vlow';
}
