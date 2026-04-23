import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, fontSize, fontWeight, radius, spacing } from '../../constants/theme';

export interface AnakinInsight {
  type: 'strength' | 'imbalance' | 'progress' | 'nutrition' | 'action';
  text: string;
}

const INSIGHT_CONFIG: Record<AnakinInsight['type'], { icon: string; color: string; label: string }> = {
  strength:  { icon: 'barbell-outline',           color: '#6366f1', label: 'Strength' },
  imbalance: { icon: 'warning-outline',            color: '#f59e0b', label: 'Balance' },
  progress:  { icon: 'trending-up-outline',        color: '#22c55e', label: 'Progress' },
  nutrition: { icon: 'nutrition-outline',          color: '#f97316', label: 'Nutrition' },
  action:    { icon: 'checkmark-circle-outline',   color: '#38bdf8', label: 'Action' },
};

interface Props {
  insights: AnakinInsight[];
}

export function AnakinInsightsCard({ insights }: Props) {
  if (insights.length === 0) return null;

  return (
    <View style={styles.card}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerIcon}>
          <Ionicons name="sparkles" size={13} color={colors.primaryForeground} />
        </View>
        <Text style={styles.headerLabel}>ANAKIN'S LATEST INSIGHTS</Text>
      </View>

      {/* Insight rows */}
      <View style={styles.list}>
        {insights.map((insight, i) => {
          const cfg = INSIGHT_CONFIG[insight.type] ?? INSIGHT_CONFIG.action;
          return (
            <View key={i} style={[styles.row, i < insights.length - 1 && styles.rowBorder]}>
              <View style={[styles.iconBox, { backgroundColor: cfg.color + '18' }]}>
                <Ionicons name={cfg.icon as any} size={15} color={cfg.color} />
              </View>
              <View style={styles.textCol}>
                <Text style={[styles.typeLabel, { color: cfg.color }]}>{cfg.label}</Text>
                <Text style={styles.insightText}>{insight.text}</Text>
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerIcon: {
    width: 22,
    height: 22,
    borderRadius: radius.full,
    backgroundColor: colors.foreground,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerLabel: {
    fontSize: 11,
    fontWeight: fontWeight.bold,
    color: colors.mutedForeground,
    letterSpacing: 0.8,
  },
  list: {
    paddingHorizontal: spacing.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  rowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  iconBox: {
    width: 30,
    height: 30,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    marginTop: 1,
  },
  textCol: {
    flex: 1,
    gap: 2,
  },
  typeLabel: {
    fontSize: 10,
    fontWeight: fontWeight.bold,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  insightText: {
    fontSize: fontSize.sm,
    color: colors.foreground,
    lineHeight: 19,
  },
});
