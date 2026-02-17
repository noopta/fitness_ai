// API adapter to connect to our Lift Coach backend
const API_BASE_URL = import.meta.env.VITE_API_URL || 'https://luciuslab.xyz:4009/api';

export interface LiftData {
  id: string;
  name: string;
  description: string;
  muscleGroups: string[];
  difficulty: string;
}

export interface ExerciseData {
  id: string;
  name: string;
  category: string;
  muscleGroups: string[];
  equipment: string[];
  difficulty: string;
  description: string;
}

export interface ProfileData {
  age?: number;
  heightCm?: number;
  weightKg?: number;
  gender?: string;
  trainingAge?: string;
  goal?: string;
  injuries?: string[];
  equipment?: string | string[];
  constraintsText?: string;
}

export interface SessionData {
  session: {
    id: string;
    selectedLift: string;
    profile?: ProfileData;
    createdAt?: string;
    status?: string;
  };
}

export interface SnapshotEntry {
  exerciseId: string;
  weight: number;
  weightUnit: string;
  reps: number;
  rpe?: number;
  date?: string;
}

export interface DiagnosticMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp?: string;
}

export interface DiagnosticResponse {
  message: string;
  complete: boolean;
  analysis?: string;
  questionsAsked?: number;
  maxQuestions?: number;
  diagnosis?: {
    primaryLimiter: string;
    muscleGroup: string;
    reasoning: string;
    confidence: string;
  };
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
  dominance_archetype?: {
    label: string;
    rationale: string;
  };
  efficiency_score?: {
    score: number;
    explanation: string;
  };
  validation_test?: {
    description: string;
    how_to_run: string;
    hypothesis_tested: string;
  };
}

export interface GeneratePlanResponse {
  plan: WorkoutPlan;
}

export interface SessionDetails {
  sessionId: string;
  selectedLift: string;
  profile?: ProfileData;
  snapshots: Array<{
    id: string;
    exerciseId: string;
    weight: number;
    weightUnit: string;
    reps: number;
    rpe?: number;
    estimatedOneRepMax?: number;
  }>;
  messages: DiagnosticMessage[];
  diagnosis?: {
    primaryLimiter: string;
    muscleGroup: string;
    reasoning: string;
  };
  plan?: WorkoutPlan;
  status: string;
  createdAt: string;
  updatedAt?: string;
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
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `API Error: ${response.statusText}`);
  }

  return response.json();
}

export const liftCoachApi = {
  getLifts: () => apiRequest<LiftData[]>('/lifts'),

  getLiftExercises: (liftId: string) => 
    apiRequest<ExerciseData[]>(`/lifts/${liftId}/exercises`),

  createSession: (data: {
    selectedLift: string;
    goal?: string;
    profile?: ProfileData;
  }) => apiRequest<SessionData>('/sessions', {
    method: 'POST',
    body: JSON.stringify(data)
  }),

  addSnapshots: (sessionId: string, snapshots: SnapshotEntry[]) =>
    apiRequest<any>(`/sessions/${sessionId}/snapshots`, {
      method: 'POST',
      body: JSON.stringify({ snapshots })
    }),

  sendMessage: (sessionId: string, message: string) =>
    apiRequest<DiagnosticResponse>(`/sessions/${sessionId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ message })
    }),

  generatePlan: (sessionId: string) =>
    apiRequest<GeneratePlanResponse>(`/sessions/${sessionId}/generate`, {
      method: 'POST',
      body: JSON.stringify({})
    }),

  getSession: (sessionId: string) =>
    apiRequest<SessionDetails>(`/sessions/${sessionId}`),

  joinWaitlist: (email: string, name?: string, phone?: string) =>
    apiRequest<{ success: boolean; message: string }>('/waitlist', {
      method: 'POST',
      body: JSON.stringify({ email, name, phone })
    }),
};
