// Reusable "Apply to my plan" affordance — used by the Nutrition and Strength
// profile surfaces to hand a suggestion to the agent (apply_suggestion task),
// which makes a goal-preserving change to the user's program/macros.
//
// Shows a clean applying → success/error overlay so the user gets clear,
// animated feedback while the agent works (the agent turn can take several
// seconds). Only renders when the agent is available for this user; callers
// pass `available` (fetched once via coachApi.agentStatus).

import React, { useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Modal, Animated, Easing,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { coachApi } from '../../lib/api';
import { colors, fontSize, fontWeight, radius, spacing } from '../../constants/theme';

type Phase = 'idle' | 'applying' | 'done' | 'error';

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
    if (phase === 'applying') return;
    setPhase('applying');
    setMessage('');
    openOverlay();
    startPulse();
    try {
      const res = await coachApi.applySuggestion(suggestion);
      setMessage(String((res as any)?.reply ?? 'Applied to your plan.'));
      setPhase('done');
      popCheck();
      await Promise.resolve(onApplied?.());
    } catch (err: any) {
      setMessage(err?.message ?? 'Could not apply that. Please try again.');
      setPhase('error');
    }
  };

  const close = () => setPhase('idle');

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
          <View style={styles.sheet}>
            {phase === 'applying' && (
              <>
                <View style={styles.iconWrap}>
                  <Animated.View style={[styles.pulseRing, pulseStyle]} />
                  <Ionicons name="sparkles" size={26} color={colors.primary} />
                </View>
                <Text style={styles.title}>Applying to your plan…</Text>
                <Text style={styles.subtitle}>Anakin is fitting this to your goal.</Text>
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

const styles = StyleSheet.create({
  btn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    marginTop: spacing.md, backgroundColor: colors.primary,
    borderRadius: radius.md, paddingVertical: 11, paddingHorizontal: 14,
  },
  btnText: { color: '#fff', fontSize: fontSize.sm, fontWeight: fontWeight.semibold },
  backdrop: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center', justifyContent: 'center', padding: spacing.xl,
  },
  sheet: {
    width: '100%', maxWidth: 340, backgroundColor: colors.background,
    borderRadius: radius.lg, padding: spacing.xl, alignItems: 'center',
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
  doneBtn: {
    marginTop: spacing.lg, backgroundColor: colors.foreground,
    borderRadius: radius.md, paddingVertical: 10, paddingHorizontal: 28,
  },
  doneBtnText: { color: colors.primaryForeground, fontSize: fontSize.sm, fontWeight: fontWeight.semibold },
});
