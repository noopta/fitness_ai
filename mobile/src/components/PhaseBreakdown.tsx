import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, fontSize, spacing, radius } from '../constants/theme';

interface PhaseScore {
  label: string;
  value: number;
  color?: string;
}

interface Props {
  phases: PhaseScore[];
}

const PHASE_COLORS = ['#6366f1', '#8b5cf6', '#a855f7', '#ec4899', '#f59e0b'];

export function PhaseBreakdown({ phases }: Props) {
  const maxVal = Math.max(...phases.map(p => p.value), 1);

  return (
    <View style={styles.container}>
      {phases.map((phase, i) => (
        <View key={phase.label} style={styles.row}>
          <Text style={styles.label} numberOfLines={1}>
            {phase.label}
          </Text>
          <View style={styles.barTrack}>
            <View
              style={[
                styles.bar,
                {
                  width: `${(phase.value / maxVal) * 100}%` as any,
                  backgroundColor: phase.color ?? PHASE_COLORS[i % PHASE_COLORS.length],
                },
              ]}
            />
          </View>
          <Text style={styles.value}>{Math.round(phase.value)}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: spacing.sm + 2 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  label: {
    width: 90,
    fontSize: fontSize.xs,
    color: colors.mutedForeground,
    textAlign: 'right',
  },
  barTrack: {
    flex: 1,
    height: 8,
    backgroundColor: colors.muted,
    borderRadius: radius.full,
    overflow: 'hidden',
  },
  bar: {
    height: '100%',
    borderRadius: radius.full,
  },
  value: {
    width: 32,
    fontSize: fontSize.xs,
    color: colors.mutedForeground,
    textAlign: 'right',
  },
});
