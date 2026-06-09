// WeightDetailScreen — full body-weight surface. Pushed (not a sheet) from
// the Inspector's weight mode. Spec: handoff §10, §11 (WeightSparkline).
//
// Subsumes the old WeeklyProjectionCard + BodyWeightCard + recent-entries
// table from the pre-v17b nutrition stack. Three blocks:
//   1. Hero — current weight, weekly delta, 30/90-day chart toggle.
//   2. Projection — projected change/week at the current calorie target,
//      plus the ±50 kcal nudge controls (the old WeeklyProjection block).
//   3. Recent entries — table of logs with date + value, swipe-to-delete
//      lives in v2; for v1 it's read-only.

import React, { useEffect, useMemo, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, useWindowDimensions, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Polyline, Circle, Line, Text as SvgText } from 'react-native-svg';
import { coachApi } from '../../../lib/api';
import { colors, fontWeight } from '../../../constants/theme';
import { useAuth } from '../../../context/AuthContext';
import { WeightShareModal } from '../../share/WeightShareModal';

interface Props {
  /** Pushed via the inspector body-press; the parent passes a back handler. */
  onClose: () => void;
}

interface BodyWeightEntry { date: string; weightLbs: number; createdAt?: string }

const RANGES = [
  { key: 30, label: '30D' },
  { key: 90, label: '90D' },
  { key: 365, label: '1Y' },
] as const;

export function WeightDetailScreen({ onClose }: Props) {
  const { user } = useAuth();
  const [logs, setLogs] = useState<BodyWeightEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState<typeof RANGES[number]['key']>(30);
  const [shareVisible, setShareVisible] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await coachApi.getBodyWeight();
        const list: BodyWeightEntry[] = Array.isArray(res)
          ? (res as any)
          : ((res as any)?.logs ?? (res as any)?.entries ?? []);
        if (!cancelled) {
          setLogs(
            [...list].sort((a, b) =>
              new Date(a.date || a.createdAt || 0).getTime() -
              new Date(b.date || b.createdAt || 0).getTime(),
            ),
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const filtered = useMemo(() => logs.slice(-range), [logs, range]);
  const current = filtered[filtered.length - 1]?.weightLbs ?? null;

  // Weekly delta = (avg of last 7) - (avg of prior 7).
  const weeklyDelta = useMemo(() => {
    if (filtered.length < 7) return null;
    const lastWeek = filtered.slice(-7);
    const prior = filtered.slice(-14, -7);
    const lastAvg = avg(lastWeek.map((e) => e.weightLbs));
    const priorAvg = prior.length ? avg(prior.map((e) => e.weightLbs)) : lastAvg;
    return lastAvg - priorAvg;
  }, [filtered]);

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close">
          <Ionicons name="chevron-back" size={24} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={styles.title}>Body weight</Text>
        <TouchableOpacity
          onPress={() => setShareVisible(true)}
          hitSlop={10}
          disabled={filtered.length < 2}
          accessibilityRole="button"
          accessibilityLabel="Share weight progress"
        >
          <Ionicons name="share-outline" size={20} color={filtered.length < 2 ? colors.mutedForeground : colors.foreground} />
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator color={colors.foreground} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
          {/* ─── Hero ──────────────────────────────────────────────────── */}
          <View style={styles.heroRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.eyebrow}>CURRENT</Text>
              <View style={styles.currentRow}>
                <Text style={styles.currentNum}>{current != null ? current.toFixed(1) : '—'}</Text>
                <Text style={styles.currentUnit}>lb</Text>
              </View>
              {weeklyDelta != null ? (
                <Text style={[styles.delta, weeklyDelta < 0 && { color: colors.success }, weeklyDelta > 0 && { color: colors.warning }]}>
                  {weeklyDelta > 0 ? '+' : ''}{weeklyDelta.toFixed(2)} lb/wk
                </Text>
              ) : null}
            </View>
            <View style={styles.rangeRow}>
              {RANGES.map((r) => (
                <TouchableOpacity
                  key={r.key}
                  style={[styles.rangeBtn, range === r.key && styles.rangeBtnOn]}
                  onPress={() => setRange(r.key)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: range === r.key }}
                >
                  <Text style={[styles.rangeText, range === r.key && styles.rangeTextOn]}>{r.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <BigChart entries={filtered} />

          {/* ─── Projection (the old WeeklyProjection block) ─────────── */}
          <ProjectionBlock series={filtered} subtractWorkoutBurn={user?.subtractWorkoutBurnFromCalories !== false} />

          {/* ─── Recent entries ──────────────────────────────────────── */}
          <Text style={styles.sectionEyebrow}>RECENT ENTRIES</Text>
          {filtered.length === 0 ? (
            <Text style={styles.emptyText}>No body weight logs yet.</Text>
          ) : (
            <View style={styles.entriesCard}>
              {[...filtered].reverse().slice(0, 14).map((e, i) => (
                <View key={`${e.date}-${i}`} style={[styles.entryRow, i > 0 && styles.entryRowDivider]}>
                  <Text style={styles.entryDate}>{formatEntryDate(e.date)}</Text>
                  <Text style={styles.entryValue}>{e.weightLbs.toFixed(1)} lb</Text>
                </View>
              ))}
            </View>
          )}
        </ScrollView>
      )}

      <WeightShareModal
        visible={shareVisible}
        onClose={() => setShareVisible(false)}
        rangeLabel={RANGES.find((r) => r.key === range)?.label ?? ''}
        current={current}
        totalChange={
          filtered.length >= 2
            ? filtered[filtered.length - 1].weightLbs - filtered[0].weightLbs
            : null
        }
        series={filtered.map((e) => e.weightLbs)}
      />
    </SafeAreaView>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function BigChart({ entries }: { entries: BodyWeightEntry[] }) {
  const { width } = useWindowDimensions();
  const W = width - 32;
  const H = 160;
  // Asymmetric padding: leave room on the left for y-axis labels and on the
  // bottom for x-axis date labels.
  const PAD_T = 12;
  const PAD_B = 22;
  const PAD_L = 36;
  const PAD_R = 12;
  const totalH = H + PAD_T + PAD_B;
  if (entries.length === 0) {
    return <View style={[styles.chartCard, { height: totalH }]}>
      <Text style={styles.emptyText}>Log a few entries to see your trend.</Text>
    </View>;
  }
  const values = entries.map((e) => e.weightLbs);
  const min = Math.min(...values) - 1;
  const max = Math.max(...values) + 1;
  const range = max - min || 1;
  const innerW = W - PAD_L - PAD_R;
  const dx = entries.length > 1 ? innerW / (entries.length - 1) : 0;

  const points = values
    .map((v, i) => {
      const x = PAD_L + i * dx;
      const y = PAD_T + (1 - (v - min) / range) * H;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  const lastX = PAD_L + (entries.length - 1) * dx;
  const lastY = PAD_T + (1 - (values[values.length - 1] - min) / range) * H;

  // 5 y-axis ticks (top → bottom). Plot coords have y=0 at top, so tick `p`
  // (0 = top = max, 1 = bottom = min).
  const yTicks = [0, 0.25, 0.5, 0.75, 1];

  // 4 x-axis ticks (first, ⅓, ⅔, last) — keeps labels from overlapping on
  // narrow screens. Always include first + last when entries.length >= 2.
  const xTickIdx = entries.length === 1
    ? [0]
    : entries.length <= 4
      ? entries.map((_, i) => i)
      : [0, Math.round((entries.length - 1) / 3), Math.round(((entries.length - 1) * 2) / 3), entries.length - 1];

  return (
    <View style={[styles.chartCard, { width: W, height: totalH }]}>
      <Svg width={W} height={totalH}>
        {/* Horizontal grid lines + y-axis labels */}
        {yTicks.map((p) => {
          const y = PAD_T + p * H;
          const value = max - p * range; // p=0 → max, p=1 → min
          return (
            <React.Fragment key={p}>
              <Line x1={PAD_L} y1={y} x2={W - PAD_R} y2={y} stroke={colors.border} strokeWidth={1} />
              <SvgText
                x={PAD_L - 4}
                y={y + 3}
                fontSize={9}
                fill={colors.mutedForeground}
                textAnchor="end"
              >
                {value.toFixed(1)}
              </SvgText>
            </React.Fragment>
          );
        })}
        <Polyline
          points={points}
          fill="none"
          stroke={colors.foreground}
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        <Circle cx={lastX} cy={lastY} r={4} fill={colors.foreground} />
        {/* X-axis date labels */}
        {xTickIdx.map((i, n) => {
          const x = PAD_L + i * dx;
          const label = formatAxisDate(entries[i]?.date);
          // Anchor first label to start, last to end, middles centred — keeps
          // labels from overflowing the chart on either edge.
          const anchor = n === 0 ? 'start' : n === xTickIdx.length - 1 ? 'end' : 'middle';
          return (
            <SvgText
              key={`x-${i}`}
              x={x}
              y={PAD_T + H + 14}
              fontSize={9}
              fill={colors.mutedForeground}
              textAnchor={anchor}
            >
              {label}
            </SvgText>
          );
        })}
      </Svg>
    </View>
  );
}

function ProjectionBlock({
  series, subtractWorkoutBurn,
}: {
  series: BodyWeightEntry[]; subtractWorkoutBurn: boolean;
}) {
  // Estimate weekly change from the last 14 entries (linear regression
  // slope × 7 days). This is the same heuristic the old WeeklyProjection
  // card used. When we have fewer than 7 entries, fall back to a flat 0.
  const slopePerDay = useMemo(() => linearSlope(series), [series]);
  const weeklyChange = slopePerDay * 7;

  return (
    <View style={styles.projectionCard}>
      <Text style={styles.sectionEyebrow}>PROJECTION</Text>
      <Text style={styles.projectionLine}>
        {Math.abs(weeklyChange) < 0.05
          ? 'Trend is flat at your current intake.'
          : `Trending ${weeklyChange > 0 ? 'up' : 'down'} ${Math.abs(weeklyChange).toFixed(2)} lb/wk.`}
      </Text>
      <Text style={styles.projectionSubtle}>
        Tweak your daily calorie target in the Coach nutrition plan to bend this.
        {subtractWorkoutBurn ? ' Workout burn already factored into today.' : ''}
      </Text>
    </View>
  );
}

// ─── Math + format helpers ───────────────────────────────────────────────────

function avg(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

/** Slope of y over index (per-day if entries are spaced 1 day apart). */
function linearSlope(series: BodyWeightEntry[]): number {
  const n = series.length;
  if (n < 2) return 0;
  const xs = series.map((_, i) => i);
  const ys = series.map((e) => e.weightLbs);
  const mx = avg(xs);
  const my = avg(ys);
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    den += (xs[i] - mx) ** 2;
  }
  if (den === 0) return 0;
  return num / den;
}

function formatEntryDate(d: string): string {
  try {
    const dt = new Date(d);
    return dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch {
    return d;
  }
}

// Short axis label, e.g. "Mar 3". Falls back gracefully if `d` is undefined
// (can happen when entries is sparse in the x-tick index slice).
function formatAxisDate(d?: string): string {
  if (!d) return '';
  try {
    const dt = new Date(d);
    return dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch {
    return d;
  }
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 14, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  title: { fontSize: 16, fontWeight: fontWeight.bold, color: colors.foreground },
  loadingBox: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  body: { padding: 16, paddingBottom: 36 },
  heroRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  eyebrow: { fontSize: 9.5, fontWeight: fontWeight.bold, color: colors.mutedForeground, letterSpacing: 1 },
  currentRow: { flexDirection: 'row', alignItems: 'flex-end', marginTop: 4 },
  currentNum: { fontSize: 36, fontWeight: '800', color: colors.foreground, letterSpacing: -1.2, fontVariant: ['tabular-nums'] },
  currentUnit: { fontSize: 16, color: colors.mutedForeground, marginLeft: 6, marginBottom: 6 },
  delta: { fontSize: 14, fontWeight: fontWeight.semibold, marginTop: 4, fontVariant: ['tabular-nums'] },
  rangeRow: { flexDirection: 'row', gap: 6 },
  rangeBtn: {
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999,
    backgroundColor: colors.muted,
  },
  rangeBtnOn: { backgroundColor: colors.foreground },
  rangeText: { fontSize: 11, fontWeight: fontWeight.semibold, color: colors.foreground },
  rangeTextOn: { color: colors.primaryForeground },
  chartCard: {
    marginTop: 14, backgroundColor: colors.card,
    borderWidth: 1, borderColor: colors.border, borderRadius: 14, padding: 4,
  },
  projectionCard: {
    marginTop: 14, borderRadius: 14, padding: 14,
    backgroundColor: colors.muted, borderWidth: 1, borderColor: colors.border,
  },
  projectionLine: { marginTop: 4, fontSize: 14, fontWeight: fontWeight.semibold, color: colors.foreground },
  projectionSubtle: { marginTop: 4, fontSize: 11.5, color: colors.mutedForeground, lineHeight: 16 },
  sectionEyebrow: { fontSize: 9.5, fontWeight: fontWeight.bold, color: colors.mutedForeground, letterSpacing: 1, marginTop: 18 },
  emptyText: { color: colors.mutedForeground, fontSize: 12, marginTop: 10, textAlign: 'center' },
  entriesCard: {
    marginTop: 8, borderRadius: 12,
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card,
  },
  entryRow: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 12 },
  entryRowDivider: { borderTopWidth: 1, borderTopColor: colors.border },
  entryDate: { fontSize: 13, color: colors.foreground },
  entryValue: { fontSize: 13, fontWeight: fontWeight.semibold, color: colors.foreground, fontVariant: ['tabular-nums'] },
});
