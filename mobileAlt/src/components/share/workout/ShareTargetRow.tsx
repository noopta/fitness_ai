// The one-tap export row (spec §7) — replaces the old single "Share" button.
//
// Layout follows the convention every athlete already knows from Strava/Nike:
// a horizontal strip of circular icon buttons with a label beneath each, so the
// destination is visible without opening a menu first.
//
// Unavailable targets are hidden, not disabled (spec §7) — a greyed button the
// user can never press is worse than no button.

import React from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, fontSize, fontWeight } from '../../../constants/theme';
import { ShareTargetDef, ShareTargetId } from './shareTargets';

interface Props {
  targets: ShareTargetDef[];
  /** Which target is mid-flight, if any. */
  busy: ShareTargetId | null;
  disabled?: boolean;
  onPress: (id: ShareTargetId) => void;
}

export function ShareTargetRow({ targets, busy, disabled, onPress }: Props) {
  const visible = targets.filter((t) => t.available);
  if (!visible.length) return null;

  return (
    <View style={styles.row}>
      {visible.map((t) => {
        const isBusy = busy === t.id;
        const isOff = !!disabled || (!!busy && !isBusy);
        return (
          <TouchableOpacity
            key={t.id}
            style={styles.item}
            onPress={() => onPress(t.id)}
            disabled={isOff || isBusy}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={`${t.label} — share your workout card`}
            accessibilityState={{ disabled: isOff || isBusy }}
          >
            <View style={[styles.circle, isOff && styles.circleOff]}>
              {isBusy
                ? <ActivityIndicator size="small" color={colors.foreground} />
                : <Ionicons name={t.icon as any} size={22} color={colors.foreground} />}
            </View>
            <Text style={[styles.label, isOff && styles.labelOff]} numberOfLines={1}>{t.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'flex-start',
    gap: spacing.lg,
    paddingTop: spacing.md,
  },
  // 44pt minimum touch target with a real label (spec §8, accessibility).
  item: { alignItems: 'center', gap: spacing.xs, minWidth: 56 },
  circle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.muted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  circleOff: { opacity: 0.4 },
  label: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.medium,
    color: colors.mutedForeground,
  },
  labelOff: { opacity: 0.5 },
});
