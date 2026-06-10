import React, { useEffect, useState } from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, fontSize, fontWeight } from '../constants/theme';
import { useCoachMarkGate } from '../lib/coachMarks';

interface Props {
  tourId: string;          // matches an entry in src/lib/coachMarks.ts TOURS
  title: string;
  body: string;
  icon?: keyof typeof Ionicons.glyphMap;
  iconColor?: string;
  /** Optional small delay before show, so the underlying screen has time to render */
  delayMs?: number;
}

/**
 * Lightweight "got it" coach-mark. Pops a centered Modal once on first visit
 * to a screen (gated by AsyncStorage via useCoachMarkGate). Not a full
 * spotlight-tour with target highlighting — that needs measureInWindow refs
 * and a cutout overlay; for the new features in this release a one-shot
 * tooltip is enough to point users at where the feature lives.
 *
 * Place near the top of the screen's render tree. The component is invisible
 * once dismissed and on subsequent visits.
 *
 * Example:
 *   <CoachMarkTooltip
 *     tourId={TOURS.SWAP_WORKOUT}
 *     title="Swap your workout"
 *     body="Tap Swap on any day to pull another session into today. Anakin re-sequences the rest of your week."
 *     icon="swap-horizontal"
 *     iconColor="#6366f1"
 *   />
 */
export function CoachMarkTooltip({ tourId, title, body, icon, iconColor, delayMs = 400 }: Props) {
  const gate = useCoachMarkGate(tourId);
  const [delayedShow, setDelayedShow] = useState(false);

  useEffect(() => {
    if (gate.shouldShow !== true) return;
    const t = setTimeout(() => setDelayedShow(true), delayMs);
    return () => clearTimeout(t);
  }, [gate.shouldShow, delayMs]);

  if (!delayedShow) return null;

  const dismiss = () => {
    setDelayedShow(false);
    void gate.markSeen();
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={dismiss}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          {icon ? (
            <View style={[styles.iconWrap, iconColor ? { backgroundColor: `${iconColor}22` } : null]}>
              <Ionicons name={icon} size={26} color={iconColor ?? colors.foreground} />
            </View>
          ) : null}
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.body}>{body}</Text>
          <TouchableOpacity style={styles.cta} onPress={dismiss} activeOpacity={0.9}>
            <Text style={styles.ctaText}>Got it</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
  },
  card: {
    backgroundColor: colors.background,
    borderRadius: radius.xl,
    padding: spacing.lg,
    width: '100%',
    maxWidth: 360,
    alignItems: 'center',
    gap: spacing.sm,
  },
  iconWrap: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.muted,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  title: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.bold,
    color: colors.foreground,
    textAlign: 'center',
  },
  body: {
    fontSize: fontSize.sm,
    color: colors.mutedForeground,
    textAlign: 'center',
    lineHeight: 20,
  },
  cta: {
    marginTop: spacing.md,
    backgroundColor: colors.foreground,
    paddingHorizontal: spacing.xl,
    paddingVertical: 12,
    borderRadius: radius.full,
    minWidth: 140,
    alignItems: 'center',
  },
  ctaText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    color: colors.primaryForeground,
  },
});
