// Pre-auth interactive diagnostic teaser. Per the user-psychology audit's
// #1 critical finding (95% drop at app-open → login), this lets unauthenticated
// users get a SPECIFIC, MEASURABLE output from the tool before hitting the
// auth wall.
//
// Flow:
//   1. Three lift inputs (bench, squat, deadlift) + bodyweight
//   2. Bodyweight-relative tier calculation (client-side, no API)
//   3. Personalized result screen with strength tier + 3 sample plan slots
//   4. "Save this plan and start training" CTA → routes into /register
//
// Intentionally light on backend dependency — the auth wall is the ONLY
// thing between exploration and signup, so the teaser must work even when
// the network is flaky.

import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput,
  Pressable, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Analytics } from '../../src/lib/analytics';
import { colors, spacing, radius, fontSize, fontWeight } from '../../src/constants/theme';

type Step = 'inputs' | 'result';

// Bodyweight-relative thresholds from Strength Standards (intermediate tier).
// Simplified to single male/unisex band — the goal is "give them a SPECIFIC
// answer in 60 seconds," not full diagnostic-engine fidelity. Numbers tuned
// against typical untrained → elite ranges.
const BENCH_BANDS  = [0.5, 0.85, 1.25, 1.75, 2.0];   // beginner / novice / intermediate / advanced / elite
const SQUAT_BANDS  = [0.75, 1.25, 1.75, 2.25, 2.75];
const DEAD_BANDS   = [1.0, 1.5, 2.25, 2.75, 3.0];
const TIER_LABELS  = ['Beginner', 'Novice', 'Intermediate', 'Advanced', 'Elite'];

function tierFor(lift: number, bw: number, bands: number[]): number {
  if (bw <= 0 || lift <= 0) return 0;
  const ratio = lift / bw;
  for (let i = bands.length - 1; i >= 0; i--) {
    if (ratio >= bands[i]) return i + 1; // returns 1..5
  }
  return 0; // sub-beginner
}

function overallTier(b: number, s: number, d: number): { tier: string; pct: number } {
  // Average of the three lift tiers, clamp to [0,5]. pct = 0..100 for the
  // progress arc visualization.
  const avg = (b + s + d) / 3;
  const clamped = Math.max(0, Math.min(5, avg));
  const idx = Math.round(clamped);
  return {
    tier: TIER_LABELS[Math.max(0, Math.min(4, idx - 1))] ?? 'Beginner',
    pct: (clamped / 5) * 100,
  };
}

function fmt(n: string): number {
  const v = parseFloat(n);
  return Number.isFinite(v) ? v : 0;
}

export default function DiagnosticPreviewScreen() {
  const router = useRouter();
  const [step, setStep] = useState<Step>('inputs');
  const [bench, setBench] = useState('');
  const [squat, setSquat] = useState('');
  const [dead, setDead] = useState('');
  const [bw, setBw] = useState('');
  const [unit, setUnit] = useState<'lbs' | 'kg'>('lbs');

  // Compute results when user advances to the result step.
  const r = (() => {
    const factor = unit === 'kg' ? 2.205 : 1;
    const b_lbs = fmt(bench) * factor;
    const s_lbs = fmt(squat) * factor;
    const d_lbs = fmt(dead)  * factor;
    const bw_lbs = fmt(bw)   * factor;

    const bTier = tierFor(b_lbs, bw_lbs, BENCH_BANDS);
    const sTier = tierFor(s_lbs, bw_lbs, SQUAT_BANDS);
    const dTier = tierFor(d_lbs, bw_lbs, DEAD_BANDS);
    const overall = overallTier(bTier, sTier, dTier);

    // Identify weakest lift relative to its bands → that's what the sample
    // plan will emphasize.
    const ratios = [
      { name: 'Bench Press', tier: bTier },
      { name: 'Squat',       tier: sTier },
      { name: 'Deadlift',    tier: dTier },
    ];
    ratios.sort((a, b) => a.tier - b.tier);
    const weakest = ratios[0]?.name ?? 'Bench Press';

    return { overall, weakest, bTier, sTier, dTier };
  })();

  const canAdvance =
    fmt(bench) > 0 && fmt(squat) > 0 && fmt(dead) > 0 && fmt(bw) > 0;

  function handleSubmit() {
    if (!canAdvance) return;
    Analytics.diagnosticPreviewCompleted?.({
      tier: r.overall.tier,
      weakest: r.weakest,
    });
    setStep('result');
  }

  function handleSignUp() {
    Analytics.diagnosticPreviewToSignup?.({ tier: r.overall.tier });
    router.replace('/(auth)/register');
  }

  if (step === 'inputs') {
    return (
      <SafeAreaView style={styles.safeArea}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={{ flex: 1 }}
        >
          <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
            <View style={styles.headerRow}>
              <Pressable onPress={() => router.back()} hitSlop={10} style={styles.backBtn}>
                <Ionicons name="chevron-back" size={22} color={colors.foreground} />
              </Pressable>
            </View>

            <Text style={styles.title}>60-second strength check.</Text>
            <Text style={styles.subtitle}>
              Tell us your best three lifts and we'll tell you your strength tier — instantly. No sign-up required.
            </Text>

            <View style={styles.unitToggle}>
              <TouchableOpacity
                style={[styles.unitChip, unit === 'lbs' && styles.unitChipActive]}
                onPress={() => setUnit('lbs')}
              >
                <Text style={[styles.unitChipText, unit === 'lbs' && styles.unitChipTextActive]}>lbs</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.unitChip, unit === 'kg' && styles.unitChipActive]}
                onPress={() => setUnit('kg')}
              >
                <Text style={[styles.unitChipText, unit === 'kg' && styles.unitChipTextActive]}>kg</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.inputBlock}>
              <Text style={styles.inputLabel}>Bodyweight</Text>
              <TextInput
                value={bw} onChangeText={setBw}
                keyboardType="numeric"
                placeholder={unit === 'lbs' ? '180' : '82'}
                placeholderTextColor={colors.mutedForeground}
                style={styles.input}
              />
            </View>

            <View style={styles.inputBlock}>
              <Text style={styles.inputLabel}>Heaviest Bench Press (1RM or 1-3 rep set)</Text>
              <TextInput
                value={bench} onChangeText={setBench}
                keyboardType="numeric"
                placeholder={unit === 'lbs' ? '225' : '100'}
                placeholderTextColor={colors.mutedForeground}
                style={styles.input}
              />
            </View>

            <View style={styles.inputBlock}>
              <Text style={styles.inputLabel}>Heaviest Squat</Text>
              <TextInput
                value={squat} onChangeText={setSquat}
                keyboardType="numeric"
                placeholder={unit === 'lbs' ? '315' : '140'}
                placeholderTextColor={colors.mutedForeground}
                style={styles.input}
              />
            </View>

            <View style={styles.inputBlock}>
              <Text style={styles.inputLabel}>Heaviest Deadlift</Text>
              <TextInput
                value={dead} onChangeText={setDead}
                keyboardType="numeric"
                placeholder={unit === 'lbs' ? '405' : '180'}
                placeholderTextColor={colors.mutedForeground}
                style={styles.input}
              />
            </View>

            <TouchableOpacity
              style={[styles.primaryBtn, !canAdvance && { opacity: 0.4 }]}
              onPress={handleSubmit}
              disabled={!canAdvance}
              activeOpacity={0.85}
            >
              <Text style={styles.primaryBtnText}>See my strength tier</Text>
            </TouchableOpacity>

            <Pressable onPress={() => router.replace('/(auth)/register')} style={styles.skipLink}>
              <Text style={styles.skipLinkText}>Skip and create an account</Text>
            </Pressable>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  // ── Result step ──────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.headerRow}>
          <Pressable onPress={() => setStep('inputs')} hitSlop={10} style={styles.backBtn}>
            <Ionicons name="chevron-back" size={22} color={colors.foreground} />
          </Pressable>
        </View>

        <Text style={styles.eyebrow}>YOUR STRENGTH TIER</Text>
        <Text style={styles.tierBig}>{r.overall.tier}</Text>

        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${r.overall.pct}%` }]} />
        </View>

        <View style={styles.liftCards}>
          {[
            { name: 'Bench Press', tier: r.bTier },
            { name: 'Squat',       tier: r.sTier },
            { name: 'Deadlift',    tier: r.dTier },
          ].map((row) => (
            <View key={row.name} style={styles.liftCard}>
              <Text style={styles.liftName}>{row.name}</Text>
              <Text style={styles.liftTier}>{TIER_LABELS[Math.max(0, Math.min(4, row.tier - 1))] ?? 'Sub-beginner'}</Text>
            </View>
          ))}
        </View>

        <View style={styles.planTeaser}>
          <View style={styles.planTeaserHeader}>
            <Ionicons name="barbell-outline" size={18} color={colors.primary} />
            <Text style={styles.planTeaserTitle}>Your 12-week plan would emphasize</Text>
          </View>
          <Text style={styles.planTeaserBody}>
            Your {r.weakest} lags relative to your other lifts — Anakin would
            build a 4-day program with extra accessory volume for the muscle
            groups behind it, plus weekly 1RM testing on your strongest lift to
            keep progress measurable.
          </Text>
        </View>

        <TouchableOpacity
          style={styles.primaryBtn}
          onPress={handleSignUp}
          activeOpacity={0.85}
        >
          <Text style={styles.primaryBtnText}>Save this plan & start training</Text>
        </TouchableOpacity>

        <Pressable onPress={() => router.replace('/(auth)/login')} style={styles.skipLink}>
          <Text style={styles.skipLinkText}>Already have an account? Sign in</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  scrollContent: { padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.md },

  headerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.md },
  backBtn: { padding: 6, marginLeft: -6 },

  title: {
    fontSize: 30, fontWeight: fontWeight.bold, color: colors.foreground,
    letterSpacing: -0.8, lineHeight: 34, marginBottom: 8,
  },
  subtitle: {
    fontSize: fontSize.base, color: colors.mutedForeground,
    marginBottom: spacing.lg, lineHeight: 22,
  },

  unitToggle: { flexDirection: 'row', gap: 8, marginBottom: spacing.md },
  unitChip: {
    paddingHorizontal: spacing.md, paddingVertical: 8,
    borderRadius: radius.full,
    borderWidth: 1, borderColor: colors.border,
  },
  unitChipActive: { backgroundColor: colors.foreground, borderColor: colors.foreground },
  unitChipText: { fontSize: fontSize.sm, color: colors.foreground, fontWeight: fontWeight.semibold },
  unitChipTextActive: { color: colors.primaryForeground },

  inputBlock: { gap: 6 },
  inputLabel: { fontSize: fontSize.sm, color: colors.mutedForeground, fontWeight: fontWeight.medium },
  input: {
    backgroundColor: colors.muted,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 16,
    fontSize: fontSize.lg, fontWeight: fontWeight.semibold, color: colors.foreground,
  },

  primaryBtn: {
    backgroundColor: colors.foreground,
    paddingVertical: 17,
    borderRadius: radius.full,
    alignItems: 'center',
    marginTop: spacing.md,
  },
  primaryBtnText: {
    fontSize: fontSize.base, fontWeight: fontWeight.semibold, color: colors.primaryForeground,
  },

  skipLink: { alignSelf: 'center', padding: spacing.md, marginTop: 4 },
  skipLinkText: { fontSize: fontSize.sm, color: colors.mutedForeground },

  // Result-step styles
  eyebrow: {
    fontSize: 11, fontWeight: fontWeight.bold, letterSpacing: 1.5,
    color: colors.mutedForeground, marginBottom: 6,
  },
  tierBig: {
    fontSize: 48, fontWeight: fontWeight.bold, color: colors.foreground,
    letterSpacing: -1.5, lineHeight: 50, marginBottom: spacing.md,
  },
  progressTrack: {
    height: 8, backgroundColor: colors.muted, borderRadius: 4,
    overflow: 'hidden', marginBottom: spacing.lg,
  },
  progressFill: { height: '100%', backgroundColor: colors.primary, borderRadius: 4 },

  liftCards: { gap: 8, marginBottom: spacing.lg },
  liftCard: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: colors.muted, borderRadius: radius.md, padding: spacing.md,
  },
  liftName: { fontSize: fontSize.base, fontWeight: fontWeight.semibold, color: colors.foreground },
  liftTier: { fontSize: fontSize.sm, color: colors.mutedForeground, fontWeight: fontWeight.medium },

  planTeaser: {
    backgroundColor: colors.muted, borderRadius: radius.lg,
    padding: spacing.md, gap: spacing.sm, marginBottom: spacing.lg,
  },
  planTeaserHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  planTeaserTitle: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.foreground },
  planTeaserBody: { fontSize: fontSize.sm, color: colors.foreground, lineHeight: 20 },
});
