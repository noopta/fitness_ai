// API adapter to connect to our Lift Coach backend
const API_BASE_URL = import.meta.env.VITE_API_URL || 'https://luciuslab.xyz:4009/api';

export interface LiftData {
  id: string;
  name: string;
  category: string;
  description: string;
}

export interface ExerciseData {
  id: string;
  name: string;
  category: string;
  targetMuscle: string[];
  equipment: string[];
}

export interface ProfileData {
  heightCm?: number;
  weightKg?: number;
  bodyCompTag?: string;
  trainingAge?: string;
  equipment?: string;
  constraintsText?: string;
}

export interface SessionData {
  id: string;
  selectedLift: string;
  goal?: string;
  userId?: string;
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

async function apiRequest<T>(
  endpoint: string,
  options?: RequestInit
): Promise<T> {
  const url = endpoint.startsWith('http') ? endpoint : `${API_BASE_URL}${endpoint}`;
  
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers
    }
  });

  if (!response.ok) {
    throw new Error(`API Error: ${response.statusText}`);
  }

  return response.json();
}

// API methods
export const liftCoachApi = {
  // Get all lifts
  getLifts: () => apiRequest<{ lifts: LiftData[] }>('/lifts'),

  // Get exercises for a lift
  getLiftExercises: (liftId: string) => 
    apiRequest<{ exercises: ExerciseData[] }>(`/lifts/${liftId}/exercises`),

  // Create new session
  createSession: (data: {
    selectedLift: string;
    goal?: string;
    profile?: ProfileData;
  }) => apiRequest<{ session: SessionData }>('/sessions', {
    method: 'POST',
    body: JSON.stringify(data)
  }),

  // Add exercise snapshot
  addSnapshot: (sessionId: string, snapshot: ExerciseSnapshot) =>
    apiRequest<{ snapshot: any }>(`/sessions/${sessionId}/snapshots`, {
      method: 'POST',
      body: JSON.stringify(snapshot)
    }),

  // Send diagnostic message
  sendMessage: (sessionId: string, message: string) =>
    apiRequest<{ complete: boolean; message: string }>(`/sessions/${sessionId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ message })
    }),

  // Generate workout plan
  generatePlan: (sessionId: string) =>
    apiRequest<{ plan: WorkoutPlan }>(`/sessions/${sessionId}/generate`, {
      method: 'POST'
    }),

  // Get session details
  getSession: (sessionId: string) =>
    apiRequest<{
      session: SessionData & {
        user?: any;
        snapshots: any[];
        messages: DiagnosticMessage[];
        plans: Array<{ planJson: string }>;
      };
    }>(`/sessions/${sessionId}`)
};
