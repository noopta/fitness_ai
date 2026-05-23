// NutritionScreen — root layout of the rebuilt Nutrition tab (v17b).
// Composes StickyHeader → Inspector → DayTimeline → ActionDock + the
// purpose-built bottom sheets (Describe / Snap / Voice / Suggest /
// MealEdit) and the WeightDetailScreen push.
//
// Data sources are unchanged from the pre-v17b stack — chassis swap, not
// a feature change:
//   • coachData.savedProgram.nutritionPlan  — kcal + macro targets
//   • nutritionApi.getMeals(today)          — logged meals (timeline)
//   • workoutsApi.getWorkoutByDate(today)   — workout calorie burn
//   • coachApi.getBodyWeight()              — 30-day weight series
//   • useAuth().user                        — subtract-workout-burn pref

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, StyleSheet, Alert, Keyboard, Modal,
  type NativeSyntheticEvent, type NativeScrollEvent,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { coachApi, nutritionApi, workoutsApi } from '../../../lib/api';
import { useAuth } from '../../../context/AuthContext';
import { Analytics } from '../../../lib/analytics';
import { colors } from '../../../constants/theme';
import { StickyHeader } from './StickyHeader';
import { Inspector } from './Inspector';
import { WeightInspector, type WeightState } from './WeightInspector';
import { MacroInspector } from './MacroInspector';
import { DayTimeline, type LoggedMeal, type GhostSlot } from './DayTimeline';
import { ActionDock, type DockAction } from './ActionDock';
import type { MacroKey, MacroState } from './MacroRing';
import { DescribeSheet } from './sheets/DescribeSheet';
import { SnapSheet } from './sheets/SnapSheet';
import { VoiceSheet } from './sheets/VoiceSheet';
import { SuggestSheet } from './sheets/SuggestSheet';
import { MealEditSheet, type EditingMeal } from './sheets/MealEditSheet';
import { WeightDetailScreen } from './WeightDetailScreen';

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

  // Dock visibility — hidden when the timeline is scrolled down past 240pt
  // and the user is still scrolling further down, or when the keyboard is up
  // (e.g. the weight log input is focused). Restored on scroll-up or near
  // the top of the surface.
  const [dockHidden, setDockHidden] = useState(false);
  const [keyboardUp, setKeyboardUp] = useState(false);
  const lastScrollYRef = useRef(0);

  // Keyboard listeners — same on both platforms, even though iOS uses Will*
  // and Android uses Did*. We don't care about the difference for this UX.
  useEffect(() => {
    const showEvent = 'keyboardDidShow';
    const hideEvent = 'keyboardDidHide';
    const show = Keyboard.addListener(showEvent, () => setKeyboardUp(true));
    const hide = Keyboard.addListener(hideEvent, () => setKeyboardUp(false));
    return () => { show.remove(); hide.remove(); };
  }, []);

  const handleTimelineScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const y = e.nativeEvent.contentOffset.y;
    const dy = y - lastScrollYRef.current;
    lastScrollYRef.current = y;
    // Hide threshold: scrolled down at least 240pt AND moving further down.
    if (y > 240 && dy > 4) {
      setDockHidden((prev) => (prev ? prev : true));
      return;
    }
    // Show again when scrolling back up or close to the top.
    if (dy < -2 || y < 60) {
      setDockHidden((prev) => (prev ? false : prev));
    }
  }, []);

  // ── Sheet visibility ─────────────────────────────────────────────────────
  // Spec §10 calls for one-sheet-at-a-time. We collapse all five into a
  // single union state so opening a new sheet automatically dismisses the
  // others.
  type OpenSheet = null | 'describe' | 'snap' | 'voice' | 'suggest' | 'edit';
  const [openSheet, setOpenSheet] = useState<OpenSheet>(null);
  const [editingMeal, setEditingMeal] = useState<EditingMeal | null>(null);
  const [weightDetailOpen, setWeightDetailOpen] = useState(false);

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

  // When the parent coach screen pings us to refresh, just re-pull the
  // local data. v1 doesn't expose pull-to-refresh on the timeline — the
  // dock + automatic post-log refresh covers the common case. PR-7+ may add
  // it back via the DayTimeline scroll surface.
  useEffect(() => {
    if (onRefresh) {
      // No-op: presence of onRefresh is informational; the parent triggers
      // reloads by re-rendering this component or by calling its own data
      // fetchers. We don't intercept here.
    }
  }, [onRefresh]);

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
    // One-sheet-at-a-time discipline — this state mutation is the discipline.
    setOpenSheet(action);
  }, []);

  const handleMealLogged = useCallback(async () => {
    setOpenSheet(null);
    setEditingMeal(null);
    await loadAll();
  }, [loadAll]);

  /**
   * Delete a logged meal. Called by the swipe-to-delete action on a row.
   * We always confirm — the swipe alone isn't a strong-enough signal that
   * the user intends to lose the entry. Optimistically remove it from the
   * timeline so the dialog dismissal doesn't feel sluggish; revert if the
   * delete call fails.
   */
  const handleDeleteMeal = useCallback((m: { id: string; name: string }) => {
    Alert.alert(
      'Delete meal?',
      `"${m.name}" will be removed from today.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            const before = todayMeals;
            setTodayMeals((prev) => prev.filter((x) => x.id !== m.id));
            try {
              await nutritionApi.deleteMeal(m.id);
            } catch (err: any) {
              setTodayMeals(before); // revert
              Alert.alert('Could not delete', err?.message ?? 'Please try again.');
            }
          },
        },
      ],
    );
  }, [todayMeals]);

  /**
   * Long-press a meal — action sheet with Edit (opens MealEditSheet for
   * portion / slot / macro tweaks) + Delete (confirm + remove).
   * Duplicate / Move-to-slot live inside MealEditSheet now.
   */
  const handleLongPressMeal = useCallback((m: LoggedMeal) => {
    Alert.alert(m.name, undefined, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Edit',
        onPress: () => {
          setEditingMeal({
            id: m.id,
            name: m.name,
            calories: m.calories,
            proteinG: m.proteinG,
            carbsG: m.carbsG,
            fatG: m.fatG,
            slot: m.slot,
          });
          setOpenSheet('edit');
        },
      },
      { text: 'Delete', style: 'destructive', onPress: () => handleDeleteMeal(m) },
    ]);
  }, [handleDeleteMeal]);

  // Tap a logged meal → MealEditSheet (replaces the v1 stop-gap that just
  // opened the generic log modal). Ghost slots still route through Suggest.
  const handleMealPress = useCallback((m: LoggedMeal) => {
    setEditingMeal({
      id: m.id,
      name: m.name,
      calories: m.calories,
      proteinG: m.proteinG,
      carbsG: m.carbsG,
      fatG: m.fatG,
      slot: m.slot,
    });
    setOpenSheet('edit');
  }, []);

  const handleGhostPress = useCallback(() => setOpenSheet('suggest'), []);

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
        weight={
          <WeightInspector
            weight={weight}
            onLog={handleLogWeight}
            onPressBody={() => setWeightDetailOpen(true)}
          />
        }
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

      {/* DayTimeline owns its own scroll surface; pull-to-refresh + scroll
          events live there so the dock can react to scroll velocity. */}
      <View style={styles.timelineWrap}>
        <DayTimeline
          meals={meals}
          ghosts={ghosts}
          onMealPress={handleMealPress}
          onGhostPress={handleGhostPress}
          onDeleteMeal={handleDeleteMeal}
          onLongPressMeal={handleLongPressMeal}
          onScroll={handleTimelineScroll}
        />
      </View>

      <ActionDock onAction={handleDockAction} hidden={dockHidden || keyboardUp} />

      {/* Sheets — spec §10 sheet-stack discipline lives in `openSheet`,
          so setting a new value automatically dismisses the others. */}
      <DescribeSheet
        visible={openSheet === 'describe'}
        onClose={() => setOpenSheet(null)}
        onLogged={handleMealLogged}
      />
      <SnapSheet
        visible={openSheet === 'snap'}
        onClose={() => setOpenSheet(null)}
        onLogged={handleMealLogged}
      />
      <VoiceSheet
        visible={openSheet === 'voice'}
        onClose={() => setOpenSheet(null)}
        onUseDescribe={() => setOpenSheet('describe')}
      />
      <SuggestSheet
        visible={openSheet === 'suggest'}
        onClose={() => setOpenSheet(null)}
        onLogged={handleMealLogged}
        remaining={{
          kcal:    Math.max(0, remainingKcal),
          protein: Math.max(0, (targetProtein ?? 0) - used.p),
          carbs:   Math.max(0, (targetCarbs   ?? 0) - used.c),
          fat:     Math.max(0, (targetFat     ?? 0) - used.f),
        }}
      />
      <MealEditSheet
        visible={openSheet === 'edit'}
        meal={editingMeal}
        onClose={() => { setOpenSheet(null); setEditingMeal(null); }}
        onChanged={handleMealLogged}
      />

      {/* WeightDetailScreen push — full-screen modal so it sits over the
          tab bar. Keeps the inspector tap behaviour the spec calls for
          without needing a real navigator entry. */}
      <Modal
        visible={weightDetailOpen}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setWeightDetailOpen(false)}
      >
        <WeightDetailScreen onClose={() => setWeightDetailOpen(false)} />
      </Modal>
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
