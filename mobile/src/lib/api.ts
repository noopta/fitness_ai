import AsyncStorage from '@react-native-async-storage/async-storage';

const API_BASE_URL = 'https://api.airthreads.ai:4009/api';

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
  session?: {
    id: string;
    selectedLift: string;
    profile?: ProfileData;
    createdAt?: string;
    status?: string;
  };
  sessionId?: string;
  id?: string;
  selectedLift?: string;
}

export interface SnapshotEntry {
  exerciseId: string;
  weight: number;
  weightUnit: string;
  sets: number;
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
  message?: string;
  aiResponse?: string;
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

export interface IndexScore {
  value: number;
  confidence: number;
  sources: string[];
}

export interface PhaseScore {
  phase_id: string;
  points: number;
}

export interface HypothesisSignal {
  key: string;
  label: string;
  score: number;
  category: 'muscle' | 'mechanical' | 'stability' | 'mobility' | 'technique' | 'programming';
  evidence: string[];
}

export interface DiagnosticSignalsSubset {
  indices: {
    quad_index?: IndexScore;
    posterior_index?: IndexScore;
    back_tension_index?: IndexScore;
    triceps_index?: IndexScore;
    shoulder_index?: IndexScore;
  };
  phase_scores: PhaseScore[];
  primary_phase: string;
  primary_phase_confidence: number;
  hypothesis_scores: HypothesisSignal[];
  efficiency_score: {
    score: number;
    explanation: string;
    deductions: Array<{ key: string; points: number; reason: string }>;
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
      priority?: 1 | 2 | 3;
      impact?: 'high' | 'medium' | 'low';
    }>;
  };
  progression_rules: string[];
  track_next_time: string[];
  dominance_archetype?: {
    label: string;
    rationale: string;
    delta_value?: number;
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
  diagnostic_signals?: DiagnosticSignalsSubset;
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

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AuthUser {
  id: string;
  name: string | null;
  email: string | null;
  tier: string;
  heightCm?: number | null;
  weightKg?: number | null;
  trainingAge?: string | null;
  equipment?: string | null;
  constraintsText?: string | null;
  coachGoal?: string | null;
  coachBudget?: string | null;
  coachOnboardingDone?: boolean;
  coachProfile?: string | null;
  savedProgram?: string | null;
}

let authToken: string | null = null;

export async function loadToken() {
  authToken = await AsyncStorage.getItem('liftoff_auth_token');
}

export async function setToken(token: string | null) {
  authToken = token;
  if (token) {
    await AsyncStorage.setItem('liftoff_auth_token', token);
  } else {
    await AsyncStorage.removeItem('liftoff_auth_token');
  }
}

async function apiRequest<T>(
  endpoint: string,
  options?: RequestInit
): Promise<T> {
  const url = endpoint.startsWith('http') ? endpoint : `${API_BASE_URL}${endpoint}`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`;
    headers['Cookie'] = `connect.sid=${authToken}`;
  }

  const response = await fetch(url, {
    ...options,
    credentials: 'include',
    headers: {
      ...headers,
      ...(options?.headers as Record<string, string>),
    },
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    const err: any = new Error(errorData.error || `API Error: ${response.statusText}`);
    err.status = response.status;
    err.upgradeUrl = errorData.upgradeUrl;
    throw err;
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

  getCachedPlan: (sessionId: string) =>
    apiRequest<GeneratePlanResponse>(`/sessions/${sessionId}/plan`),

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

  chat: (sessionId: string, message: string) =>
    apiRequest<{ reply: string }>(`/sessions/${sessionId}/chat`, {
      method: 'POST',
      body: JSON.stringify({ message })
    }),
};

export const authApi = {
  me: () => apiRequest<any>('/auth/me'),
  login: async (email: string, password: string) => {
    const result = await apiRequest<any>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password })
    });
    if (result.token) {
      await setToken(result.token);
    }
    return result;
  },
  register: async (name: string, email: string, password: string, dateOfBirth?: string) => {
    const result = await apiRequest<any>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ name, email, password, dateOfBirth })
    });
    if (result.token) {
      await setToken(result.token);
    }
    return result;
  },
  logout: async () => {
    await apiRequest<any>('/auth/logout', { method: 'POST' });
    await setToken(null);
  },
  updateProfile: (data: Partial<ProfileData & { name?: string }>) =>
    apiRequest<any>('/auth/profile', { method: 'PUT', body: JSON.stringify(data) }),
};

export const historyApi = {
  getHistory: () => apiRequest<any[]>('/sessions/history'),
};

export const sessionApi = {
  getPublic: (sessionId: string) =>
    fetch(`${API_BASE_URL}/sessions/${sessionId}/public`).then(r => r.ok ? r.json() : null),
  share: (sessionId: string) =>
    apiRequest<{ shareUrl: string }>(`/sessions/${sessionId}/share`, { method: 'POST' }),
};

export const storage = {
  get: (key: string) => AsyncStorage.getItem(key),
  set: (key: string, value: string) => AsyncStorage.setItem(key, value),
  remove: (key: string) => AsyncStorage.removeItem(key),
  getJSON: async <T>(key: string): Promise<T | null> => {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return null;
    try { return JSON.parse(raw); } catch { return null; }
  },
  setJSON: (key: string, value: any) => AsyncStorage.setItem(key, JSON.stringify(value)),
};
