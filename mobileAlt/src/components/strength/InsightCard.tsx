import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { Insight, InsightKind } from '../../lib/athleteModel';

// One card in "Anakin's Read" — the proactive insight feed. First-pass
// styling: kind-colored accent stripe + icon, priority-aware. The full
// visual treatment (the screenshot-worthy version) comes in the design pass.

interface KindStyle {
  icon: keyof typeof Ionicons.glyphMap;
  accent: string;   // left stripe + icon color
  tint: string;     // soft icon-bubble background
}

const KIND_STYLE: Record<InsightKind, KindStyle> = {
  stagnation: { icon: 'trending-down',      accent: '#B45309', tint: '#FEF3C7' },
  imbalance:  { icon: 'git-compare-outline', accent: '#DC2626', tint: '#FEE2E2' },
  neglect:    { icon: 'eye-off-outline',    accent: '#52525B', tint: '#F4F4F5' },
  win:        { icon: 'trending-up',        accent: '#15803D', tint: '#DCFCE7' },
};

export function InsightCard({ insight }: { insight: Insight }) {
  const ks = KIND_STYLE[insight.kind];

  return (
    <View
      style={[styles.card, { borderLeftColor: ks.accent }]}
      accessibilityRole="text"
      accessibilityLabel={`${insight.priority} priority ${insight.kind}: ${insight.title}. ${insight.detail}`}
    >
      <View style={styles.row}>
        <View style={[styles.iconBubble, { backgroundColor: ks.tint }]}>
          <Ionicons name={ks.icon} size={16} color={ks.accent} />
        </View>
        <View style={styles.body}>
          <View style={styles.titleRow}>
            <Text style={styles.title} numberOfLines={2}>{insight.title}</Text>
            {insight.metric != null && (
              <View style={[styles.metricPill, { backgroundColor: ks.tint }]}>
                <Text style={[styles.metricText, { color: ks.accent }]}>{insight.metric}</Text>
              </View>
            )}
          </View>
          <Text style={styles.detail}>{insight.detail}</Text>
          {insight.ctaHint && (
            <View style={styles.ctaRow}>
              <Ionicons name="arrow-forward" size={11} color={ks.accent} />
              <Text style={[styles.ctaText, { color: ks.accent }]}>{insight.ctaHint}</Text>
            </View>
          )}
        </View>
      </View>
      {insight.priority === 'high' && (
        <View style={styles.priorityFlag}>
          <Text style={styles.priorityText}>PRIORITY</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E4E4E7',
    borderLeftWidth: 3,
    borderRadius: 12,
    padding: 12,
    position: 'relative',
  },
  row: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  iconBubble: {
    width: 30, height: 30, borderRadius: 8,
    alignItems: 'center', justifyContent: 'center', marginTop: 1,
  },
  body: { flex: 1 },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  title: { flex: 1, fontSize: 13.5, fontWeight: '700', color: '#09090B', lineHeight: 18 },
  metricPill: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 999 },
  metricText: { fontSize: 11, fontWeight: '700', fontFamily: 'Menlo' },
  detail: { fontSize: 12.5, color: '#52525B', lineHeight: 18, marginTop: 3 },
  ctaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6 },
  ctaText: { fontSize: 11.5, fontWeight: '600' },
  priorityFlag: {
    position: 'absolute', top: -1, right: -1,
    backgroundColor: '#09090B',
    paddingHorizontal: 6, paddingVertical: 2,
    borderTopRightRadius: 11, borderBottomLeftRadius: 8,
  },
  priorityText: { color: '#FFFFFF', fontSize: 8, fontWeight: '800', letterSpacing: 0.8 },
});
