export interface Lift {
  id: string;
  name: string;
  category: string;
  description: string;
}

export interface Exercise {
  id: string;
  name: string;
  category: string;
  targetMuscle: string[];
  equipment: string[];
}

export interface SessionData {
  id: string;
  selectedLift: string;
  goal?: string;
  userId?: string;
}

export interface ProfileData {
  heightCm?: number;
  weightKg?: number;
  bodyCompTag?: string;
  trainingAge?: string;
  equipment?: string;
  constraintsText?: string;
}

export interface ExerciseSnapshot {
  exerciseId: string;
  weight: number;
  sets: number;
  repsSchema: string;
  rpeOrRir?: string;
}

export interface DiagnosticMessage {
  role: 'user' | 'assistant';
  message: string;
  createdAt?: string;
}

export interface WorkoutPlan {
  selected_lift: string;
  diagnosis: Array<{
    limiter: string;
    limiterName: string;
    confidence: number;
    evidence: string[];
  }>;
  bench_day_plan: {
    primary_lift: {
      exercise_id: string;
      exercise_name: string;
      sets: number;
      reps: string;
      intensity: string;
      rest_minutes: number;
    };
    accessories: Array<{
      exercise_id: string;
      exercise_name: string;
      sets: number;
      reps: string;
      why: string;
      category: string;
    }>;
  };
  progression_rules: string[];
  track_next_time: string[];
}
