// Recovery & nutrition factors — Phase 6 of the Athlete Model.
//
// When a lift stalls, the cause is multi-factorial. This service surfaces
// the *contributing factors* we can observe from logged data — never
// claiming "the cause", only "things working against you right now".
// The Insight Engine attaches these to stagnation insights so a plateau
// reads as "bench stalled — and you've been in a deficit for 8 weeks"
// rather than just "bench stalled".
//
// Pure + deterministic. Caller loads the logs; this does the analysis.

export interface BodyWeightPoint { date: string; weightLbs: number }
export interface NutritionPoint { date: string; calories: number; proteinG: number }
export interface WellnessPoint { date: string; sleepHours: number; stress: number; energy: number }

export type RecoveryFactorId =
  | 'calorie-deficit'
  | 'low-protein'
  | 'poor-sleep'
  | 'high-stress'
  | 'low-energy';

export interface RecoveryFactor {
  id: RecoveryFactorId;
  severity: number;       // 0-1
  note: string;           // plain-English "contributing factor" line
}

export interface RecoveryFactorsInput {
  bodyWeight: BodyWeightPoint[];      // any window; sorted or not
  nutrition: NutritionPoint[];
  wellness: WellnessPoint[];
  bodyWeightLbs: number | null;       // current bodyweight for protein-target math
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0;
}

/**
 * Analyze the trailing-window logs for factors that suppress strength
 * progress. Returns only the factors that are actually present, severity-
 * ranked. An empty array means "nothing in the logs is working against you"
 * — which is itself useful (rules diet/recovery out as the plateau cause).
 */
export function analyzeRecoveryFactors(input: RecoveryFactorsInput): RecoveryFactor[] {
  const factors: RecoveryFactor[] = [];

  // ── Calorie deficit — inferred from a bodyweight downtrend ─────────────
  // We trust the scale over self-reported calories (logging is leaky).
  // A sustained drop while trying to get stronger is a real headwind.
  const bw = [...input.bodyWeight].sort((a, b) => a.date.localeCompare(b.date));
  if (bw.length >= 3) {
    const first = bw[0].weightLbs;
    const last = bw[bw.length - 1].weightLbs;
    const dropLbs = first - last;
    if (dropLbs >= 2 && first > 0) {
      const pctDrop = dropLbs / first;
      factors.push({
        id: 'calorie-deficit',
        severity: Math.min(1, pctDrop / 0.06), // ~6% drop → max severity
        note: `Bodyweight is down ${dropLbs.toFixed(1)} lb — you've been in a calorie deficit. Strength gains are hard while losing weight.`,
      });
    }
  }

  // ── Low protein — vs ~0.7 g/lb bodyweight target ──────────────────────
  if (input.nutrition.length >= 3 && input.bodyWeightLbs && input.bodyWeightLbs > 0) {
    const avgProtein = mean(input.nutrition.map((n) => n.proteinG));
    const target = input.bodyWeightLbs * 0.7;
    if (avgProtein > 0 && avgProtein < target * 0.8) {
      factors.push({
        id: 'low-protein',
        severity: Math.min(1, (target - avgProtein) / target),
        note: `Average protein (${Math.round(avgProtein)}g/day) is below your ~${Math.round(target)}g target — muscle repair is under-fueled.`,
      });
    }
  }

  // ── Poor sleep — average below 7 h ─────────────────────────────────────
  if (input.wellness.length >= 3) {
    const avgSleep = mean(input.wellness.map((w) => w.sleepHours).filter((h) => h > 0));
    if (avgSleep > 0 && avgSleep < 7) {
      factors.push({
        id: 'poor-sleep',
        severity: Math.min(1, (7 - avgSleep) / 2.5),
        note: `Averaging ${avgSleep.toFixed(1)}h sleep — under the ~7-9h that recovery and strength expression need.`,
      });
    }

    // ── High stress (1-5 scale, higher = worse) ─────────────────────────
    const avgStress = mean(input.wellness.map((w) => w.stress).filter((s) => s > 0));
    if (avgStress >= 3.5) {
      factors.push({
        id: 'high-stress',
        severity: Math.min(1, (avgStress - 3) / 2),
        note: `Stress check-ins are running high — elevated stress blunts recovery and force output.`,
      });
    }

    // ── Low energy (1-5 scale, lower = worse) ───────────────────────────
    const avgEnergy = mean(input.wellness.map((w) => w.energy).filter((e) => e > 0));
    if (avgEnergy > 0 && avgEnergy <= 2.5) {
      factors.push({
        id: 'low-energy',
        severity: Math.min(1, (3 - avgEnergy) / 2),
        note: `Energy check-ins are low — a sign recovery isn't keeping up with training load.`,
      });
    }
  }

  return factors.sort((a, b) => b.severity - a.severity);
}
