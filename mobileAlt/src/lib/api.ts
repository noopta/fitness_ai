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
