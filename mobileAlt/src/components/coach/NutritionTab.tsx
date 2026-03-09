import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  Modal,
  Pressable,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
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
  const [mealSuggestions, setMealSuggestions] = useState<string[]>([]);
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
    setMealModalVisible(true);
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
      console.log('[MealSuggestions] request body:', JSON.stringify(requestBody));
      const result = await coachApi.getMealSuggestions(requestBody);
      console.log('[MealSuggestions] full response:', JSON.stringify(result));
      const raw: any[] = Array.isArray(result)
        ? result
        : result?.meals ?? result?.suggestions ?? result?.mealSuggestions ?? [];
      console.log('[MealSuggestions] parsed items count:', raw.length);
      if (raw.length === 0) {
        setMealSuggestions(['No meal suggestions were returned. Please try again.']);
        return;
      }
      const suggestions: string[] = raw.map((item: any) => {
        if (typeof item === 'string') return item;
        if (item && typeof item === 'object') {
          const parts: string[] = [];
          if (item.name) parts.push(item.name);
          if (item.description) parts.push(item.description);
          if (item.macros) {
            const m = item.macros;
            const macroStr = [
              m.proteinG != null ? `${m.proteinG}g protein` : null,
              m.carbsG != null ? `${m.carbsG}g carbs` : null,
              m.fatG != null ? `${m.fatG}g fat` : null,
              m.calories != null ? `${m.calories} cal` : null,
            ].filter(Boolean).join(', ');
            if (macroStr) parts.push(`(${macroStr})`);
          }
          if (item.prepMinutes) parts.push(`${item.prepMinutes} min prep`);
          return parts.join(' — ') || JSON.stringify(item);
        }
        return String(item);
      });
      setMealSuggestions(suggestions);
    } catch (err: any) {
      console.error('[MealSuggestions] error:', err);
      setMealSuggestions([err?.message || 'Could not load meal suggestions. Please try again.']);
    } finally {
      setMealLoading(false);
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
      <Button fullWidth variant="outline" onPress={handleGetMealSuggestions}>
        View Meal Suggestions
      </Button>

      {/* Meal suggestions modal */}
      <Modal
        visible={mealModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setMealModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <Pressable
            style={styles.modalBackdrop}
            onPress={() => setMealModalVisible(false)}
          />
          <View style={styles.modalSheet}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>Meal Suggestions</Text>

            {mealLoading ? (
              <View style={styles.modalLoading}>
                <ActivityIndicator size="large" color={colors.primary} />
                <Text style={styles.modalLoadingText}>Generating suggestions...</Text>
              </View>
            ) : (
              <ScrollView style={styles.modalScroll} showsVerticalScrollIndicator={false}>
                {mealSuggestions.map((meal, i) => (
                  <View key={i} style={styles.mealRow}>
                    <View style={styles.mealBullet} />
                    <Text style={styles.mealText}>{meal}</Text>
                  </View>
                ))}
              </ScrollView>
            )}

            <Pressable
              style={styles.closeBtnPill}
              onPress={() => setMealModalVisible(false)}
            >
              <Text style={styles.closeBtnText}>Close</Text>
            </Pressable>
          </View>
        </View>
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
    justifyContent: 'flex-end',
  },
  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  modalSheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: spacing.md,
    paddingBottom: 34,
    maxHeight: '65%',
    gap: spacing.md,
  },
  modalHandle: {
    width: 40,
    height: 4,
    borderRadius: radius.full,
    backgroundColor: colors.border,
    alignSelf: 'center',
    marginBottom: spacing.xs,
  },
  modalTitle: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.semibold,
    color: colors.foreground,
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
  },
  mealRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  mealBullet: {
    width: 6,
    height: 6,
    borderRadius: radius.full,
    backgroundColor: colors.primary,
    marginTop: 6,
    flexShrink: 0,
  },
  mealText: {
    fontSize: fontSize.sm,
    color: colors.foreground,
    flex: 1,
    lineHeight: 20,
  },
  closeBtnPill: {
    backgroundColor: colors.foreground,
    borderRadius: radius.xl,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: spacing.xs,
  },
  closeBtnText: {
    fontSize: fontSize.base,
    fontWeight: fontWeight.semibold,
    color: colors.primaryForeground,
  },
});
