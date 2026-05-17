import React, { useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue, useAnimatedStyle, withSpring, useReducedMotion,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import type { RatioResult } from '../../lib/athleteModel';

// One strength-ratio row in the "Strength Balance" scoreboard. Design
// handoff §6/§11: a full-width banded track — green healthy-band segment,
// an animated marker bar showing where the user sits, monospace edge ticks
// at the band bounds. No-data ratios render a lock-chip "unlock" variant.

function markerColorFor(ratio: RatioResult): string {
  if (ratio.status === 'in-band') return '#09090B';
  if (ratio.severity > 0.5) return '#DC2626';
  return '#B45309';
}

/** No-data variant — the ratio's contributing lift hasn't been logged. */
function NoDataRow({ ratio }: { ratio: RatioResult }) {
  return (
    <View style={styles.row} accessibilityRole="text" accessibilityLabel={`${ratio.name}: ${ratio.note}`}>
      <View style={styles.headerLine}>
        <Text style={styles.name}>{ratio.name}</Text>
        <Text style={styles.valueMuted}>—</Text>
      </View>
      <View style={styles.lockChip}>
        <Ionicons name="lock-closed" size={11} color="#A1A1AA" />
        <Text style={styles.lockText}>{ratio.note}</Text>
      </View>
    </View>
  );
}

export function RatioRow({ ratio }: { ratio: RatioResult }) {
  const reducedMotion = useReducedMotion();

  // Band-track geometry as percentages (0-100). Padding on each side so an
  // out-of-band value still lands on the bar. §11: padding = max(0.15, hi-lo).
  const [lo, hi] = ratio.band;
  const span = hi - lo || 1;
  const padding = Math.max(0.15, span);
  const min = lo - padding;
  const max = hi + padding;
  const total = max - min || 1;
  const pct = (v: number) => Math.max(0, Math.min(100, ((v - min) / total) * 100));
  const bandLo = pct(lo);
  const bandHi = pct(hi);
  const bandCenter = (bandLo + bandHi) / 2;
  const markerTarget = ratio.value != null ? pct(ratio.value) : bandCenter;

  // Marker springs from band-center to its real position on mount.
  const markerX = useSharedValue(bandCenter);
  useEffect(() => {
    if (reducedMotion) { markerX.value = markerTarget; return; }
    markerX.value = bandCenter;
    markerX.value = withSpring(markerTarget, { damping: 18, stiffness: 220 });
  }, [markerTarget, bandCenter, reducedMotion, markerX]);
  const markerStyle = useAnimatedStyle(() => ({ left: `${markerX.value}%` }));

  if (ratio.status === 'no-data' || ratio.value == null) {
    return <NoDataRow ratio={ratio} />;
  }

  const markerColor = markerColorFor(ratio);

  return (
    <View
      style={styles.row}
      accessibilityRole="text"
      accessibilityLabel={
        `${ratio.name}: ${ratio.value}, healthy range ${lo} to ${hi}, ` +
        `${ratio.status === 'in-band' ? 'in band' : 'drifted'}. ${ratio.note}`
      }
    >
      <View style={styles.headerLine}>
        <Text style={styles.name}>{ratio.name}</Text>
        <Text style={[styles.value, { color: markerColor }]} allowFontScaling={false}>
          {ratio.value.toFixed(2)}
        </Text>
      </View>

      {/* Banded track */}
      <View style={styles.track}>
        <View style={styles.trackBase} />
        <View
          style={[styles.band, { left: `${bandLo}%`, width: `${bandHi - bandLo}%` }]}
        />
        <Animated.View style={[styles.marker, { backgroundColor: markerColor }, markerStyle]} />
      </View>

      {/* Edge ticks at the band bounds */}
      <View style={styles.tickRow}>
        <Text style={[styles.tick, { left: `${bandLo}%` }]}>{lo}</Text>
        <Text style={[styles.tick, { left: `${bandHi}%` }]}>{hi}</Text>
      </View>

      <Text style={styles.note}>{ratio.note}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#F4F4F5' },
  headerLine: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  name: { fontSize: 13.5, fontWeight: '700', color: '#09090B' },
  value: { fontSize: 17, fontWeight: '800', fontFamily: 'Menlo', letterSpacing: -0.5 },
  valueMuted: { fontSize: 17, fontWeight: '800', fontFamily: 'Menlo', color: '#A1A1AA' },

  track: { height: 16, justifyContent: 'center', marginTop: 10 },
  trackBase: {
    position: 'absolute', left: 0, right: 0, height: 5,
    borderRadius: 3, backgroundColor: '#E4E4E7',
  },
  band: {
    position: 'absolute', height: 5, borderRadius: 3,
    backgroundColor: '#BBF7D0',
    borderWidth: 0.5, borderColor: '#86EFAC',
  },
  marker: {
    position: 'absolute', width: 4, height: 16, borderRadius: 2,
    borderWidth: 2, borderColor: '#FFFFFF',
    marginLeft: -2,  // center the 4px marker on its x
  },
  tickRow: { height: 13, marginTop: 2 },
  tick: {
    position: 'absolute', fontSize: 9.5, fontFamily: 'Menlo', color: '#A1A1AA',
    transform: [{ translateX: -10 }], width: 20, textAlign: 'center',
  },
  note: { fontSize: 11.5, color: '#71717A', lineHeight: 16, marginTop: 8 },

  lockChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    alignSelf: 'flex-start', marginTop: 8,
    backgroundColor: '#F4F4F5',
    paddingHorizontal: 9, paddingVertical: 6, borderRadius: 8,
  },
  lockText: { fontSize: 11.5, color: '#71717A', fontWeight: '500' },
});
