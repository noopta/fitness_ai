// Plain-language names for the training phases Axiom infers (contract 6).
import type { TrainingPhase } from '../../lib/api';

export const PHASE_LABEL: Record<TrainingPhase, string> = {
  building_strength: 'Building strength',
  cutting: 'Cutting',
  cut_too_aggressive: 'Cutting too hard',
  building_muscle: 'Building muscle',
  recomp: 'Recomp',
  plateau: 'Plateau',
  rebuilding_consistency: 'Rebuilding consistency',
  unknown: 'Not sure yet',
};

/** Phases a user can pick by hand (Change sheet). */
export const SELECTABLE_PHASES: TrainingPhase[] = [
  'building_strength', 'building_muscle', 'cutting', 'recomp', 'plateau', 'rebuilding_consistency',
];

export function phaseLabel(p: string | null | undefined): string {
  if (!p) return PHASE_LABEL.unknown;
  return (PHASE_LABEL as Record<string, string>)[p] ?? p.replace(/_/g, ' ');
}
