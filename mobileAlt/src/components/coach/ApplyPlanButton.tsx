// Reusable "Apply to my plan" affordance — used by the Nutrition and Strength
// profile surfaces to hand a suggestion to the agent (apply_suggestion task).
//
// Two flows depending on what the agent returns:
//   1. PROGRAM proposal — the response carries `proposal.updatedProgram`. We
//      render a side-by-side diff (current vs proposed) and the user taps
//      Confirm to persist via coachApi.confirmProposal. Direct match to the
//      "propose then confirm" pattern the user asked for.
//   2. DIRECT apply — no proposal (e.g. nutrition macro tweak the agent
//      applied via adjust_macros). We just show the agent's reply + ✓.
//
// Only renders when the agent is available for this user (gated by
// `available`, fetched via coachApi.agentStatus elsewhere).

import React, { useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Modal, Animated, Easing, ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { coachApi } from '../../lib/api';
import { colors, fontSize, fontWeight, radius, spacing } from '../../constants/theme';

type Phase = 'idle' | 'applying' | 'review' | 'confirming' | 'done' | 'error';

interface ProgramProposal {
  kind: 'program_update';
  updatedProgram: any;
  summary: string;
  changedDays?: string[];
}

interface Props {
  /** The suggestion text handed to the agent. */
  suggestion: string;
  /** Whether the agent is available for this user (gates visibility). */
  available: boolean;
  /** Button label. */
  label?: string;
  /** Called after a successful apply so the caller can refresh its data. */
  onApplied?: () => void | Promise<void>;
}

export function ApplyPlanButton({ suggestion, available, label = 'Apply to my plan', onApplied }: Props) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [message, setMessage] = useState('');
  const [proposal, setProposal] = useState<ProgramProposal | null>(null);
  // Snapshot of the program BEFORE the proposed change. Used to render the
  // diff side-by-side; pulled from the agent context implicitly via the
  // proposal returning the full new program — we just keep the user's most
  // recent saved program for comparison.
  const [currentProgram, setCurrentProgram] = useState<any>(null);

  // Animations: a gentle pulsing ring while applying, a spring-scaled
  // checkmark on success.
  const pulse = useRef(new Animated.Value(0)).current;
  const checkScale = useRef(new Animated.Value(0)).current;
  const overlayFade = useRef(new Animated.Value(0)).current;

  const startPulse = () => {
    pulse.setValue(0);
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    ).start();
  };

  const openOverlay = () => {
    overlayFade.setValue(0);
    Animated.timing(overlayFade, { toValue: 1, duration: 180, useNativeDriver: true }).start();
  };

  const popCheck = () => {
    checkScale.setValue(0);
    Animated.spring(checkScale, { toValue: 1, friction: 5, tension: 120, useNativeDriver: true }).start();
  };

  const onPress = async () => {
    if (phase === 'applying' || phase === 'confirming') return;
    setPhase('applying');
    setMessage('');
    setProposal(null);
    setCurrentProgram(null);
    openOverlay();
    startPulse();
    // Fetch the current program in parallel with the agent run so we have
    // something to diff against once a proposal comes back. We don't block
    // the agent on this — if it fails we just show the proposed program alone.
    const currentPromise = coachApi.getProgram().catch(() => null);
    try {
      const res = await coachApi.applySuggestion(suggestion);
      const reply = String(res?.reply ?? '');
      setMessage(reply || 'Applied to your plan.');
      if (res?.proposal && res.proposal.kind === 'program_update') {
        // Propose-then-confirm path — show the diff.
        const cur = await currentPromise;
        setCurrentProgram(extractProgram(cur));
        setProposal(res.proposal);
        setPhase('review');
      } else {
        // Direct-apply path (e.g. macro tweak) — agent already wrote it.
        setPhase('done');
        popCheck();
        await Promise.resolve(onApplied?.());
      }
    } catch (err: any) {
      setMessage(err?.message ?? 'Could not apply that. Please try again.');
      setPhase('error');
    }
  };

  const onConfirm = async () => {
    if (!proposal || phase === 'confirming') return;
    setPhase('confirming');
    startPulse();
    try {
      await coachApi.confirmProposal(proposal.updatedProgram);
      setPhase('done');
      popCheck();
      await Promise.resolve(onApplied?.());
    } catch (err: any) {
      setMessage(err?.message ?? 'Could not apply that change.');
      setPhase('error');
    }
  };

  const close = () => {
    setPhase('idle');
    setProposal(null);
    setCurrentProgram(null);
  };

  if (!available) return null;

  const pulseStyle = {
    transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1.15] }) }],
    opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.45, 0.9] }),
  };

  return (
    <>
      <TouchableOpacity
        style={styles.btn}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={label}
      >
        <Ionicons name="sparkles" size={16} color="#fff" />
        <Text style={styles.btnText}>{label}</Text>
      </TouchableOpacity>

      <Modal visible={phase !== 'idle'} transparent animationType="none" onRequestClose={close}>
        <Animated.View style={[styles.backdrop, { opacity: overlayFade }]}>
          <View style={phase === 'review' ? styles.sheetWide : styles.sheet}>
            {phase === 'applying' && (
              <>
                <View style={styles.iconWrap}>
                  <Animated.View style={[styles.pulseRing, pulseStyle]} />
                  <Ionicons name="sparkles" size={26} color={colors.primary} />
                </View>
                <Text style={styles.title}>Drafting a change…</Text>
                <Text style={styles.subtitle}>Anakin is fitting this to your goal.</Text>
              </>
            )}
            {phase === 'review' && proposal && (
              <>
                <Text style={styles.title}>Review the change</Text>
                <Text style={styles.subtitle}>Tap Confirm to apply, or Cancel to skip.</Text>
                {message ? <Text style={styles.summaryNote}>{message}</Text> : null}
                <Text style={styles.summaryLabel}>What Anakin is proposing</Text>
                <Text style={styles.summaryBox}>{proposal.summary}</Text>
                <DiffView
                  current={currentProgram}
                  proposed={proposal.updatedProgram}
                  highlightDays={proposal.changedDays ?? []}
                />
                <View style={styles.actionRow}>
                  <TouchableOpacity style={styles.cancelBtn} onPress={close} accessibilityRole="button">
                    <Text style={styles.cancelBtnText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.confirmBtn} onPress={onConfirm} accessibilityRole="button">
                    <Ionicons name="checkmark" size={16} color="#fff" />
                    <Text style={styles.confirmBtnText}>Confirm</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
            {phase === 'confirming' && (
              <>
                <View style={styles.iconWrap}>
                  <Animated.View style={[styles.pulseRing, pulseStyle]} />
                  <Ionicons name="sparkles" size={26} color={colors.primary} />
                </View>
                <Text style={styles.title}>Applying…</Text>
              </>
            )}
            {phase === 'done' && (
              <>
                <Animated.View style={[styles.successIcon, { transform: [{ scale: checkScale }] }]}>
                  <Ionicons name="checkmark" size={30} color="#fff" />
                </Animated.View>
                <Text style={styles.title}>Applied</Text>
                <Text style={styles.resultText}>{message}</Text>
                <TouchableOpacity style={styles.doneBtn} onPress={close} accessibilityRole="button">
                  <Text style={styles.doneBtnText}>Got it</Text>
                </TouchableOpacity>
              </>
            )}
            {phase === 'error' && (
              <>
                <View style={styles.errorIcon}>
                  <Ionicons name="alert" size={28} color="#fff" />
                </View>
                <Text style={styles.title}>Couldn't apply</Text>
                <Text style={styles.resultText}>{message}</Text>
                <TouchableOpacity style={styles.doneBtn} onPress={close} accessibilityRole="button">
                  <Text style={styles.doneBtnText}>Close</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </Animated.View>
      </Modal>
    </>
  );
}

// ── Diff renderer ───────────────────────────────────────────────────────────
// Renders only the training days that actually changed. Falls back to the
// proposed program alone if we couldn't fetch the current program.

function extractProgram(coachInit: any): any {
  // Common shapes we've seen: { savedProgram }, the program directly, or null.
  if (!coachInit) return null;
  if (coachInit.savedProgram) return coachInit.savedProgram;
  if (coachInit.program) return coachInit.program;
  return coachInit;
}

function DiffView({ current, proposed, highlightDays }: { current: any; proposed: any; highlightDays: string[] }) {
  const proposedDays = collectDays(proposed);
  const currentDays = collectDays(current);
  // If the agent named the changed days, focus on those; otherwise show every
  // day where current vs proposed differ. Hard cap to keep the modal short.
  const dayNames = (highlightDays.length > 0 ? highlightDays : diffDayNames(currentDays, proposedDays)).slice(0, 4);

  if (dayNames.length === 0) {
    return (
      <View style={styles.diffEmpty}>
        <Text style={styles.diffEmptyText}>No structural changes — Anakin is keeping your program intact.</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.diffScroll} contentContainerStyle={{ paddingBottom: spacing.sm }}>
      {dayNames.map((day) => (
        <View key={day} style={styles.diffDay}>
          <Text style={styles.diffDayName}>{day}</Text>
          <View style={styles.diffCols}>
            <View style={styles.diffCol}>
              <Text style={styles.diffColLabel}>Currently</Text>
              {(currentDays[day] ?? []).map((line, i) => (
                <Text key={`c-${i}`} style={styles.diffLine}>• {line}</Text>
              ))}
              {!currentDays[day] && <Text style={styles.diffMuted}>—</Text>}
            </View>
            <View style={styles.diffCol}>
              <Text style={styles.diffColLabelProp}>Proposed</Text>
              {(proposedDays[day] ?? []).map((line, i) => {
                const cur = currentDays[day] ?? [];
                const isChange = !cur.includes(line);
                return (
                  <Text key={`p-${i}`} style={[styles.diffLine, isChange && styles.diffLineNew]}>
                    {isChange ? '➕ ' : '• '}{line}
                  </Text>
                );
              })}
              {!proposedDays[day] && <Text style={styles.diffMuted}>—</Text>}
            </View>
          </View>
        </View>
      ))}
    </ScrollView>
  );
}

// Collect each training day's exercises into a compact one-line-per-exercise
// shape so the diff is easy to scan. Defensive against shape variation.
function collectDays(program: any): Record<string, string[]> {
  if (!program || typeof program !== 'object') return {};
  const out: Record<string, string[]> = {};
  const phases = Array.isArray(program.phases) ? program.phases : [];
  for (const phase of phases) {
    const days = Array.isArray(phase.trainingDays) ? phase.trainingDays : [];
    for (const d of days) {
      const name = String(d?.day ?? d?.name ?? 'Day').trim();
      const ex = Array.isArray(d?.exercises) ? d.exercises : [];
      out[name] = ex.map((e: any) => formatExerciseLine(e));
    }
  }
  return out;
}

function formatExerciseLine(ex: any): string {
  if (!ex || typeof ex !== 'object') return '?';
  const name = String(ex.name ?? ex.exercise ?? 'Exercise');
  const sets = ex.sets ?? ex.targetSets;
  const reps = ex.reps ?? ex.targetReps;
  const rir = ex.rir ?? ex.RIR;
  const tag = sets != null && reps != null ? `${sets}×${reps}` : null;
  const rirPart = rir != null ? ` RIR ${rir}` : '';
  return tag ? `${name} — ${tag}${rirPart}` : name;
}

function diffDayNames(a: Record<string, string[]>, b: Record<string, string[]>): string[] {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const changed: string[] = [];
  for (const k of keys) {
    const la = (a[k] ?? []).join('||');
    const lb = (b[k] ?? []).join('||');
    if (la !== lb) changed.push(k);
  }
  return changed;
}

const styles = StyleSheet.create({
  btn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    marginTop: spacing.md, backgroundColor: colors.primary,
    borderRadius: radius.md, paddingVertical: 11, paddingHorizontal: 14,
  },
  btnText: { color: '#fff', fontSize: fontSize.sm, fontWeight: fontWeight.semibold },
  backdrop: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center', justifyContent: 'center', padding: spacing.lg,
  },
  sheet: {
    width: '100%', maxWidth: 340, backgroundColor: colors.background,
    borderRadius: radius.lg, padding: spacing.xl, alignItems: 'center',
  },
  sheetWide: {
    width: '100%', maxWidth: 480, maxHeight: '85%', backgroundColor: colors.background,
    borderRadius: radius.lg, padding: spacing.lg,
  },
  iconWrap: { width: 64, height: 64, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.md },
  pulseRing: {
    position: 'absolute', width: 64, height: 64, borderRadius: 32,
    backgroundColor: colors.primary + '22',
  },
  successIcon: {
    width: 56, height: 56, borderRadius: 28, backgroundColor: '#22c55e',
    alignItems: 'center', justifyContent: 'center', marginBottom: spacing.md,
  },
  errorIcon: {
    width: 56, height: 56, borderRadius: 28, backgroundColor: colors.destructive,
    alignItems: 'center', justifyContent: 'center', marginBottom: spacing.md,
  },
  title: { fontSize: fontSize.base, fontWeight: fontWeight.bold, color: colors.foreground, textAlign: 'center' },
  subtitle: { fontSize: fontSize.sm, color: colors.mutedForeground, textAlign: 'center', marginTop: 4 },
  resultText: { fontSize: fontSize.sm, color: colors.mutedForeground, textAlign: 'center', marginTop: 8, lineHeight: 20 },

  summaryNote: { fontSize: fontSize.sm, color: colors.mutedForeground, marginTop: spacing.sm, lineHeight: 20 },
  summaryLabel: {
    alignSelf: 'flex-start', marginTop: spacing.md,
    fontSize: fontSize.xs, color: colors.mutedForeground,
    textTransform: 'uppercase', letterSpacing: 0.5,
  },
  summaryBox: {
    alignSelf: 'stretch', fontSize: fontSize.sm, color: colors.foreground,
    backgroundColor: colors.muted, borderRadius: radius.md,
    paddingHorizontal: spacing.sm, paddingVertical: 8, marginTop: 4,
  },

  diffScroll: { alignSelf: 'stretch', marginTop: spacing.sm, maxHeight: 280 },
  diffEmpty: { alignSelf: 'stretch', marginTop: spacing.sm, padding: spacing.sm, backgroundColor: colors.muted, borderRadius: radius.md },
  diffEmptyText: { fontSize: fontSize.sm, color: colors.mutedForeground, textAlign: 'center' },
  diffDay: {
    marginBottom: spacing.sm, padding: spacing.sm, borderRadius: radius.md,
    backgroundColor: colors.muted, borderWidth: 1, borderColor: colors.border,
  },
  diffDayName: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.foreground, marginBottom: 6 },
  diffCols: { flexDirection: 'row', gap: spacing.sm },
  diffCol: { flex: 1 },
  diffColLabel: { fontSize: fontSize.xs, color: colors.mutedForeground, marginBottom: 4, fontWeight: fontWeight.semibold },
  diffColLabelProp: { fontSize: fontSize.xs, color: colors.primary, marginBottom: 4, fontWeight: fontWeight.semibold },
  diffLine: { fontSize: fontSize.xs, color: colors.foreground, lineHeight: 18 },
  diffLineNew: { color: colors.primary, fontWeight: fontWeight.semibold },
  diffMuted: { fontSize: fontSize.xs, color: colors.mutedForeground, fontStyle: 'italic' },

  actionRow: { flexDirection: 'row', alignSelf: 'stretch', gap: spacing.sm, marginTop: spacing.md },
  cancelBtn: {
    flex: 1, paddingVertical: 11, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.muted,
    alignItems: 'center',
  },
  cancelBtnText: { color: colors.foreground, fontSize: fontSize.sm, fontWeight: fontWeight.semibold },
  confirmBtn: {
    flex: 1, paddingVertical: 11, borderRadius: radius.md,
    backgroundColor: colors.primary, alignItems: 'center',
    flexDirection: 'row', justifyContent: 'center', gap: 6,
  },
  confirmBtnText: { color: '#fff', fontSize: fontSize.sm, fontWeight: fontWeight.semibold },

  doneBtn: {
    marginTop: spacing.lg, backgroundColor: colors.foreground,
    borderRadius: radius.md, paddingVertical: 10, paddingHorizontal: 28,
  },
  doneBtnText: { color: colors.primaryForeground, fontSize: fontSize.sm, fontWeight: fontWeight.semibold },
});
