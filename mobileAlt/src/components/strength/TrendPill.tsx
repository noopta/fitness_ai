import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { MuscleTrend } from '../../lib/athleteModel';

// Small status pill for a muscle's strength trajectory. Design handoff §6.

interface TrendMeta {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  bg: string;
  fg: string;
}

const TREND_META: Record<MuscleTrend, TrendMeta> = {
  improving:           { label: 'Improving',      icon: 'trending-up',          bg: '#DCFCE7', fg: '#15803D' },
  plateau:             { label: 'Plateau',        icon: 'remove-outline',       bg: '#FEF3C7', fg: '#B45309' },
  declining:           { label: 'Declining',      icon: 'trending-down',        bg: '#FEE2E2', fg: '#DC2626' },
  'insufficient-data': { label: 'Need more data', icon: 'ellipsis-horizontal',  bg: '#F4F4F5', fg: '#71717A' },
};

export function TrendPill({ trend }: { trend: MuscleTrend }) {
  const m = TREND_META[trend];
  return (
    <View
      style={[styles.pill, { backgroundColor: m.bg }]}
      accessibilityRole="text"
      accessibilityLabel={`Trend: ${m.label}`}
    >
      <Ionicons name={m.icon} size={12} color={m.fg} />
      <Text style={[styles.text, { color: m.fg }]}>{m.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 999,
  },
  text: { fontSize: 11.5, fontWeight: '700' },
});
