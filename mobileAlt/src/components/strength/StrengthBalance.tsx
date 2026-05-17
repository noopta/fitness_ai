import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { RatioRow } from './RatioRow';
import type { RatioResult } from '../../lib/athleteModel';

// "Strength Balance" — the ratio scoreboard section. Header carries a
// status pill: a drift count when any ratio is out of band, an "IN BALANCE"
// success pill when all measurable ratios sit healthy. Design handoff §6/§7.
//
// All ratios render — no-data ones become RatioRow's lock-chip "unlock"
// variant rather than being hidden, so the user sees what logging unlocks.

interface Props {
  ratios: RatioResult[];
}

export function StrengthBalance({ ratios }: Props) {
  if (ratios.length === 0) return null;

  const drifted = ratios.filter((r) => r.status === 'high' || r.status === 'low').length;
  const measured = ratios.filter((r) => r.status !== 'no-data').length;

  let pill: { text: string; bg: string; fg: string };
  if (drifted > 0) {
    pill = {
      text: `${drifted} DRIFT${drifted > 1 ? 'S' : ''}`,
      bg: '#FEE2E2', fg: '#DC2626',
    };
  } else if (measured > 0) {
    pill = { text: 'IN BALANCE', bg: '#DCFCE7', fg: '#15803D' };
  } else {
    pill = { text: 'LOG TO UNLOCK', bg: '#F4F4F5', fg: '#71717A' };
  }

  return (
    <View style={styles.section}>
      <View style={styles.header}>
        <Text style={styles.eyebrow}>Strength Balance</Text>
        <View style={[styles.pill, { backgroundColor: pill.bg }]}>
          <Text style={[styles.pillText, { color: pill.fg }]}>{pill.text}</Text>
        </View>
      </View>
      <View style={styles.list}>
        {ratios.map((ratio) => <RatioRow key={ratio.id} ratio={ratio} />)}
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
  list: { marginTop: 4 },
});
