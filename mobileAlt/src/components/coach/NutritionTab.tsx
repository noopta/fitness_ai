import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  Modal,
  Pressable,
  StyleSheet,
  Dimensions,
} from 'react-native';

const MEAL_SHEET_HEIGHT = Dimensions.get('window').height * 0.75;
import { colors, fontSize, fontWeight, spacing, radius } from '../../constants/theme';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/Card';
import { Button } from '../ui/Button';
import { coachApi } from '../../lib/api';

interface NutritionTabProps {
  coachData: any;
  coachGoal?: string | null;
  coachBudget?: string | null;
  onRefresh?: () => Promise<void> | void;
}

function ProgressBar({ value, color }: { value: number; color: string }) {
  const pct = Math.min(Math.max(value, 0), 100);
  return (
    <View style={styles.progressTrack}>
      <View style={[styles.progressBar, { width: `${pct}%`, backgroundColor: color }]} />
    </View>
  );
}

interface MacroCardProps {
  label: string;
  grams: number | null;
  progressPct: number;
  color: string;
  target?: string;
}

function MacroCard({ label, grams, progressPct, color, target }: MacroCardProps) {
  return (
    <View style={styles.macroCard}>
      <View style={[styles.macroIndicator, { backgroundColor: color }]} />
      <Text style={styles.macroLabel}>{label}</Text>
      <Text style={[styles.macroGrams, { color }]}>
        {grams !== null ? `${grams}g` : target ?? '—'}
      </Text>
      {grams !== null && <ProgressBar value={progressPct} color={color} />}
    </View>
  );
}

export function NutritionTab({ coachData, coachGoal, coachBudget, onRefresh }: NutritionTabProps) {
  const [mealModalVisible, setMealModalVisible] = useState(false);
  const [mealSuggestions, setMealSuggestions] = useState<any[]>([]);
  const [mealLoading, setMealLoading] = useState(false);
  const [generatingPlan, setGeneratingPlan] = useState(false);

  // Parse nutrition plan
  let nutritionPlan: any = null;
  if (coachData?.savedProgram) {
    try {
      const prog =
        typeof coachData.savedProgram === 'string'
          ? JSON.parse(coachData.savedProgram)
          : coachData.savedProgram;
      nutritionPlan = prog?.nutritionPlan ?? prog?.nutrition ?? null;
    } catch {
      nutritionPlan = null;
    }
  }

  const macros = nutritionPlan?.macros ?? nutritionPlan;
  const calories: number | null = macros?.calories ?? nutritionPlan?.calories ?? null;
  const protein: number | null = macros?.proteinG ?? macros?.protein_g ?? macros?.protein ?? null;
  const carbs: number | null = macros?.carbsG ?? macros?.carbs_g ?? macros?.carbs ?? null;
  const fat: number | null = macros?.fatG ?? macros?.fat_g ?? macros?.fat ?? null;
  const fiber: number | null = macros?.fiberG ?? macros?.fiber_g ?? macros?.fiber ?? null;

  // Progress bar percentages
  const proteinTarget = calories ? (calories * 0.35) / 4 : null;
  const carbsTarget = calories ? (calories * 0.45) / 4 : null;
  const fatTarget = calories ? (calories * 0.30) / 9 : null;

  const proteinPct = protein && proteinTarget ? (protein / proteinTarget) * 100 : 0;
  const carbsPct = carbs && carbsTarget ? (carbs / carbsTarget) * 100 : 0;
  const fatPct = fat && fatTarget ? (fat / fatTarget) * 100 : 0;
  const fiberPct = fiber ? (fiber / 35) * 100 : 0;

  async function handleGetMealSuggestions() {
    setMealLoading(true);
    try {
      const requestBody = {
        macros: {
          proteinG: protein ?? 150,
          carbsG: carbs ?? 200,
          fatG: fat ?? 60,
          calories: calories ?? 2000,
        },
        goal: coachGoal || 'strength',
        numberOfMeals: 5,
        budget: coachBudget || null,
      };
      const result = await coachApi.getMealSuggestions(requestBody);
      const raw: any[] = Array.isArray(result)
        ? result
        : result?.meals ?? result?.suggestions ?? result?.mealSuggestions ?? [];
      if (raw.length === 0) {
        setMealSuggestions([{ name: 'No suggestions returned', description: 'Please try again.' }]);
      } else {
        // Store objects (or wrap strings) for richer rendering
        setMealSuggestions(raw.map((item: any) =>
          typeof item === 'string' ? { name: item } : item
        ));
      }
    } catch (err: any) {
      setMealSuggestions([{ name: err?.message || 'Could not load meal suggestions. Please try again.' }]);
    } finally {
      setMealLoading(false);
      setMealModalVisible(true); // open modal only after results are ready
    }
  }

  const [planError, setPlanError] = useState<string | null>(null);

  async function handleGeneratePlan() {
    setGeneratingPlan(true);
    setPlanError(null);
    try {
      const plan = await coachApi.generateNutritionPlan({
        goal: coachGoal || 'general',
      });
      console.log('[NutritionTab] Generated plan:', JSON.stringify(plan).slice(0, 300));

      const existingProgram = coachData?.savedProgram ?? {};
      const merged = { ...existingProgram, nutritionPlan: plan };
      await coachApi.updateProgram({ program: merged });

      if (onRefresh) await onRefresh();
    } catch (err: any) {
      console.error('[NutritionTab] Generate plan error:', err);
      setPlanError(err?.message || 'Failed to generate nutrition plan. Please try again.');
    } finally {
      setGeneratingPlan(false);
    }
  }

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
              Generate a personalized nutrition plan based on your goals.
            </Text>
            <Button
              fullWidth
              onPress={handleGeneratePlan}
              loading={generatingPlan}
              style={styles.generateBtn}
            >
              Generate Nutrition Plan
            </Button>
            {planError && (
              <Text style={styles.planErrorText}>{planError}</Text>
            )}
          </CardContent>
        </Card>
      </ScrollView>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      {/* Calorie card */}
      <Card style={styles.card}>
        <CardHeader>
          <CardTitle>Daily Calories</CardTitle>
        </CardHeader>
        <CardContent style={styles.calorieContent}>
          <Text style={styles.calorieNumber}>{calories ?? '—'}</Text>
          <Text style={styles.calorieLabel}>Daily Target (kcal)</Text>
          {nutritionPlan.maintenance && (
            <View style={styles.calorieComparison}>
              <View style={styles.comparisonItem}>
                <Text style={styles.comparisonValue}>{nutritionPlan.maintenance}</Text>
                <Text style={styles.comparisonLabel}>Maintenance</Text>
              </View>
              <View style={styles.comparisonDivider} />
              <View style={styles.comparisonItem}>
                <Text style={[styles.comparisonValue, { color: colors.primary }]}>
                  {calories}
                </Text>
                <Text style={styles.comparisonLabel}>Goal</Text>
              </View>
            </View>
          )}
        </CardContent>
      </Card>

      {/* Macro grid */}
      <Card style={styles.card}>
        <CardHeader>
          <CardTitle>Macronutrients</CardTitle>
        </CardHeader>
        <CardContent style={styles.macroGrid}>
          <MacroCard
            label="Protein"
            grams={protein}
            progressPct={proteinPct}
            color="#3b82f6"
          />
          <MacroCard
            label="Carbs"
            grams={carbs}
            progressPct={carbsPct}
            color="#f59e0b"
          />
          <MacroCard
            label="Fat"
            grams={fat}
            progressPct={fatPct}
            color="#ec4899"
          />
          <MacroCard
            label="Fiber"
            grams={fiber}
            progressPct={fiberPct}
            color="#22c55e"
            target="25-35g"
          />
        </CardContent>
      </Card>

      {/* Meal suggestions */}
      <Button fullWidth variant="outline" onPress={handleGetMealSuggestions} loading={mealLoading} disabled={mealLoading}>
        View Meal Suggestions
      </Button>

      {/* Meal suggestions modal */}
      <Modal
        visible={mealModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setMealModalVisible(false)}
      >
        <Pressable
          style={styles.modalOverlay}
          onPress={() => setMealModalVisible(false)}
        >
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
                  {meal.description ? (
                    <Text style={styles.mealDesc}>{meal.description}</Text>
                  ) : null}
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
                </View>
              ))}
            </ScrollView>

            <Pressable
              style={styles.closeBtnPill}
              onPress={() => setMealModalVisible(false)}
            >
              <Text style={styles.closeBtnText}>Close</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: spacing.md,
    gap: spacing.md,
    paddingBottom: spacing.xxl,
  },
  card: {},
  emptyContent: {
    alignItems: 'center',
    paddingVertical: spacing.xl,
    gap: spacing.md,
  },
  emptyIcon: {
    fontSize: 40,
  },
  emptyTitle: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.semibold,
    color: colors.foreground,
  },
  emptyDesc: {
    fontSize: fontSize.sm,
    color: colors.mutedForeground,
    textAlign: 'center',
    lineHeight: 20,
  },
  generateBtn: {
    marginTop: spacing.xs,
  },
  calorieContent: {
    alignItems: 'center',
    paddingTop: 0,
    gap: spacing.sm,
  },
  calorieNumber: {
    fontSize: 56,
    fontWeight: fontWeight.bold,
    color: colors.primary,
    lineHeight: 64,
  },
  calorieLabel: {
    fontSize: fontSize.sm,
    color: colors.mutedForeground,
  },
  calorieComparison: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.lg,
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    width: '100%',
  },
  comparisonItem: {
    alignItems: 'center',
    flex: 1,
  },
  comparisonValue: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.bold,
    color: colors.foreground,
  },
  comparisonLabel: {
    fontSize: fontSize.xs,
    color: colors.mutedForeground,
    marginTop: 2,
  },
  comparisonDivider: {
    width: 1,
    height: 32,
    backgroundColor: colors.border,
  },
  macroGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    paddingTop: 0,
  },
  macroCard: {
    width: '47%',
    backgroundColor: colors.muted,
    borderRadius: radius.md,
    padding: spacing.sm,
    gap: 4,
  },
  macroIndicator: {
    width: 24,
    height: 4,
    borderRadius: radius.full,
    marginBottom: 4,
  },
  macroLabel: {
    fontSize: fontSize.xs,
    color: colors.mutedForeground,
    fontWeight: fontWeight.medium,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  macroGrams: {
    fontSize: fontSize.xl,
    fontWeight: fontWeight.bold,
  },
  progressTrack: {
    height: 4,
    borderRadius: radius.full,
    backgroundColor: colors.border,
    overflow: 'hidden',
    marginTop: 4,
  },
  progressBar: {
    height: '100%',
    borderRadius: radius.full,
  },
  planErrorText: {
    fontSize: fontSize.sm,
    color: '#ef4444',
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  modalSpacer: {
    flex: 1,
  },
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
    width: 40,
    height: 4,
    borderRadius: radius.full,
    backgroundColor: colors.border,
    alignSelf: 'center',
    marginBottom: spacing.sm,
  },
  modalTitle: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.semibold,
    color: colors.foreground,
  },
  modalSubtitle: {
    fontSize: fontSize.xs,
    color: colors.mutedForeground,
    marginTop: 2,
    marginBottom: spacing.sm,
  },
  modalLoading: {
    alignItems: 'center',
    paddingVertical: spacing.xl,
    gap: spacing.sm,
  },
  modalLoadingText: {
    fontSize: fontSize.sm,
    color: colors.mutedForeground,
  },
  modalScroll: {
    flex: 1,
    minHeight: 0,
  },
  modalScrollContent: {
    gap: spacing.sm,
    paddingBottom: spacing.md,
  },
  // New meal card styles
  mealCard: {
    backgroundColor: colors.muted,
    borderRadius: radius.lg,
    padding: spacing.sm,
    gap: 6,
  },
  mealCardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.xs,
  },
  mealName: {
    flex: 1,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    color: colors.foreground,
  },
  mealTypeBadge: {
    backgroundColor: `${colors.primary}20`,
    borderRadius: radius.full,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  mealTypeText: {
    fontSize: 10,
    color: colors.primary,
    fontWeight: fontWeight.semibold,
    textTransform: 'capitalize',
  },
  mealDesc: {
    fontSize: fontSize.xs,
    color: colors.mutedForeground,
    lineHeight: 17,
  },
  mealMacroRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 5,
  },
  macroPill: {
    borderRadius: radius.full,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  macroPillText: {
    fontSize: 10,
    fontWeight: fontWeight.semibold,
  },
  mealPrepTime: {
    fontSize: 10,
    color: colors.mutedForeground,
  },
  closeBtnPill: {
    backgroundColor: colors.foreground,
    borderRadius: radius.xl,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  closeBtnText: {
    fontSize: fontSize.base,
    fontWeight: fontWeight.semibold,
    color: colors.primaryForeground,
  },
});
