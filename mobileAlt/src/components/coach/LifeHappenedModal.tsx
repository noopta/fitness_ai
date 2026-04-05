import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Modal,
  StyleSheet,
  ActivityIndicator,
  Pressable,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, fontSize, fontWeight, radius } from '../../constants/theme';
import { coachApi } from '../../lib/api';


import { KeyboardDoneBar, KEYBOARD_DONE_ID } from '../ui/KeyboardDoneBar';// ─── Types ────────────────────────────────────────────────────────────────────

interface AdjustmentResult {
  disruptionType: string;
  disruptionLabel: string;
  severity: 'mild' | 'moderate' | 'significant';
  physiologicalImpacts: string[];
  trainingImpact: {
    missedSessions: number;
    intensityNote: string;
    summary: string;
  };
  nutritionalAdvice: {
    immediate: string[];
    today: string[];
    supplements: string[];
  } | null;
  suggestedShiftDays: number;
  adjustmentRationale: string;
  coachNote: string;
  recoveryTimeline: string;
}

interface Props {
  visible: boolean;
  onClose: () => void;
  onApplied: () => void;
}

const EXAMPLE_PROMPTS = [
  "I drank a lot last night",
  "I've been sick for 3 days",
  "Missed 2 training sessions",
  "On vacation, no gym access",
  "Pulled my lower back slightly",
];

const SEVERITY_COLORS: Record<string, string> = {
  mild: '#22c55e',
  moderate: '#f59e0b',
  significant: '#ef4444',
};

// ─── Component ────────────────────────────────────────────────────────────────

export function LifeHappenedModal({ visible, onClose, onApplied }: Props) {
  const [stage, setStage] = useState<'input' | 'loading' | 'result'>('input');
  const [input, setInput] = useState('');
  const [result, setResult] = useState<AdjustmentResult | null>(null);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit() {
    if (input.trim().length < 5) return;
    setStage('loading');
    setError('');
    try {
      const data = await coachApi.adjustProgram({ userInput: input.trim() });
      setResult(data);
      setStage('result');
    } catch (err: any) {
      setError(err?.message || 'Failed to analyze. Please try again.');
      setStage('input');
    }
  }

  async function handleApply() {
    if (!result) return;
    setApplying(true);
    try {
      await coachApi.applyAdjustment({ shiftDays: result.suggestedShiftDays });
      handleClose();
      onApplied();
    } catch (err: any) {
      setError(err?.message || 'Failed to apply adjustment.');
    } finally {
      setApplying(false);
    }
  }

  function handleClose() {
    if (stage === 'loading') return;
    setStage('input');
    setInput('');
    setResult(null);
    setError('');
    onClose();
  }

  const sevColor = SEVERITY_COLORS[result?.severity ?? 'moderate'] ?? '#f59e0b';

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={handleClose}>
      <Pressable style={styles.overlay} onPress={handleClose}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          <KeyboardDoneBar />
          <View style={styles.handle} />

          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerIcon}>
              <Ionicons name="heart-outline" size={18} color="#f59e0b" />
            </View>
            <View style={styles.headerTextBlock}>
              <Text style={styles.headerTitle}>Life Happened</Text>
              <Text style={styles.headerSub}>Tell Anakin what's going on</Text>
            </View>
            {stage !== 'loading' && (
              <TouchableOpacity onPress={handleClose} style={styles.closeBtn}>
                <Ionicons name="close" size={20} color={colors.mutedForeground} />
              </TouchableOpacity>
            )}
          </View>

          <ScrollView
            style={styles.body}
            contentContainerStyle={styles.bodyContent}
            showsVerticalScrollIndicator={false}
            bounces={false}
            keyboardShouldPersistTaps="handled"
          >
            {/* ── Input ── */}
            {stage === 'input' && (
              <View style={styles.stagePad}>
                <Text style={styles.introText}>
                  Missed a session? Had a rough night out? Feeling under the weather? Tell Anakin what happened and get a personalized recovery plan with adjusted training and nutrition advice.
                </Text>

                <TextInput
                  style={styles.textArea}
                  multiline
                  numberOfLines={4}
                  placeholder="e.g. I drank last night at my friend's birthday, didn't sleep well, and feel rough this morning..."
                  placeholderTextColor={colors.mutedForeground}
                  value={input}
                  onChangeText={setInput}
                  textAlignVertical="top"
              inputAccessoryViewID={KEYBOARD_DONE_ID}
                />

                <Text style={styles.chipsLabel}>COMMON SITUATIONS</Text>
                <View style={styles.chips}>
                  {EXAMPLE_PROMPTS.map((p, i) => (
                    <TouchableOpacity key={i} style={styles.chip} onPress={() => setInput(p)}>
                      <Text style={styles.chipText}>{p}</Text>
                    </TouchableOpacity>
                  ))}
                </View>

                {error ? <Text style={styles.errorText}>{error}</Text> : null}

                <TouchableOpacity
                  style={[styles.submitBtn, input.trim().length < 5 && styles.submitBtnDisabled]}
                  onPress={handleSubmit}
                  disabled={input.trim().length < 5}
                >
                  <Ionicons name="sparkles" size={16} color="#fff" />
                  <Text style={styles.submitBtnText}>Analyze & Get Recovery Plan</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* ── Loading ── */}
            {stage === 'loading' && (
              <View style={styles.loadingStage}>
                <ActivityIndicator size="large" color={colors.primary} />
                <Text style={styles.loadingTitle}>Analyzing your situation…</Text>
                <Text style={styles.loadingSubText}>
                  Anakin is reviewing the physiological impact and adjusting your plan
                </Text>
                {['Classifying disruption type', 'Calculating physiological impact', 'Building recovery protocol', 'Adjusting training schedule'].map((step, i) => (
                  <View key={i} style={styles.loadingStep}>
                    <View style={styles.loadingDot} />
                    <Text style={styles.loadingStepText}>{step}</Text>
                  </View>
                ))}
              </View>
            )}

            {/* ── Result ── */}
            {stage === 'result' && result && (
              <View style={styles.stagePad}>
                {/* Disruption card */}
                <View style={[styles.disruptionBox, { borderColor: sevColor + '40', backgroundColor: sevColor + '15' }]}>
                  <View style={styles.disruptionRow}>
                    <Text style={styles.disruptionLabel}>{result.disruptionLabel}</Text>
                    <Text style={[styles.severityTag, { color: sevColor }]}>
                      {(result.severity ?? 'moderate').toUpperCase()}
                    </Text>
                  </View>
                  <Text style={styles.coachNote}>{result.coachNote}</Text>
                </View>

                {/* Physiological impacts */}
                {(result.physiologicalImpacts ?? []).length > 0 && (
                  <View style={styles.section}>
                    <Text style={styles.sectionLabel}>WHAT'S HAPPENING TO YOUR BODY</Text>
                    {result.physiologicalImpacts.map((item, i) => (
                      <View key={i} style={styles.impactRow}>
                        <View style={styles.amberDot} />
                        <Text style={styles.impactText}>{item}</Text>
                      </View>
                    ))}
                  </View>
                )}

                {/* Training impact */}
                <View style={styles.section}>
                  <Text style={styles.sectionLabel}>TRAINING IMPACT</Text>
                  <View style={styles.infoBox}>
                    <Text style={styles.infoBoxBold}>{result.trainingImpact?.intensityNote}</Text>
                    <Text style={styles.infoBoxText}>{result.trainingImpact?.summary}</Text>
                  </View>
                </View>

                {/* Nutritional advice */}
                {result.nutritionalAdvice && (
                  <View style={styles.section}>
                    <Text style={styles.sectionLabel}>NUTRITIONAL RECOVERY</Text>
                    {(result.nutritionalAdvice.immediate ?? []).length > 0 && (
                      <View style={[styles.infoBox, styles.infoBoxRed]}>
                        <Text style={[styles.sectionLabel, { color: '#ef4444', marginBottom: 6 }]}>DO THIS NOW</Text>
                        {result.nutritionalAdvice.immediate.map((item, i) => (
                          <View key={i} style={styles.impactRow}>
                            <Ionicons name="checkmark-circle-outline" size={14} color="#ef4444" />
                            <Text style={styles.impactText}>{item}</Text>
                          </View>
                        ))}
                      </View>
                    )}
                    {(result.nutritionalAdvice.today ?? []).length > 0 && (
                      <View style={styles.infoBox}>
                        <Text style={[styles.sectionLabel, { marginBottom: 6 }]}>TODAY'S EATING FOCUS</Text>
                        {result.nutritionalAdvice.today.map((item, i) => (
                          <View key={i} style={styles.impactRow}>
                            <View style={styles.primaryDot} />
                            <Text style={styles.impactText}>{item}</Text>
                          </View>
                        ))}
                      </View>
                    )}
                  </View>
                )}

                {/* Schedule adjustment */}
                <View style={styles.section}>
                  <Text style={styles.sectionLabel}>SCHEDULE ADJUSTMENT</Text>
                  <View style={styles.infoBox}>
                    {result.suggestedShiftDays === 0 ? (
                      <Text style={[styles.infoBoxBold, { color: '#22c55e' }]}>No schedule change needed</Text>
                    ) : (
                      <Text style={styles.infoBoxBold}>
                        Shift program back by {result.suggestedShiftDays} day{result.suggestedShiftDays !== 1 ? 's' : ''}
                      </Text>
                    )}
                    <Text style={styles.infoBoxText}>{result.adjustmentRationale}</Text>
                  </View>
                </View>

                {/* Recovery timeline */}
                <View style={styles.recoveryBox}>
                  <Ionicons name="time-outline" size={16} color={colors.primary} />
                  <Text style={styles.recoveryText}>
                    <Text style={{ fontWeight: fontWeight.semibold }}>Recovery: </Text>
                    {result.recoveryTimeline}
                  </Text>
                </View>

                {error ? <Text style={styles.errorText}>{error}</Text> : null}

                {/* Actions */}
                <View style={styles.actions}>
                  <TouchableOpacity style={styles.keepBtn} onPress={handleClose}>
                    <Text style={styles.keepBtnText}>Keep original</Text>
                  </TouchableOpacity>
                  {(result.suggestedShiftDays ?? 0) > 0 && (
                    <TouchableOpacity
                      style={[styles.applyBtn, applying && styles.applyBtnDisabled]}
                      onPress={handleApply}
                      disabled={applying}
                    >
                      {applying ? (
                        <ActivityIndicator size="small" color="#fff" />
                      ) : (
                        <Text style={styles.applyBtnText}>Apply Adjustment</Text>
                      )}
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            )}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '92%',
    paddingBottom: 34,
  },
  handle: {
    width: 40, height: 4,
    borderRadius: radius.full,
    backgroundColor: colors.border,
    alignSelf: 'center',
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: spacing.sm,
  },
  headerIcon: {
    width: 36, height: 36,
    borderRadius: radius.lg,
    backgroundColor: 'rgba(245,158,11,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTextBlock: { flex: 1 },
  headerTitle: {
    fontSize: fontSize.base,
    fontWeight: fontWeight.bold,
    color: colors.foreground,
  },
  headerSub: {
    fontSize: fontSize.xs,
    color: colors.mutedForeground,
  },
  closeBtn: {
    padding: spacing.xs,
    borderRadius: radius.md,
  },
  body: { maxHeight: '70%' },
  bodyContent: { paddingBottom: spacing.lg },
  stagePad: { padding: spacing.md, gap: spacing.md },

  // Input
  introText: {
    fontSize: fontSize.sm,
    color: colors.mutedForeground,
    lineHeight: 20,
  },
  textArea: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    backgroundColor: colors.muted,
    padding: spacing.md,
    fontSize: fontSize.sm,
    color: colors.foreground,
    minHeight: 100,
  },
  chipsLabel: {
    fontSize: 10,
    fontWeight: fontWeight.bold,
    color: colors.mutedForeground,
    letterSpacing: 0.8,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  chip: {
    backgroundColor: colors.muted,
    borderRadius: radius.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
  },
  chipText: { fontSize: fontSize.xs, color: colors.mutedForeground },
  submitBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    backgroundColor: colors.primary,
    borderRadius: radius.lg,
    paddingVertical: 14,
  },
  submitBtnDisabled: { opacity: 0.4 },
  submitBtnText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    color: '#fff',
  },
  errorText: {
    fontSize: fontSize.sm,
    color: '#ef4444',
    textAlign: 'center',
  },

  // Loading
  loadingStage: {
    alignItems: 'center',
    paddingVertical: spacing.xxl,
    paddingHorizontal: spacing.md,
    gap: spacing.md,
  },
  loadingTitle: {
    fontSize: fontSize.base,
    fontWeight: fontWeight.semibold,
    color: colors.foreground,
    textAlign: 'center',
  },
  loadingSubText: {
    fontSize: fontSize.sm,
    color: colors.mutedForeground,
    textAlign: 'center',
    lineHeight: 20,
  },
  loadingStep: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  loadingDot: {
    width: 6, height: 6,
    borderRadius: 3,
    backgroundColor: `${colors.primary}60`,
  },
  loadingStepText: {
    fontSize: fontSize.xs,
    color: colors.mutedForeground,
  },

  // Result
  disruptionBox: {
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: spacing.xs,
  },
  disruptionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  disruptionLabel: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.bold,
    color: colors.foreground,
    flex: 1,
    marginRight: spacing.sm,
  },
  severityTag: {
    fontSize: 10,
    fontWeight: fontWeight.bold,
    letterSpacing: 0.8,
  },
  coachNote: {
    fontSize: fontSize.sm,
    color: colors.mutedForeground,
    lineHeight: 19,
  },
  section: { gap: spacing.xs },
  sectionLabel: {
    fontSize: 10,
    fontWeight: fontWeight.bold,
    color: colors.mutedForeground,
    letterSpacing: 0.8,
  },
  impactRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.xs,
    paddingVertical: 3,
  },
  amberDot: {
    width: 6, height: 6,
    borderRadius: 3,
    backgroundColor: '#f59e0b',
    marginTop: 5,
    flexShrink: 0,
  },
  primaryDot: {
    width: 6, height: 6,
    borderRadius: 3,
    backgroundColor: colors.primary,
    marginTop: 5,
    flexShrink: 0,
  },
  impactText: {
    flex: 1,
    fontSize: fontSize.xs,
    color: colors.foreground,
    lineHeight: 18,
  },
  infoBox: {
    backgroundColor: colors.muted,
    borderRadius: radius.md,
    padding: spacing.sm,
    gap: 4,
  },
  infoBoxRed: {
    backgroundColor: 'rgba(239,68,68,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.2)',
  },
  infoBoxBold: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    color: colors.foreground,
  },
  infoBoxText: {
    fontSize: fontSize.xs,
    color: colors.mutedForeground,
    lineHeight: 18,
  },
  recoveryBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    backgroundColor: `${colors.primary}0F`,
    borderWidth: 1,
    borderColor: `${colors.primary}25`,
    borderRadius: radius.md,
    padding: spacing.sm,
  },
  recoveryText: {
    flex: 1,
    fontSize: fontSize.xs,
    color: colors.foreground,
    lineHeight: 18,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  keepBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    paddingVertical: 12,
    alignItems: 'center',
  },
  keepBtnText: {
    fontSize: fontSize.sm,
    color: colors.foreground,
    fontWeight: fontWeight.medium,
  },
  applyBtn: {
    flex: 1,
    backgroundColor: colors.primary,
    borderRadius: radius.lg,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
  },
  applyBtnDisabled: { opacity: 0.6 },
  applyBtnText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    color: '#fff',
  },
});
