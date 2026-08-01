// Nutrition & gut-health assessment — handoff §7.1. Full-screen modal flow:
// welcome → one question per screen (config-driven) → generating (dark,
// citation ticker) → hands off to the plan reveal. ~3 minutes, judgment-free.
import React, { useMemo, useState, useEffect, useRef } from 'react';
import {
  Modal, View, Text, Pressable, TextInput, ActivityIndicator,
  Animated, KeyboardAvoidingView, Platform, StyleSheet,
} from 'react-native';
import { colors } from '../../../../constants/theme';
import { nutritionApi } from '../../../../lib/api';
import { Eyebrow, Chip } from './GutPrimitives';

type QuestionType = 'text' | 'single' | 'multi' | 'stepper';

interface Question {
  key: string;
  category: string;
  title: string;
  reassurance: string;
  type: QuestionType;
  options?: Array<{ key: string; label: string }>;
  min?: number;
  max?: number;
  unit?: string;
}

// One question per screen; order mirrors a first-visit nutritionist consult.
const QUESTIONS: Question[] = [
  {
    key: 'typicalDay', category: 'Your day', type: 'text',
    title: 'Walk me through a typical day of eating.',
    reassurance: 'No judgment — real days, not ideal days, are what tune your plan.',
  },
  {
    key: 'mealsPerDay', category: 'Your day', type: 'stepper', min: 1, max: 8, unit: 'meals',
    title: 'How many meals do you usually eat a day?',
    reassurance: 'Snacks count if they’re a regular thing.',
  },
  {
    key: 'orderOutPerWeek', category: 'Your day', type: 'stepper', min: 0, max: 21, unit: 'orders / week',
    title: 'How often do you order out or eat takeout?',
    reassurance: 'Takeout fits in the plan — we’ll work with it, not against it.',
  },
  {
    key: 'digestionBloating', category: 'Digestion', type: 'single',
    title: 'How often do you feel bloated or uncomfortable after eating?',
    reassurance: 'This stays between you and your coach.',
    options: [
      { key: 'never', label: 'Rarely or never' },
      { key: 'sometimes', label: 'Sometimes' },
      { key: 'often', label: 'Often' },
    ],
  },
  {
    key: 'digestionRegularity', category: 'Digestion', type: 'single',
    title: 'Is your digestion generally regular?',
    reassurance: 'Regularity is one of the clearest gut-health signals we have.',
    options: [
      { key: 'regular', label: 'Yes, like clockwork' },
      { key: 'irregular', label: 'Not really' },
    ],
  },
  {
    key: 'intolerances', category: 'Digestion', type: 'multi',
    title: 'Any foods that don’t sit right with you?',
    reassurance: 'Select any that apply — skip if none.',
    options: [
      { key: 'lactose', label: 'Dairy / lactose' },
      { key: 'gluten', label: 'Gluten' },
      { key: 'fodmap', label: 'Onion / garlic / beans (FODMAPs)' },
      { key: 'spicy', label: 'Spicy food' },
      { key: 'caffeine-gi', label: 'Coffee on an empty stomach' },
    ],
  },
  {
    key: 'energyPattern', category: 'Energy', type: 'single',
    title: 'Do you hit an energy crash in the afternoon?',
    reassurance: 'Afternoon crashes are usually a diet-pattern signal, not a willpower one.',
    options: [
      { key: 'yes', label: 'Most days' },
      { key: 'sometimes', label: 'Some days' },
      { key: 'no', label: 'Not really' },
    ],
  },
  {
    key: 'caffeinePerDay', category: 'Energy', type: 'stepper', min: 0, max: 10, unit: 'caffeinated drinks / day',
    title: 'How much caffeine in a typical day?',
    reassurance: 'Coffee, energy drinks, pre-workout — all of it counts.',
  },
  {
    key: 'sleepQuality', category: 'Recovery', type: 'single',
    title: 'How’s your sleep quality lately?',
    reassurance: 'Sleep and gut health run on the same clock — this shapes your plan.',
    options: [
      { key: 'good', label: 'Solid most nights' },
      { key: 'mixed', label: 'Hit and miss' },
      { key: 'poor', label: 'Rough' },
    ],
  },
  {
    key: 'fermentedPerWeek', category: 'Gut baseline', type: 'stepper', min: 0, max: 21, unit: 'servings / week',
    title: 'Fermented foods — yogurt, kefir, kimchi, sauerkraut?',
    reassurance: 'Zero is a common starting point. It’s also the fastest lever we have.',
  },
  {
    key: 'dietaryStyle', category: 'Preferences', type: 'single',
    title: 'How would you describe the way you eat?',
    reassurance: 'Your targets adjust to this — plant-based needs different numbers.',
    options: [
      { key: 'omnivore', label: 'Everything' },
      { key: 'pescatarian', label: 'Pescatarian' },
      { key: 'vegetarian', label: 'Vegetarian' },
      { key: 'vegan', label: 'Vegan' },
    ],
  },
  {
    key: 'goals', category: 'Goals', type: 'multi',
    title: 'What do you want your nutrition to do for you?',
    reassurance: 'Pick up to three — order of tapping sets priority.',
    options: [
      { key: 'energy', label: 'Steadier energy' },
      { key: 'gut_comfort', label: 'Gut comfort' },
      { key: 'recovery', label: 'Faster recovery' },
      { key: 'sleep', label: 'Better sleep' },
      { key: 'cognition', label: 'Sharper focus' },
      { key: 'body_comp', label: 'Body composition' },
    ],
  },
  {
    key: 'medicalFlags', category: 'Safety', type: 'multi',
    title: 'Any diagnosed digestive conditions?',
    reassurance: 'If yes, we’ll keep advice general and point you to your clinician for specifics.',
    options: [
      { key: 'ibs', label: 'IBS' },
      { key: 'ibd', label: 'IBD (Crohn’s / colitis)' },
      { key: 'celiac', label: 'Celiac disease' },
      { key: 'gerd', label: 'GERD / chronic reflux' },
    ],
  },
];

const GENERATING_TICKER = [
  'Reading your training profile',
  'Setting your 18 nutrient targets',
  'Matching foods to your focus nutrients',
  'Checking the research library',
  'Writing your gut protocol',
];

function toAssessmentPayload(answers: Record<string, unknown>): Record<string, unknown> {
  return {
    typicalDay: answers.typicalDay || undefined,
    mealsPerDay: answers.mealsPerDay ?? undefined,
    orderOutPerWeek: answers.orderOutPerWeek ?? undefined,
    digestion: {
      bloating: answers.digestionBloating || undefined,
      regularity: answers.digestionRegularity || undefined,
      intolerances: (answers.intolerances as string[]) || [],
    },
    energy: {
      afternoonCrashes: answers.energyPattern === 'yes',
      caffeinePerDay: answers.caffeinePerDay ?? undefined,
    },
    sleepQualityLow: answers.sleepQuality === 'poor' || answers.sleepQuality === 'mixed',
    fermentedPerWeek: answers.fermentedPerWeek ?? undefined,
    dietaryStyle: answers.dietaryStyle || undefined,
    goals: (answers.goals as string[]) || [],
    medicalFlags: (answers.medicalFlags as string[]) || [],
  };
}

export function AssessmentFlow({
  visible, onClose, onPlanReady,
}: {
  visible: boolean;
  onClose: () => void;
  onPlanReady: (planPayload: unknown) => void;
}) {
  const [step, setStep] = useState(-1); // -1 welcome, 0..n-1 questions, n generating
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [tickerIdx, setTickerIdx] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const fade = useRef(new Animated.Value(1)).current;

  const q = step >= 0 && step < QUESTIONS.length ? QUESTIONS[step] : null;
  const generating = step === QUESTIONS.length;
  const hasMedicalFlag = ((answers.medicalFlags as string[]) || []).length > 0;

  const answered = useMemo(() => {
    if (!q) return false;
    if (q.type === 'multi' || q.type === 'stepper') return true; // both have valid defaults
    const v = answers[q.key];
    if (q.type === 'text') return typeof v === 'string' && v.trim().length > 0;
    return v !== undefined && v !== null && v !== '';
  }, [q, answers]);

  const advance = (delta: number) => {
    Animated.sequence([
      Animated.timing(fade, { toValue: 0, duration: 100, useNativeDriver: true }),
      Animated.timing(fade, { toValue: 1, duration: 250, useNativeDriver: true }),
    ]).start();
    setStep((s) => s + delta);
  };

  // Generating: save → generate (real async work), with a min duration so
  // the ticker reads (§5 — wire to the actual promise, keep min-duration).
  useEffect(() => {
    if (!generating || !visible) return;
    let cancelled = false;
    setError(null);
    setTickerIdx(0);
    const ticker = setInterval(
      () => setTickerIdx((i) => Math.min(i + 1, GENERATING_TICKER.length - 1)),
      900,
    );
    const started = Date.now();
    (async () => {
      try {
        await nutritionApi.saveAssessment(toAssessmentPayload(answers));
        const plan = await nutritionApi.generateNutritionPlan();
        const minWait = Math.max(0, 2400 - (Date.now() - started));
        await new Promise((r) => setTimeout(r, minWait));
        if (!cancelled) onPlanReady(plan);
      } catch {
        if (!cancelled) setError('Couldn’t generate your plan — check your connection and try again.');
      }
    })();
    return () => { cancelled = true; clearInterval(ticker); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [generating, visible, attempt]);

  useEffect(() => {
    if (visible) { setStep(-1); setAnswers({}); setTickerIdx(0); setError(null); }
  }, [visible]);

  const setAnswer = (key: string, value: unknown) => setAnswers((a) => ({ ...a, [key]: value }));
  const toggleMulti = (key: string, option: string) => {
    const current = (answers[key] as string[]) || [];
    setAnswer(key, current.includes(option) ? current.filter((o) => o !== option) : [...current, option]);
  };

  if (!visible) return null;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      {generating ? (
        <View style={[styles.fill, { backgroundColor: colors.foreground, padding: 24, justifyContent: 'center' }]}>
          {error ? (
            <View style={{ gap: 16 }}>
              <Text style={{ color: colors.primaryForeground, fontSize: 20, fontWeight: '700' }}>That didn’t go through</Text>
              <Text style={{ color: '#a1a1aa', fontSize: 14, lineHeight: 21 }}>{error}</Text>
              <Pressable onPress={() => setAttempt((a) => a + 1)} style={styles.lightButton}>
                <Text style={{ color: colors.foreground, fontWeight: '600', fontSize: 14 }}>Try again</Text>
              </Pressable>
              <Pressable onPress={onClose} style={{ alignItems: 'center', padding: 8 }}>
                <Text style={{ color: '#a1a1aa', fontSize: 13 }}>Close — your answers are saved</Text>
              </Pressable>
            </View>
          ) : (
            <View style={{ gap: 24 }}>
              <ActivityIndicator color="#ffffff" size="large" />
              <View style={{ gap: 6 }}>
                <Text style={{ color: colors.primaryForeground, fontSize: 22, fontWeight: '700', letterSpacing: -0.4 }}>
                  Building your nutrition plan
                </Text>
                <Text style={{ color: '#a1a1aa', fontSize: 13 }}>
                  Targets set by the engine, foods matched to your goals.
                </Text>
              </View>
              <View style={{ gap: 10 }}>
                {GENERATING_TICKER.map((line, i) => (
                  <View key={line} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, opacity: i <= tickerIdx ? 1 : 0.35 }}>
                    <Text style={{ color: i < tickerIdx ? colors.success : '#a1a1aa', fontSize: 13, width: 16 }}>
                      {i < tickerIdx ? '✓' : '·'}
                    </Text>
                    <Text style={{ color: colors.primaryForeground, fontSize: 13 }}>{line}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}
        </View>
      ) : step === -1 ? (
        <View style={[styles.fill, { padding: 24, justifyContent: 'space-between', backgroundColor: colors.background }]}>
          <View style={{ gap: 12, marginTop: 64 }}>
            <Eyebrow>Nutrition & gut health</Eyebrow>
            <Text style={{ fontSize: 27, fontWeight: '700', letterSpacing: -0.7, color: colors.foreground }}>
              Three minutes. The same questions an elite nutritionist would ask.
            </Text>
            <Text style={{ fontSize: 14, lineHeight: 21, color: colors.mutedForeground }}>
              You train some days. You eat every day. This tunes your targets — macros and the
              micronutrients behind energy, recovery, and gut health — to how you actually live.
              Judgment-free.
            </Text>
          </View>
          <View style={{ gap: 10 }}>
            <Pressable onPress={() => setStep(0)} style={styles.primaryButton}>
              <Text style={{ color: colors.primaryForeground, fontWeight: '600', fontSize: 15 }}>Start</Text>
            </Pressable>
            <Pressable onPress={onClose} style={{ alignItems: 'center', padding: 12 }}>
              <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>Not now</Text>
            </Pressable>
          </View>
        </View>
      ) : q ? (
        <KeyboardAvoidingView behavior="padding" style={styles.fill}>
          <View style={[styles.fill, { backgroundColor: colors.background, paddingTop: 56 }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20 }}>
              <Pressable onPress={() => (step === 0 ? onClose() : advance(-1))} hitSlop={12}>
                <Text style={{ fontSize: 22, color: colors.foreground }}>‹</Text>
              </Pressable>
              <View style={{ flex: 1, height: 3, borderRadius: 999, backgroundColor: colors.muted }}>
                <View style={{ width: `${((step + 1) / QUESTIONS.length) * 100}%`, height: 3, borderRadius: 999, backgroundColor: colors.foreground }} />
              </View>
              <Text style={{ fontSize: 11, color: colors.mutedForeground, fontVariant: ['tabular-nums'] }}>
                {step + 1} / {QUESTIONS.length}
              </Text>
            </View>

            <Animated.ScrollView style={{ opacity: fade }} contentContainerStyle={{ padding: 20, gap: 16 }}>
              <Eyebrow>{q.category}</Eyebrow>
              <Text style={{ fontSize: 24, fontWeight: '700', letterSpacing: -0.5, color: colors.foreground }}>
                {q.title}
              </Text>

              {q.type === 'text' && (
                <TextInput
                  multiline
                  placeholder="Coffee at 7, usually skip breakfast, lunch is…"
                  placeholderTextColor="#a1a1aa"
                  value={(answers[q.key] as string) || ''}
                  onChangeText={(v) => setAnswer(q.key, v)}
                  style={styles.textarea}
                />
              )}

              {q.type === 'single' && (
                <View style={{ gap: 8 }}>
                  {q.options!.map((o) => {
                    const selected = answers[q.key] === o.key;
                    return (
                      <Pressable
                        key={o.key}
                        onPress={() => setAnswer(q.key, o.key)}
                        style={[styles.optionRow, selected && styles.optionRowSelected]}
                      >
                        <Text style={{ fontSize: 14, fontWeight: '600', color: colors.foreground }}>{o.label}</Text>
                        {selected && <Text style={{ fontSize: 14, color: colors.foreground }}>✓</Text>}
                      </Pressable>
                    );
                  })}
                </View>
              )}

              {q.type === 'multi' && (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {q.options!.map((o) => (
                    <Chip
                      key={o.key}
                      label={o.label}
                      selected={((answers[q.key] as string[]) || []).includes(o.key)}
                      onPress={() => toggleMulti(q.key, o.key)}
                    />
                  ))}
                </View>
              )}

              {q.type === 'stepper' && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 20, justifyContent: 'center', paddingVertical: 12 }}>
                  <Pressable
                    onPress={() => setAnswer(q.key, Math.max(q.min!, ((answers[q.key] as number) ?? q.min!) - 1))}
                    style={styles.stepBtn}
                  >
                    <Text style={{ fontSize: 20, color: colors.foreground }}>−</Text>
                  </Pressable>
                  <View style={{ alignItems: 'center', minWidth: 96 }}>
                    <Text style={{ fontSize: 30, fontWeight: '700', color: colors.foreground, fontVariant: ['tabular-nums'] }}>
                      {(answers[q.key] as number) ?? q.min}
                    </Text>
                    <Text style={{ fontSize: 11, color: colors.mutedForeground }}>{q.unit}</Text>
                  </View>
                  <Pressable
                    onPress={() => setAnswer(q.key, Math.min(q.max!, ((answers[q.key] as number) ?? q.min!) + 1))}
                    style={styles.stepBtn}
                  >
                    <Text style={{ fontSize: 20, color: colors.foreground }}>+</Text>
                  </Pressable>
                </View>
              )}

              <Text style={{ fontSize: 12, color: colors.mutedForeground, lineHeight: 18 }}>{q.reassurance}</Text>

              {q.key === 'medicalFlags' && hasMedicalFlag && (
                <View style={styles.medicalNote}>
                  <Text style={{ fontSize: 13, lineHeight: 19, color: colors.warningInk }}>
                    Noted. Your plan will stay general on these — for anything condition-specific, your
                    gastroenterologist or dietitian is the right call, and your coach will say so too.
                  </Text>
                </View>
              )}
            </Animated.ScrollView>

            <View style={{ flexDirection: 'row', gap: 10, padding: 20, paddingBottom: 32 }}>
              <Pressable onPress={() => (step === 0 ? onClose() : advance(-1))} style={[styles.ghostButton, { flex: 1 }]}>
                <Text style={{ color: colors.foreground, fontWeight: '600', fontSize: 14 }}>Back</Text>
              </Pressable>
              <Pressable
                disabled={!answered}
                onPress={() => {
                  if (q.type === 'stepper' && answers[q.key] === undefined) setAnswer(q.key, q.min);
                  advance(1);
                }}
                style={[styles.primaryButton, { flex: 2, opacity: answered ? 1 : 0.4 }]}
              >
                <Text style={{ color: colors.primaryForeground, fontWeight: '600', fontSize: 15 }}>
                  {step === QUESTIONS.length - 1 ? 'Build my plan' : 'Next'}
                </Text>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      ) : null}
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  primaryButton: {
    backgroundColor: '#09090b', borderRadius: 12, paddingVertical: 14,
    alignItems: 'center', justifyContent: 'center', minHeight: 48,
  },
  ghostButton: {
    backgroundColor: '#ffffff', borderWidth: 1, borderColor: '#e4e4e7',
    borderRadius: 12, paddingVertical: 14, alignItems: 'center',
    justifyContent: 'center', minHeight: 48,
  },
  lightButton: {
    backgroundColor: '#ffffff', borderRadius: 12, paddingVertical: 13, alignItems: 'center',
  },
  optionRow: {
    borderWidth: 1, borderColor: '#e4e4e7', borderRadius: 12,
    paddingVertical: 15, paddingHorizontal: 16,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
  },
  optionRowSelected: { borderWidth: 1.5, borderColor: '#09090b' },
  textarea: {
    borderWidth: 1, borderColor: '#e4e4e7', borderRadius: 12, padding: 14,
    minHeight: 130, textAlignVertical: 'top', fontSize: 14, color: '#09090b',
  },
  stepBtn: {
    width: 44, height: 44, borderRadius: 12, borderWidth: 1, borderColor: '#e4e4e7',
    alignItems: 'center', justifyContent: 'center',
  },
  medicalNote: {
    borderWidth: 1, borderColor: '#fef3c7', backgroundColor: '#fffbeb',
    borderRadius: 12, padding: 14,
  },
});
