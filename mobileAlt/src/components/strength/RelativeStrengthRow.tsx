import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import type { RelStrengthResult, RelStrengthTier } from '../../lib/athleteModel';

// One lift's relative-strength row — a segmented Novice→Elite tier bar with
// a marker at the user's bodyweight-multiple. Design handoff §6.
//
// Tier band breakpoints (× bodyweight) — 5 values bound the 4 tier segments.
// Keyed by the backend's RelStrengthResult.lift names.
const TIER_BANDS: Record<string, [number, number, number, number, number]> = {
  'Bench Press':    [0.5, 1.0, 1.5, 2.0, 2.5],
  'Squat':          [0.75, 1.25, 1.75, 2.25, 3.0],
  'Deadlift':       [1.0, 1.5, 2.0, 2.5, 3.0],
  'Overhead Press': [0.35, 0.55, 0.85, 1.10, 1.45],
};

// 4 segment shades, Novice → Elite (zinc-400 → zinc-950).
const SEGMENT_COLORS = ['#A1A1AA', '#52525B', '#27272A', '#09090B'];
const TIER_LABELS = ['NOV', 'INT', 'ADV', 'ELITE'];
const TIER_INDEX: Record<RelStrengthTier, number> = {
  untested: -1, novice: 0, intermediate: 1, advanced: 2, elite: 3,
};

interface Props {
  result: RelStrengthResult;
}

export function RelativeStrengthRow({ result }: Props) {
  const bands = TIER_BANDS[result.lift];
  const tierIdx = TIER_INDEX[result.tier];
  const tested = result.tier !== 'untested' && result.ratioToBw != null && !!bands;

  // Marker x as a 0-100% across the 4 equal-width segments. Within the
  // user's tier segment, position proportionally to their value.
  let markerPct: number | null = null;
  if (tested && bands) {
    const seg = Math.max(0, Math.min(3, tierIdx));
    const segLo = bands[seg];
    const segHi = bands[seg + 1];
    const within = Math.max(0, Math.min(1, (result.ratioToBw! - segLo) / (segHi - segLo || 1)));
    markerPct = ((seg + within) / 4) * 100;
  }

  return (
    <View
      style={styles.row}
      accessibilityRole="text"
      accessibilityLabel={
        tested
          ? `${result.lift}: ${result.ratioToBw}× bodyweight, ${result.tier} tier`
          : `${result.lift}: not tested`
      }
    >
      <View style={styles.headerLine}>
        <Text style={styles.lift}>{result.lift}</Text>
        <Text style={[styles.value, !tested && styles.valueMuted]} allowFontScaling={false}>
          {tested ? `${result.ratioToBw!.toFixed(2)}× BW` : 'Not tested'}
        </Text>
      </View>

      {/* Segmented tier bar */}
      <View style={styles.bar}>
        {SEGMENT_COLORS.map((color, i) => (
          <View
            key={i}
            style={[
              styles.segment,
              { backgroundColor: tested ? color : '#E4E4E7' },
              i > 0 && styles.segmentSep,
            ]}
          />
        ))}
        {markerPct != null && (
          <View style={[styles.marker, { left: `${markerPct}%` }]} />
        )}
      </View>

      {/* Tier labels — current tier bolded */}
      <View style={styles.labelRow}>
        {TIER_LABELS.map((label, i) => (
          <Text
            key={label}
            style={[
              styles.tierLabel,
              tested && i === tierIdx && styles.tierLabelActive,
            ]}
          >
            {label}
          </Text>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#F4F4F5' },
  headerLine: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  lift: { fontSize: 13.5, fontWeight: '700', color: '#09090B' },
  value: { fontSize: 13, fontWeight: '800', fontFamily: 'Menlo', color: '#09090B' },
  valueMuted: { color: '#A1A1AA', fontWeight: '600' },

  bar: { flexDirection: 'row', height: 12, borderRadius: 4, overflow: 'hidden', marginTop: 9 },
  segment: { flex: 1, height: '100%' },
  segmentSep: { borderLeftWidth: 1, borderLeftColor: '#FFFFFF' },
  marker: {
    position: 'absolute', width: 4, height: 18, borderRadius: 2, top: -3,
    backgroundColor: '#09090B', borderWidth: 2, borderColor: '#FFFFFF',
    marginLeft: -2,
  },

  labelRow: { flexDirection: 'row', marginTop: 5 },
  tierLabel: {
    flex: 1, textAlign: 'center', fontSize: 8.5, fontWeight: '700',
    letterSpacing: 0.5, color: '#A1A1AA',
  },
  tierLabelActive: { color: '#09090B' },
});
