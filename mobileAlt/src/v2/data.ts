// Data hooks for the v2 pages. Thin react-query wrappers over the existing
// API client so the new screens share caches with each other and the cost
// of a tab switch is a cache read.

import { useQuery, useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch, coachApi, nutritionApi, nutritionProfileApi, workoutsApi, socialApi, groupsApi, liftCoachApi, formAnalysisApi, authApi } from '../lib/api';
import { v2Api, type Brief, type TrainingOverview } from './api';
import { getCached, setCached } from '../lib/cache';
import { todayStr } from '../lib/localDate';
import { useAuth } from '../context/AuthContext';

const STALE = 60_000;

export const qk = {
  brief: ['v2', 'brief'] as const,
  program: ['v2', 'program'] as const,
  schedule: ['v2', 'schedule'] as const,
  today: ['v2', 'today'] as const,
  completed: ['v2', 'completed'] as const,
  strength: ['v2', 'strength'] as const,
  meals: (date?: string) => ['v2', 'meals', date ?? 'today'] as const,
  npDay: ['v2', 'np', 'day'] as const,
  npEffect: (id: string) => ['v2', 'np', 'effect', id] as const,
  npNutrient: (key: string) => ['v2', 'np', 'nutrient', key] as const,
  // Under 'np' so a logged meal refreshes the plan's coverage.
  nutritionPlan: ['v2', 'np', 'plan'] as const,
  feed: ['v2', 'feed'] as const,
  feedPages: ['v2', 'feed', 'pages'] as const,
  socialCounts: ['v2', 'social', 'counts'] as const,
  conversations: ['v2', 'social', 'conversations'] as const,
  friendRequests: ['v2', 'social', 'requests'] as const,
  groups: ['v2', 'social', 'groups'] as const,
  saved: (type: string) => ['v2', 'social', 'saved', type] as const,
  leaderboard: ['v2', 'leaderboard'] as const,
  workouts: ['v2', 'workouts'] as const,
  diagnostics: ['v2', 'diagnostics'] as const,
  memory: ['v2', 'memory'] as const,
  bodyWeight: ['v2', 'bodyWeight'] as const,
  streak: ['v2', 'streak'] as const,
  trainingOverview: ['v2', 'training', 'overview'] as const,
  checkins: ['v2', 'checkins'] as const,
  freestyle: ['v2', 'training', 'freestyle'] as const,
  adaptation: ['v2', 'training', 'adaptation'] as const,
  video: (name: string) => ['v2', 'video', name.toLowerCase()] as const,
  // Under 'meals' so a logged meal refreshes them.
  dayTargets: (date: string) => ['v2', 'meals', 'targets', date] as const,
  summary: (range: string, date: string) => ['v2', 'meals', 'summary', range, date] as const,
  recipes: ['v2', 'recipes'] as const,
  savedFoods: ['v2', 'savedFoods'] as const,
};

// Review #5: home never waits. The last brief (persisted, per user) renders on
// the first frame and is refreshed behind it; while the server is still
// writing Anakin's line (`pending`) it's polled every 3 s.
const BRIEF_CACHE_TTL = 12 * 60 * 60 * 1000;
export const useBrief = () => {
  const { user } = useAuth();
  const key = `v2:brief:${user?.id ?? 'anon'}`;
  return useQuery({
    queryKey: [...qk.brief, user?.id ?? 'anon'],
    queryFn: async () => { const b = await v2Api.brief(); setCached(key, b); return b; },
    initialData: () => getCached<Brief>(key, BRIEF_CACHE_TTL) ?? undefined,
    initialDataUpdatedAt: 0, // always revalidate the cached copy
    staleTime: 5 * 60_000,
    retry: 1,
    refetchInterval: (q) => (q.state.data?.pending ? 3000 : false),
  });
};
// Training bands: one call on tab focus. The last payload (persisted, per user)
// renders the collapsed summaries on the first frame, revalidated behind it.
const TRAINING_CACHE_TTL = 7 * 24 * 60 * 60 * 1000;
export const useTrainingOverview = () => {
  const { user } = useAuth();
  const key = `v2:training:${user?.id ?? 'anon'}`;
  return useQuery({
    queryKey: [...qk.trainingOverview, user?.id ?? 'anon'],
    queryFn: async () => { const o = await v2Api.trainingOverview(); setCached(key, o); return o; },
    initialData: () => getCached<TrainingOverview>(key, TRAINING_CACHE_TTL) ?? undefined,
    initialDataUpdatedAt: 0,
    staleTime: STALE,
    retry: 1,
  });
};
export const useProgram = () => useQuery({ queryKey: qk.program, queryFn: () => coachApi.getProgram() as Promise<any>, staleTime: STALE });
export const useSchedule = () => useQuery({ queryKey: qk.schedule, queryFn: () => coachApi.getSchedule() as Promise<any>, staleTime: STALE });
export const useToday = () => useQuery({ queryKey: qk.today, queryFn: () => coachApi.getToday() as Promise<any>, staleTime: STALE });
export const useCompletedPrograms = () => useQuery({ queryKey: qk.completed, queryFn: () => coachApi.getCompletedPrograms() as Promise<any>, staleTime: 5 * 60_000 });
export const useStrength = () => useQuery({ queryKey: qk.strength, queryFn: () => apiFetch('/strength/profile') as Promise<any>, staleTime: 5 * 60_000 });
export const useMeals = (date?: string) => useQuery({ queryKey: qk.meals(date), queryFn: () => nutritionApi.getMeals(date) as Promise<any>, staleTime: 30_000 });
export const useNpDay = () => useQuery({ queryKey: qk.npDay, queryFn: () => nutritionProfileApi.getDay(), staleTime: STALE });
export const useNpWeek = () => useQuery({ queryKey: ['v2', 'np', 'week'], queryFn: () => nutritionProfileApi.getDay(undefined, '7d'), staleTime: 5 * 60_000 });
export const useNpEffect = (id: string) => useQuery({ queryKey: qk.npEffect(id), queryFn: () => nutritionProfileApi.getEffect(id, undefined, '7d' as any), staleTime: STALE, enabled: !!id });
export const useNutritionPlan = () => useQuery({ queryKey: qk.nutritionPlan, queryFn: () => v2Api.nutritionPlan(), staleTime: STALE });
export const useNpNutrient = (key: string) => useQuery({ queryKey: qk.npNutrient(key), queryFn: () => nutritionProfileApi.getNutrient(key, undefined, '7d' as any), staleTime: STALE, enabled: !!key });
// Feed tab (bug fixes 5 Oct, 3a): friends' posts, 20 a page, paged by the server's cursor.
export const useFeedPages = () => useInfiniteQuery({
  queryKey: qk.feedPages,
  initialPageParam: null as string | null,
  queryFn: ({ pageParam }) => socialApi.getFeed({ includeResearch: false, before: pageParam, limit: 20 }) as Promise<any>,
  getNextPageParam: (last: any) => last?.nextCursor ?? undefined,
  staleTime: STALE,
});
export const useSocialCounts = () => useQuery({ queryKey: qk.socialCounts, queryFn: () => socialApi.getNotificationCounts() as Promise<any>, staleTime: 30_000, refetchInterval: 60_000 });
export const useConversations = () => useQuery({ queryKey: qk.conversations, queryFn: () => socialApi.getConversations() as Promise<any[]>, staleTime: 15_000 });
export const useFriendRequests = () => useQuery({ queryKey: qk.friendRequests, queryFn: () => socialApi.getFriendRequests() as Promise<any[]>, staleTime: 30_000 });
export const useGroups = () => useQuery({ queryKey: qk.groups, queryFn: () => groupsApi.list() as Promise<any>, staleTime: STALE });
export const useSaved = (type: 'all' | 'workouts' | 'posts' | 'articles') => useQuery({ queryKey: qk.saved(type), queryFn: () => socialApi.getSaved(type) as Promise<any>, staleTime: 15_000 });
export const useFeed = () => useQuery({ queryKey: qk.feed, queryFn: () => socialApi.getFeed({ includeResearch: false }) as Promise<any>, staleTime: STALE });
export const useWorkouts = () => useQuery({ queryKey: qk.workouts, queryFn: () => workoutsApi.getWorkouts() as Promise<any>, staleTime: STALE });
export const useMemory = () => useQuery({ queryKey: qk.memory, queryFn: v2Api.memory, staleTime: STALE });
export const useBodyWeight = () => useQuery({ queryKey: qk.bodyWeight, queryFn: () => coachApi.getBodyWeight() as Promise<any>, staleTime: STALE });
export const useDiagnostics = () => useQuery({
  queryKey: qk.diagnostics,
  staleTime: STALE,
  queryFn: async () => {
    const [sessions, analyses] = await Promise.all([
      (liftCoachApi as any).getSessionHistory().catch(() => []),
      (formAnalysisApi as any).list().catch(() => ({ analyses: [] })),
    ]);
    return {
      sessions: Array.isArray(sessions) ? sessions : (sessions?.sessions ?? []),
      analyses: Array.isArray(analyses?.analyses) ? analyses.analyses : [],
    };
  },
});
/** Streak from the activity heatmap: consecutive days (ending today or yesterday) with any activity. */
export const useStreak = () => useQuery({
  queryKey: qk.streak,
  staleTime: STALE,
  queryFn: async () => {
    const rows: { date: string; count: number }[] = await apiFetch('/activity/heatmap').catch(() => []);
    const active = new Set(rows.filter((r) => r.count > 0).map((r) => r.date.slice(0, 10)));
    const day = (d: Date) => d.toISOString().slice(0, 10);
    const cur = new Date();
    if (!active.has(day(cur))) cur.setDate(cur.getDate() - 1);
    let streak = 0;
    while (active.has(day(cur))) { streak++; cur.setDate(cur.getDate() - 1); }
    let longest = 0, run = 0, prev: string | null = null;
    for (const d of [...active].sort()) {
      if (prev) { const p = new Date(prev); p.setDate(p.getDate() + 1); run = day(p) === d ? run + 1 : 1; } else run = 1;
      longest = Math.max(longest, run); prev = d;
    }
    const weekStart = new Date(); weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));
    const thisWeek = [...active].filter((d) => d >= day(weekStart)).length;
    return { currentStreak: streak, longest, thisWeek, activeDays: active.size };
  },
});

// Wave 2 (handoff H-01, T-04–T-06, T-10).
export const useCheckins = () => useQuery({ queryKey: qk.checkins, queryFn: () => apiFetch('/wellness/checkins') as Promise<{ checkins: any[] }>, staleTime: STALE });
export const useFreestyle = () => useQuery({ queryKey: qk.freestyle, queryFn: () => v2Api.freestyle(), staleTime: STALE });
export const useAdaptationPending = () => useQuery({ queryKey: qk.adaptation, queryFn: () => apiFetch('/adaptation/pending') as Promise<{ enabled: boolean; proposals: any[] }>, staleTime: STALE });
/** An exercise's tutorial ({ videoId, title, thumbnail }); null when there isn't one. Cached for the session. */
export const useExerciseVideo = (name: string, enabled = true) => useQuery({
  queryKey: qk.video(name),
  queryFn: () => (coachApi.getExerciseVideo(name) as Promise<{ videoId: string; title: string; thumbnail?: string }>).catch(() => null),
  staleTime: Infinity, enabled: enabled && !!name, retry: 0,
});

// Wave 3 (handoff N-05 – N-10).
export const useDayTargets = (date = todayStr()) => useQuery({ queryKey: qk.dayTargets(date), queryFn: () => v2Api.dayTargets(date), staleTime: STALE });
export const useNutritionSummary = (range: 'today' | '7d' | '30d', date = todayStr()) => useQuery({ queryKey: qk.summary(range, date), queryFn: () => v2Api.nutritionSummary(range, date), staleTime: STALE });
export const useRecipes = () => useQuery({ queryKey: qk.recipes, queryFn: () => nutritionApi.getRecipes('', 100), staleTime: STALE });
export const useSavedFoods = () => useQuery({ queryKey: qk.savedFoods, queryFn: () => nutritionApi.searchFoods('', 100), staleTime: STALE });

/** Bust the caches a write touches. */
export function useInvalidate() {
  const qc = useQueryClient();
  return {
    afterWorkout: () => Promise.all([qc.invalidateQueries({ queryKey: qk.trainingOverview }), qc.invalidateQueries({ queryKey: qk.schedule }), qc.invalidateQueries({ queryKey: qk.today }), qc.invalidateQueries({ queryKey: qk.workouts }), qc.invalidateQueries({ queryKey: qk.strength }), qc.invalidateQueries({ queryKey: qk.brief })]),
    afterMeal: () => Promise.all([qc.invalidateQueries({ queryKey: ['v2', 'meals'] }), qc.invalidateQueries({ queryKey: ['v2', 'np'] }), qc.invalidateQueries({ queryKey: qk.brief }), qc.invalidateQueries({ queryKey: qk.recipes }), qc.invalidateQueries({ queryKey: qk.savedFoods })]),
    afterProgram: () => Promise.all([qc.invalidateQueries({ queryKey: qk.trainingOverview }), qc.invalidateQueries({ queryKey: qk.program }), qc.invalidateQueries({ queryKey: qk.schedule }), qc.invalidateQueries({ queryKey: qk.today }), qc.invalidateQueries({ queryKey: qk.brief })]),
    afterSchedule: () => Promise.all([qc.invalidateQueries({ queryKey: qk.trainingOverview }), qc.invalidateQueries({ queryKey: qk.schedule }), qc.invalidateQueries({ queryKey: qk.today }), qc.invalidateQueries({ queryKey: qk.brief }), qc.invalidateQueries({ queryKey: qk.checkins })]),
    all: () => qc.invalidateQueries({ queryKey: ['v2'] }),
  };
}

export { authApi };
