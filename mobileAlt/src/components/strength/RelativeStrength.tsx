import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { RelativeStrengthRow } from './RelativeStrengthRow';
import type { RelStrengthResult } from '../../lib/athleteModel';

// "Relative Strength" section — one tiered bar per main lift, showing the
// user's bodyweight-multiple against Novice→Elite standards. Handoff §6.

interface Props {
  results: RelStrengthResult[];
}

export function RelativeStrength({ results }: Props) {
  if (results.length === 0) return null;

  const tested = results.filter((r) => r.tier !== 'untested').length;

  return (
    <View style={styles.section}>
      <View style={styles.header}>
        <Text style={styles.eyebrow}>Relative Strength</Text>
        <Text style={styles.meta}>
          {tested > 0 ? `${tested}/${results.length} tested` : 'log to rank'}
        </Text>
      </View>
      <View style={styles.list}>
        {results.map((r) => <RelativeStrengthRow key={r.lift} result={r} />)}
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
  meta: { fontSize: 11, color: '#71717A', fontFamily: 'Menlo' },
  list: { marginTop: 4 },
});
