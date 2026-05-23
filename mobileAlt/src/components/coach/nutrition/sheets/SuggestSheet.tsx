// SuggestSheet — Anakin's meal suggestions ranked by what's missing from
// the day's macro targets. Spec: handoff §10 + §06 (GhostSlotRow tap).
//
// Server-side LLM scoring: posts the user's remaining macros + slot
// preference to /nutrition/suggest-meals, which pulls goal/budget context
// from the user's coach profile and returns 4 ranked candidates. Falls
// back to a small static template library only when the network/LLM call
// fails (e.g. offline) so the sheet always has something useful to show.

import React, { useEffect, useMemo, useState } from 'react';
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
  remaining: {
    kcal: number;
    protein: number;
    carbs: number;
    fat: number;
  };
  slot?: MealSlotApi | null;
  onLogged: () => void | Promise<void>;
}

interface Suggestion {
  name: string;
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  fits?: 'protein' | 'carbs' | 'fat' | 'balanced';
  slots?: MealSlotApi[];
}

/**
 * Offline fallback. Same templates the v1 SuggestSheet used. Kept small
 * because the LLM path is the primary one — these only render when the
 * /suggest-meals call fails outright.
 */
const FALLBACK: Suggestion[] = [
  { name: 'Greek yogurt + berries + walnuts',
    calories: 280, proteinG: 22, carbsG: 24, fatG: 10, fits: 'protein' },
  { name: 'Grilled chicken + rice + broccoli',
    calories: 520, proteinG: 42, carbsG: 55, fatG: 12, fits: 'protein' },
  { name: 'Whey shake + banana',
    calories: 280, proteinG: 28, carbsG: 32, fatG: 4, fits: 'protein' },
  { name: 'Avocado toast + 2 eggs',
    calories: 440, proteinG: 18, carbsG: 32, fatG: 26, fits: 'fat' },
];

export function SuggestSheet({ visible, onClose, remaining, slot, onLogged }: Props) {
  const [loading, setLoading] = useState(false);
  const [list, setList] = useState<Suggestion[]>([]);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Fetch when the sheet opens. Refetch when the remaining numbers change
  // by a meaningful delta (logging a meal mid-sheet would otherwise leave
  // stale suggestions visible).
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await nutritionApi.suggestMeals({ remaining, slot: slot ?? null });
        const suggestions = Array.isArray((res as any)?.suggestions)
          ? (res as any).suggestions as Suggestion[]
          : [];
        if (!cancelled) {
          setList(suggestions.length > 0 ? suggestions : FALLBACK);
        }
      } catch {
        if (!cancelled) {
          setList(FALLBACK);
          setError('Showing offline suggestions.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [visible, remaining.kcal, remaining.protein, remaining.carbs, remaining.fat, slot]);

  const handleLog = async (s: Suggestion) => {
    setSavingId(s.name);
    setError(null);
    try {
      await nutritionApi.logMeal({
        date: todayStr(),
        name: s.name,
        mealType: slot ?? slotForNow(),
        calories: s.calories,
        proteinG: s.proteinG,
        carbsG: s.carbsG,
        fatG: s.fatG,
      });
      Analytics.foodTypedLogged({ calories: s.calories });
      await Promise.resolve(onLogged());
      onClose();
    } catch (err: any) {
      setError(err?.message ?? 'Could not log that. Try again.');
    } finally {
      setSavingId(null);
    }
  };

  const subtitle = useMemo(() => {
    const biggest =
      remaining.protein >= remaining.carbs && remaining.protein >= remaining.fat ? 'protein'
      : remaining.carbs >= remaining.fat ? 'carbs' : 'fat';
    const amount = Math.round(remaining[biggest as 'protein' | 'carbs' | 'fat']);
    return amount > 0
      ? `Tailored to ${amount}g ${biggest} remaining.`
      : 'Already on plan — these are gentle add-ons.';
  }, [remaining]);

  return (
    <BottomSheet visible={visible} onClose={onClose} title="Anakin suggests" subtitle={subtitle}>
      {loading ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator color={colors.foreground} />
          <Text style={styles.loadingText}>Anakin is choosing your next meal…</Text>
        </View>
      ) : (
        <View style={{ gap: 8 }}>
          {list.map((s) => (
            <View key={s.name} style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text style={styles.name} numberOfLines={1}>{s.name}</Text>
                <Text style={styles.macros}>
                  {s.calories} kcal · P {s.proteinG} · C {s.carbsG} · F {s.fatG}
                </Text>
              </View>
              <TouchableOpacity
                style={[styles.logBtn, savingId === s.name && styles.logBtnSaving]}
                onPress={() => handleLog(s)}
                disabled={!!savingId}
                accessibilityRole="button"
                accessibilityLabel={`Log ${s.name}`}
              >
                {savingId === s.name
                  ? <ActivityIndicator color={colors.primaryForeground} />
                  : <Text style={styles.logBtnText}>Log</Text>}
              </TouchableOpacity>
            </View>
          ))}
        </View>
      )}
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  loadingBox: { alignItems: 'center', paddingVertical: 24, gap: 10 },
  loadingText: { fontSize: 12, color: colors.mutedForeground },
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
