// Shared status pill + dot + coverage bar used across the subscreens.
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { fontWeight } from '../../../constants/theme';
import { STATUS_STYLE, NP } from './npTokens';
import type { NpStatus } from '../../../lib/api';

export function StatusPill({ status }: { status: NpStatus }) {
  const st = STATUS_STYLE[status];
  return (
    <View style={[styles.pill, { backgroundColor: st.pillBg }]}>
      <View style={[styles.dot, { backgroundColor: st.dot }]} />
      <Text style={[styles.text, { color: st.pillInk }]}>{st.label}</Text>
    </View>
  );
}

// Full-width progress/track bar; fill coloured by status, clamped to 100%.
export function CoverageBar({ pct, status }: { pct: number; status: NpStatus }) {
  const st = STATUS_STYLE[status];
  return (
    <View style={styles.track}>
      <View style={[styles.fill, { width: `${Math.min(100, Math.max(0, pct))}%`, backgroundColor: st.dot }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  pill: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 9, paddingVertical: 3, borderRadius: 999 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  text: { fontSize: 10, fontWeight: fontWeight.bold, letterSpacing: 0.3 },
  track: { height: 6, borderRadius: 999, backgroundColor: NP.muted, overflow: 'hidden' },
  fill: { height: 6, borderRadius: 999 },
});
