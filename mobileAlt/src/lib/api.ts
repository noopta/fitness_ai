import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

let SecureStore: typeof import('expo-secure-store') | null = null;
if (Platform.OS !== 'web') {
  SecureStore = require('expo-secure-store');
}

const API_BASE = 'https://api.airthreads.ai/api';
const TOKEN_KEY = 'liftoff_auth_token';

/**
 * Default deadline for every request. Ordinary reads finish in well under a
 * second; anything past this is a stuck endpoint, and the user is better served
 * by a visible error than an indefinite spinner.
 */
const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * For endpoints that legitimately run long — LLM generation, vision, audio
 * transcription. These genuinely take tens of seconds, so the default deadline
 * would abort real work. Pass `{ timeoutMs: LONG_TIMEOUT_MS }` explicitly
 * rather than raising the default and losing the protection everywhere else.
 */
export const LONG_TIMEOUT_MS = 180_000;

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

export async function apiFetch(
  path: string,
  options?: RequestInit & { timeoutMs?: number },
  requiresAuth = true,
): Promise<any> {
  // RN's fetch has NO default timeout, so before this every endpoint except
  // /social/feed could hang a screen forever — no error, no retry, just an
  // infinite spinner. That is exactly how the 2026-08-03 incident presented:
  // the coach/nutrition/diagnostics tabs weren't failing, they were waiting.
  // Every request now gets a deadline; pass timeoutMs explicitly to widen it
  // for genuinely long operations (uploads, LLM generation).
  const { timeoutMs = DEFAULT_TIMEOUT_MS, ...fetchOptions } = options ?? {};
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(fetchOptions.headers as Record<string, string>),
  };
  if (requiresAuth) {
    const token = await getToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    } else {
      // No token for an auth-required endpoint: short-circuit instead of firing a
      // request that is guaranteed to 401. This silences the social-feed 401
      // spam on the signed-out onboarding screen without masking real failures
      // (getToken reads storage fresh each call, so authed users never hit this).
      const error = new Error('Authentication required');
      (error as any).status = 401;
      (error as any).skippedNoToken = true;
      throw error;
    }
  }

  const url = `${API_BASE}${path}`;
  console.log(`[API] ${fetchOptions.method || 'GET'} ${url}`);

  // Abort the request if it exceeds timeoutMs so a slow/stuck endpoint fails
  // fast with a clean error instead of hanging the screen. Pass timeoutMs: 0
  // to opt out entirely (nothing should, but streaming callers might).
  const controller = timeoutMs ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;

  try {
    const res = await fetch(url, {
      ...fetchOptions,
      headers,
      signal: controller?.signal ?? fetchOptions.signal,
    });
    console.log(`[API] ${path} -> ${res.status}`);

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      let parsed: any = {};
      try { parsed = JSON.parse(errBody); } catch {}
      const message = parsed.error || parsed.message || `API error: ${res.status}`;
      // 401 is an expected auth state (signed out / expired), not a code error —
      // log it quietly so it doesn't read as a red error in the console.
      if (res.status === 401) {
        console.log(`[API] ${path} -> 401 (auth required)`);
      } else {
        // 404s on optional resources (e.g. "no nutrition plan yet") are an
        // expected state, not an error — keep the console clean.
        if (res.status === 404 && (options as any)?.silent404) {
          console.log(`[API] ${path} -> 404 (expected: ${message})`);
        } else {
          console.error(`[API] Error ${res.status} on ${path}: ${message}`);
        }
      }
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
    if (err?.name === 'AbortError') {
      console.warn(`[API] ${path} timed out after ${timeoutMs}ms`);
      const e: any = new Error('Request timed out. Please try again.');
      e.status = 0;
      e.timedOut = true;
      throw e;
    }
    console.error(`[API] Network error on ${path}:`, err?.message || err);
    throw new Error(`Network error: ${err?.message || 'Could not connect to server'}`);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// ─── Auth API ────────────────────────────────────────────────────────────────

export interface AuthSuccess {
  user: { id: string; name: string | null; email: string | null; tier: string };
  token: string;
  alreadyVerified?: boolean;
}
export interface AuthVerifyPending {
  requiresVerification: true;
  email: string;
  codeSent?: boolean;
  message?: string;
}
export type RegisterOrLoginResult = AuthSuccess | AuthVerifyPending;

// Type guard the screens use to fork between routing into the app vs into
// the verify-email flow.
export function isVerifyPending(r: any): r is AuthVerifyPending {
  return !!r?.requiresVerification && typeof r?.email === 'string';
}

export const authApi = {
  login: (email: string, password: string): Promise<RegisterOrLoginResult> =>
    apiFetch('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }, false),

  register: (name: string, email: string, password: string, dateOfBirth?: string): Promise<RegisterOrLoginResult> =>
    apiFetch('/auth/register', { method: 'POST', body: JSON.stringify({ name, email, password, dateOfBirth }) }, false),

  // 6-digit OTP confirmation for email+password signups. Returns the same
  // AuthSuccess shape as login/register-after-verification so the caller
  // can route into the app immediately.
  verifyEmail: (email: string, code: string): Promise<AuthSuccess> =>
    apiFetch('/auth/verify-email', { method: 'POST', body: JSON.stringify({ email, code }) }, false),

  resendVerification: (email: string): Promise<{ sent: boolean; cooldownRemainingSec?: number; reason?: string }> =>
    apiFetch('/auth/resend-verification', { method: 'POST', body: JSON.stringify({ email }) }, false),

  logout: () => apiFetch('/auth/logout', { method: 'POST' }),

  getMe: () => apiFetch('/auth/me'),

  // C.3: total registered user count, used as social proof on the signup
  // screen. Cached server-side for 60s so a hot auth screen doesn't hammer
  // Prisma. Returns 0 on any failure so the caller can fall through gracefully.
  userCount: async (): Promise<number> => {
    try {
      const r = await apiFetch('/auth/user-count', undefined, false) as { count?: number };
      return typeof r?.count === 'number' ? r.count : 0;
    } catch { return 0; }
  },

  updateProfile: (profile: {
    trainingAge?: string;
    equipment?: string;
    heightCm?: number;
    weightKg?: number;
    constraintsText?: string;
    coachGoal?: string;
    coachBudget?: string;
    coachOnboardingDone?: boolean;
    coachProfile?: string;
    subtractWorkoutBurnFromCalories?: boolean;
    unitPreference?: 'metric' | 'imperial';
    foodRegion?: 'global' | 'ng' | 'gm' | 'wa';
  }) => apiFetch('/auth/profile', { method: 'PUT', body: JSON.stringify(profile) }),

  registerPushToken: (token: string) =>
    apiFetch('/auth/push-token', { method: 'PUT', body: JSON.stringify({ token }) }),

  checkUsername: (username: string) =>
    apiFetch(`/auth/check-username?username=${encodeURIComponent(username)}`),

  setUsername: (username: string) =>
    apiFetch('/auth/username', { method: 'PUT', body: JSON.stringify({ username }) }),

  setAvatar: (avatarBase64: string) =>
    apiFetch('/auth/avatar', { method: 'PUT', body: JSON.stringify({ avatarBase64 }) }),

  setDob: (dateOfBirth: string) =>
    apiFetch('/auth/set-dob', { method: 'POST', body: JSON.stringify({ dateOfBirth }) }),

  deleteAccount: () =>
    apiFetch('/auth/account', { method: 'DELETE' }),
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
      timeoutMs: LONG_TIMEOUT_MS,
    }),

  // Results-page chat (Assistants API thread, separate from diagnostic messages)
  sendResultsChat: (sessionId: string, content: string) =>
    apiFetch(`/sessions/${sessionId}/chat`, {
      method: 'POST',
      body: JSON.stringify({ message: content }),
      timeoutMs: LONG_TIMEOUT_MS,
    }),

  generatePlan: (sessionId: string) =>
    apiFetch(`/sessions/${sessionId}/generate`, { method: 'POST' }),

  getCachedPlan: (sessionId: string) =>
    apiFetch(`/sessions/${sessionId}/plan`),

  getSession: (sessionId: string) =>
    apiFetch(`/sessions/${sessionId}`),

  getSessionHistory: () => apiFetch('/sessions/history'),

  deleteSession: (sessionId: string) =>
    apiFetch(`/sessions/${sessionId}`, { method: 'DELETE' }),

  sharePlan: (sessionId: string) =>
    apiFetch(`/sessions/${sessionId}/share`, { method: 'POST' }),

  getPublicSession: (sessionId: string) =>
    apiFetch(`/sessions/${sessionId}/public`, {}, false),

  getExerciseVideo: (exerciseId: string) =>
    apiFetch(`/exercises/${exerciseId}/video`),
};

// ─── Coach API ────────────────────────────────────────────────────────────────

// ─── Group Chats (#4) ─────────────────────────────────────────────────────
// Backend routes are AGENT_ENABLED-gated; calls fail (404) when off, which
// mirrors the agent gating pattern. Designed for the Groups list/create/chat
// screens.
export const groupsApi = {
  list: () => apiFetch('/groups'),
  create: (data: {
    name: string;
    groupGoal?: string;
    memberUsernames?: string[];
    selfGoal?: string;
    anakinDailyEnabled?: boolean;
  }) => apiFetch('/groups', { method: 'POST', body: JSON.stringify(data) }),
  get: (id: string) => apiFetch(`/groups/${id}`),
  postMessage: (id: string, text: string) =>
    apiFetch(`/groups/${id}/messages`, { method: 'POST', body: JSON.stringify({ text }) }),
  patch: (id: string, data: { groupGoal?: string | null; anakinDailyEnabled?: boolean; selfGoal?: string | null; name?: string }) =>
    apiFetch(`/groups/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  leave: (id: string) => apiFetch(`/groups/${id}/leave`, { method: 'POST' }),
  // Manual trigger for testing Anakin's morning check-in. ?dryRun=1 returns
  // the draft without posting.
  anakinCheckin: (id: string, dryRun = false) =>
    apiFetch(`/groups/${id}/anakin-checkin${dryRun ? '?dryRun=1' : ''}`, { method: 'POST' }),
};

export const coachApi = {
  // Whether the agentic Anakin is available for this user (flag + allowlist).
  // Drives visibility of "Apply to my plan" affordances. Returns
  // { available: false } gracefully if the agent surface is off (404).
  agentStatus: async (): Promise<{ available: boolean }> => {
    try {
      return await apiFetch('/coach/agent/status');
    } catch {
      return { available: false };
    }
  },
  // Apply a Strength/Nutrition suggestion to the user's real plan.
  // For PROGRAM changes, the agent returns a `proposal` (no DB write yet) and
  // the client renders a side-by-side diff; the user taps Confirm and we call
  // confirmProposal to actually persist. For NUTRITION changes (adjust_macros)
  // the agent applies directly and `proposal` will be absent — the existing
  // single-step UX still works.
  applySuggestion: (suggestion: string): Promise<{
    reply: string;
    proposal?: {
      kind: 'program_update';
      updatedProgram: any;
      summary: string;
      changedDays?: string[];
    };
  }> =>
    apiFetch('/coach/agent/task/apply_suggestion', {
      method: 'POST', body: JSON.stringify({ input: suggestion }),
    }),
  // Persist a proposed program update (the second half of the propose →
  // confirm "Apply to my plan" flow). No LLM call — just the goal-preserving
  // validation + write path.
  // Accepts either { updatedProgram } (program_update kind) or
  // { proposedWeek, reason? } (workout_swap kind). Backend route
  // discriminates on which field is present.
  confirmProposal: (
    payload:
      | any
      | { updatedProgram: any }
      | { proposedWeek: any[]; reason?: string }
  ) => {
    const body =
      payload && (payload.updatedProgram || payload.proposedWeek)
        ? payload
        : { updatedProgram: payload };
    return apiFetch('/coach/agent/confirm-proposal', {
      method: 'POST', body: JSON.stringify(body),
    });
  },
  // Messages / chat thread
  getMessages: () => apiFetch('/coach/messages'),
  // Try the agentic Anakin first; the backend allowlist (AGENT_USER_ALLOWLIST)
  // decides who gets it. A 404 means "not enabled for this user" → fall back
  // to the classic coach so everyone else is unaffected. Both endpoints return
  // a { reply } shape, so the chat UI doesn't change. The agent path can take
  // longer (it reads data + reasons), which the existing send spinner covers.
  sendChat: async (content: string) => {
    try {
      return await apiFetch('/coach/agent', { method: 'POST', body: JSON.stringify({ message: content }), timeoutMs: LONG_TIMEOUT_MS });
    } catch (err: any) {
      if (err?.status === 404) {
        return apiFetch('/coach/chat', { method: 'POST', body: JSON.stringify({ message: content }), timeoutMs: LONG_TIMEOUT_MS });
      }
      throw err;
    }
  },
  deleteThread: () => apiFetch('/coach/thread', { method: 'DELETE' }),

  // Insights
  getInsights: () => apiFetch('/coach/insights'),

  // Program
  getProgram: () => apiFetch('/coach/program'),
  // Finished-programs archive: history of prior programs with stats.
  getCompletedPrograms: () => apiFetch('/coach/completed-programs'),
  getCompletedProgram: (id: string) => apiFetch(`/coach/completed-programs/${id}`),
  generateProgram: (data: any) =>
    apiFetch('/coach/program', { method: 'POST', body: JSON.stringify(data), timeoutMs: LONG_TIMEOUT_MS }),
  updateProgram: (data: any) =>
    apiFetch('/coach/program', { method: 'PUT', body: JSON.stringify({ program: data }) }),
  adjustProgram: (data: any) =>
    apiFetch('/coach/adjust', { method: 'POST', body: JSON.stringify(data), timeoutMs: LONG_TIMEOUT_MS }),
  applyAdjustment: (data: any) =>
    apiFetch('/coach/apply-adjustment', { method: 'POST', body: JSON.stringify(data) }),

  // Today / schedule
  getToday: () => apiFetch('/coach/today'),
  getSchedule: () => apiFetch('/coach/schedule'),
  // Swap today's workout with another day's, then re-balance the week (LLM).
  swapDay: (data: { date: string; sourceDate: string }) =>
    apiFetch('/coach/swap-day', { method: 'POST', body: JSON.stringify(data) }),
  applyWeekPlan: (data: { week: Array<{ date: string; session: any; locked?: boolean }>; reason?: string }) =>
    apiFetch('/coach/apply-week-plan', { method: 'POST', body: JSON.stringify(data) }),

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
  // Body weight is stored canonically in kilograms. Callers convert the user's
  // typed value via useUnits().toKg() before calling this. (Legacy weightLbs is
  // still accepted by the backend, but new code sends weightKg.)
  logBodyWeight: (weightKg: number, date?: string) =>
    apiFetch('/coach/body-weight', {
      method: 'POST',
      body: JSON.stringify({ weightKg, date: date || (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })() }),
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
      date: data.date || (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })(),
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

  // Welcome message
  getWelcomeMessage: () => apiFetch('/coach/welcome'),
  dismissWelcomeMessage: () => apiFetch('/coach/welcome/dismiss', { method: 'POST' }),

  // Exercise video
  getExerciseVideo: (name: string) =>
    apiFetch(`/coach/exercise-video?name=${encodeURIComponent(name)}`),
};

// ─── Nutrition / Meal Logging API ─────────────────────────────────────────────

export interface SavedFoodItem {
  id: string;
  name: string;
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  source?: string;
  useCount?: number;
  /** Stored micronutrients (server returns them; shown on the confirm sheet). */
  nutrients?: Record<string, number>;
}

export interface RecipeItemInput {
  name: string;
  quantity?: string;
  // Whole-recipe macro contribution of this ingredient (NOT per serving) —
  // the backend sums these and divides by servings.
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
}

export interface RecipeSummary {
  id: string;
  name: string;
  servings: number;
  // Per-serving totals, denormalized server-side.
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  items: RecipeItemInput[];
  useCount: number;
  /** Per-serving micronutrients, denormalized server-side. */
  nutrients?: Record<string, number>;
}

export interface ParsedRecipeResult {
  name: string;
  servings: number;
  items: Array<Required<RecipeItemInput>>;
  /** Estimated totals for the whole recipe; divided by servings when saved. */
  nutrients: Record<string, number>;
  confidence: 'high' | 'medium' | 'low';
  notes: string;
}

export interface BarcodeLookupResult {
  code: string;
  name: string;
  brand: string | null;
  imageUrl: string | null;
  per100g: {
    calories: number;
    proteinG: number;
    carbsG: number;
    fatG: number;
    fiberG: number | null;
    sugarG: number | null;
    sodiumMg: number | null;
    saturatedFatG?: number | null;
    cholesterolMg?: number | null;
    ironMg?: number | null;
    calciumMg?: number | null;
    magnesiumMg?: number | null;
    potassiumMg?: number | null;
    zincMg?: number | null;
    vitaminCMg?: number | null;
    vitaminB12Mcg?: number | null;
    folateMcg?: number | null;
  };
  servingSize: string | null;
  servingQuantityG: number | null;
  // 'community' = read from a nutrition label another user photographed after
  // an OpenFoodFacts miss. Same shape, so callers need no branching.
  source: 'openfoodfacts' | 'community';
  verified?: boolean;
}

export const nutritionApi = {
  // Look up a UPC/EAN/GTIN barcode in OpenFoodFacts. Throws on 404 (barcode
  // not in DB) — caller should fall through to manual entry / LLM parse.
  lookupBarcode: (code: string): Promise<BarcodeLookupResult> =>
    apiFetch(`/nutrition/barcode/${encodeURIComponent(code)}`),

  // Recover from a barcode miss: the user photographs the nutrition panel and
  // we read it. The result is cached globally, so the next person to scan that
  // product gets it instantly — this is how coverage gets built for Nigerian
  // and Gambian goods OpenFoodFacts doesn't carry.
  scanNutritionLabel: (
    code: string, imageBase64: string, mimeType: string,
  ): Promise<BarcodeLookupResult> =>
    apiFetch(`/nutrition/barcode/${encodeURIComponent(code)}/label`, {
      method: 'POST',
      body: JSON.stringify({ imageBase64, mimeType }),
    }),

  // SavedFood library — every meal logged via POST /nutrition/meals
  // auto-upserts into this library on the backend, so this returns the
  // user's full log history of food names + macros + use counts. Used by
  // the Manual-entry autocomplete and other quick-log surfaces.
  // `q` filters by normalized name match; empty = recent-by-useCount.
  // `recipes` rides along in the same response (additive key) so quick-log
  // surfaces can show one unified library of foods + saved recipes.
  searchFoods: (q: string, limit = 20): Promise<{ foods: SavedFoodItem[]; recipes?: RecipeSummary[] }> =>
    apiFetch(`/nutrition/foods?q=${encodeURIComponent(q)}&limit=${limit}`),

  // ── Recipes — MyFitnessPal-style saved dishes ──────────────────────────
  // A recipe = name + servings + ingredient list; backend stores per-serving
  // macros. Logging snapshots servings × per-serving into a normal MealEntry,
  // so editing a recipe never rewrites past logs.
  getRecipes: (q = '', limit = 50): Promise<{ recipes: RecipeSummary[] }> =>
    apiFetch(`/nutrition/recipes?q=${encodeURIComponent(q)}&limit=${limit}`),
  createRecipe: (data: { name: string; servings: number; items: RecipeItemInput[]; nutrients?: Record<string, number> }): Promise<RecipeSummary> =>
    apiFetch('/nutrition/recipes', { method: 'POST', body: JSON.stringify(data) }),
  updateRecipe: (id: string, data: { name: string; servings: number; items: RecipeItemInput[]; nutrients?: Record<string, number> }): Promise<RecipeSummary> =>
    apiFetch(`/nutrition/recipes/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteRecipe: (id: string) =>
    apiFetch(`/nutrition/recipes/${id}`, { method: 'DELETE' }),
  logRecipe: (id: string, data: { date: string; mealType: 'breakfast' | 'lunch' | 'dinner' | 'snack' | 'meal'; servings: number }) =>
    apiFetch(`/nutrition/recipes/${id}/log`, { method: 'POST', body: JSON.stringify(data) }),
  // AI recipe parser — paste/dictate a whole recipe, get structured
  // per-ingredient macros back for review in the builder. Shares the
  // free-tier daily AI quota with parseMeal/analyzePhoto.
  parseRecipe: (description: string, servings?: number): Promise<ParsedRecipeResult> =>
    apiFetch('/nutrition/recipes/parse', {
      method: 'POST',
      body: JSON.stringify({ description, ...(servings ? { servings } : {}) }),
    }),

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
    // Rich fields — forward these from the parse response so the Nutrition
    // Profile effects engine has the full nutrient vector to read. All
    // optional; omitting them logs a bare macro entry as before.
    ingredients?: string[];
    tags?: string[];
    nutrients?: Record<string, unknown>;
    source?: 'manual' | 'text' | 'photo' | 'saved_food' | 'recipe' | 'barcode';
    parseConfidence?: 'high' | 'medium' | 'low';
    nutrientMap?: Record<string, number>;
    ingredientNutrients?: Array<{ name: string; nutrients: Record<string, number> }>;
    // Gut-health enrichment (gut-health feature; server defaults all)
    plants?: string[];
    fermentedFoods?: string[];
    ultraProcessed?: boolean;
  }) => apiFetch('/nutrition/meals', { method: 'POST', body: JSON.stringify(data) }),
  deleteMeal: (id: string) =>
    apiFetch(`/nutrition/meals/${id}`, { method: 'DELETE' }),

  /**
   * Partial update of an existing meal entry. Replaces the
   * delete-then-re-log workaround MealEditSheet used in v1 — keeps the
   * row's id, createdAt, and saved-food backlinks intact.
   */
  updateMeal: (id: string, data: Partial<{
    name: string;
    mealType: 'breakfast' | 'lunch' | 'dinner' | 'snack' | 'meal';
    calories: number;
    proteinG: number;
    carbsG: number;
    fatG: number;
    notes: string | null;
  }>) => apiFetch(`/nutrition/meals/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  }),

  // History / aggregated daily data
  getHistory: (days?: number) =>
    apiFetch(`/nutrition/history${days ? `?days=${days}` : ''}`),

  // AI meal parser — describe a meal, get macros back
  parseMeal: (description: string) =>
    apiFetch('/nutrition/parse-meal', { method: 'POST', body: JSON.stringify({ description }), timeoutMs: LONG_TIMEOUT_MS }),

  // Gemini vision — analyze a photo of a meal, get macros back
  analyzePhoto: (imageBase64: string, mimeType: string) =>
    apiFetch('/nutrition/analyze-photo', { method: 'POST', body: JSON.stringify({ imageBase64, mimeType }), timeoutMs: LONG_TIMEOUT_MS }),

  /**
   * Anakin-ranked meal suggestions tailored to today's remaining macros.
   * Powers the SuggestSheet — server-side LLM scoring beats the v1 static
   * template ranker because it can pull goal/budget context the client
   * doesn't have.
   */
  suggestMeals: (input: {
    remaining: { kcal: number; protein: number; carbs: number; fat: number };
    slot?: 'breakfast' | 'lunch' | 'dinner' | 'snack' | 'meal' | null;
  }) => apiFetch('/nutrition/suggest-meals', {
    method: 'POST',
    body: JSON.stringify(input),
    timeoutMs: LONG_TIMEOUT_MS,
  }),

  /** Transcribe a voice recording. Powers the VoiceSheet. */
  transcribeAudio: (audioBase64: string, mimeType: string) =>
    apiFetch('/nutrition/transcribe', {
      method: 'POST',
      body: JSON.stringify({ audioBase64, mimeType }),
      timeoutMs: LONG_TIMEOUT_MS,
    }),

  // AI-generated nutrition profile (aggregates 90 days + LLM insights)
  getProfile: () => apiFetch('/nutrition/profile', { timeoutMs: LONG_TIMEOUT_MS }),

  // ── Gut-health feature (2026-07) ──
  getAssessment: () => apiFetch('/nutrition/assessment'),
  saveAssessment: (assessment: Record<string, unknown>) =>
    apiFetch('/nutrition/assessment', { method: 'POST', body: JSON.stringify(assessment) }),
  generateNutritionPlan: () =>
    apiFetch('/nutrition/plan/generate', { method: 'POST', timeoutMs: LONG_TIMEOUT_MS }),
  getNutritionPlan: () => apiFetch('/nutrition/plan', { silent404: true } as any),
  getMicrosDaily: (date?: string) =>
    apiFetch(`/nutrition/micros/daily${date ? `?date=${date}` : ''}`),
  getGutWeek: (end?: string) =>
    apiFetch(`/nutrition/gut/week${end ? `?end=${end}` : ''}`),
  scanOrder: (imageBase64: string, mimeType: string) =>
    apiFetch('/nutrition/order-scan', { method: 'POST', body: JSON.stringify({ imageBase64, mimeType }), timeoutMs: LONG_TIMEOUT_MS }),
  logOrder: (data: {
    date?: string; mealType?: string; vendor?: string | null;
    items: Array<Record<string, unknown>>;
  }) => apiFetch('/nutrition/order-log', { method: 'POST', body: JSON.stringify(data) }),
};

// ─── Nutrition Profile (effects-first, Strength → Nutrition) ──────────────────
// Read-only companion to the Strength Profile. Consumes the deterministic
// body-system engine; logging still lives in Coach → Nutrition.

export type NpStatus = 'ok' | 'warn' | 'low';

// Which window the profile describes. For 7d/30d every figure is the MEAN DAILY
// intake across the window's LOGGED days — unlogged days are excluded, not
// counted as zero. That's why the client must relabel "kcal logged" as a daily
// rate: the number is a per-day average, not a window total.
export type NpRange = 'today' | '7d' | '30d';

// Fields every ranged endpoint echoes back. `range` is load-bearing: backend
// and mobile ship independently, so a new build against an old server would
// otherwise render today's numbers under a "30 days" pill. Callers compare it
// against what they asked for and refuse the mismatch.
export interface NpWindowMeta {
  range?: NpRange;
  windowDays?: number;
  startDate?: string;
  endDate?: string;
  loggedDays?: number;
  partialDays?: number;
  avgDaily?: boolean;
  daysOverCeiling?: Record<string, number>;
}

export interface NpWindowDay {
  date: string;
  logged: boolean;
  mealCount: number;
  kcal: number;
}

export interface NpSystem {
  id: 'recovery' | 'cognition' | 'energy' | 'sleep' | 'mood';
  name: string;
  status: NpStatus;
  score: number;
  driver: string;
  chips: string[];
}

export interface NpDayProfile extends NpWindowMeta {
  date: string;
  hasData: boolean;
  mealsLogged: number;
  kcalLogged?: number;
  microCoveragePct?: number;
  profileScore?: number;
  profileScoreProvisional?: boolean;
  headline?: string;
  systems?: NpSystem[];
  topMove?: { title: string; mechanism: string; gain: string } | null;
  // `meals` on today only; `days` on 7d/30d — a month of undifferentiated meal
  // rows is neither readable nor a bounded payload.
  meals?: Array<{ id: string; name: string; mealType: string; calories: number }>;
  days?: NpWindowDay[];
  // Scoring averaged intake is NOT the same as averaging per-day scores (1650/0
  // choline → 100% vs 50%). The hero shows the former as "your typical day";
  // these are the latter, matching what the trend chart's bars average to.
  meanDailyProfileScore?: number;
  meanDailyCoveragePct?: number;
  extras?: Array<{ key: string; amount: number }>;
}

export interface NpDriverLine {
  key: string; label: string; unit: string;
  amount: number; target: number; pct: number; status: NpStatus; tracked: boolean;
}

export interface NpEffectDetail extends NpWindowMeta {
  systemId: string; name: string; status: NpStatus; score: number;
  summary: string; drivers: NpDriverLine[]; mechanisms: string[]; watchFor: string | null;
  hasData?: boolean;
  // Ceiling nutrients are exposure, not a mean — an averaged sodium figure that
  // reads "ok" can still hide a 4600 mg day, so the spikes are counted per day.
  ceilingSpikes?: Array<{ key: string; label: string; days: number }>;
}

export interface NpNutrientDetail extends NpWindowMeta {
  key: string; label: string; tag: string | null; unit: string;
  current: string; target: string; pct: number; status: NpStatus; ceiling: boolean;
  chain: Array<{ title: string; body: string }>;
  why: string;
  sources: Array<{ food: string; amount: string }>;
  recommendation: string;
  watchFor: string | null;
}

export interface NpMealBreakdown {
  id: string; name: string; mealType: string; kcal: number; loggedAt: string;
  macros: { proteinG: number; carbsG: number; fatG: number };
  ingredients: Array<{ name: string; resolved: boolean; chips: string[] }>;
}

export interface NpTrend {
  range: string;
  // One entry per calendar day in the window. `logged: false` = nothing logged
  // that day (render a gap, not a 0% bar — they mean different things).
  series: Array<{ date: string; coveragePct: number; profileScore: number; logged: boolean }>;
  consistency: Array<{ key: string; label: string; pctDaysOnTarget: number }>;
  loggedDays: number;
  partialDays?: number;
  daysOverCeiling?: Record<string, number>;
}

export interface NpRecommendation {
  name: string; serving: string; category: string; gain: string; mechanism: string;
  prefill: { name: string; source: string };
}

// `date` always anchors the window's END and is the caller's LOCAL day (see
// localDate.ts) — anchoring on the server's UTC day would hide meals logged
// this evening. `range` defaults to today server-side, so it's only sent when
// it's actually a window; that keeps the today request byte-identical to what
// older builds send.
function npQuery(date?: string, range: NpRange = 'today'): string {
  const parts: string[] = [];
  if (date) parts.push(`date=${date}`);
  if (range !== 'today') parts.push(`range=${range}`);
  return parts.length ? `?${parts.join('&')}` : '';
}

export const nutritionProfileApi = {
  getDay: (date?: string, range: NpRange = 'today'): Promise<NpDayProfile> =>
    apiFetch(`/nutrition-profile${npQuery(date, range)}`),
  getEffect: (systemId: string, date?: string, range: NpRange = 'today'): Promise<NpEffectDetail> =>
    apiFetch(`/nutrition-profile/effect/${systemId}${npQuery(date, range)}`),
  getNutrient: (key: string, date?: string, range: NpRange = 'today'): Promise<NpNutrientDetail> =>
    apiFetch(`/nutrition-profile/nutrient/${key}${npQuery(date, range)}`),
  getMeal: (mealId: string): Promise<NpMealBreakdown> =>
    apiFetch(`/nutrition-profile/meal/${mealId}`),
  getTrend: (range: '7d' | '30d' = '7d', date?: string): Promise<NpTrend> =>
    apiFetch(`/nutrition-profile/trend?range=${range}${date ? `&date=${date}` : ''}`),
  getRecommendations: (date?: string, range: NpRange = 'today'): Promise<{ date: string; recommendations: NpRecommendation[] } & NpWindowMeta> =>
    apiFetch(`/nutrition-profile/recommendations${npQuery(date, range)}`),
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
      // True for unloaded movements (abs, push-ups, etc.). Lets progress be
      // tracked by reps rather than load.
      bodyweight?: boolean;
      // Per-set breakdown, used when weights/reps vary across sets within
      // the same exercise (e.g. 135x4 → 100x8 → 100x8). When present, the
      // backend uses this for e1RM / strength-profile signals; the top-level
      // weightKg/reps are kept as a summary of the top set.
      setEntries?: Array<{
        weightKg?: number | null;
        reps: number;
        rpe?: number | null;
      }>;
    }>;
    notes?: string;
    duration?: number;
  }) => apiFetch('/workouts', { method: 'POST', body: JSON.stringify(data) }),
  deleteWorkout: (id: string) => apiFetch(`/workouts/${id}`, { method: 'DELETE' }),
};

// ─── Social API ───────────────────────────────────────────────────────────────

/**
 * Put deduplicated avatars back onto the inline author objects.
 *
 * The feed sends each distinct author once in an `authors` map rather than
 * repeating an ~84 KB avatarBase64 on every post and every comment. Restoring
 * them here means the rest of the app sees exactly the shape it always has,
 * so the saving is purely on the wire and no component had to change.
 *
 * Tolerant by design: an old server that doesn't send `authors` falls straight
 * through, and an author missing from the map keeps whatever it already had.
 */
export function rehydrateAuthors(res: any): any {
  const authors = res?.authors;
  if (!authors || !Array.isArray(res?.items)) return res;

  const fill = (person: any) => {
    if (!person?.id) return;
    if (person.avatarBase64 == null) {
      const known = authors[person.id];
      if (known?.avatarBase64 != null) person.avatarBase64 = known.avatarBase64;
    }
  };

  for (const item of res.items) {
    if (item?.kind !== 'post') continue;
    fill(item.data?.sharer);
    for (const c of item.data?.comments ?? []) fill(c?.author);
  }
  return res;
}

export const socialApi = {
  // Notification badge counts (unread DMs + pending friend requests)
  getNotificationCounts: () => apiFetch('/social/notifications/counts'),

  // Leaderboard
  getLeaderboard: (lift: string) => apiFetch(`/social/leaderboard?lift=${encodeURIComponent(lift)}`),
  getLeaderboardLifts: () => apiFetch('/social/leaderboard/lifts'),

  // Friends
  getFriends: () => apiFetch('/social/friends'),
  getFriendRequests: () => apiFetch('/social/friends/requests'),
  sendFriendRequest: (targetUserId: string) =>
    apiFetch('/social/friends/request', { method: 'POST', body: JSON.stringify({ targetUserId }) }),
  acceptFriendRequest: (requesterId: string) =>
    apiFetch('/social/friends/accept', { method: 'POST', body: JSON.stringify({ requesterId }) }),
  declineFriendRequest: (requesterId: string) =>
    apiFetch('/social/friends/decline', { method: 'POST', body: JSON.stringify({ requesterId }) }),
  removeFriend: (userId: string) => apiFetch(`/social/friends/${userId}`, { method: 'DELETE' }),
  blockUser: (targetUserId: string) =>
    apiFetch('/social/friends/block', { method: 'POST', body: JSON.stringify({ targetUserId }) }),

  // User search
  searchUsers: (q: string) => apiFetch(`/social/users/search?q=${encodeURIComponent(q)}`),

  // Conversations
  getConversations: () => apiFetch('/social/conversations'),
  createConversation: (participantId: string) =>
    apiFetch('/social/conversations', { method: 'POST', body: JSON.stringify({ participantId }) }),
  getMessages: (conversationId: string, limit?: number, before?: string) =>
    apiFetch(`/social/conversations/${conversationId}/messages?limit=${limit ?? 50}${before ? `&before=${before}` : ''}`),
  sendMessage: (conversationId: string, body: string) =>
    apiFetch(`/social/conversations/${conversationId}/messages`, { method: 'POST', body: JSON.stringify({ body }) }),
  markRead: (conversationId: string) =>
    apiFetch(`/social/conversations/${conversationId}/read`, { method: 'POST' }),
  pollMessages: (conversationId: string, after?: string) =>
    apiFetch(`/social/conversations/${conversationId}/poll${after ? `?after=${after}` : ''}`),

  // Sharing
  shareItem: (data: { recipientId?: string; itemType: string; itemId?: string; payload: object; caption?: string; visibility?: 'friends' | 'public' }) =>
    apiFetch('/social/share', { method: 'POST', body: JSON.stringify(data) }),
  getSharedFeed: () => apiFetch('/social/shared-feed'),
  // Feed loader. Always sends `slim=1` so the backend strips inline
  // imageBase64 — PostCard knows to lazy-load via /posts/:id/image when it
  // sees `hasImage:true` instead of the raw blob. That alone cut the
  // response from ~11MB to ~4MB.
  //
  // includeResearch defaults to TRUE: research items should be in the feed
  // on every load. The Research button stays as a way to force-refresh
  // articles from PubMed, but is no longer the *only* way to see them.
  //
  // Also sends `authors=1`: the server hoists each distinct author into an
  // `authors` map instead of repeating their ~84 KB avatarBase64 on every post
  // and every comment. Measured on a real 35-item page: 53 blobs but only 3
  // distinct, so 3.45 MB of a 3.69 MB response was duplicate bytes.
  // rehydrateAuthors() puts the avatars back before anything downstream sees
  // the data, so PostCard and friends keep reading `sharer.avatarBase64` and
  // need no changes — the dedup exists only on the wire.
  getFeed: async (opts?: { fresh?: boolean; includeResearch?: boolean }) => {
    const params = new URLSearchParams();
    params.set('slim', '1');
    params.set('authors', '1');
    if (opts?.fresh) params.set('fresh', '1');
    if (opts?.includeResearch === false) params.set('include_research', '0');
    // 15s cap: the default (cached) feed returns in well under a second; if the
    // server is stuck, fail fast with a clean error instead of hanging the tab.
    const res = await apiFetch(`/social/feed?${params.toString()}`, { timeoutMs: 15000 });
    return rehydrateAuthors(res);
  },
  // Articles-only endpoint. Called when the user explicitly taps "Get fresh
  // research" — slower fetches are acceptable since the user opted in.
  getFeedArticles: (opts?: { fresh?: boolean }) =>
    apiFetch(`/social/feed/articles${opts?.fresh ? '?fresh=1' : ''}`),
  // Polled periodically to populate the Twitter-style "N new posts" pill.
  getNewPostCount: (afterIso: string) =>
    apiFetch(`/social/feed/new-count?after=${encodeURIComponent(afterIso)}`),

  // Saved articles
  saveArticle: (articleId: string) =>
    apiFetch(`/social/articles/${articleId}/save`, { method: 'POST' }),
  unsaveArticle: (articleId: string) =>
    apiFetch(`/social/articles/${articleId}/save`, { method: 'DELETE' }),
  getSavedArticles: () => apiFetch('/social/articles/saved'),
  forwardArticle: (articleId: string, recipientId: string, message?: string) =>
    apiFetch(`/social/articles/${articleId}/forward`, {
      method: 'POST',
      body: JSON.stringify({ recipientId, message }),
    }),

  // Reactions
  reactToPost: (postId: string) =>
    apiFetch(`/social/posts/${postId}/react`, { method: 'POST' }),

  // Lazy-load full image for a post (feed responses strip imageBase64)
  getPostImage: (postId: string) => apiFetch(`/social/posts/${postId}/image`),

  // Comments
  getComments: (postId: string) => apiFetch(`/social/posts/${postId}/comments`),
  addComment: (postId: string, text: string) =>
    apiFetch(`/social/posts/${postId}/comments`, { method: 'POST', body: JSON.stringify({ text }) }),

  // Forward (send to DM)
  forwardPost: (postId: string, recipientId: string, message?: string) =>
    apiFetch(`/social/posts/${postId}/forward`, { method: 'POST', body: JSON.stringify({ recipientId, message }) }),

  // Forward a workout (planned program day OR a logged session) to a friend's DM
  forwardWorkout: (
    recipientId: string,
    kind: 'planned' | 'logged',
    workout: Record<string, unknown>,
    note?: string,
  ) =>
    apiFetch('/social/workouts/forward', {
      method: 'POST',
      body: JSON.stringify({ recipientId, kind, workout, note }),
    }),

  // Invite
  getInviteLink: () => apiFetch('/social/invite'),

  // Delete own post
  deletePost: (postId: string) =>
    apiFetch(`/social/posts/${postId}`, { method: 'DELETE' }),

  // Content moderation (required by Apple App Store for UGC)
  reportPost: (itemId: string, reason: string) =>
    apiFetch('/social/report', { method: 'POST', body: JSON.stringify({ itemId, reason }) }),
};

// ─── Train Together API ───────────────────────────────────────────────────────
// Overlap finder + partner-workout pins. Schedules are only visible when both
// sides opted in (scheduleSharing) and the friendship is accepted.

export const trainTogetherApi = {
  getSharing: () => apiFetch('/train-together/sharing'),
  setSharing: (enabled: boolean) =>
    apiFetch('/train-together/sharing', { method: 'PUT', body: JSON.stringify({ enabled }) }),

  // Accepted friends annotated with selectability (sharing + has a program)
  getFriends: () => apiFetch('/train-together/friends'),

  // The overlap matrix for me + selected friends over the next N weeks
  getOverlap: (friendIds: string[], weeks: number = 2) =>
    apiFetch(`/train-together/overlap?friendIds=${friendIds.map(encodeURIComponent).join(',')}&weeks=${weeks}`),

  // Pins (planned shared workouts)
  createPin: (date: string, memberIds: string[], note?: string) =>
    apiFetch('/train-together/pins', { method: 'POST', body: JSON.stringify({ date, memberIds, note }) }),
  getPins: () => apiFetch('/train-together/pins'),
  getPin: (pinId: string) => apiFetch(`/train-together/pins/${pinId}`),
  respondToPin: (pinId: string, response: 'accepted' | 'declined') =>
    apiFetch(`/train-together/pins/${pinId}/respond`, { method: 'POST', body: JSON.stringify({ response }) }),
  deletePin: (pinId: string) => apiFetch(`/train-together/pins/${pinId}`, { method: 'DELETE' }),

  // "Ask" pill — nudge a friend who hasn't turned on sharing
  nudge: (friendId: string) =>
    apiFetch('/train-together/nudge', { method: 'POST', body: JSON.stringify({ friendId }) }),

  // Shared session ("Build us a shared workout", spec §10)
  buildSharedSession: (pinId: string) =>
    apiFetch(`/train-together/pins/${pinId}/shared-session`, { method: 'POST' }),
  respondSharedSession: (pinId: string, response: 'accepted' | 'declined') =>
    apiFetch(`/train-together/pins/${pinId}/shared-session/respond`, { method: 'POST', body: JSON.stringify({ response }) }),
};

// ─── Institution API ──────────────────────────────────────────────────────────

export const institutionApi = {
  getInstitution: (slug: string) => apiFetch(`/institutions/${slug}`),
  getMembers: (slug: string) => apiFetch(`/institutions/${slug}/members`),
  getAthletes: (slug: string) => apiFetch(`/institutions/${slug}/athletes`),
  getAthleteDetail: (slug: string, userId: string) =>
    apiFetch(`/institutions/${slug}/athletes/${userId}`),
  getCoachInfo: (slug: string) => apiFetch(`/institutions/${slug}/coach-info`),
  invite: (slug: string, data: { email?: string; role?: string; expiresIn?: number }) =>
    apiFetch(`/institutions/${slug}/invite`, { method: 'POST', body: JSON.stringify(data) }),
  validateInvite: (token: string) => apiFetch(`/institutions/invite/${token}`),
  claimInvite: (token: string) =>
    apiFetch(`/institutions/invite/${token}/claim`, { method: 'POST' }),
  messageAthlete: (slug: string, userId: string, body: string) =>
    apiFetch(`/institutions/${slug}/athletes/${userId}/message`, { method: 'POST', body: JSON.stringify({ body }) }),
};



// ─── Payments API ─────────────────────────────────────────────────────────────

export const paymentsApi = {
  // Returns Stripe publishable key — safe to expose to clients
  getConfig: () => apiFetch('/payments/config', {}, false),

  // Subscription state for rail-aware UI (tier + Stripe subStatus)
  getPaymentsStatus: () => apiFetch('/payments/status'),
  // Stripe Customer Portal session — swap card / cancel / invoices
  getPaymentsPortal: () => apiFetch('/payments/portal', { method: 'POST' }),

  // Creates a subscription and returns a PaymentIntent client_secret.
  // Pass promoCode to apply a Stripe Promotion Code discount (validated server-side).
  createSubscriptionIntent: (promoCode?: string) =>
    apiFetch('/payments/create-subscription-intent', {
      method: 'POST',
      body: JSON.stringify({ promoCode: promoCode ?? null }),
    }),
};

// ─── Multipart upload helper ────────────────────────────────────────────────
//
// apiFetch always sends Content-Type: application/json, which breaks
// multipart bodies (RN must set the multipart boundary itself). This is a
// thin sibling that attaches the Bearer token but lets fetch own the
// Content-Type for a FormData body. Used by form-video upload.
export async function apiUpload(path: string, form: FormData, extraHeaders?: Record<string, string>): Promise<any> {
  const headers: Record<string, string> = { ...(extraHeaders ?? {}) };
  const token = await getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const url = `${API_BASE}${path}`;
  console.log(`[API] POST(upload) ${url}`);
  // Form-video analysis can run 60-90s end-to-end (upload + GCS save +
  // Vertex Gemini inference). RN's default fetch timeout on iOS is 60s,
  // which was causing "Network req failed" 499s — extend to 3 min.
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 180_000);
  try {
    const res = await fetch(url, { method: 'POST', headers, body: form, signal: controller.signal });
    clearTimeout(timeoutId);
    console.log(`[API] ${path} -> ${res.status}`);
    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      let parsed: any = {};
      try { parsed = JSON.parse(errBody); } catch {}
      const message = parsed.error || parsed.message || `API error: ${res.status}`;
      const error = new Error(message);
      (error as any).status = res.status;
      (error as any).body = parsed;
      throw error;
    }
    const text = await res.text();
    return text ? JSON.parse(text) : {};
  } catch (err: any) {
    clearTimeout(timeoutId);
    if (err?.status) throw err;
    // Distinguish "timed out after 3 min" from a generic network failure so
    // the UI can show a helpful message rather than the lower-level error.
    if (err?.name === 'AbortError') {
      throw new Error('Upload timed out after 3 minutes. Try a shorter clip or a stronger connection.');
    }
    console.error(`[API] Upload network error on ${path}:`, err?.message || err);
    throw new Error(`Network error: ${err?.message || 'Could not upload'}`);
  }
}

// ─── Form-video analysis API ────────────────────────────────────────────────────

export interface FormWeakness { issue: string; severity: 'minor' | 'moderate' | 'major'; cue: string }
export interface FormDrill { name: string; why: string; setsReps?: string }
export interface WorkoutVideoAnalysis {
  exercise: string;
  formScore: number;
  repCount: number | null;
  strengths: string[];
  weaknesses: FormWeakness[];
  recommendedDrills: FormDrill[];
  programmingNotes: string[];
  safetyFlags: string[];
  summary: string;
}
export type FormAnalysisStatus = 'pending' | 'complete' | 'failed';

// Response to POST /form-analysis/video — the upload returns immediately
// with status='pending'. The client then polls GET /:id until the row's
// status transitions to 'complete' (with `analysis` populated) or 'failed'.
export interface FormAnalysisStarted {
  id: string;
  createdAt: string;
  status: 'pending';
  usage?: { feature: string; used: number; limit: number | null; remaining: number | null; resetAt: string };
}

// Response to GET /form-analysis/:id. `analysis` is meaningful only when
// status='complete'; `errorMessage` populated on 'failed'.
export interface FormAnalysisDetail {
  id: string;
  status: FormAnalysisStatus;
  errorMessage: string | null;
  exercise: string;
  formScore: number | null;
  repCount: number | null;
  exerciseHint: string | null;
  createdAt: string;
  analysis: WorkoutVideoAnalysis;
}

export interface FormAnalysisListItem {
  id: string;
  status: FormAnalysisStatus;
  exercise: string;
  formScore: number | null;
  repCount: number | null;
  createdAt: string;
}

export const formAnalysisApi = {
  /**
   * Kick off async form-video analysis. Uploads the clip, returns 202 with
   * the row id while the heavy Gemini analysis runs in the background.
   * `uri` is the local file URI from expo-image-picker (RN streams the
   * file off disk — no base64).
   */
  start: (
    uri: string,
    mimeType: string,
    exerciseHint?: string,
  ): Promise<FormAnalysisStarted> => {
    const form = new FormData();
    const ext = (mimeType.split('/')[1] || 'mp4').replace('quicktime', 'mov');
    form.append('video', { uri, name: `form.${ext}`, type: mimeType } as any);
    if (exerciseHint?.trim()) form.append('exerciseHint', exerciseHint.trim());
    // Opt into the async/poll flow — the backend defaults to the legacy
    // synchronous 200 for clients that don't send this header.
    return apiUpload('/form-analysis/video', form, { 'X-Form-Analysis-Async': '1' });
  },

  list: (): Promise<{ analyses: FormAnalysisListItem[] }> => apiFetch('/form-analysis'),

  get: (id: string): Promise<FormAnalysisDetail> => apiFetch(`/form-analysis/${id}`),

  /**
   * Poll GET /:id every `intervalMs` until status is terminal (complete or
   * failed) or the request runs past `timeoutMs`. Default 4s poll, 5min
   * timeout. `onTick` (optional) gets every intermediate status so the
   * caller can update progress UI as the upload moves through stages.
   * Resolves with the terminal detail; rejects on timeout/network error.
   */
  pollUntilDone: async (
    id: string,
    opts: { intervalMs?: number; timeoutMs?: number; onTick?: (s: FormAnalysisDetail) => void } = {},
  ): Promise<FormAnalysisDetail> => {
    const interval = opts.intervalMs ?? 4000;
    const timeout = opts.timeoutMs ?? 300_000; // 5 min hard ceiling
    const start = Date.now();
    while (true) {
      const detail = await apiFetch(`/form-analysis/${id}`) as FormAnalysisDetail;
      opts.onTick?.(detail);
      if (detail.status === 'complete' || detail.status === 'failed') return detail;
      if (Date.now() - start > timeout) {
        throw new Error('Analysis is taking longer than expected. Pull-to-refresh in a minute.');
      }
      await new Promise((r) => setTimeout(r, interval));
    }
  },
};
