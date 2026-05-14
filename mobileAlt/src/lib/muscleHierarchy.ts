// Frontend muscle hierarchy — declares which muscle groups belong to which
// movement bucket on the radar's drill-down. Lives in the client (not the
// backend) so we can iterate on the UX hierarchy — split a bucket, regroup
// muscles — without a backend deploy.
//
// The backend returns flat `muscleScores: { Chest: 78, Lats: 72, ... }`.
// The frontend uses MOVEMENT_TO_MUSCLES to map a tapped axis ("Pull") into
// the muscle subset to render in the level-2 sub-radar.
//
// Notes on overlap:
// - Glutes appear under both Squat and Hinge — that's intentional, glutes
//   contribute to both knee-dominant and hip-dominant patterns and users
//   would expect to find them either way.
// - Erectors only show under Hinge; their squat contribution is small and
//   would crowd the squat sub-radar.
// - Lateral Delt sits in Push since vertical pressing is its primary driver
//   in our data; lateral raises also count.

import type { RadarAxis } from '../components/strength/RadarChart';

export type MovementBucket = 'Push' | 'Pull' | 'Squat' | 'Hinge' | 'Core' | 'Power';

export const MOVEMENT_TO_MUSCLES: Record<MovementBucket, string[]> = {
  Push:  ['Chest', 'Front Delt', 'Triceps', 'Lateral Delt'],
  Pull:  ['Lats', 'Mid-back', 'Rear Delt', 'Biceps', 'Forearms'],
  Squat: ['Quads', 'Glutes', 'Adductors', 'Calves'],
  Hinge: ['Hamstrings', 'Glutes', 'Erectors', 'Lower Back'],
  Core:  ['Abs', 'Obliques', 'Lower Back'],
  Power: ['Hip Power', 'Posterior Chain', 'Grip'],
};

// Display order for the level-1 overview. Matches the existing screen's
// RADAR_ORDER so a flag-on user lands on the same first frame as flag-off.
export const MOVEMENT_ORDER: MovementBucket[] = ['Push', 'Squat', 'Core', 'Pull', 'Hinge', 'Power'];

// Default target score for level-2 muscle axes (0..100). Mirrors the
// backend's DEFAULT_MUSCLE_TARGET; duplicated here to avoid a round trip.
export const DEFAULT_MUSCLE_TARGET = 80;

// Backend movement keys (lowercase, snake-cased) → display labels.
// Mirrors what already exists in strength-profile.tsx so we render the
// overview axis labels identically with or without the flag.
export const MOVEMENT_LABEL_FROM_BACKEND_KEY: Record<string, MovementBucket> = {
  push:   'Push',
  pull:   'Pull',
  legs:   'Squat',
  hinge:  'Hinge',
  core:   'Core',
  cardio: 'Power',
};

export type RadarLevel =
  | { kind: 'overview' }
  | { kind: 'bucket'; bucket: MovementBucket };

/**
 * Derive the radar axes array to render at the current level. Pure function
 * — given the same inputs, returns the same output, no side effects. The
 * screen's level state changing causes this to re-derive and the chart's
 * useEffect picks up the new axes and morphs.
 */
export function buildAxesForLevel(
  level: RadarLevel,
  radarScores: Record<string, number> | null | undefined,
  muscleScores: Record<string, number> | null | undefined,
  targetMovement = 80,
  targetMuscle = DEFAULT_MUSCLE_TARGET,
): RadarAxis[] {
  if (level.kind === 'overview') {
    if (!radarScores) return [];
    return MOVEMENT_ORDER
      .map<RadarAxis | null>((m) => {
        const key = backendKeyFor(m);
        const raw = radarScores[key];
        if (raw == null) return null;
        return {
          axis: m,
          // Backend radarScores are 0–10 (tonnage-relative); rescale to 0–100
          // for visual consistency with the muscle-level radar.
          current: Math.max(0, Math.min(100, raw * 10)),
          target: targetMovement,
        };
      })
      .filter((a): a is RadarAxis => a !== null);
  }

  // Bucket (level 2): show muscles configured for this bucket.
  if (!muscleScores) return [];
  const muscles = MOVEMENT_TO_MUSCLES[level.bucket] ?? [];
  return muscles
    .map<RadarAxis | null>((m) => {
      const v = muscleScores[m];
      if (v == null) return null;
      return { axis: m, current: Math.max(0, Math.min(100, v)), target: targetMuscle };
    })
    .filter((a): a is RadarAxis => a !== null);
}

function backendKeyFor(label: MovementBucket): string {
  for (const [key, lbl] of Object.entries(MOVEMENT_LABEL_FROM_BACKEND_KEY)) {
    if (lbl === label) return key;
  }
  return label.toLowerCase();
}
