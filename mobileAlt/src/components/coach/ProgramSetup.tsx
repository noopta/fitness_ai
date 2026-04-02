import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Animated,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { colors, fontSize, fontWeight, spacing, radius } from '../../constants/theme';
import { Button } from '../ui/Button';
import { coachApi } from '../../lib/api';

interface ProgramSetupProps {
  onGenerate: (program: any) => void;
  onBack: () => void;
}

const DURATIONS = [
  { value: 4, label: '4 Weeks', sub: 'Introductory / Deload block' },
  { value: 8, label: '8 Weeks', sub: 'Standard mesocycle', badge: 'Recommended' },
  { value: 12, label: '12 Weeks', sub: 'Full macrocycle' },
  { value: 16, label: '16 Weeks', sub: 'Competition prep' },
];

const DAYS = [
  { value: 3, label: '3 days', sub: 'Full body or upper/lower split' },
  { value: 4, label: '4 days', sub: 'Upper/lower or push/pull/legs' },
  { value: 5, label: '5 days', sub: 'Higher frequency, more volume' },
  { value: 6, label: '6 days', sub: 'High commitment, daily training' },
];

const GENERATING_MESSAGES = [
  'Analyzing your training profile…',
  'Designing your program phases…',
  'Calibrating sets and rep schemes…',
  'Optimizing progressive overload…',
  'Personalizing exercise selection…',
  'Finalizing your plan…',
];

// ── Animated loading screen ───────────────────────────────────────────────────

function GeneratingScreen() {
  const pulse = useRef(new Animated.Value(0.88)).current;
  const [msgIdx, setMsgIdx] = useState(0);

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.08, duration: 900, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.88, duration: 900, useNativeDriver: true }),
      ])
    ).start();

    const timer = setInterval(() => {
      setMsgIdx(i => (i + 1) % GENERATING_MESSAGES.length);
    }, 2200);

    return () => {
      clearInterval(timer);
      pulse.stopAnimation();
    };
  }, []);

  return (
    <View style={gs.container}>
      <Animated.View style={[gs.avatar, { transform: [{ scale: pulse }] }]}>
        <Text style={gs.avatarText}>A</Text>
        <Animated.View style={[gs.ring, { transform: [{ scale: pulse }], opacity: pulse.interpolate({ inputRange: [0.88, 1.08], outputRange: [0.3, 0] }) }]} />
      </Animated.View>

      <Text style={gs.title}>Building Your Program</Text>
      <Text style={gs.subtitle}>Powered by Anakin AI</Text>

      <View style={gs.dots}>
        {[0, 1, 2].map(i => (
          <AnimDot key={i} delay={i * 280} />
        ))}
      </View>

      <Text style={gs.message}>{GENERATING_MESSAGES[msgIdx]}</Text>
      <Text style={gs.hint}>This usually takes 15–30 seconds</Text>
    </View>
  );
}

function AnimDot({ delay }: { delay: number }) {
  const opacity = useRef(new Animated.Value(0.25)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.timing(opacity, { toValue: 1, duration: 400, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.25, duration: 400, useNativeDriver: true }),
        Animated.delay(840 - delay),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, []);

  return <Animated.View style={[gs.dot, { opacity }]} />;
}

const gs = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    gap: spacing.sm,
  },
  avatar: {
    width: 88,
    height: 88,
    borderRadius: radius.full,
    backgroundColor: colors.foreground,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  avatarText: { fontSize: 40, fontWeight: fontWeight.bold, color: colors.primaryForeground },
  ring: {
    position: 'absolute',
    width: 108,
    height: 108,
    borderRadius: 54,
    borderWidth: 2,
    borderColor: colors.primary,
  },
  title: { fontSize: fontSize.xl, fontWeight: fontWeight.bold, color: colors.foreground },
  subtitle: { fontSize: fontSize.sm, color: colors.mutedForeground },
  dots: { flexDirection: 'row', gap: 8, marginTop: spacing.md, marginBottom: spacing.xs },
  dot: { width: 8, height: 8, borderRadius: radius.full, backgroundColor: colors.primary },
  message: { fontSize: fontSize.sm, color: colors.foreground, textAlign: 'center', marginTop: spacing.xs },
  hint: { fontSize: fontSize.xs, color: colors.mutedForeground, marginTop: 4 },
});

// ── Program Setup ─────────────────────────────────────────────────────────────

export function ProgramSetup({ onGenerate, onBack }: ProgramSetupProps) {
  const [durationWeeks, setDurationWeeks] = useState<number>(8);
  const [daysPerWeek, setDaysPerWeek] = useState<number>(4);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleGenerate() {
    setError('');
    setLoading(true);
    try {
      const result = await coachApi.generateProgram({ durationWeeks, daysPerWeek });
      onGenerate(result);
    } catch (err: any) {
      setError(err?.message || 'Failed to generate program. Please try again.');
      setLoading(false);
    }
  }

  if (loading) return <GeneratingScreen />;

  return (
    <KeyboardAvoidingView style={s.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        style={s.container}
        contentContainerStyle={s.content}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={s.heading}>Configure Your Program</Text>
        <Text style={s.subheading}>
          Choose the duration and training frequency for your program.
        </Text>

        {/* Duration */}
        <Text style={s.sectionLabel}>Program Duration</Text>
        <View style={s.optionList}>
          {DURATIONS.map(opt => {
            const sel = durationWeeks === opt.value;
            return (
              <Pressable key={opt.value} onPress={() => setDurationWeeks(opt.value)}
                style={[s.optionCard, sel && s.optionCardSel]}>
                <View style={[s.radio, sel && s.radioSel]}>
                  {sel && <View style={s.radioInner} />}
                </View>
                <View style={s.optionText}>
                  <View style={s.optionLabelRow}>
                    <Text style={[s.optionLabel, sel && s.optionLabelSel]}>{opt.label}</Text>
                    {opt.badge ? (
                      <View style={s.badge}><Text style={s.badgeText}>{opt.badge}</Text></View>
                    ) : null}
                  </View>
                  <Text style={s.optionSub}>{opt.sub}</Text>
                </View>
              </Pressable>
            );
          })}
        </View>

        {/* Days per week */}
        <Text style={[s.sectionLabel, { marginTop: spacing.lg }]}>Days Per Week</Text>
        <View style={s.optionList}>
          {DAYS.map(opt => {
            const sel = daysPerWeek === opt.value;
            return (
              <Pressable key={opt.value} onPress={() => setDaysPerWeek(opt.value)}
                style={[s.optionCard, sel && s.optionCardSel]}>
                <View style={[s.radio, sel && s.radioSel]}>
                  {sel && <View style={s.radioInner} />}
                </View>
                <View style={s.optionText}>
                  <Text style={[s.optionLabel, sel && s.optionLabelSel]}>{opt.label}</Text>
                  <Text style={s.optionSub}>{opt.sub}</Text>
                </View>
              </Pressable>
            );
          })}
        </View>

        {!!error && <Text style={s.errorText}>{error}</Text>}

        <View style={s.navRow}>
          <Button variant="outline" onPress={onBack} style={s.navBtn}>Back</Button>
          <Button onPress={handleGenerate} style={s.navBtn}>Generate Program</Button>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  flex: { flex: 1 },
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md, gap: spacing.sm, paddingBottom: spacing.xxl },

  heading: { fontSize: fontSize.xxl, fontWeight: fontWeight.bold, color: colors.foreground, marginTop: spacing.xs },
  subheading: { fontSize: fontSize.sm, color: colors.mutedForeground, lineHeight: 20 },

  sectionLabel: {
    fontSize: fontSize.base, fontWeight: fontWeight.semibold, color: colors.foreground,
    marginBottom: spacing.xs,
  },

  optionList: { gap: spacing.xs },
  optionCard: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    padding: spacing.sm, borderRadius: radius.md, borderWidth: 1,
    borderColor: colors.border, backgroundColor: colors.muted,
  },
  optionCardSel: { borderColor: colors.primary, backgroundColor: `${colors.primary}18` },
  radio: {
    width: 20, height: 20, borderRadius: radius.full, borderWidth: 2,
    borderColor: colors.border, alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  radioSel: { borderColor: colors.primary },
  radioInner: { width: 10, height: 10, borderRadius: radius.full, backgroundColor: colors.primary },
  optionText: { flex: 1 },
  optionLabelRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  optionLabel: { fontSize: fontSize.sm, color: colors.mutedForeground, fontWeight: fontWeight.medium },
  optionLabelSel: { color: colors.foreground, fontWeight: fontWeight.semibold },
  optionSub: { fontSize: fontSize.xs, color: colors.mutedForeground, marginTop: 2 },
  badge: {
    paddingHorizontal: 6, paddingVertical: 2, borderRadius: radius.sm,
    backgroundColor: `${colors.primary}22`,
  },
  badgeText: { fontSize: fontSize.xs, color: colors.primary, fontWeight: fontWeight.semibold },

  errorText: { fontSize: fontSize.sm, color: colors.destructive, textAlign: 'center' },

  navRow: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.md },
  navBtn: { flex: 1 },
});
