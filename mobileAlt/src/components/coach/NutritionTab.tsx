import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  Modal,
  Pressable,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
  ActivityIndicator,
  RefreshControl,
  Alert,
  TextInput,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, fontSize, fontWeight, spacing, radius } from '../../constants/theme';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/Card';
import { Button } from '../ui/Button';
import { coachApi, nutritionApi } from '../../lib/api';
import { MealLogModal } from './MealLogModal';

const MEAL_SHEET_HEIGHT = Dimensions.get('window').height * 0.75;
const CHART_WIDTH = Dimensions.get('window').width - spacing.md * 4;

// ─── Types ────────────────────────────────────────────────────────────────────

interface NutritionTabProps {
  coachData: any;
  coachGoal?: string | null;
  coachBudget?: string | null;
  onRefresh?: () => Promise<void> | void;
}

interface DayHistory {
  date: string;
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  meals: any[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function todayStr() {
  return new Date().toISOString().split('T')[0];
}

function fmtDate(d: string) {
  const dt = new Date(d + 'T12:00:00');
  return dt.toLocaleDateString('en-US', { weekday: 'short' }).slice(0, 3);
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ProgressBar({ value, color, height = 4 }: { value: number; color: string; height?: number }) {
  const pct = Math.min(Math.max(value, 0), 100);
  return (
    <View style={[styles.progressTrack, { height }]}>
      <View style={[styles.progressBar, { width: `${pct}%`, backgroundColor: color }]} />
    </View>
  );
}

interface MacroCardProps {
  label: string;
  grams: number | null;
  logged: number;
  color: string;
  target?: string;
}

function MacroCard({ label, grams, logged, color, target }: MacroCardProps) {
  const pct = grams ? (logged / grams) * 100 : 0;
  return (
    <View style={styles.macroCard}>
      <View style={[styles.macroIndicator, { backgroundColor: color }]} />
      <Text style={styles.macroCardLabel}>{label}</Text>
      <Text style={[styles.macroGrams, { color }]}>
        {logged > 0 ? `${Math.round(logged)}` : grams !== null ? `${grams}` : target ?? '—'}
        <Text style={styles.macroUnit}>g</Text>
      </Text>
      {grams !== null && (
        <Text style={styles.macroTarget}>of {grams}g</Text>
      )}
      <ProgressBar value={pct} color={color} />
    </View>
  );
}

// Last 7-day bar chart (calories)
function CaloriesChart({ history, targetCalories }: { history: DayHistory[]; targetCalories: number | null }) {
  // Build last 7 days grid
  const days: Array<{ label: string; calories: number; isToday: boolean }> = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const str = d.toISOString().split('T')[0];
    const entry = history.find(h => h.date === str);
    days.push({
      label: i === 0 ? 'Today' : fmtDate(str),
      calories: entry?.calories ?? 0,
      isToday: i === 0,
    });
  }

  const maxCal = Math.max(...days.map(d => d.calories), targetCalories ?? 0, 500);
  const barWidth = (CHART_WIDTH / 7) - 6;

  return (
    <View style={styles.chartContainer}>
      <View style={styles.chartBars}>
        {days.map((day, i) => {
          const barH = day.calories > 0 ? Math.max((day.calories / maxCal) * 100, 4) : 0;
          const color = day.isToday ? colors.primary : `${colors.primary}60`;
          return (
            <View key={i} style={[styles.chartBarCol, { width: barWidth }]}>
              <Text style={[styles.chartCalLabel, day.isToday && styles.chartCalLabelToday]}>
                {day.calories > 0 ? Math.round(day.calories) : ''}
              </Text>
              <View style={styles.chartBarBg}>
                {targetCalories != null && (
                  <View style={[styles.targetLine, { bottom: `${(targetCalories / maxCal) * 100}%` }]} />
                )}
                <View
                  style={[
                    styles.chartBar,
                    {
                      height: `${barH}%`,
                      backgroundColor: color,
                      borderRadius: 4,
                    },
                  ]}
                />
              </View>
              <Text style={[styles.chartDayLabel, day.isToday && styles.chartDayLabelToday]}>
                {day.label}
              </Text>
            </View>
          );
        })}
      </View>
      {targetCalories != null && (
        <Text style={styles.chartTargetLegend}>— Target: {targetCalories} kcal/day</Text>
      )}
    </View>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function NutritionTab({ coachData, coachGoal, coachBudget, onRefresh }: NutritionTabProps) {
  const [mealModalVisible, setMealModalVisible] = useState(false);
  const [mealSuggestions, setMealSuggestions] = useState<any[]>([]);
  const [mealLoading, setMealLoading] = useState(false);
  const [generatingPlan, setGeneratingPlan] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);
  const [logModalVisible, setLogModalVisible] = useState(false);
  const [prefillMeal, setPrefillMeal] = useState<any>(null);

  // Today's logged meals
  const [todayMeals, setTodayMeals] = useState<any[]>([]);
  const [history, setHistory] = useState<DayHistory[]>([]);
  const [loadingMeals, setLoadingMeals] = useState(false);

  // Parse nutrition plan from saved program
  let nutritionPlan: any = null;
  let savedProg: any = null;
  if (coachData?.savedProgram) {
    try {
      savedProg =
        typeof coachData.savedProgram === 'string'
          ? JSON.parse(coachData.savedProgram)
          : coachData.savedProgram;
      nutritionPlan = savedProg?.nutritionPlan ?? savedProg?.nutrition ?? null;
    } catch {
      nutritionPlan = null;
    }
  }

  const macros = nutritionPlan?.macros ?? nutritionPlan;
  const baseTargetCalories: number | null = macros?.calories ?? nutritionPlan?.calories ?? null;

  // Adjustable calorie state (initialized from plan, user can tweak)
  const [calorieAdjust, setCalorieAdjust] = useState<number>(0);
  const [calorieInput, setCalorieInput] = useState<string>('');

  const targetCalories: number | null = baseTargetCalories !== null
    ? baseTargetCalories + calorieAdjust
    : null;

  // Weight projection data
  const weeklyWeightChangeLb: number | null = nutritionPlan?.expectedOutcomes?.weeklyWeightChangeLb ?? null;
  const totalWeeks: number = savedProg?.durationWeeks ?? 0;
  const currentWeek: number = coachData?.currentWeek ?? 1;
  const weeksRemaining = Math.max(0, totalWeeks - currentWeek);
  // Adjust projected weekly change based on calorie adjustment (3500 kcal ≈ 1 lb)
  const adjustedWeeklyChange: number | null = weeklyWeightChangeLb !== null
    ? weeklyWeightChangeLb + (calorieAdjust * 7) / 3500
    : null;
  const currentWeightLbs: number | null = (() => {
    try {
      const bw = coachData?.currentWeightLbs ?? coachData?.weightKg
        ? (coachData.weightKg ? coachData.weightKg * 2.205 : null)
        : null;
      return bw;
    } catch { return null; }
  })();
  const targetWeightLbs: number | null =
    currentWeightLbs !== null && adjustedWeeklyChange !== null && weeksRemaining > 0
      ? currentWeightLbs + adjustedWeeklyChange * weeksRemaining
      : null;
  const targetProtein: number | null = macros?.proteinG ?? macros?.protein_g ?? macros?.protein ?? null;
  const targetCarbs: number | null = macros?.carbsG ?? macros?.carbs_g ?? macros?.carbs ?? null;
  const targetFat: number | null = macros?.fatG ?? macros?.fat_g ?? macros?.fat ?? null;
  const targetFiber: number | null = macros?.fiberG ?? macros?.fiber_g ?? macros?.fiber ?? null;

  // Today's logged totals
  const loggedCalories = todayMeals.reduce((s, m) => s + (m.calories || 0), 0);
  const loggedProtein = todayMeals.reduce((s, m) => s + (m.proteinG || 0), 0);
  const loggedCarbs = todayMeals.reduce((s, m) => s + (m.carbsG || 0), 0);
  const loggedFat = todayMeals.reduce((s, m) => s + (m.fatG || 0), 0);

  const caloriePct = targetCalories ? (loggedCalories / targetCalories) * 100 : 0;

  const loadMealData = useCallback(async () => {
    setLoadingMeals(true);
    try {
      const [mealsRes, histRes] = await Promise.all([
        nutritionApi.getMeals(todayStr()),
        nutritionApi.getHistory(7),
      ]);
      setTodayMeals(mealsRes?.entries ?? []);
      setHistory(histRes?.history ?? []);
    } catch {
      // silently fail — nutrition data is supplementary
    } finally {
      setLoadingMeals(false);
    }
  }, []);

  useEffect(() => {
    loadMealData();
  }, [loadMealData]);

  async function handleDeleteMeal(id: string) {
    Alert.alert('Delete Meal', 'Remove this meal entry?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive', onPress: async () => {
          try {
            await nutritionApi.deleteMeal(id);
            setTodayMeals(prev => prev.filter(m => m.id !== id));
          } catch (err: any) {
            Alert.alert('Error', err?.message || 'Failed to delete meal');
          }
        },
      },
    ]);
  }

  async function handleGetMealSuggestions() {
    setMealLoading(true);
    try {
      const result = await coachApi.getMealSuggestions({
        macros: {
          proteinG: targetProtein ?? 150,
          carbsG: targetCarbs ?? 200,
          fatG: targetFat ?? 60,
          calories: targetCalories ?? 2000,
        },
        goal: coachGoal || 'strength',
        numberOfMeals: 5,
        budget: coachBudget || null,
      });
      const raw: any[] = Array.isArray(result)
        ? result
        : result?.meals ?? result?.suggestions ?? result?.mealSuggestions ?? [];
      setMealSuggestions(raw.length === 0
        ? [{ name: 'No suggestions returned', description: 'Please try again.' }]
        : raw.map((item: any) => typeof item === 'string' ? { name: item } : item)
      );
    } catch (err: any) {
      setMealSuggestions([{ name: err?.message || 'Could not load suggestions. Please try again.' }]);
    } finally {
      setMealLoading(false);
      setMealModalVisible(true);
    }
  }

  async function handleGeneratePlan() {
    setGeneratingPlan(true);
    setPlanError(null);
    try {
      const plan = await coachApi.generateNutritionPlan({ goal: coachGoal || 'general' });
      const existingProgram = coachData?.savedProgram ?? {};
      await coachApi.updateProgram({ program: { ...existingProgram, nutritionPlan: plan } });
      if (onRefresh) await onRefresh();
    } catch (err: any) {
      setPlanError(err?.message || 'Failed to generate plan. Please try again.');
    } finally {
      setGeneratingPlan(false);
    }
  }

  // ── No plan state ────────────────────────────────────────────────────────────

  if (!nutritionPlan) {
    return (
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <Card style={styles.card}>
          <CardContent style={styles.emptyContent}>
            <Text style={styles.emptyIcon}>🥗</Text>
            <Text style={styles.emptyTitle}>No Nutrition Plan Yet</Text>
            <Text style={styles.emptyDesc}>
              Generate a personalized nutrition plan based on your training goals.
            </Text>
            <Button fullWidth onPress={handleGeneratePlan} loading={generatingPlan} style={styles.generateBtn}>
              Generate Nutrition Plan
            </Button>
            {planError && <Text style={styles.planErrorText}>{planError}</Text>}
          </CardContent>
        </Card>
      </ScrollView>
    );
  }

  // ── Has plan ─────────────────────────────────────────────────────────────────

  return (
    <>
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={loadingMeals} onRefresh={loadMealData} />}
      >
        {/* ── Today's Progress ── */}
        <Card style={styles.card}>
          <CardHeader>
            <View style={styles.cardHeaderRow}>
              <CardTitle>Today's Calories</CardTitle>
              <TouchableOpacity style={styles.logBtn} onPress={() => { setPrefillMeal(null); setLogModalVisible(true); }}>
                <Ionicons name="add" size={14} color={colors.primary} />
                <Text style={styles.logBtnText}>Log Meal</Text>
              </TouchableOpacity>
            </View>
          </CardHeader>
          <CardContent style={styles.calContent}>
            <View style={styles.calRow}>
              <View style={styles.calMain}>
                <Text style={styles.calLogged}>{Math.round(loggedCalories)}</Text>
                <Text style={styles.calSlash}> / </Text>
                <Text style={styles.calTarget}>{targetCalories ?? '—'}</Text>
                <Text style={styles.calUnit}> kcal</Text>
              </View>
              <Text style={styles.calRemaining}>
                {targetCalories
                  ? `${Math.max(0, Math.round(targetCalories - loggedCalories))} left`
                  : ''}
              </Text>
            </View>
            <ProgressBar value={caloriePct} color={colors.primary} height={6} />
          </CardContent>
        </Card>

        {/* ── Weight Projection + Calorie Adjustment ── */}
        {(adjustedWeeklyChange !== null || targetCalories !== null) && (
          <Card style={styles.card}>
            <CardHeader><CardTitle>Weekly Projection</CardTitle></CardHeader>
            <CardContent style={styles.projContent}>
              {adjustedWeeklyChange !== null && (
                <View style={styles.projRow}>
                  <Text style={styles.projLabel}>Projected weight change/week</Text>
                  <Text style={[
                    styles.projValue,
                    { color: adjustedWeeklyChange < 0 ? colors.success : adjustedWeeklyChange > 0 ? colors.destructive : colors.foreground }
                  ]}>
                    {adjustedWeeklyChange > 0 ? '+' : ''}{adjustedWeeklyChange.toFixed(2)} lbs
                  </Text>
                </View>
              )}
              {targetWeightLbs !== null && (
                <View style={styles.projRow}>
                  <Text style={styles.projLabel}>Target weight at program end</Text>
                  <Text style={[styles.projValue, { color: colors.primary }]}>
                    {targetWeightLbs.toFixed(1)} lbs
                  </Text>
                </View>
              )}
              {baseTargetCalories !== null && (
                <View style={styles.calAdjustSection}>
                  <Text style={styles.calAdjustLabel}>Adjust daily calories</Text>
                  <View style={styles.calAdjustRow}>
                    <TouchableOpacity
                      style={styles.calAdjustBtn}
                      onPress={() => setCalorieAdjust(a => Math.max(a - 50, -500))}
                    >
                      <Text style={styles.calAdjustBtnText}>−50</Text>
                    </TouchableOpacity>
                    <View style={styles.calAdjustDisplay}>
                      <Text style={styles.calAdjustDisplayVal}>
                        {targetCalories} kcal
                      </Text>
                      {calorieAdjust !== 0 && (
                        <Text style={[styles.calAdjustDiff, { color: calorieAdjust > 0 ? colors.destructive : colors.success }]}>
                          {calorieAdjust > 0 ? '+' : ''}{calorieAdjust} from plan
                        </Text>
                      )}
                    </View>
                    <TouchableOpacity
                      style={styles.calAdjustBtn}
                      onPress={() => setCalorieAdjust(a => Math.min(a + 50, 500))}
                    >
                      <Text style={styles.calAdjustBtnText}>+50</Text>
                    </TouchableOpacity>
                  </View>
                  {calorieAdjust !== 0 && (
                    <TouchableOpacity onPress={() => setCalorieAdjust(0)} style={styles.resetBtn}>
                      <Text style={styles.resetBtnText}>Reset to plan</Text>
                    </TouchableOpacity>
                  )}
                </View>
              )}
            </CardContent>
          </Card>
        )}

        {/* ── Macro targets ── */}
        <Card style={styles.card}>
          <CardHeader><CardTitle>Macronutrients</CardTitle></CardHeader>
          <CardContent style={styles.macroGrid}>
            <MacroCard label="Protein" grams={targetProtein} logged={loggedProtein} color="#3b82f6" />
            <MacroCard label="Carbs" grams={targetCarbs} logged={loggedCarbs} color="#f59e0b" />
            <MacroCard label="Fat" grams={targetFat} logged={loggedFat} color="#ec4899" />
            <MacroCard label="Fiber" grams={targetFiber} logged={0} color="#22c55e" target="25-35g" />
          </CardContent>
        </Card>

        {/* ── 7-day calories chart ── */}
        <Card style={styles.card}>
          <CardHeader><CardTitle>This Week</CardTitle></CardHeader>
          <CardContent>
            <CaloriesChart history={history} targetCalories={targetCalories} />
          </CardContent>
        </Card>

        {/* ── Today's meals ── */}
        <Card style={styles.card}>
          <CardHeader>
            <View style={styles.cardHeaderRow}>
              <CardTitle>Today's Meals</CardTitle>
              {loadingMeals && <ActivityIndicator size="small" color={colors.primary} />}
            </View>
          </CardHeader>
          <CardContent style={styles.mealsContent}>
            {todayMeals.length === 0 ? (
              <View style={styles.mealsEmpty}>
                <Ionicons name="restaurant-outline" size={28} color={colors.mutedForeground} />
                <Text style={styles.mealsEmptyText}>No meals logged yet today</Text>
                <TouchableOpacity
                  style={styles.mealsEmptyBtn}
                  onPress={() => { setPrefillMeal(null); setLogModalVisible(true); }}
                >
                  <Text style={styles.mealsEmptyBtnText}>+ Log your first meal</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View style={styles.mealsList}>
                {todayMeals.map((meal, i) => (
                  <View key={meal.id ?? i} style={styles.mealRow}>
                    <View style={styles.mealRowLeft}>
                      <View style={[styles.mealTypeDot, { backgroundColor: mealTypeColor(meal.mealType) }]} />
                      <View style={styles.mealRowInfo}>
                        <Text style={styles.mealRowName}>{meal.name}</Text>
                        <Text style={styles.mealRowMeta}>
                          {meal.mealType ?? 'meal'}{meal.calories > 0 ? ` · ${Math.round(meal.calories)} kcal` : ''}
                          {meal.proteinG > 0 ? ` · ${Math.round(meal.proteinG)}g P` : ''}
                        </Text>
                      </View>
                    </View>
                    <TouchableOpacity onPress={() => handleDeleteMeal(meal.id)} style={styles.mealDeleteBtn}>
                      <Ionicons name="trash-outline" size={14} color={colors.mutedForeground} />
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            )}
          </CardContent>
        </Card>

        {/* ── Meal suggestions ── */}
        <Button fullWidth variant="outline" onPress={handleGetMealSuggestions} loading={mealLoading} disabled={mealLoading}>
          View Meal Suggestions
        </Button>
      </ScrollView>

      {/* ── Meal Log Modal ── */}
      <MealLogModal
        visible={logModalVisible}
        onClose={() => setLogModalVisible(false)}
        onSaved={() => { setLogModalVisible(false); loadMealData(); }}
        prefill={prefillMeal}
        date={todayStr()}
      />

      {/* ── Meal suggestions modal ── */}
      <Modal
        visible={mealModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setMealModalVisible(false)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setMealModalVisible(false)}>
          <View style={styles.modalSpacer} />
          <Pressable style={styles.modalSheet} onPress={() => {}}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>Meal Suggestions</Text>
            <Text style={styles.modalSubtitle}>{mealSuggestions.length} meals matched to your macros</Text>

            <ScrollView
              style={styles.modalScroll}
              contentContainerStyle={styles.modalScrollContent}
              showsVerticalScrollIndicator={false}
              bounces={false}
            >
              {mealSuggestions.map((meal: any, i: number) => (
                <View key={i} style={styles.mealCard}>
                  <View style={styles.mealCardHeader}>
                    <Text style={styles.mealName}>{meal.name || `Meal ${i + 1}`}</Text>
                    {meal.mealType ? (
                      <View style={styles.mealTypeBadge}>
                        <Text style={styles.mealTypeText}>{meal.mealType}</Text>
                      </View>
                    ) : null}
                  </View>
                  {meal.description ? <Text style={styles.mealDesc}>{meal.description}</Text> : null}
                  {meal.macros ? (
                    <View style={styles.mealMacroRow}>
                      {meal.macros.proteinG != null && (
                        <View style={[styles.macroPill, { backgroundColor: '#3b82f620' }]}>
                          <Text style={[styles.macroPillText, { color: '#3b82f6' }]}>{meal.macros.proteinG}g P</Text>
                        </View>
                      )}
                      {meal.macros.carbsG != null && (
                        <View style={[styles.macroPill, { backgroundColor: '#f59e0b20' }]}>
                          <Text style={[styles.macroPillText, { color: '#f59e0b' }]}>{meal.macros.carbsG}g C</Text>
                        </View>
                      )}
                      {meal.macros.fatG != null && (
                        <View style={[styles.macroPill, { backgroundColor: '#ec489920' }]}>
                          <Text style={[styles.macroPillText, { color: '#ec4899' }]}>{meal.macros.fatG}g F</Text>
                        </View>
                      )}
                      {meal.macros.calories != null && (
                        <View style={[styles.macroPill, { backgroundColor: '#6366f120' }]}>
                          <Text style={[styles.macroPillText, { color: '#6366f1' }]}>{meal.macros.calories} cal</Text>
                        </View>
                      )}
                    </View>
                  ) : null}
                  {meal.prepMinutes != null && (
                    <Text style={styles.mealPrepTime}>{meal.prepMinutes} min prep</Text>
                  )}
                  {/* Log this meal button */}
                  <TouchableOpacity
                    style={styles.logThisMealBtn}
                    onPress={() => {
                      setMealModalVisible(false);
                      setPrefillMeal({
                        name: meal.name,
                        mealType: meal.mealType,
                        calories: meal.macros?.calories,
                        proteinG: meal.macros?.proteinG,
                        carbsG: meal.macros?.carbsG,
                        fatG: meal.macros?.fatG,
                      });
                      setLogModalVisible(true);
                    }}
                  >
                    <Ionicons name="add-circle-outline" size={13} color={colors.primary} />
                    <Text style={styles.logThisMealText}>Log this meal</Text>
                  </TouchableOpacity>
                </View>
              ))}
            </ScrollView>

            <Pressable style={styles.closeBtnPill} onPress={() => setMealModalVisible(false)}>
              <Text style={styles.closeBtnText}>Close</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

function mealTypeColor(type: string) {
  switch (type) {
    case 'breakfast': return '#f59e0b';
    case 'lunch': return '#22c55e';
    case 'dinner': return '#6366f1';
    case 'snack': return '#ec4899';
    default: return colors.mutedForeground;
  }
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xxl },
  card: {},

  // Empty state
  emptyContent: { alignItems: 'center', paddingVertical: spacing.xl, gap: spacing.md },
  emptyIcon: { fontSize: 40 },
  emptyTitle: { fontSize: fontSize.lg, fontWeight: fontWeight.semibold, color: colors.foreground },
  emptyDesc: { fontSize: fontSize.sm, color: colors.mutedForeground, textAlign: 'center', lineHeight: 20 },
  generateBtn: { marginTop: spacing.xs },
  planErrorText: { fontSize: fontSize.sm, color: '#ef4444', textAlign: 'center', marginTop: spacing.sm },

  // Card header row
  cardHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  logBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    borderWidth: 1, borderColor: colors.primary,
    borderRadius: radius.full,
    paddingHorizontal: 8, paddingVertical: 4,
  },
  logBtnText: { fontSize: 11, color: colors.primary, fontWeight: fontWeight.medium },

  // Calorie progress
  calContent: { gap: spacing.sm, paddingTop: 0 },
  calRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  calMain: { flexDirection: 'row', alignItems: 'baseline' },
  calLogged: { fontSize: 28, fontWeight: fontWeight.bold, color: colors.primary },
  calSlash: { fontSize: 18, color: colors.mutedForeground },
  calTarget: { fontSize: 18, fontWeight: fontWeight.semibold, color: colors.foreground },
  calUnit: { fontSize: fontSize.sm, color: colors.mutedForeground },
  calRemaining: { fontSize: fontSize.xs, color: colors.mutedForeground },

  // Progress bar
  progressTrack: {
    borderRadius: radius.full,
    backgroundColor: colors.border,
    overflow: 'hidden',
  },
  progressBar: { height: '100%', borderRadius: radius.full },

  // Macro grid
  macroGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, paddingTop: 0 },
  macroCard: {
    width: '47%',
    backgroundColor: colors.muted,
    borderRadius: radius.md,
    padding: spacing.sm,
    gap: 2,
  },
  macroIndicator: { width: 24, height: 3, borderRadius: radius.full, marginBottom: 4 },
  macroCardLabel: {
    fontSize: 10, color: colors.mutedForeground,
    fontWeight: fontWeight.medium, textTransform: 'uppercase', letterSpacing: 0.5,
  },
  macroGrams: { fontSize: fontSize.xl, fontWeight: fontWeight.bold },
  macroUnit: { fontSize: fontSize.sm, fontWeight: fontWeight.normal },
  macroTarget: { fontSize: 10, color: colors.mutedForeground },

  // Chart
  chartContainer: { gap: 6 },
  chartBars: { flexDirection: 'row', alignItems: 'flex-end', height: 100, gap: 4 },
  chartBarCol: { alignItems: 'center', gap: 3 },
  chartBarBg: { flex: 1, width: '100%', justifyContent: 'flex-end', position: 'relative' },
  chartBar: { width: '100%' },
  targetLine: {
    position: 'absolute', left: 0, right: 0, height: 1,
    backgroundColor: `${colors.primary}50`,
    borderStyle: 'dashed',
  },
  chartCalLabel: { fontSize: 8, color: colors.mutedForeground, textAlign: 'center' },
  chartCalLabelToday: { color: colors.primary, fontWeight: fontWeight.semibold },
  chartDayLabel: { fontSize: 9, color: colors.mutedForeground, textAlign: 'center' },
  chartDayLabelToday: { color: colors.primary, fontWeight: fontWeight.semibold },
  chartTargetLegend: { fontSize: 9, color: colors.mutedForeground, textAlign: 'right' },

  // Today's meals list
  mealsContent: { paddingTop: 0 },
  mealsEmpty: { alignItems: 'center', paddingVertical: spacing.lg, gap: spacing.xs },
  mealsEmptyText: { fontSize: fontSize.sm, color: colors.mutedForeground },
  mealsEmptyBtn: { marginTop: spacing.xs },
  mealsEmptyBtnText: { fontSize: fontSize.sm, color: colors.primary, fontWeight: fontWeight.medium },
  mealsList: { gap: spacing.xs },
  mealRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: spacing.xs,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  mealRowLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flex: 1 },
  mealTypeDot: { width: 8, height: 8, borderRadius: 4 },
  mealRowInfo: { flex: 1 },
  mealRowName: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.foreground },
  mealRowMeta: { fontSize: fontSize.xs, color: colors.mutedForeground, textTransform: 'capitalize' },
  mealDeleteBtn: { padding: 6 },

  // Meal suggestions modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' },
  modalSpacer: { flex: 1 },
  modalSheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingBottom: 34,
    height: MEAL_SHEET_HEIGHT,
  },
  modalHandle: {
    width: 40, height: 4, borderRadius: radius.full,
    backgroundColor: colors.border,
    alignSelf: 'center',
    marginBottom: spacing.sm,
  },
  modalTitle: { fontSize: fontSize.lg, fontWeight: fontWeight.semibold, color: colors.foreground },
  modalSubtitle: { fontSize: fontSize.xs, color: colors.mutedForeground, marginTop: 2, marginBottom: spacing.sm },
  modalScroll: { flex: 1, minHeight: 0 },
  modalScrollContent: { gap: spacing.sm, paddingBottom: spacing.md },
  mealCard: { backgroundColor: colors.muted, borderRadius: radius.lg, padding: spacing.sm, gap: 6 },
  mealCardHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.xs },
  mealName: { flex: 1, fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.foreground },
  mealTypeBadge: { backgroundColor: `${colors.primary}20`, borderRadius: radius.full, paddingHorizontal: 8, paddingVertical: 2 },
  mealTypeText: { fontSize: 10, color: colors.primary, fontWeight: fontWeight.semibold, textTransform: 'capitalize' },
  mealDesc: { fontSize: fontSize.xs, color: colors.mutedForeground, lineHeight: 17 },
  mealMacroRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 5 },
  macroPill: { borderRadius: radius.full, paddingHorizontal: 8, paddingVertical: 3 },
  macroPillText: { fontSize: 10, fontWeight: fontWeight.semibold },
  mealPrepTime: { fontSize: 10, color: colors.mutedForeground },
  logThisMealBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingTop: 4,
    borderTopWidth: 1, borderTopColor: colors.border,
    marginTop: 2,
  },
  logThisMealText: { fontSize: fontSize.xs, color: colors.primary, fontWeight: fontWeight.medium },
  closeBtnPill: {
    backgroundColor: colors.foreground, borderRadius: radius.xl,
    paddingVertical: 14, alignItems: 'center', marginTop: spacing.sm,
  },
  closeBtnText: { fontSize: fontSize.base, fontWeight: fontWeight.semibold, color: colors.primaryForeground },

  // Projection card
  projContent: { paddingTop: 0, gap: spacing.sm },
  projRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 4 },
  projLabel: { fontSize: fontSize.sm, color: colors.mutedForeground, flex: 1 },
  projValue: { fontSize: fontSize.sm, fontWeight: fontWeight.bold },
  calAdjustSection: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.sm, gap: spacing.xs },
  calAdjustLabel: { fontSize: fontSize.xs, color: colors.mutedForeground, fontWeight: fontWeight.medium, textTransform: 'uppercase', letterSpacing: 0.5 },
  calAdjustRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  calAdjustBtn: {
    backgroundColor: colors.muted, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: spacing.md, paddingVertical: 8,
  },
  calAdjustBtnText: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.foreground },
  calAdjustDisplay: { flex: 1, alignItems: 'center' },
  calAdjustDisplayVal: { fontSize: fontSize.lg, fontWeight: fontWeight.bold, color: colors.foreground },
  calAdjustDiff: { fontSize: 10, fontWeight: fontWeight.medium },
  resetBtn: { alignSelf: 'center' },
  resetBtnText: { fontSize: fontSize.xs, color: colors.primary, fontWeight: fontWeight.medium },
});
