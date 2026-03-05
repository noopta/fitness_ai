import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, fontSize, fontWeight, spacing, radius } from '../constants/theme';

interface Hypothesis {
  name: string;
  score: number; // 0-100
}

interface Props {
  hypotheses: Hypothesis[];
}

export function HypothesisRankings({ hypotheses }: Props) {
  const sorted = [...hypotheses].sort((a, b) => b.score - a.score).slice(0, 5);
  const max = sorted[0]?.score || 1;

  const getBarColor = (index: number): string => {
    if (index === 0) return colors.primary;
    if (index === 1) return colors.mutedForeground;
    return colors.mutedForeground;
  };

  return (
    <View style={styles.container}>
      {sorted.map((h, i) => (
        <View key={h.name} style={styles.item}>
          <View style={styles.header}>
            <View style={styles.rankBadge}>
              <Text style={styles.rankText}>{i + 1}</Text>
            </View>
            <Text style={styles.name} numberOfLines={1}>
              {h.name}
            </Text>
            <Text style={styles.score}>{Math.round(h.score)}%</Text>
          </View>
          <View style={styles.track}>
            <View
              style={[
                styles.bar,
                {
                  width: `${(h.score / max) * 100}%` as any,
                  backgroundColor: getBarColor(i),
                },
              ]}
            />
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: spacing.md - 4 },
  item: { gap: spacing.xs + 2 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  rankBadge: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.muted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rankText: {
    fontSize: 10,
    fontWeight: fontWeight.bold,
    color: colors.mutedForeground,
  },
  name: {
    flex: 1,
    fontSize: fontSize.sm,
    color: colors.foreground,
  },
  score: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    color: colors.primary,
  },
  track: {
    height: 6,
    backgroundColor: colors.muted,
    borderRadius: radius.full,
    overflow: 'hidden',
  },
  bar: {
    height: '100%',
    borderRadius: radius.full,
  },
});
