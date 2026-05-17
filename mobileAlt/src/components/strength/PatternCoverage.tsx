import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { PatternCell } from './PatternCell';
import type { PatternCoverage as PatternCoverageEntry } from '../../lib/athleteModel';

// "Pattern Coverage" section — a 2-column grid of movement patterns showing
// which the user trains and which are gaps. Design handoff §6.
//
// Header pill: an "N GAPS" warning when any pattern is neglected, else a
// "FULL COVERAGE" success pill.

interface Props {
  patterns: PatternCoverageEntry[];
  onCellPress?: (cell: PatternCoverageEntry) => void;
}

export function PatternCoverage({ patterns, onCellPress }: Props) {
  if (patterns.length === 0) return null;

  const gaps = patterns.filter((p) => p.status === 'neglected').length;

  const pill = gaps > 0
    ? { text: `${gaps} GAP${gaps > 1 ? 'S' : ''}`, bg: '#FEE2E2', fg: '#DC2626' }
    : { text: 'FULL COVERAGE', bg: '#DCFCE7', fg: '#15803D' };

  // Chunk into rows of 2 for the grid.
  const rows: PatternCoverageEntry[][] = [];
  for (let i = 0; i < patterns.length; i += 2) {
    rows.push(patterns.slice(i, i + 2));
  }

  return (
    <View style={styles.section}>
      <View style={styles.header}>
        <Text style={styles.eyebrow}>Pattern Coverage</Text>
        <View style={[styles.pill, { backgroundColor: pill.bg }]}>
          <Text style={[styles.pillText, { color: pill.fg }]}>{pill.text}</Text>
        </View>
      </View>
      <View style={styles.grid}>
        {rows.map((row, ri) => (
          <View key={ri} style={styles.row}>
            {row.map((cell) => (
              <PatternCell key={cell.pattern} cell={cell} onPress={onCellPress} />
            ))}
            {/* Pad a trailing odd cell so the last row aligns to the grid. */}
            {row.length === 1 && <View style={{ flex: 1 }} />}
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { paddingHorizontal: 20, marginTop: 4 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  eyebrow: {
    fontSize: 11, fontWeight: '700', letterSpacing: 1.5,
    textTransform: 'uppercase', color: '#71717A',
  },
  pill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  pillText: { fontSize: 9.5, fontWeight: '800', letterSpacing: 0.6 },
  grid: { marginTop: 10, gap: 8 },
  row: { flexDirection: 'row', gap: 8 },
});
