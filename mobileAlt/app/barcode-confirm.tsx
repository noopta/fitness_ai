// Confirm-and-log screen after a successful barcode lookup. Per-100g macros
// from OpenFoodFacts get scaled by the user-entered serving size in grams
// (defaulting to the product's listed serving when available). One Log
// button persists via nutritionApi.logMeal and routes home.

import React, { useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity,
  ActivityIndicator, Alert, Image, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { nutritionApi } from '../src/lib/api';
import { Analytics } from '../src/lib/analytics';
import { colors, spacing, radius, fontSize, fontWeight } from '../src/constants/theme';

function todayDateStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function num(s: string | string[] | undefined, fallback = 0): number {
  if (Array.isArray(s)) s = s[0];
  const n = parseFloat(String(s ?? ''));
  return Number.isFinite(n) ? n : fallback;
}

export default function BarcodeConfirmScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    code?: string; name?: string; brand?: string;
    calories?: string; proteinG?: string; carbsG?: string; fatG?: string;
    servingSize?: string; servingQuantityG?: string; imageUrl?: string;
  }>();

  const productName = String(params.name ?? 'Unknown product');
  const brand = String(params.brand ?? '');
  const imageUrl = String(params.imageUrl ?? '');
  // OpenFoodFacts macros are per-100g. We default the serving to the
  // product's listed grams (e.g. 30g for a packet of chips) when present,
  // otherwise 100g.
  const initialServingG = num(params.servingQuantityG, 100) || 100;

  const per100 = useMemo(() => ({
    calories: num(params.calories),
    proteinG: num(params.proteinG),
    carbsG: num(params.carbsG),
    fatG: num(params.fatG),
  }), [params.calories, params.proteinG, params.carbsG, params.fatG]);

  const [servingG, setServingG] = useState(String(initialServingG));
  const [logging, setLogging] = useState(false);

  // Scale macros by (servingG / 100).
  const scaled = useMemo(() => {
    const factor = (num(servingG, 100) || 100) / 100;
    return {
      calories: Math.round(per100.calories * factor),
      proteinG: Math.round(per100.proteinG * factor * 10) / 10,
      carbsG:   Math.round(per100.carbsG   * factor * 10) / 10,
      fatG:     Math.round(per100.fatG     * factor * 10) / 10,
    };
  }, [per100, servingG]);

  async function handleLog() {
    if (!productName.trim()) return;
    setLogging(true);
    try {
      await nutritionApi.logMeal({
        date: todayDateStr(),
        name: productName + (brand ? ` (${brand})` : ''),
        mealType: 'snack',
        calories: scaled.calories,
        proteinG: scaled.proteinG,
        carbsG:   scaled.carbsG,
        fatG:     scaled.fatG,
      } as any);
      Analytics.foodBarcodeLogged({ code: String(params.code ?? ''), name: productName, servingsLogged: 1 });
      router.replace('/(tabs)');
    } catch (err: any) {
      Alert.alert('Could not log', err?.message || 'Try again.');
      setLogging(false);
    }
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} hitSlop={10} style={styles.iconBtn}>
            <Ionicons name="close" size={22} color={colors.foreground} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Confirm food</Text>
          <View style={{ width: 22 }} />
        </View>

        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          {/* Product card */}
          <View style={styles.productCard}>
            {imageUrl ? (
              <Image source={{ uri: imageUrl }} style={styles.productImage} />
            ) : (
              <View style={styles.productImagePlaceholder}>
                <Ionicons name="fast-food-outline" size={32} color={colors.mutedForeground} />
              </View>
            )}
            <View style={{ flex: 1 }}>
              <Text style={styles.productName} numberOfLines={2}>{productName}</Text>
              {brand ? <Text style={styles.productBrand}>{brand}</Text> : null}
              <Text style={styles.productSource}>OpenFoodFacts</Text>
            </View>
          </View>

          {/* Serving editor */}
          <Text style={styles.sectionLabel}>Serving size</Text>
          <View style={styles.servingRow}>
            <TextInput
              value={servingG}
              onChangeText={setServingG}
              keyboardType="numeric"
              style={styles.servingInput}
            />
            <Text style={styles.servingUnit}>grams</Text>
          </View>

          {/* Macro readout */}
          <View style={styles.macroGrid}>
            <View style={styles.macroCard}>
              <Text style={styles.macroValue}>{scaled.calories}</Text>
              <Text style={styles.macroLabel}>kcal</Text>
            </View>
            <View style={styles.macroCard}>
              <Text style={styles.macroValue}>{scaled.proteinG}g</Text>
              <Text style={styles.macroLabel}>protein</Text>
            </View>
            <View style={styles.macroCard}>
              <Text style={styles.macroValue}>{scaled.carbsG}g</Text>
              <Text style={styles.macroLabel}>carbs</Text>
            </View>
            <View style={styles.macroCard}>
              <Text style={styles.macroValue}>{scaled.fatG}g</Text>
              <Text style={styles.macroLabel}>fat</Text>
            </View>
          </View>

          <Text style={styles.hint}>
            Macros scaled from per-100g values. Adjust grams to match your portion.
          </Text>
        </ScrollView>

        <View style={styles.footer}>
          <TouchableOpacity
            style={[styles.logBtn, logging && { opacity: 0.6 }]}
            onPress={handleLog}
            disabled={logging}
            activeOpacity={0.85}
          >
            {logging ? (
              <ActivityIndicator color={colors.primaryForeground} />
            ) : (
              <Text style={styles.logBtnText}>Log this meal</Text>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerTitle: { fontSize: fontSize.base, fontWeight: fontWeight.semibold, color: colors.foreground },
  iconBtn: { padding: 4 },

  body: { padding: spacing.lg, gap: spacing.md },

  productCard: {
    flexDirection: 'row',
    gap: spacing.md,
    alignItems: 'center',
    backgroundColor: colors.muted,
    borderRadius: radius.lg,
    padding: spacing.md,
  },
  productImage: { width: 72, height: 72, borderRadius: radius.md, backgroundColor: '#fff' },
  productImagePlaceholder: {
    width: 72, height: 72, borderRadius: radius.md, backgroundColor: colors.background,
    alignItems: 'center', justifyContent: 'center',
  },
  productName: { fontSize: fontSize.base, fontWeight: fontWeight.semibold, color: colors.foreground },
  productBrand: { fontSize: fontSize.sm, color: colors.mutedForeground, marginTop: 2 },
  productSource: { fontSize: 10, color: colors.mutedForeground, marginTop: 4, letterSpacing: 0.5, textTransform: 'uppercase' },

  sectionLabel: {
    fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.foreground, marginTop: spacing.sm,
  },
  servingRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  servingInput: {
    flex: 1,
    backgroundColor: colors.muted,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 14,
    fontSize: fontSize.lg,
    fontWeight: fontWeight.semibold,
    color: colors.foreground,
  },
  servingUnit: { color: colors.mutedForeground, fontSize: fontSize.base },

  macroGrid: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  macroCard: {
    flex: 1, backgroundColor: colors.muted, borderRadius: radius.md,
    padding: spacing.md, alignItems: 'center',
  },
  macroValue: { fontSize: fontSize.lg, fontWeight: fontWeight.bold, color: colors.foreground },
  macroLabel: { fontSize: 11, color: colors.mutedForeground, marginTop: 2, textTransform: 'uppercase', letterSpacing: 0.5 },

  hint: { fontSize: fontSize.xs, color: colors.mutedForeground, textAlign: 'center', marginTop: spacing.md, paddingHorizontal: spacing.md },

  footer: { padding: spacing.lg, borderTopWidth: 1, borderTopColor: colors.border },
  logBtn: {
    backgroundColor: colors.foreground,
    paddingVertical: 16,
    borderRadius: radius.full,
    alignItems: 'center',
  },
  logBtnText: { color: colors.primaryForeground, fontSize: fontSize.base, fontWeight: fontWeight.semibold },
});
