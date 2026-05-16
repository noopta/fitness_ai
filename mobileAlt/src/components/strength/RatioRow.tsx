import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import type { RatioResult } from '../../lib/athleteModel';

// One strength-ratio row in the "Strength Balance" scoreboard. Shows the
// ratio name, the user's value, and a mini band track placing that value
// against the healthy range. Drift is colored; in-band is calm.
//
// The band track: a horizontal bar where the green segment is the healthy
// band and a dot marks where the user sits. Renders the diagnostic at a
// glance — no numbers-reading required.

const TRACK_WIDTH = 96;

function statusColor(status: RatioResult['status']): string {
  switch (status) {
    case 'in-band': return '#15803D';
    case 'high':
    case 'low':     return '#DC2626';
    default:        return '#A1A1AA';
  }
}

export function RatioRow({ ratio }: { ratio: RatioResult }) {
  const color = statusColor(ratio.status);
  const hasData = ratio.value != null;

  // Map the ratio value onto the track. The visible track spans a little
  // wider than the band so out-of-band values still render on-bar.
  const [lo, hi] = ratio.band;
  const span = hi - lo || 1;
  const trackMin = lo - span * 0.8;
  const trackMax = hi + span * 0.8;
  const trackSpan = trackMax - trackMin || 1;
  const clampPct = (v: number) => Math.max(0, Math.min(1, (v - trackMin) / trackSpan));

  const bandLeft = clampPct(lo);
  const bandRight = clampPct(hi);
  const dotPct = hasData ? clampPct(ratio.value as number) : 0.5;

  return (
    <View
      style={styles.row}
      accessibilityRole="text"
      accessibilityLabel={
        hasData
          ? `${ratio.name}: ${ratio.value}, healthy range ${lo} to ${hi}, ${ratio.status}. ${ratio.note}`
          : `${ratio.name}: not enough data`
      }
    >
      <View style={styles.left}>
        <Text style={styles.name}>{ratio.name}</Text>
        <Text style={styles.note} numberOfLines={2}>{ratio.note}</Text>
      </View>

      <View style={styles.right}>
        <Text style={[styles.value, { color: hasData ? '#09090B' : '#A1A1AA' }]}>
          {hasData ? (ratio.value as number).toFixed(2) : '—'}
        </Text>
        <View style={styles.track}>
          {/* full track */}
          <View style={styles.trackBase} />
          {/* healthy band segment */}
          <View
            style={[
              styles.trackBand,
              { left: bandLeft * TRACK_WIDTH, width: (bandRight - bandLeft) * TRACK_WIDTH },
            ]}
          />
          {/* user value marker */}
          {hasData && (
            <View
              style={[
                styles.dot,
                { left: dotPct * TRACK_WIDTH - 4, backgroundColor: color, borderColor: '#FFFFFF' },
              ]}
            />
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F4F4F5',
  },
  left: { flex: 1 },
  name: { fontSize: 13, fontWeight: '700', color: '#09090B' },
  note: { fontSize: 11.5, color: '#71717A', marginTop: 2, lineHeight: 16 },
  right: { width: TRACK_WIDTH, alignItems: 'center', gap: 5 },
  value: { fontSize: 16, fontWeight: '800', fontFamily: 'Menlo', letterSpacing: -0.5 },
  track: { width: TRACK_WIDTH, height: 14, justifyContent: 'center' },
  trackBase: {
    position: 'absolute', left: 0, right: 0, height: 4,
    borderRadius: 2, backgroundColor: '#E4E4E7',
  },
  trackBand: {
    position: 'absolute', height: 4, borderRadius: 2,
    backgroundColor: '#BBF7D0',
  },
  dot: {
    position: 'absolute', width: 8, height: 8, borderRadius: 4,
    borderWidth: 1.5, top: 3,
  },
});
