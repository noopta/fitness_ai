import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

let SecureStore: typeof import('expo-secure-store') | null = null;
if (Platform.OS !== 'web') {
  SecureStore = require('expo-secure-store');
}

const API_BASE = 'https://api.airthreads.ai:4009/api';
const TOKEN_KEY = 'liftoff_auth_token';

export async function getToken(): Promise<string | null> {
  if (Platform.OS === 'web') {
    return AsyncStorage.getItem(TOKEN_KEY);
  }
  return SecureStore!.getItemAsync(TOKEN_KEY);
}

export async function setToken(token: string): Promise<void> {
  if (Platform.OS === 'web') {
    await AsyncStorage.setItem(TOKEN_KEY, token);
    return;
  }
  return SecureStore!.setItemAsync(TOKEN_KEY, token);
}

export async function clearToken(): Promise<void> {
  if (Platform.OS === 'web') {
    await AsyncStorage.removeItem(TOKEN_KEY);
    return;
  }
  return SecureStore!.deleteItemAsync(TOKEN_KEY);
}

async function apiFetch(path: string, options?: RequestInit, requiresAuth = true): Promise<any> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options?.headers as Record<string, string>),
  };
  if (requiresAuth) {
    const token = await getToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    } else {
      console.warn(`[API] No auth token for ${path}`);
    }
  }

  const url = `${API_BASE}${path}`;
  console.log(`[API] ${options?.method || 'GET'} ${url}`);

  try {
    const res = await fetch(url, { ...options, headers });
    console.log(`[API] ${path} -> ${res.status}`);

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      let parsed: any = {};
      try { parsed = JSON.parse(errBody); } catch {}
      const message = parsed.error || parsed.message || `API error: ${res.status}`;
      console.error(`[API] Error ${res.status} on ${path}: ${message}`);
      const error = new Error(message);
      (error as any).status = res.status;
      throw error;
    }

    const text = await res.text();
    if (!text) return {};
    try {
      return JSON.parse(text);
    } catch {
      console.warn(`[API] Non-JSON response from ${path}`);
      return { raw: text };
    }
  } catch (err: any) {
    if (err?.status) throw err;
    console.error(`[API] Network error on ${path}:`, err?.message || err);
    throw new Error(`Network error: ${err?.message || 'Could not connect to server'}`);
  }
}

// ─── Auth API ────────────────────────────────────────────────────────────────

export const authApi = {
  login: (email: string, password: string) =>
    apiFetch('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }, false),

  register: (name: string, email: string, password: string, dateOfBirth?: string) =>
    apiFetch('/auth/register', { method: 'POST', body: JSON.stringify({ name, email, password, dateOfBirth }) }, false),

  logout: () => apiFetch('/auth/logout', { method: 'POST' }),

  getMe: () => apiFetch('/auth/me'),

  updateProfile: (profile: {
    trainingAge?: string;
    equipment?: string;
    heightCm?: number;
    weightKg?: number;
    constraintsText?: string;
  }) => apiFetch('/auth/profile', { method: 'PUT', body: JSON.stringify(profile) }),

  registerPushToken: (token: string) =>
    apiFetch('/auth/push-token', { method: 'PUT', body: JSON.stringify({ token }) }),
};

// ─── Lift Coach API ───────────────────────────────────────────────────────────

export const liftCoachApi = {
  createSession: (data: {
    selectedLift: string;
    goal?: string;
    trainingAge?: string;
    equipment?: string;
    heightCm?: number;
    weightKg?: number;
    constraintsText?: string;
  }) => apiFetch('/sessions', {
    method: 'POST',
    body: JSON.stringify({
      selectedLift: data.selectedLift,
      goal: data.goal,
      profile: {
        trainingAge: data.trainingAge,
        equipment: data.equipment,
        heightCm: data.heightCm,
        weightKg: data.weightKg,
        constraintsText: data.constraintsText,
      },
    }),
  }),

  addSnapshots: (sessionId: string, snapshots: Array<{
    exerciseId: string;
    weight: number;
    sets: number;
    reps: number;
    rpe?: number;
    date?: string;
  }>) => apiFetch(`/sessions/${sessionId}/snapshots`, {
    method: 'POST',
    body: JSON.stringify({ snapshots }),
  }),

  sendMessage: (sessionId: string, content: string) =>
    apiFetch(`/sessions/${sessionId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ message: content }),
    }),

  // Results-page chat (Assistants API thread, separate from diagnostic messages)
  sendResultsChat: (sessionId: string, content: string) =>
    apiFetch(`/sessions/${sessionId}/chat`, {
      method: 'POST',
      body: JSON.stringify({ message: content }),
    }),

  generatePlan: (sessionId: string) =>
    apiFetch(`/sessions/${sessionId}/generate`, { method: 'POST' }),

  getCachedPlan: (sessionId: string) =>
    apiFetch(`/sessions/${sessionId}/plan`),

  getSession: (sessionId: string) =>
    apiFetch(`/sessions/${sessionId}`),

  getSessionHistory: () => apiFetch('/sessions/history'),

  sharePlan: (sessionId: string) =>
    apiFetch(`/sessions/${sessionId}/share`, { method: 'POST' }),

  getPublicSession: (sessionId: string) =>
    apiFetch(`/sessions/${sessionId}/public`, {}, false),

  getExerciseVideo: (exerciseId: string) =>
    apiFetch(`/exercises/${exerciseId}/video`),
};

// ─── Coach API ────────────────────────────────────────────────────────────────

export const coachApi = {
  // Messages / chat thread
  getMessages: () => apiFetch('/coach/messages'),
  sendChat: (content: string) =>
    apiFetch('/coach/chat', { method: 'POST', body: JSON.stringify({ message: content }) }),
  deleteThread: () => apiFetch('/coach/thread', { method: 'DELETE' }),

  // Insights
  getInsights: () => apiFetch('/coach/insights'),

  // Program
  getProgram: () => apiFetch('/coach/program'),
  generateProgram: (data: any) =>
    apiFetch('/coach/program', { method: 'POST', body: JSON.stringify(data) }),
  updateProgram: (data: any) =>
    apiFetch('/coach/program', { method: 'PUT', body: JSON.stringify(data) }),
  adjustProgram: (data: any) =>
    apiFetch('/coach/adjust', { method: 'POST', body: JSON.stringify(data) }),
  applyAdjustment: (data: any) =>
    apiFetch('/coach/apply-adjustment', { method: 'POST', body: JSON.stringify(data) }),

  // Today / schedule
  getToday: () => apiFetch('/coach/today'),
  getSchedule: () => apiFetch('/coach/schedule'),

  // Nutrition
  generateNutritionPlan: (data: any) =>
    apiFetch('/coach/nutrition-plan', { method: 'POST', body: JSON.stringify(data) }),
  getMealSuggestions: (data: any) =>
    apiFetch('/coach/meal-suggestions', { method: 'POST', body: JSON.stringify(data) }),
  setNutritionBudget: (data: any) =>
    apiFetch('/coach/budget', { method: 'PUT', body: JSON.stringify(data) }),
  adjustNutrition: (data: any) =>
    apiFetch('/coach/nutrition-adjustment', { method: 'PUT', body: JSON.stringify(data) }),

  // Analytics / body weight
  getAnalytics: () => apiFetch('/coach/analytics'),
  logBodyWeight: (weightLbs: number, date?: string) =>
    apiFetch('/coach/body-weight', {
      method: 'POST',
      body: JSON.stringify({ weightLbs, date: date || new Date().toISOString().split('T')[0] }),
    }),
  getBodyWeight: () => apiFetch('/coach/body-weight'),

  // Wellness
  getWellnessCheckins: () => apiFetch('/wellness/checkins'),
  postCheckin: (data: {
    date?: string;
    mood?: number;
    energy?: number;
    sleepHours?: number;
    stress?: number;
    hrv?: number;
    notes?: string;
  }) => apiFetch('/wellness/checkin', {
    method: 'POST',
    body: JSON.stringify({
      date: data.date || new Date().toISOString().split('T')[0],
      mood: data.mood ?? 5,
      energy: data.energy ?? 5,
      sleepHours: data.sleepHours ?? 7,
      stress: data.stress ?? 5,
      ...(data.hrv !== undefined ? { hrv: data.hrv } : {}),
      ...(data.notes ? { notes: data.notes } : {}),
    }),
  }),

  // Payments
  getPaymentsStatus: () => apiFetch('/payments/status'),
  getPaymentsPortal: () => apiFetch('/payments/portal', { method: 'POST' }),

  // Strength profile
  getStrengthProfile: () => apiFetch('/strength/profile'),

  // Exercise video
  getExerciseVideo: (name: string) =>
    apiFetch(`/coach/exercise-video?name=${encodeURIComponent(name)}`),
};

// ─── Nutrition / Meal Logging API ─────────────────────────────────────────────

export const nutritionApi = {
  // Individual meal entries
  getMeals: (date?: string) =>
    apiFetch(`/nutrition/meals${date ? `?date=${date}` : ''}`),
  logMeal: (data: {
    date: string;
    name: string;
    mealType: 'breakfast' | 'lunch' | 'dinner' | 'snack' | 'meal';
    calories: number;
    proteinG: number;
    carbsG: number;
    fatG: number;
    notes?: string;
  }) => apiFetch('/nutrition/meals', { method: 'POST', body: JSON.stringify(data) }),
  deleteMeal: (id: string) =>
    apiFetch(`/nutrition/meals/${id}`, { method: 'DELETE' }),

  // History / aggregated daily data
  getHistory: (days?: number) =>
    apiFetch(`/nutrition/history${days ? `?days=${days}` : ''}`),

  // AI meal parser — describe a meal, get macros back
  parseMeal: (description: string) =>
    apiFetch('/nutrition/parse-meal', { method: 'POST', body: JSON.stringify({ description }) }),
};

// ─── Workouts API ─────────────────────────────────────────────────────────────

export const workoutsApi = {
  getWorkouts: () => apiFetch('/workouts'),
  getWorkoutByDate: (date: string) => apiFetch(`/workouts/${date}`),
  logWorkout: (data: {
    date: string;
    title?: string;
    exercises: Array<{
      name: string;
      sets: number;
      reps: string;
      weightKg?: number | null;
      rpe?: number | null;
      notes?: string | null;
    }>;
    notes?: string;
    duration?: number;
  }) => apiFetch('/workouts', { method: 'POST', body: JSON.stringify(data) }),
  deleteWorkout: (id: string) => apiFetch(`/workouts/${id}`, { method: 'DELETE' }),
};

