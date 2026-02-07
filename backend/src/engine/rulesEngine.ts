import { getLiftById, Limiter } from '../data/lifts.js';
import { getExerciseById, Exercise, exercises } from '../data/exercises.js';

export interface SessionContext {
  selectedLift: string;
  trainingAge?: string;
  goal?: string;
  equipment?: string;
  constraints?: string;
  snapshots?: Array<{
    exerciseId: string;
    weight: number;
    sets: number;
    repsSchema: string;
  }>;
}

export interface VolumeConstraints {
  maxTotalSets: number;
  maxCompoundSets: number;
  maxAccessorySets: number;
}

export function getVolumeConstraints(trainingAge?: string): VolumeConstraints {
  switch (trainingAge) {
    case 'beginner':
      return {
        maxTotalSets: 12,
        maxCompoundSets: 5,
        maxAccessorySets: 9
      };
    case 'intermediate':
      return {
        maxTotalSets: 18,
        maxCompoundSets: 8,
        maxAccessorySets: 12
      };
    case 'advanced':
      return {
        maxTotalSets: 25,
        maxCompoundSets: 10,
        maxAccessorySets: 18
      };
    default:
      return {
        maxTotalSets: 15,
        maxCompoundSets: 6,
        maxAccessorySets: 10
      };
  }
}

export function getApprovedAccessories(
  liftId: string,
  limiters: string[],
  equipment?: string,
  constraints?: string
): Exercise[] {
  const lift = getLiftById(liftId);
  if (!lift) return [];

  // Get all limiters for the lift
  const limiterObjects = lift.commonLimiters.filter(l => limiters.includes(l.id));
  
  // Collect target muscles and indicator exercises
  const targetMuscles = new Set<string>();
  const indicatorExerciseIds = new Set<string>();
  
  limiterObjects.forEach(limiter => {
    limiter.targetMuscles.forEach(m => targetMuscles.add(m));
    limiter.indicatorExercises?.forEach(e => indicatorExerciseIds.add(e));
  });

  // Filter exercises based on:
  // 1. Match target muscles OR be an indicator exercise
  // 2. Not the primary lift itself
  // 3. Equipment availability
  // 4. No contraindications
  
  const approved = exercises.filter(ex => {
    // Don't include the primary lift
    if (ex.id === liftId) return false;
    
    // Check if exercise targets relevant muscles or is an indicator
    const targetsRelevantMuscle = ex.targetMuscle.some(m => targetMuscles.has(m));
    const isIndicator = indicatorExerciseIds.has(ex.id);
    
    if (!targetsRelevantMuscle && !isIndicator) return false;
    
    // Equipment check (simplified for MVP - accept if any equipment matches)
    if (equipment && equipment !== 'commercial') {
      const hasRequiredEquipment = ex.equipment.some(eq => 
        ['barbell', 'dumbbells', 'bodyweight', 'band'].includes(eq)
      );
      if (equipment === 'limited' && !hasRequiredEquipment) return false;
    }
    
    // Contraindication check (simplified)
    if (constraints && ex.contraindications) {
      const hasConflict = ex.contraindications.some(contra => 
        constraints.toLowerCase().includes(contra.toLowerCase().replace('_', ' '))
      );
      if (hasConflict) return false;
    }
    
    return true;
  });

  return approved;
}

export function getStabilityExercises(liftId: string, equipment?: string): Exercise[] {
  // Lift-specific stability exercises
  const stabilityMap: Record<string, string[]> = {
    flat_bench_press: ['face_pull', 'chest_supported_row', 'band_pull_apart', 'external_rotation'],
    incline_bench_press: ['face_pull', 'band_pull_apart', 'external_rotation'],
    deadlift: ['plank', 'pallof_press', 'good_morning'],
    barbell_back_squat: ['plank', 'pallof_press', 'good_morning'],
    barbell_front_squat: ['plank', 'pallof_press']
  };

  const ids = stabilityMap[liftId] || [];
  const stabilityExercises = ids
    .map(id => getExerciseById(id))
    .filter(Boolean) as Exercise[];

  // Filter by equipment if needed
  if (equipment === 'limited' || equipment === 'home') {
    return stabilityExercises.filter(ex => 
      ex.equipment.some(eq => ['bodyweight', 'band', 'dumbbells'].includes(eq))
    );
  }

  return stabilityExercises;
}

export function analyzeSnapshotStrengthRatios(
  liftId: string,
  snapshots: Array<{ exerciseId: string; weight: number; sets: number; repsSchema: string }>
): { limiter: string; confidence: number; evidence: string }[] {
  // Simple heuristic analysis of strength ratios
  // This provides initial guidance before LLM diagnostic
  
  const findings: { limiter: string; confidence: number; evidence: string }[] = [];
  
  if (liftId === 'flat_bench_press') {
    const mainBench = snapshots.find(s => s.exerciseId === 'flat_bench_press');
    const closeGrip = snapshots.find(s => s.exerciseId === 'close_grip_bench_press');
    const row = snapshots.find(s => s.exerciseId === 'barbell_row' || s.exerciseId === 'chest_supported_row');
    
    if (mainBench && closeGrip) {
      const ratio = closeGrip.weight / mainBench.weight;
      if (ratio < 0.75) {
        findings.push({
          limiter: 'triceps_lockout_strength',
          confidence: 0.6,
          evidence: 'Close-grip bench is significantly weaker than main bench (ratio < 0.75)'
        });
      }
    }
    
    if (mainBench && row) {
      const ratio = row.weight / mainBench.weight;
      if (ratio < 0.6) {
        findings.push({
          limiter: 'upper_back_stability',
          confidence: 0.5,
          evidence: 'Rowing strength is low relative to bench press'
        });
      }
    }
  }
  
  if (liftId === 'deadlift') {
    const mainDL = snapshots.find(s => s.exerciseId === 'deadlift');
    const rackPull = snapshots.find(s => s.exerciseId === 'rack_pull');
    const rdl = snapshots.find(s => s.exerciseId === 'romanian_deadlift');
    
    if (mainDL && rackPull) {
      const ratio = rackPull.weight / mainDL.weight;
      if (ratio > 1.15) {
        findings.push({
          limiter: 'off_floor_strength',
          confidence: 0.65,
          evidence: 'Rack pulls significantly stronger than full deadlift'
        });
      }
    }
  }
  
  return findings;
}

export function generateIntensityRecommendation(
  trainingAge?: string,
  goal?: string
): { sets: number; reps: string; intensity: string; rest: number } {
  // Default intensity prescription based on training age and goal
  
  const isStrength = goal === 'strength_peak';
  const isHypertrophy = goal === 'hypertrophy';
  
  if (trainingAge === 'beginner') {
    return {
      sets: 4,
      reps: isHypertrophy ? '8-10' : '6-8',
      intensity: 'RIR 2-3',
      rest: 2.5
    };
  }
  
  if (trainingAge === 'advanced') {
    return {
      sets: isStrength ? 5 : 4,
      reps: isStrength ? '3-5' : (isHypertrophy ? '8-12' : '5-8'),
      intensity: isStrength ? 'RIR 1' : 'RIR 1-2',
      rest: isStrength ? 4 : 3
    };
  }
  
  // Intermediate default
  return {
    sets: 4,
    reps: isStrength ? '4-6' : (isHypertrophy ? '8-10' : '6-8'),
    intensity: 'RIR 1-2',
    rest: 3
  };
}
