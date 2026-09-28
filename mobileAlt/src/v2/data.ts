// Data hooks for the v2 pages. Thin react-query wrappers over the existing
// API client so the new screens share caches with each other and the cost
// of a tab switch is a cache read.

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch, coachApi, nutritionApi, nutritionProfileApi, workoutsApi, socialApi, liftCoachApi, formAnalysisApi, authApi } from '../lib/api';
import { v2Api } from './api';

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
  feed: ['v2', 'feed'] as const,
  leaderboard: ['v2', 'leaderboard'] as const,
  workouts: ['v2', 'workouts'] as const,
  diagnostics: ['v2', 'diagnostics'] as const,
  memory: ['v2', 'memory'] as const,
  bodyWeight: ['v2', 'bodyWeight'] as const,
  streak: ['v2', 'streak'] as const,
};

export const useBrief = () => useQuery({ queryKey: qk.brief, queryFn: v2Api.brief, staleTime: 5 * 60_000, retry: 1 });
export const useProgram = () => useQuery({ queryKey: qk.program, queryFn: () => coachApi.getProgram() as Promise<any>, staleTime: STALE });
export const useSchedule = () => useQuery({ queryKey: qk.schedule, queryFn: () => coachApi.getSchedule() as Promise<any>, staleTime: STALE });
export const useToday = () => useQuery({ queryKey: qk.today, queryFn: () => coachApi.getToday() as Promise<any>, staleTime: STALE });
export const useCompletedPrograms = () => useQuery({ queryKey: qk.completed, queryFn: () => coachApi.getCompletedPrograms() as Promise<any>, staleTime: 5 * 60_000 });
export const useStrength = () => useQuery({ queryKey: qk.strength, queryFn: () => apiFetch('/strength/profile') as Promise<any>, staleTime: 5 * 60_000 });
export const useMeals = (date?: string) => useQuery({ queryKey: qk.meals(date), queryFn: () => nutritionApi.getMeals(date) as Promise<any>, staleTime: 30_000 });
export const useNpDay = () => useQuery({ queryKey: qk.npDay, queryFn: () => nutritionProfileApi.getDay(), staleTime: STALE });
export const useNpEffect = (id: string) => useQuery({ queryKey: qk.npEffect(id), queryFn: () => nutritionProfileApi.getEffect(id, undefined, '7d' as any), staleTime: STALE, enabled: !!id });
export const useNpNutrient = (key: string) => useQuery({ queryKey: qk.npNutrient(key), queryFn: () => nutritionProfileApi.getNutrient(key, undefined, '7d' as any), staleTime: STALE, enabled: !!key });
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

/** Bust the caches a write touches. */
export function useInvalidate() {
  const qc = useQueryClient();
  return {
    afterWorkout: () => Promise.all([qc.invalidateQueries({ queryKey: qk.schedule }), qc.invalidateQueries({ queryKey: qk.today }), qc.invalidateQueries({ queryKey: qk.workouts }), qc.invalidateQueries({ queryKey: qk.strength }), qc.invalidateQueries({ queryKey: qk.brief })]),
    afterMeal: () => Promise.all([qc.invalidateQueries({ queryKey: ['v2', 'meals'] }), qc.invalidateQueries({ queryKey: ['v2', 'np'] }), qc.invalidateQueries({ queryKey: qk.brief })]),
    afterProgram: () => Promise.all([qc.invalidateQueries({ queryKey: qk.program }), qc.invalidateQueries({ queryKey: qk.schedule }), qc.invalidateQueries({ queryKey: qk.today }), qc.invalidateQueries({ queryKey: qk.brief })]),
    afterSchedule: () => Promise.all([qc.invalidateQueries({ queryKey: qk.schedule }), qc.invalidateQueries({ queryKey: qk.today }), qc.invalidateQueries({ queryKey: qk.brief })]),
    all: () => qc.invalidateQueries({ queryKey: ['v2'] }),
  };
}

export { authApi };
