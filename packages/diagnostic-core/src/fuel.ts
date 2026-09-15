import type { Verdict } from './types';
import { liftFamily, type LiftFamily } from './lifts';

/**
 * "Fuel for this fix" — general micronutrient guidance keyed to the diagnosis.
 *
 * Deliberately NOT personalised intake analysis: a diagnostic user has almost
 * never logged a meal (prod, Sep 2026: five users logged any meal in 30 days),
 * so we can't say what they're short on. What we can say honestly is which
 * nutrients matter for the KIND of work their fix prescribes. Pure and
 * derived from fields every stored verdict already has, so reports written
 * before this shipped get the section too, and web and mobile can't disagree.
 *
 * Claims stay on recovery and adaptation to the prescribed work — never that a
 * nutrient fixes the limiter itself — and match the reviewed mechanism copy in
 * backend/src/engine/nutrientRegistry.ts.
 */

export type FuelTheme = 'build' | 'joint' | 'skill';

export interface FuelNutrient {
  name: string;
  why: string;
  foods: string;
}

export interface FuelNote {
  theme: FuelTheme;
  lead: string;
  nutrients: FuelNutrient[];
  foundation: string;
  caveat: string;
}

/** Limiters where the fix is load tolerance for irritated or restricted tissue. */
const JOINT_KEYS = new Set(['shoulder_health', 'mobility_restriction']);

/** Limiters where the fix is positions, bracing and timing rather than new muscle. */
const SKILL_KEYS = new Set([
  'bracing_deficit',
  'core_bracing_deficit',
  'scap_stability_deficit',
  'upper_back_rack_deficit',
  'elbow_flare_technique',
  'touch_point_technique',
  'stretch_reflex_reliance',
  'grip_limiter',
  'lat_tension_deficit',
  'wedge_setup_deficit',
]);

/**
 * Muscle deficits (triceps, quads, glutes…) and the volume candidates fall
 * through to `build`, as does a verdict with no hypothesis — every fix adds
 * hard sets, so recovery nutrients are the safe general read.
 */
export function fuelTheme(hypothesisKey: string | null): FuelTheme {
  if (hypothesisKey && JOINT_KEYS.has(hypothesisKey)) return 'joint';
  if (hypothesisKey && SKILL_KEYS.has(hypothesisKey)) return 'skill';
  return 'build';
}

const REGION: Record<string, string> = {
  triceps_deficit: 'triceps',
  pec_off_chest_deficit: 'chest',
  upper_chest_deficit: 'upper chest and front delts',
  anterior_delt_deficit: 'front delts',
  quad_deficit: 'quads',
  quad_floor_deficit: 'quads',
  glute_hip_deficit: 'glutes',
  posterior_lockout_deficit: 'glutes and hamstrings',
  pressing_volume: 'pressing muscles',
  pulling_volume: 'back and hips',
  leg_volume: 'legs',
};

const FAMILY_REGION: Record<LiftFamily, string> = {
  press: 'pressing muscles',
  deadlift: 'back and hips',
  squat: 'legs',
};

const VITAMIN_D: FuelNutrient = {
  name: 'Vitamin D',
  why: 'Supports muscle function and recovery, and low levels are common with little sun exposure.',
  foods: 'Salmon, sardines, eggs, fortified milk. Get a blood test before taking high doses.',
};

const MAGNESIUM: FuelNutrient = {
  name: 'Magnesium',
  why: 'Every contraction spends ATP that depends on it, and hard training plus sweat raises what you need.',
  foods: 'Pumpkin seeds, almonds, black beans, spinach.',
};

const CAVEAT =
  'General guidance for this type of fix, not a read of your diet. Log a week of meals to see which of these you actually hit. ' +
  'Check with a clinician before supplementing if you take medication, are pregnant, or manage a medical condition.';

const PROTEIN = 'about 1.6 g of protein per kg of body weight a day (0.7 g per lb), spread over 3 to 4 meals';

export function fuelFor(v: Pick<Verdict, 'lift' | 'limiter'>): FuelNote {
  const key = v.limiter.hypothesisKey;
  const theme = fuelTheme(key);

  if (theme === 'joint') {
    return {
      theme,
      lead:
        key === 'mobility_restriction'
          ? 'Your fix works on the positions your joints can reach under load. Food will not add range, but it does support the tissue you are asking to adapt.'
          : 'Your fix loads a shoulder that is already telling you something. Tendons and ligaments adapt slower than muscle, and a few nutrients support that repair.',
      nutrients: [
        {
          name: 'Vitamin C',
          why: 'Your body needs it to build collagen, the main protein in tendons and ligaments.',
          foods: 'Citrus, kiwi, bell peppers, berries.',
        },
        {
          name: 'Omega-3 (EPA and DHA)',
          why: 'Helps regulate inflammation, which matters when a joint is irritated by training.',
          foods: 'Salmon, sardines, mackerel. Algae oil if you do not eat fish.',
        },
        VITAMIN_D,
      ],
      foundation:
        `Cover ${PROTEIN}. Some small studies suggest 10 to 15 g of gelatin or collagen with vitamin C about an hour before rehab work supports connective tissue. It is low-risk but not proven.`,
      caveat: CAVEAT,
    };
  }

  if (theme === 'skill') {
    return {
      theme,
      lead:
        'Your fix is about quality reps: bracing, position and timing. That work rewards a fresh nervous system and steady energy through the session more than extra muscle.',
      nutrients: [
        {
          name: 'Iron',
          why: 'Carries oxygen to working muscle. Running low shows up as heavy, flat sessions, and is more common in women and plant-based eaters.',
          foods: 'Red meat, lentils, spinach eaten with a vitamin C source. Do not supplement without a ferritin test.',
        },
        MAGNESIUM,
        {
          name: 'Sodium and potassium',
          why: 'These electrolytes set the charge that lets muscle fire. Heavy sweating drains them and blunts output.',
          foods: 'Salt your pre-training meal if you sweat a lot. Potatoes, bananas and beans for potassium.',
        },
      ],
      foundation:
        `Train fed, with carbs and protein 2 to 3 hours before, and drink water through the session. Cover ${PROTEIN}.`,
      caveat: CAVEAT,
    };
  }

  const region = (key ? REGION[key] : undefined) || FAMILY_REGION[liftFamily(v.lift)];
  return {
    theme,
    lead: `Your fix adds hard sets for your ${region}. The strength comes from recovering between those sessions, and a few micronutrients decide how well that goes.`,
    nutrients: [
      VITAMIN_D,
      MAGNESIUM,
      {
        name: 'Zinc',
        why: 'Needed for protein synthesis and tissue repair, and often runs short when calories are tight.',
        foods: 'Beef, oysters, pumpkin seeds, lentils.',
      },
    ],
    foundation:
      `Micronutrients only help once the basics are covered: ${PROTEIN}, and 3 to 5 g of creatine monohydrate daily, the best-supported supplement for strength work.`,
    caveat: CAVEAT,
  };
}
