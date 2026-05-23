// SuggestSheet — Anakin's meal suggestions ranked by what's missing from
// the day's macro targets. Spec: handoff §10 (SuggestSheet) + §06
// (GhostSlotRow tap).
//
// v1: no per-slot suggestion endpoint exists yet, so we generate three
// candidate meals client-side from a small template library and rank them
// by how well they close the user's biggest macro gap (protein > carbs
// > fat). Each row has a Log button that commits via nutritionApi.logMeal.

import React, { useMemo, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ActivityIndicator,
} from 'react-native';
import { nutritionApi } from '../../../../lib/api';
import { Analytics } from '../../../../lib/analytics';
import { colors, fontWeight } from '../../../../constants/theme';
import { BottomSheet } from './BottomSheet';
import { slotForNow, todayStr, type MealSlotApi } from './sheetHelpers';

interface Props {
  visible: boolean;
  onClose: () => void;
  /** What's left to hit today, in grams. nulls mean "no target set". */
  remaining: {
    kcal: number;
    protein: number;
    carbs: number;
    fat: number;
  };
  /** Optional slot pre-filter when entered via a ghost-slot tap. */
  slot?: MealSlotApi | null;
  onLogged: () => void | Promise<void>;
}

interface Template {
  name: string;
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  /** Which macro this meal best closes the gap on. */
  fits: 'protein' | 'carbs' | 'fat' | 'balanced';
  /** Slots the suggestion makes sense in. */
  slots: MealSlotApi[];
}

/**
 * Small static library. Each entry is an editorial choice — picked because
 * it's a real food users actually eat, with realistic macro splits. Real
 * personalisation will land when the backend exposes a suggestion endpoint.
 */
const LIBRARY: Template[] = [
  { name: 'Greek yogurt + berries + walnuts',
    calories: 280, proteinG: 22, carbsG: 24, fatG: 10, fits: 'protein',
    slots: ['breakfast', 'snack'] },
  { name: 'Grilled chicken + jasmine rice + broccoli',
    calories: 520, proteinG: 42, carbsG: 55, fatG: 12, fits: 'protein',
    slots: ['lunch', 'dinner'] },
  { name: 'Cottage cheese + apple + cinnamon',
    calories: 220, proteinG: 22, carbsG: 26, fatG: 3, fits: 'protein',
    slots: ['snack'] },
  { name: 'Whey shake + banana',
    calories: 280, proteinG: 28, carbsG: 32, fatG: 4, fits: 'protein',
    slots: ['snack', 'breakfast'] },
  { name: 'Salmon + sweet potato + asparagus',
    calories: 540, proteinG: 38, carbsG: 38, fatG: 22, fits: 'balanced',
    slots: ['dinner'] },
  { name: 'Steel-cut oats + whey + peanut butter',
    calories: 460, proteinG: 32, carbsG: 50, fatG: 14, fits: 'carbs',
    slots: ['breakfast'] },
  { name: 'Tuna wrap + side salad',
    calories: 420, proteinG: 30, carbsG: 38, fatG: 16, fits: 'protein',
    slots: ['lunch'] },
  { name: 'Casein shake + handful of almonds',
    calories: 280, proteinG: 25, carbsG: 14, fatG: 14, fits: 'protein',
    slots: ['snack'] },
  { name: 'Avocado toast + 2 eggs',
    calories: 440, proteinG: 18, carbsG: 32, fatG: 26, fits: 'fat',
    slots: ['breakfast', 'lunch'] },
  { name: 'Beef stir-fry + brown rice',
    calories: 580, proteinG: 36, carbsG: 58, fatG: 18, fits: 'balanced',
    slots: ['dinner', 'lunch'] },
];

/** Score a template by how much of the biggest gap it would close. */
function scoreFor(
  t: Template,
  remaining: { protein: number; carbs: number; fat: number; kcal: number },
  slot: MealSlotApi | null,
): number {
  let score = 0;
  // Closing the biggest gap wins — pick whichever macro is most in deficit
  // and reward templates that contribute to it.
  const biggest =
    remaining.protein >= remaining.carbs && remaining.protein >= remaining.fat ? 'protein'
    : remaining.carbs >= remaining.fat ? 'carbs' : 'fat';
  if (t.fits === biggest || t.fits === 'balanced') score += 40;
  // Slot match
  if (slot && t.slots.includes(slot)) score += 15;
  // Don't blow through the remaining kcal budget — penalize templates that
  // are way over (or way under) what's left.
  if (remaining.kcal > 0) {
    const ratio = t.calories / remaining.kcal;
    if (ratio > 0.4 && ratio < 1.05) score += 25;
    else if (ratio >= 1.05 && ratio < 1.4) score += 5;
  }
  // Small tie-breaker — prefer higher protein when scores tie.
  score += Math.round(t.proteinG / 10);
  return score;
}

export function SuggestSheet({ visible, onClose, remaining, slot, onLogged }: Props) {
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const ranked = useMemo(() => {
    return LIBRARY
      .map((t) => ({ t, score: scoreFor(t, remaining, slot ?? null) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 4)
      .map((r) => r.t);
  }, [remaining, slot]);

  const handleLog = async (t: Template) => {
    setSavingId(t.name);
    setError(null);
    try {
      await nutritionApi.logMeal({
        date: todayStr(),
        name: t.name,
        mealType: slot ?? slotForNow(),
        calories: t.calories,
        proteinG: t.proteinG,
        carbsG: t.carbsG,
        fatG: t.fatG,
      });
      Analytics.foodTypedLogged({ calories: t.calories });
      await Promise.resolve(onLogged());
      onClose();
    } catch (err: any) {
      setError(err?.message ?? 'Could not log that. Try again.');
    } finally {
      setSavingId(null);
    }
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title="Anakin suggests"
      subtitle={`Tailored to ${remaining.protein > 0 ? `${Math.round(remaining.protein)}g protein` : 'today'} remaining.`}
    >
      <View style={{ gap: 8 }}>
        {ranked.map((t) => (
          <View key={t.name} style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.name} numberOfLines={1}>{t.name}</Text>
              <Text style={styles.macros}>
                {t.calories} kcal · P {t.proteinG} · C {t.carbsG} · F {t.fatG}
              </Text>
            </View>
            <TouchableOpacity
              style={[styles.logBtn, savingId === t.name && styles.logBtnSaving]}
              onPress={() => handleLog(t)}
              disabled={!!savingId}
              accessibilityRole="button"
              accessibilityLabel={`Log ${t.name}`}
            >
              {savingId === t.name
                ? <ActivityIndicator color={colors.primaryForeground} />
                : <Text style={styles.logBtnText}>Log</Text>}
            </TouchableOpacity>
          </View>
        ))}
      </View>
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 12, paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.card,
  },
  name: { fontSize: 13.5, fontWeight: fontWeight.bold, color: colors.foreground },
  macros: { fontSize: 11, color: colors.mutedForeground, marginTop: 2, fontVariant: ['tabular-nums'] },
  logBtn: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999,
    backgroundColor: colors.foreground,
    marginLeft: 10,
    minWidth: 60, alignItems: 'center',
  },
  logBtnSaving: { opacity: 0.7 },
  logBtnText: { color: colors.primaryForeground, fontWeight: fontWeight.bold, fontSize: 12 },
  errorText: { color: colors.destructive, fontSize: 12, marginTop: 8, textAlign: 'center' },
});
