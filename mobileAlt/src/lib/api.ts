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

export async function apiFetch(path: string, options?: RequestInit, requiresAuth = true): Promise<any> {
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
  confirmProposal: (updatedProgram: any) =>
    apiFetch('/coach/agent/confirm-proposal', {
      method: 'POST', body: JSON.stringify({ updatedProgram }),
    }),
  // Messages / chat thread
  getMessages: () => apiFetch('/coach/messages'),
  // Try the agentic Anakin first; the backend allowlist (AGENT_USER_ALLOWLIST)
  // decides who gets it. A 404 means "not enabled for this user" → fall back
  // to the classic coach so everyone else is unaffected. Both endpoints return
  // a { reply } shape, so the chat UI doesn't change. The agent path can take
  // longer (it reads data + reasons), which the existing send spinner covers.
  sendChat: async (content: string) => {
    try {
      return await apiFetch('/coach/agent', { method: 'POST', body: JSON.stringify({ message: content }) });
    } catch (err: any) {
      if (err?.status === 404) {
        return apiFetch('/coach/chat', { method: 'POST', body: JSON.stringify({ message: content }) });
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
    apiFetch('/coach/program', { method: 'POST', body: JSON.stringify(data) }),
  updateProgram: (data: any) =>
    apiFetch('/coach/program', { method: 'PUT', body: JSON.stringify({ program: data }) }),
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
      body: JSON.stringify({ weightLbs, date: date || (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })() }),
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
    apiFetch('/nutrition/parse-meal', { method: 'POST', body: JSON.stringify({ description }) }),

  // Gemini vision — analyze a photo of a meal, get macros back
  analyzePhoto: (imageBase64: string, mimeType: string) =>
    apiFetch('/nutrition/analyze-photo', { method: 'POST', body: JSON.stringify({ imageBase64, mimeType }) }),

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
  }),

  /** Transcribe a voice recording. Powers the VoiceSheet. */
  transcribeAudio: (audioBase64: string, mimeType: string) =>
    apiFetch('/nutrition/transcribe', {
      method: 'POST',
      body: JSON.stringify({ audioBase64, mimeType }),
    }),

  // AI-generated nutrition profile (aggregates 90 days + LLM insights)
  getProfile: () => apiFetch('/nutrition/profile'),
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
  shareItem: (data: { recipientId?: string; itemType: string; itemId?: string; payload: object; caption?: string }) =>
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
  getFeed: (opts?: { fresh?: boolean; includeResearch?: boolean }) => {
    const params = new URLSearchParams();
    params.set('slim', '1');
    if (opts?.fresh) params.set('fresh', '1');
    if (opts?.includeResearch === false) params.set('include_research', '0');
    return apiFetch(`/social/feed?${params.toString()}`);
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
