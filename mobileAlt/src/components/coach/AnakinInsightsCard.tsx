import React, { useState } from 'react';
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
  const [expanded, setExpanded] = useState(false);

  if (insights.length === 0) return null;

  return (
    <View style={styles.card}>
      {/* Tappable header — always visible */}
      <TouchableOpacity
        style={styles.header}
        activeOpacity={0.75}
        onPress={() => setExpanded(e => !e)}
      >
        <View style={styles.headerLeft}>
          <View style={styles.headerIcon}>
            <Ionicons name="sparkles" size={13} color={colors.primaryForeground} />
          </View>
          <Text style={styles.headerLabel}>ANAKIN'S LATEST INSIGHTS</Text>
          <View style={styles.countBadge}>
            <Text style={styles.countText}>{insights.length}</Text>
          </View>
        </View>
        <Ionicons
          name={expanded ? 'chevron-up' : 'chevron-down'}
          size={16}
          color={colors.mutedForeground}
        />
      </TouchableOpacity>

      {/* Collapsed preview — show first insight faintly */}
      {!expanded && (
        <TouchableOpacity
          style={styles.preview}
          activeOpacity={0.75}
          onPress={() => setExpanded(true)}
        >
          {(() => {
            const cfg = INSIGHT_CONFIG[insights[0].type] ?? INSIGHT_CONFIG.action;
            return (
              <View style={styles.previewRow}>
                <View style={[styles.iconBoxSm, { backgroundColor: cfg.color + '18' }]}>
                  <Ionicons name={cfg.icon as any} size={13} color={cfg.color} />
                </View>
                <Text style={styles.previewText} numberOfLines={1}>{insights[0].text}</Text>
                <Text style={styles.previewMore}>+{insights.length - 1} more</Text>
              </View>
            );
          })()}
        </TouchableOpacity>
      )}

      {/* Expanded: all insight rows */}
      {expanded && (
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
      )}
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

  // Header row (always shown)
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    flex: 1,
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
  countBadge: {
    backgroundColor: colors.muted,
    borderRadius: radius.full,
    paddingHorizontal: 6,
    paddingVertical: 1,
    marginLeft: 2,
  },
  countText: {
    fontSize: 10,
    fontWeight: fontWeight.bold,
    color: colors.mutedForeground,
  },

  // Collapsed preview
  preview: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  previewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  iconBoxSm: {
    width: 24,
    height: 24,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  previewText: {
    flex: 1,
    fontSize: fontSize.xs,
    color: colors.mutedForeground,
    lineHeight: 17,
  },
  previewMore: {
    fontSize: fontSize.xs,
    color: colors.mutedForeground,
    fontWeight: fontWeight.medium,
    flexShrink: 0,
  },

  // Expanded list
  list: {
    paddingHorizontal: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
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
