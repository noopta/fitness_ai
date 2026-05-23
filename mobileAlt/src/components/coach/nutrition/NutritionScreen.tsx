// NutritionScreen — root layout of the rebuilt Nutrition tab (v17b).
// Composes StickyHeader → Inspector → DayTimeline → ActionDock.
//
// Data sources stay the same as the old four-card stack — this is a chassis
// swap, not a feature change. We pull from:
//   • coachData.savedProgram.nutritionPlan       — kcal + macro targets
//   • nutritionApi.getMeals(today)               — logged meals (timeline)
//   • workoutsApi.getWorkoutByDate(today)        — workout calorie burn
//   • coachApi.getBodyWeight()                   — 30-day weight series
//   • useAuth().user                             — subtract-workout-burn pref
//
// Sheet integrations the spec calls out (Describe/Snap/Voice/Suggest) are
// staged. v1 wires Describe to the existing MealLogModal (the same flow the
// old "Log by description" card used). Snap routes through the existing
// MealLogModal scan path; Voice / Suggest surface a "coming soon" toast.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, StyleSheet, Alert, RefreshControl, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { coachApi, nutritionApi, workoutsApi } from '../../../lib/api';
import { useAuth } from '../../../context/AuthContext';
import { Analytics } from '../../../lib/analytics';
import { MealLogModal } from '../MealLogModal';
import { colors } from '../../../constants/theme';
import { StickyHeader } from './StickyHeader';
import { Inspector } from './Inspector';
import { WeightInspector, type WeightState } from './WeightInspector';
import { MacroInspector } from './MacroInspector';
import { DayTimeline, type LoggedMeal, type GhostSlot } from './DayTimeline';
import { ActionDock, type DockAction } from './ActionDock';
import type { MacroKey, MacroState } from './MacroRing';

interface Props {
  coachData: any;
  coachGoal?: string | null;
  coachBudget?: string | null;
  onRefresh?: () => Promise<void> | void;
  userId?: string;
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function todayLabel(): string {
  const d = new Date();
  return d
    .toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    .toUpperCase()
    .replace(/^/, 'TODAY · ');
}

/** Heuristic slot label from a HH:MM time string. */
function slotFromTime(time: string): LoggedMeal['slot'] {
  const h = parseInt(time.split(':')[0] ?? '0', 10);
  if (h < 10) return 'BREAKFAST';
  if (h < 12) return 'SNACK';
  if (h < 15) return 'LUNCH';
  if (h < 17) return 'SNACK';
  if (h < 21) return 'DINNER';
  return 'LATE';
}

/**
 * Generate placeholder ghost-slot suggestions for any of breakfast / lunch /
 * dinner not yet logged. v1 is intentionally simple — backend doesn't expose
 * a per-slot suggestion engine yet, so we produce static names + a flat
 * remaining-kcal split. Replace once a real suggestion endpoint exists.
 */
function buildGhostSlots(
  loggedSlots: Set<LoggedMeal['slot']>,
  remainingKcal: number,
): GhostSlot[] {
  const candidates: Array<{ slot: GhostSlot['slot']; time: string; name: string }> = [
    { slot: 'BREAKFAST', time: '08:00', name: 'Plan breakfast' },
    { slot: 'LUNCH',     time: '13:00', name: 'Plan lunch' },
    { slot: 'DINNER',    time: '19:00', name: 'Plan dinner' },
  ];
  const missing = candidates.filter((c) => !loggedSlots.has(c.slot));
  if (missing.length === 0 || remainingKcal <= 0) return [];
  const budget = Math.max(150, Math.round(remainingKcal / missing.length / 25) * 25);
  return missing.map((m, i) => ({
    id: `ghost-${i}-${m.slot}`,
    slot: m.slot,
    time: m.time,
    suggestedName: m.name,
    budgetKcal: budget,
  }));
}

/** Build the per-macro coach note for the MacroInspector. */
function macroCoachNote(key: MacroKey, used: number, target: number): string {
  if (target <= 0) return 'Set a target in your nutrition plan to see prescriptions.';
  const pct = used / target;
  if (pct > 1.1) {
    return `${Math.round(used - target)}g over today. Easy on portion sizes at your next meal.`;
  }
  if (pct >= 0.9) return `Right on the plan. Hold the line at your next meal.`;
  if (pct >= 0.6) return `On pace. Aim for ${Math.round(target - used)}g more across remaining meals.`;
  return `Behind on ${key}. Front-load it in your next meal to catch up.`;
}

export function NutritionScreen({ coachData, onRefresh, userId }: Props) {
  const { user } = useAuth();

  // ── Selection state ──────────────────────────────────────────────────────
  const [selectedMacro, setSelectedMacro] = useState<MacroKey | null>(null);

  // ── Data state ───────────────────────────────────────────────────────────
  const [todayMeals, setTodayMeals] = useState<any[]>([]);
  const [workoutBurnKcal, setWorkoutBurnKcal] = useState(0);
  const [bwLogs, setBwLogs] = useState<Array<{ date: string; weightLbs: number }>>([]);
  const [refreshing, setRefreshing] = useState(false);

  // ── Sheets ───────────────────────────────────────────────────────────────
  const [logModalVisible, setLogModalVisible] = useState(false);

  // ── Targets from the saved program ───────────────────────────────────────
  const nutritionPlan = useMemo(() => {
    try {
      const savedProg =
        typeof coachData?.savedProgram === 'string'
          ? JSON.parse(coachData.savedProgram)
          : coachData?.savedProgram;
      return savedProg?.nutritionPlan ?? savedProg?.nutrition ?? null;
    } catch {
      return null;
    }
  }, [coachData?.savedProgram]);

  const macros = nutritionPlan?.macros ?? nutritionPlan;
  const baseTargetCalories: number | null = macros?.calories ?? nutritionPlan?.calories ?? null;
  const targetProtein: number | null = macros?.proteinG ?? macros?.protein_g ?? macros?.protein ?? null;
  const targetCarbs:   number | null = macros?.carbsG   ?? macros?.carbs_g   ?? macros?.carbs   ?? null;
  const targetFat:     number | null = macros?.fatG     ?? macros?.fat_g     ?? macros?.fat     ?? null;
  const targetFiber:   number | null = macros?.fiberG   ?? macros?.fiber_g   ?? macros?.fiber   ?? null;

  // ── Used (today's intake) ────────────────────────────────────────────────
  const used = useMemo(() => {
    return todayMeals.reduce(
      (acc, m: any) => ({
        kcal:   acc.kcal   + (Number(m.calories) || 0),
        p:      acc.p      + (Number(m.proteinG) || 0),
        c:      acc.c      + (Number(m.carbsG)   || 0),
        f:      acc.f      + (Number(m.fatG)     || 0),
        fi:     acc.fi     + (Number(m.fiberG)   || 0),
      }),
      { kcal: 0, p: 0, c: 0, f: 0, fi: 0 },
    );
  }, [todayMeals]);

  // ── Loaders ──────────────────────────────────────────────────────────────
  const loadAll = useCallback(async () => {
    const date = todayStr();
    try {
      const [mealsRes, burnRes, bwRes] = await Promise.all([
        nutritionApi.getMeals(date).catch(() => ({ entries: [] })),
        workoutsApi.getWorkoutByDate(date).catch(() => []),
        coachApi.getBodyWeight().catch(() => null),
      ]);
      setTodayMeals((mealsRes as any)?.entries ?? []);
      const burn = Array.isArray(burnRes)
        ? burnRes.reduce((s: number, l: any) => s + (Number(l?.caloriesBurnedKcal) || 0), 0)
        : 0;
      setWorkoutBurnKcal(burn);
      const list = Array.isArray(bwRes)
        ? (bwRes as any[])
        : (bwRes as any)?.logs ?? (bwRes as any)?.entries ?? [];
      // Oldest → newest, so the sparkline reads left-to-right.
      setBwLogs(
        [...list].sort((a: any, b: any) =>
          new Date(a.date || a.createdAt || 0).getTime() -
          new Date(b.date || b.createdAt || 0).getTime(),
        ),
      );
    } catch {
      // Component remains usable with empty state — no need to surface.
    }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadAll();
    if (onRefresh) await onRefresh();
    setRefreshing(false);
  }, [loadAll, onRefresh]);

  // ── Macro states for the rings + inspector ───────────────────────────────
  const macroStates: MacroState[] = useMemo(() => [
    { key: 'protein', used: used.p,  target: targetProtein },
    { key: 'carbs',   used: used.c,  target: targetCarbs },
    { key: 'fat',     used: used.f,  target: targetFat },
    { key: 'fiber',   used: used.fi, target: targetFiber },
  ], [used, targetProtein, targetCarbs, targetFat, targetFiber]);

  // ── Weight state ─────────────────────────────────────────────────────────
  const weight: WeightState = useMemo(() => {
    const last30 = bwLogs.slice(-30).map((l) => l.weightLbs);
    const current = last30[last30.length - 1] ?? null;
    let weeklyDelta: string | null = null;
    if (last30.length >= 7) {
      const lastWeekAvg = avg(last30.slice(-7));
      const priorAvg = avg(last30.slice(-14, -7));
      const delta = lastWeekAvg - (priorAvg || lastWeekAvg);
      weeklyDelta = `${delta > 0 ? '+' : ''}${delta.toFixed(2)} lb`;
    }
    // Coach note: tied to delta direction relative to plan goal.
    let coachNote: string | null = null;
    if (last30.length >= 3 && current != null) {
      coachNote =
        weeklyDelta && weeklyDelta.startsWith('-')
          ? `${last30.length}-day average down. Right on plan.`
          : `${last30.length}-day average steady. Watch the trend this week.`;
    }
    // Logged-today detection.
    const today = todayStr();
    const last = bwLogs[bwLogs.length - 1];
    const loggedToday = !!last && (last.date === today);
    return {
      current,
      series: last30,
      weeklyDelta,
      coachNote,
      loggedToday,
      loggedTodayLabel: loggedToday ? 'Logged today' : undefined,
    };
  }, [bwLogs]);

  // ── Ghost slots ──────────────────────────────────────────────────────────
  const meals: LoggedMeal[] = useMemo(() => {
    return todayMeals
      .filter((m: any) => m && m.id)
      .map((m: any) => {
        const ts: string =
          (m.createdAt && new Date(m.createdAt).toTimeString().slice(0, 5)) ||
          (m.time && String(m.time).slice(0, 5)) ||
          '12:00';
        return {
          id: m.id,
          time: ts,
          slot: (m.mealType ? String(m.mealType).toUpperCase() : slotFromTime(ts)) as LoggedMeal['slot'],
          name: m.name || m.title || 'Meal',
          calories: Number(m.calories) || 0,
          proteinG: Number(m.proteinG) || 0,
          carbsG:   Number(m.carbsG)   || 0,
          fatG:     Number(m.fatG)     || 0,
        };
      })
      .sort((a, b) => a.time.localeCompare(b.time));
  }, [todayMeals]);

  const subtractBurn = user?.subtractWorkoutBurnFromCalories !== false;
  const targetWithBurn = baseTargetCalories != null
    ? baseTargetCalories + (subtractBurn ? workoutBurnKcal : 0)
    : null;
  const remainingKcal = targetWithBurn != null ? targetWithBurn - used.kcal : 0;
  const ghosts: GhostSlot[] = useMemo(() => {
    const loggedSlots = new Set<LoggedMeal['slot']>(meals.map((m) => m.slot));
    return buildGhostSlots(loggedSlots, Math.max(0, remainingKcal));
  }, [meals, remainingKcal]);

  // ── Handlers ─────────────────────────────────────────────────────────────
  const handleSelectMacro = useCallback((key: MacroKey) => {
    setSelectedMacro((prev) => (prev === key ? null : key));
  }, []);

  const handleDockAction = useCallback((action: DockAction) => {
    if (action === 'describe' || action === 'snap') {
      // Snap currently routes through the same MealLogModal flow; v1 keeps
      // them collapsed until the dedicated SnapSheet ships.
      setLogModalVisible(true);
      return;
    }
    if (action === 'voice') {
      Alert.alert('Voice logging', "Coming soon — Anakin will take voice notes here.");
      return;
    }
    if (action === 'suggest') {
      Alert.alert(
        'Anakin suggestions',
        "Coming soon — Anakin will suggest meals based on your remaining macros for the day.",
      );
    }
  }, []);

  const handleMealLogged = useCallback(async () => {
    setLogModalVisible(false);
    await loadAll();
  }, [loadAll]);

  const handleLogWeight = useCallback(async (lb: number) => {
    try {
      await coachApi.logBodyWeight(lb, todayStr());
      Analytics.bodyWeightLogged();
      await loadAll();
    } catch (err: any) {
      Alert.alert('Could not log weight', err?.message ?? 'Please try again.');
    }
  }, [loadAll]);

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.root} edges={[]}>
      <StickyHeader
        dateLabel={todayLabel()}
        kcal={{
          used: used.kcal,
          target: baseTargetCalories,
          workoutBurn: subtractBurn ? workoutBurnKcal : 0,
        }}
        macros={macroStates}
        selectedMacro={selectedMacro}
        onSelectMacro={handleSelectMacro}
      />

      <Inspector
        mode={selectedMacro ? 'macro' : 'weight'}
        weight={<WeightInspector weight={weight} onLog={handleLogWeight} />}
        macro={
          selectedMacro && (() => {
            const m = macroStates.find((x) => x.key === selectedMacro)!;
            return (
              <MacroInspector
                macro={m}
                onDismiss={() => setSelectedMacro(null)}
                coachNote={macroCoachNote(m.key, m.used, m.target ?? 0)}
              />
            );
          })()
        }
      />

      {/* Pull-to-refresh lives on the timeline scroll surface. */}
      <ScrollView
        style={styles.timelineWrap}
        contentContainerStyle={{ flexGrow: 1 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
        scrollEnabled={false}
      >
        <DayTimeline
          meals={meals}
          ghosts={ghosts}
          onMealPress={() => setLogModalVisible(true)}
          onGhostPress={() => setLogModalVisible(true)}
        />
      </ScrollView>

      <ActionDock onAction={handleDockAction} />

      <MealLogModal
        visible={logModalVisible}
        onClose={() => setLogModalVisible(false)}
        onSaved={handleMealLogged}
        date={todayStr()}
      />
    </SafeAreaView>
  );
}

function avg(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  timelineWrap: { flex: 1 },
});
