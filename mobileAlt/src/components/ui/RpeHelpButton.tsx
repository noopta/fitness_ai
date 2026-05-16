import React, { useState } from 'react';
import { View, Text, StyleSheet, Modal, Pressable, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, fontSize, fontWeight, radius, spacing } from '../../constants/theme';

// Small "?" affordance placed next to an RPE input. A lot of users don't
// know what RPE means — tapping this opens a plain-English explainer with
// the 1-10 scale broken down. Self-contained: manages its own modal state.

const RPE_ROWS: Array<{ rpe: string; meaning: string }> = [
  { rpe: '10', meaning: 'Maximal — could not do another rep' },
  { rpe: '9',  meaning: '1 rep left in the tank' },
  { rpe: '8',  meaning: '2 reps left' },
  { rpe: '7',  meaning: '3 reps left' },
  { rpe: '≤6', meaning: 'Comfortable — 4+ reps left' },
];

export function RpeHelpButton({ size = 15 }: { size?: number }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <TouchableOpacity
        onPress={() => setOpen(true)}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel="What is RPE?"
        style={styles.iconBtn}
      >
        <Ionicons name="help-circle-outline" size={size} color={colors.mutedForeground} />
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        {/* Tap-outside to dismiss */}
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          {/* Inner card — stopPropagation so taps on the card don't dismiss */}
          <Pressable style={styles.card} onPress={() => {}}>
            <View style={styles.header}>
              <Text style={styles.title}>What is RPE?</Text>
              <TouchableOpacity onPress={() => setOpen(false)} hitSlop={8}>
                <Ionicons name="close" size={20} color={colors.mutedForeground} />
              </TouchableOpacity>
            </View>

            <Text style={styles.lede}>
              RPE — Rate of Perceived Exertion. How hard a set felt, on a 1-10 scale.
              It tells us how many reps you had left.
            </Text>

            <View style={styles.scale}>
              {RPE_ROWS.map((row) => (
                <View key={row.rpe} style={styles.scaleRow}>
                  <View style={styles.rpeBadge}>
                    <Text style={styles.rpeBadgeText}>{row.rpe}</Text>
                  </View>
                  <Text style={styles.scaleMeaning}>{row.meaning}</Text>
                </View>
              ))}
            </View>

            <Text style={styles.footnote}>
              Logging RPE sharpens your strength estimates. Leave it blank and we'll
              estimate it from your rep range — but logging it is more accurate.
            </Text>

            <TouchableOpacity style={styles.gotItBtn} onPress={() => setOpen(false)} activeOpacity={0.85}>
              <Text style={styles.gotItText}>Got it</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  iconBtn: { padding: 1, marginLeft: 3 },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  card: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: colors.background,
    borderRadius: radius.xl,
    padding: spacing.lg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  title: { fontSize: fontSize.lg, fontWeight: fontWeight.bold, color: colors.foreground },
  lede: {
    fontSize: fontSize.sm,
    color: colors.mutedForeground,
    lineHeight: 20,
    marginBottom: spacing.md,
  },
  scale: { gap: 8, marginBottom: spacing.md },
  scaleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  rpeBadge: {
    minWidth: 36,
    height: 28,
    borderRadius: radius.sm,
    backgroundColor: colors.foreground,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  rpeBadgeText: {
    color: colors.primaryForeground,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.bold,
    fontVariant: ['tabular-nums'],
  },
  scaleMeaning: { flex: 1, fontSize: fontSize.sm, color: colors.foreground },
  footnote: {
    fontSize: fontSize.xs,
    color: colors.mutedForeground,
    lineHeight: 17,
    marginBottom: spacing.md,
  },
  gotItBtn: {
    backgroundColor: colors.foreground,
    borderRadius: radius.lg,
    paddingVertical: 12,
    alignItems: 'center',
  },
  gotItText: { color: colors.primaryForeground, fontSize: fontSize.base, fontWeight: fontWeight.semibold },
});
