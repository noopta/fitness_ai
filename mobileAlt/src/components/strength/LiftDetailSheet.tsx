import React, { useMemo } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, Dimensions } from 'react-native';
import Svg, { Defs, LinearGradient, Stop, Path, Circle } from 'react-native-svg';
import { BottomSheet } from '../ui/BottomSheet';
import { DeltaTag } from './DeltaTag';
import type { LiftRowData } from './LiftRow';

const SCREEN_H = Dimensions.get('window').height;

interface Props {
  visible: boolean;
  onClose: () => void;
  lift: LiftRowData | null;
  /** Optional 30D percentile, e.g. "Top 22%". Pass null for em-dash. */
  percentile?: number | null;
  /** Tap "Log a set". */
  onLogSet?: (lift: LiftRowData) => void;
  /** Tap "History". */
  onHistory?: (lift: LiftRowData) => void;
}

/**
 * Lift detail sheet — opens when a lift row is tapped.
 *
 * Spec snap points are [55%, 92%] in the handoff. The custom BottomSheet
 * doesn't support snap points; we render at 78% (matches the handoff's mock
 * preview), which is close to the upper snap and a usable single resting
 * height. Real snap-point support would need @gorhom/bottom-sheet.
 */
export function LiftDetailSheet({ visible, onClose, lift, percentile, onLogSet, onHistory }: Props) {
  const { d, area, dots } = useMemo(() => buildSparkPath(lift?.spark ?? [], 280, 100), [lift?.spark]);

  if (!lift) {
    // Early-return guard. Render an empty sheet rather than null so the
    // mounted/unmounted lifecycle stays stable across visibility flips.
    return (
      <BottomSheet visible={visible} onClose={onClose} height={1}>
        <View />
      </BottomSheet>
    );
  }

  const negative = lift.delta30d != null && lift.delta30d < 0;

  return (
    <BottomSheet visible={visible} onClose={onClose} height={SCREEN_H * 0.78} style={styles.sheet}>
      <View style={styles.handle} />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        {/* ── Title row ── */}
        <View style={styles.titleRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.eyebrow}>e1RM</Text>
            <Text style={styles.title} numberOfLines={1}>{lift.name}</Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={styles.bigNumber} allowFontScaling={false}>
              {lift.e1rm ?? '—'}
              {lift.e1rm != null && <Text style={styles.unit}> {lift.unit}</Text>}
            </Text>
            <View style={{ marginTop: 2 }}>
              <DeltaTag value={lift.delta30d} suffix={` ${lift.unit}`} size={11} />
              <Text style={styles.deltaSuffix}>30D</Text>
            </View>
          </View>
        </View>

        {/* ── Big chart ── */}
        <View style={styles.chartCard}>
          <View style={styles.chartHeader}>
            <Text style={styles.eyebrow}>Trend · {lift.spark.length} weeks</Text>
            <Text style={styles.percentile}>
              {percentile != null ? `Top ${percentile}%` : '—'}
            </Text>
          </View>
          {lift.spark.length >= 2 ? (
            <Svg viewBox="0 0 280 100" width="100%" height={100}>
              <Defs>
                <LinearGradient id="grad" x1="0" y1="0" x2="0" y2="1">
                  <Stop offset="0%" stopColor="#09090B" stopOpacity={0.18} />
                  <Stop offset="100%" stopColor="#09090B" stopOpacity={0} />
                </LinearGradient>
              </Defs>
              <Path d={area} fill="url(#grad)" />
              <Path
                d={d}
                fill="none"
                stroke={negative ? '#EF4444' : '#09090B'}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              {dots.map((dot, i) => (
                <Circle
                  key={i}
                  cx={dot.x}
                  cy={dot.y}
                  r={i === dots.length - 1 ? 3.5 : 2}
                  fill="#09090B"
                />
              ))}
            </Svg>
          ) : (
            <Text style={styles.emptyChart}>Log at least two sessions to see a trend.</Text>
          )}
        </View>

        {/* ── Last sessions placeholder ──
            The screen-level data shape doesn't carry per-set detail; Tap
            History routes the user to the sessions list which has it. */}
        <View style={{ marginTop: 16 }}>
          <Text style={styles.eyebrow}>Recent activity</Text>
          <Text style={styles.activityNote}>
            Your last sets, RPEs, and weights are in the History tab — tap below.
          </Text>
        </View>

        {/* ── Footer CTAs ── */}
        <View style={styles.footer}>
          <TouchableOpacity
            style={styles.primaryBtn}
            onPress={() => onLogSet?.(lift)}
            accessibilityRole="button"
            accessibilityLabel={`Log a set of ${lift.name}`}
          >
            <Text style={styles.primaryBtnText}>Log a set</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.secondaryBtn}
            onPress={() => onHistory?.(lift)}
            accessibilityRole="button"
            accessibilityLabel={`View history for ${lift.name}`}
          >
            <Text style={styles.secondaryBtnText}>History</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </BottomSheet>
  );
}

// Build line path + filled area path + dot coords for the chart.
// Self-contained (not the Sparkline component) because the dimensions and
// styling differ — bigger, gradient under the line, terminal dot emphasized.
function buildSparkPath(values: number[], W: number, H: number) {
  if (!values.length || values.length < 2) {
    return { d: '', area: '', dots: [] as Array<{ x: number; y: number }> };
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const sx = (i: number) => (i * W) / (values.length - 1);
  const sy = (n: number) => H - ((n - min) / range) * (H - 12) - 6;
  const d = values.map((n, i) => `${i ? 'L' : 'M'}${sx(i).toFixed(1)} ${sy(n).toFixed(1)}`).join(' ');
  const area = d + ` L${W} ${H} L0 ${H} Z`;
  const dots = values.map((n, i) => ({ x: sx(i), y: sy(n) }));
  return { d, area, dots };
}

const styles = StyleSheet.create({
  sheet: { backgroundColor: '#FFFFFF' },
  handle: {
    width: 36, height: 4, borderRadius: 999, backgroundColor: '#D4D4D8',
    alignSelf: 'center', marginTop: 10, marginBottom: 6,
  },
  content: { paddingHorizontal: 20, paddingTop: 10, paddingBottom: 32 },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  eyebrow: {
    fontSize: 11, fontWeight: '700', letterSpacing: 1.5,
    textTransform: 'uppercase', color: '#71717A',
  },
  title: { fontSize: 22, fontWeight: '700', letterSpacing: -0.4, marginTop: 4, color: '#09090B' },
  bigNumber: {
    fontSize: 32, fontWeight: '800', letterSpacing: -0.6,
    color: '#09090B', fontVariant: ['tabular-nums'],
  },
  unit: { fontSize: 13, color: '#71717A', fontWeight: '500' },
  deltaSuffix: { fontSize: 9, color: '#71717A', fontFamily: 'Menlo', textAlign: 'right' },
  chartCard: {
    marginTop: 16, padding: 14, paddingTop: 12,
    borderWidth: 1, borderColor: '#E4E4E7', borderRadius: 14,
  },
  chartHeader: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', marginBottom: 8,
  },
  percentile: { fontSize: 11, color: '#71717A', fontFamily: 'Menlo' },
  emptyChart: {
    fontSize: 12, color: '#71717A', textAlign: 'center', paddingVertical: 24,
  },
  activityNote: { fontSize: 13, color: '#71717A', marginTop: 6, lineHeight: 19 },
  footer: { flexDirection: 'row', gap: 8, marginTop: 24 },
  primaryBtn: {
    flex: 1, height: 44, backgroundColor: '#09090B',
    borderRadius: 12, alignItems: 'center', justifyContent: 'center',
  },
  primaryBtnText: { color: '#FFFFFF', fontWeight: '700', fontSize: 13 },
  secondaryBtn: {
    paddingHorizontal: 18, height: 44, backgroundColor: '#F4F4F5',
    borderRadius: 12, alignItems: 'center', justifyContent: 'center',
  },
  secondaryBtnText: { color: '#09090B', fontWeight: '700', fontSize: 13 },
});
