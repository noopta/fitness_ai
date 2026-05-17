import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import type { PatternCoverage } from '../../lib/athleteModel';

// One cell in the PatternCoverage grid. Status drives the whole treatment:
//   covered   → inverted dark card (the pattern is well-trained)
//   light     → warning-soft card (some volume, below ideal)
//   neglected → destructive-soft card (a real gap)
// Design handoff §6.

type Status = PatternCoverage['status'];

interface CellStyle {
  bg: string;
  label: string;     // pattern-label text color
  sub: string;       // sets-count text color
  pillBg: string;
  pillFg: string;
  pillText: string;
}

const CELL_STYLE: Record<Status, CellStyle> = {
  covered: {
    bg: '#09090B', label: '#FFFFFF', sub: 'rgba(255,255,255,0.6)',
    pillBg: 'rgba(255,255,255,0.15)', pillFg: '#FFFFFF', pillText: 'COVERED',
  },
  light: {
    bg: '#FEF3C7', label: '#09090B', sub: '#B45309',
    pillBg: '#FDE68A', pillFg: '#B45309', pillText: 'LIGHT',
  },
  neglected: {
    bg: '#FEE2E2', label: '#09090B', sub: '#DC2626',
    pillBg: '#FECACA', pillFg: '#DC2626', pillText: 'GAP',
  },
};

interface Props {
  cell: PatternCoverage;
  onPress?: (cell: PatternCoverage) => void;
}

export function PatternCell({ cell, onPress }: Props) {
  const cs = CELL_STYLE[cell.status];
  const setsLabel = cell.trailingSets === 0
    ? 'None logged'
    : `${cell.trailingSets} set${cell.trailingSets === 1 ? '' : 's'} · 4 wks`;

  return (
    <Pressable
      onPress={() => onPress?.(cell)}
      style={({ pressed }) => [
        styles.cell,
        { backgroundColor: cs.bg },
        pressed && { opacity: 0.9, transform: [{ scale: 0.985 }] },
      ]}
      accessibilityRole="button"
      accessibilityLabel={`${cell.label}: ${cs.pillText.toLowerCase()}, ${setsLabel}`}
    >
      <View style={styles.pillRow}>
        <View style={[styles.pill, { backgroundColor: cs.pillBg }]}>
          <Text style={[styles.pillText, { color: cs.pillFg }]}>{cs.pillText}</Text>
        </View>
      </View>
      <Text style={[styles.label, { color: cs.label }]} numberOfLines={2}>{cell.label}</Text>
      <Text style={[styles.sub, { color: cs.sub }]}>{setsLabel}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  cell: {
    flex: 1,
    borderRadius: 12,
    padding: 12,
    minHeight: 86,
    justifyContent: 'space-between',
  },
  pillRow: { flexDirection: 'row', justifyContent: 'flex-end' },
  pill: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 999 },
  pillText: { fontSize: 8, fontWeight: '800', letterSpacing: 0.6 },
  label: { fontSize: 13, fontWeight: '700', marginTop: 6 },
  sub: { fontSize: 10.5, fontWeight: '600', marginTop: 2 },
});
