import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  Dimensions,
} from 'react-native';
import Svg, { Polyline, Circle, Line, Text as SvgText, Path } from 'react-native-svg';
import { colors, fontSize, fontWeight, spacing, radius } from '../../constants/theme';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/Card';
import { Input } from '../ui/Input';
import { Button } from '../ui/Button';
import { coachApi } from '../../lib/api';

interface AnalyticsTabProps {
  coachData: any;
}

interface BodyWeightEntry {
  id?: string;
  weightKg?: number;
  weightLbs?: number;
  date: string;
  createdAt?: string;
}

// ─── Weight Sparkline Chart ───────────────────────────────────────────────────

function WeightChart({ entries }: { entries: BodyWeightEntry[] }) {
  if (entries.length < 2) return null;

  const WIDTH = 300;
  const HEIGHT = 100;
  const PAD_H = 32;
  const PAD_V = 12;

  // Chronological order for chart (entries are descending, reverse for chart)
  const sorted = [...entries].reverse();
  const weights = sorted.map((e) => e.weightLbs ?? e.weightKg ?? 0);
  const minW = Math.min(...weights);
  const maxW = Math.max(...weights);
  const range = maxW - minW || 1;

  const toX = (i: number) =>
    PAD_H + (i / (sorted.length - 1)) * (WIDTH - PAD_H * 2);
  const toY = (w: number) =>
    PAD_V + (1 - (w - minW) / range) * (HEIGHT - PAD_V * 2);

  const points = sorted
    .map((e, i) => `${toX(i).toFixed(1)},${toY(e.weightLbs ?? e.weightKg ?? 0).toFixed(1)}`)
    .join(' ');

  const trend = weights[weights.length - 1] - weights[0];
  const lineColor = trend <= 0 ? colors.success : colors.destructive;

  return (
    <View style={chartStyles.wrapper}>
      <Svg width={WIDTH} height={HEIGHT}>
        <Line
          x1={PAD_H} y1={HEIGHT - PAD_V}
          x2={WIDTH - PAD_H} y2={HEIGHT - PAD_V}
          stroke={colors.border} strokeWidth="1"
        />
        <Polyline
          points={points}
          fill="none"
          stroke={lineColor}
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        <Circle cx={toX(0)} cy={toY(weights[0])} r="4" fill={colors.border} />
        <Circle cx={toX(sorted.length - 1)} cy={toY(weights[weights.length - 1])} r="4" fill={lineColor} />
        <SvgText x={2} y={toY(maxW) + 4} fontSize="9" fill={colors.mutedForeground}>
          {maxW.toFixed(0)}
        </SvgText>
        <SvgText x={2} y={toY(minW) + 4} fontSize="9" fill={colors.mutedForeground}>
          {minW.toFixed(0)}
        </SvgText>
      </Svg>
    </View>
  );
}

const chartStyles = StyleSheet.create({
  wrapper: {
    alignItems: 'center',
    marginVertical: spacing.sm,
  },
});

// ─── Weight Projection Chart ──────────────────────────────────────────────────

interface ProjectionPoint {
  label: string;
  actual: number | null;
  projected: number | null;
}

function WeightProjectionChart({
  entries,
  weeklyChangeLbs,
  totalWeeks,
  currentWeek,
}: {
  entries: BodyWeightEntry[];
  weeklyChangeLbs: number;
  totalWeeks: number;
  currentWeek: number;
}) {
  const WIDTH = Dimensions.get('window').width - 80;
  const HEIGHT = 110;
  const PAD_H = 36;
  const PAD_V = 14;

  // Build actual data from entries (last 4 weeks = 28 days)
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const points: ProjectionPoint[] = [];

  // Past 4 weeks (actual)
  for (let w = -4; w <= 0; w++) {
    const d = new Date(today);
    d.setDate(d.getDate() + w * 7);
    const str = d.toISOString().split('T')[0];
    const entry = entries.find(e => {
      const eDate = (e.date || e.createdAt || '').split('T')[0];
      // match within ±3 days
      const diff = Math.abs(new Date(eDate).getTime() - d.getTime()) / 86400000;
      return diff <= 3;
    });
    points.push({
      label: `W${w === 0 ? 'Now' : w}`,
      actual: entry ? (entry.weightLbs ?? entry.weightKg ?? null) : null,
      projected: null,
    });
  }

  // Future projection: remaining weeks from now to program end
  const weeksRemaining = Math.max(0, totalWeeks - currentWeek);
  const latestActual = entries.length > 0 ? (entries[0].weightLbs ?? entries[0].weightKg ?? null) : null;
  if (latestActual !== null && weeksRemaining > 0) {
    const projWeeks = Math.min(weeksRemaining, 8);
    for (let w = 1; w <= projWeeks; w++) {
      points.push({
        label: `+${w}w`,
        actual: null,
        projected: latestActual + weeklyChangeLbs * w,
      });
    }
  }

  if (points.length < 2) return null;

  // Gather all non-null values for scale
  const allVals = points.flatMap(p => [p.actual, p.projected]).filter((v): v is number => v !== null);
  if (allVals.length < 2) return null;

  const minV = Math.min(...allVals) - 2;
  const maxV = Math.max(...allVals) + 2;
  const range = maxV - minV || 1;

  const toX = (i: number) => PAD_H + (i / (points.length - 1)) * (WIDTH - PAD_H * 2);
  const toY = (v: number) => PAD_V + (1 - (v - minV) / range) * (HEIGHT - PAD_V * 2);

  // Build path for actual line
  const actualPts = points.map((p, i) => p.actual !== null ? `${toX(i).toFixed(1)},${toY(p.actual).toFixed(1)}` : null).filter(Boolean);
  const projPts = points.map((p, i) => p.projected !== null ? `${toX(i).toFixed(1)},${toY(p.projected).toFixed(1)}` : null).filter(Boolean);

  // Bridge: if there's a latest actual adjacent to first projected
  const lastActualIdx = points.reduce((acc, p, i) => p.actual !== null ? i : acc, -1);
  const firstProjIdx = points.findIndex(p => p.projected !== null);
  let bridgePath = '';
  if (lastActualIdx >= 0 && firstProjIdx > lastActualIdx) {
    const x1 = toX(lastActualIdx).toFixed(1);
    const y1 = toY(points[lastActualIdx].actual!).toFixed(1);
    const x2 = toX(firstProjIdx).toFixed(1);
    const y2 = toY(points[firstProjIdx].projected!).toFixed(1);
    bridgePath = `M${x1},${y1} L${x2},${y2}`;
  }

  const trend = weeklyChangeLbs <= 0 ? colors.success : colors.destructive;

  return (
    <View style={projStyles.wrapper}>
      <Svg width={WIDTH} height={HEIGHT}>
        {/* Baseline */}
        <Line x1={PAD_H} y1={HEIGHT - PAD_V} x2={WIDTH - PAD_H} y2={HEIGHT - PAD_V} stroke={colors.border} strokeWidth="1" />
        {/* Actual line */}
        {actualPts.length >= 2 && (
          <Polyline points={actualPts.join(' ')} fill="none" stroke={colors.primary} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        )}
        {/* Bridge dashed */}
        {bridgePath ? (
          <Path d={bridgePath} fill="none" stroke={trend} strokeWidth="1.5" strokeDasharray="4,4" />
        ) : null}
        {/* Projected line */}
        {projPts.length >= 2 && (
          <Polyline points={projPts.join(' ')} fill="none" stroke={trend} strokeWidth="2" strokeDasharray="5,4" strokeLinejoin="round" strokeLinecap="round" />
        )}
        {/* Actual dots */}
        {points.map((p, i) =>
          p.actual !== null ? (
            <Circle key={`a${i}`} cx={toX(i)} cy={toY(p.actual)} r="3" fill={colors.primary} />
          ) : null
        )}
        {/* Last projected dot */}
        {(() => {
          const last = [...points].reverse().find(p => p.projected !== null);
          const lastIdx = last ? points.lastIndexOf(last) : -1;
          return last && lastIdx >= 0 ? (
            <Circle cx={toX(lastIdx)} cy={toY(last.projected!)} r="3" fill={trend} />
          ) : null;
        })()}
        {/* Y axis labels */}
        <SvgText x={2} y={toY(maxV - 2) + 4} fontSize="9" fill={colors.mutedForeground}>{Math.round(maxV - 2)}</SvgText>
        <SvgText x={2} y={toY(minV + 2) + 4} fontSize="9" fill={colors.mutedForeground}>{Math.round(minV + 2)}</SvgText>
      </Svg>
      <View style={projStyles.legend}>
        <View style={projStyles.legendItem}>
          <View style={[projStyles.legendDot, { backgroundColor: colors.primary }]} />
          <Text style={projStyles.legendText}>Actual</Text>
        </View>
        <View style={projStyles.legendItem}>
          <View style={[projStyles.legendDot, { backgroundColor: trend }]} />
          <Text style={projStyles.legendText}>Projected</Text>
        </View>
        <Text style={projStyles.legendChange}>
          {weeklyChangeLbs > 0 ? '+' : ''}{weeklyChangeLbs.toFixed(1)} lbs/week
        </Text>
      </View>
    </View>
  );
}

const projStyles = StyleSheet.create({
  wrapper: { gap: spacing.xs },
  legend: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: 2 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { fontSize: 10, color: colors.mutedForeground },
  legendChange: { marginLeft: 'auto', fontSize: 10, color: colors.mutedForeground, fontStyle: 'italic' },
});

// ─── Main Component ───────────────────────────────────────────────────────────

export function AnalyticsTab({ coachData }: AnalyticsTabProps) {
  const [bodyWeightEntries, setBodyWeightEntries] = useState<BodyWeightEntry[]>([]);
  const [bwLoading, setBwLoading] = useState(true);
  const [logWeight, setLogWeight] = useState('');
  const [logging, setLogging] = useState(false);
  const [logError, setLogError] = useState('');

  useEffect(() => {
    loadBodyWeight();
  }, []);

  async function loadBodyWeight() {
    try {
      const data = await coachApi.getBodyWeight();
      // Backend returns { logs: [...] }
      const entries: BodyWeightEntry[] = Array.isArray(data)
        ? data
        : data?.logs ?? data?.entries ?? data?.weights ?? [];
      // Sort descending by date
      const sorted = [...entries].sort((a, b) => {
        const da = new Date(a.date || a.createdAt || 0).getTime();
        const db = new Date(b.date || b.createdAt || 0).getTime();
        return db - da;
      });
      setBodyWeightEntries(sorted);
    } catch {
      // No weight data yet
    } finally {
      setBwLoading(false);
    }
  }

  async function handleLogWeight() {
    const weight = parseFloat(logWeight);
    if (isNaN(weight) || weight <= 0) {
      setLogError('Please enter a valid weight.');
      return;
    }
    setLogError('');
    setLogging(true);
    try {
      await coachApi.logBodyWeight(weight);
      setLogWeight('');
      await loadBodyWeight();
    } catch (err: any) {
      const msg = err?.message || 'Failed to log weight.';
      if (msg.includes('readonly') || msg.includes('read-only') || msg.includes('read only')) {
        setLogError('Server is temporarily unable to save data. Please try again later.');
      } else {
        setLogError(msg);
      }
    } finally {
      setLogging(false);
    }
  }

  function formatDate(dateStr: string) {
    try {
      const d = new Date(dateStr);
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    } catch {
      return dateStr;
    }
  }

  function getWeight(entry: BodyWeightEntry): number {
    return entry.weightLbs ?? entry.weightKg ?? 0;
  }

  function getDelta(entries: BodyWeightEntry[], idx: number): string {
    if (idx >= entries.length - 1) return '—';
    const diff = getWeight(entries[idx]) - getWeight(entries[idx + 1]);
    if (diff === 0) return '±0';
    return diff > 0 ? `+${diff.toFixed(1)}` : `${diff.toFixed(1)}`;
  }

  function getDeltaColor(entries: BodyWeightEntry[], idx: number): string {
    if (idx >= entries.length - 1) return colors.mutedForeground;
    const diff = getWeight(entries[idx]) - getWeight(entries[idx + 1]);
    if (diff === 0) return colors.mutedForeground;
    return diff > 0 ? colors.destructive : colors.success;
  }

  const e1RMs: Record<string, number> = coachData?.e1RMs ?? {};
  const hasE1RMs = Object.keys(e1RMs).length > 0;
  const totalSessions = coachData?.totalSessions ?? coachData?.sessionCount ?? null;
  const tableEntries = bodyWeightEntries.slice(0, 7);

  // Weight projection from nutrition plan
  let weeklyChangeLbs: number | null = null;
  let totalWeeks = 0;
  let currentWeek = 1;
  try {
    const prog = typeof coachData?.savedProgram === 'string'
      ? JSON.parse(coachData.savedProgram)
      : coachData?.savedProgram;
    const nutritionPlan = prog?.nutritionPlan ?? prog?.nutrition;
    weeklyChangeLbs = nutritionPlan?.expectedOutcomes?.weeklyWeightChangeLb ?? null;
    totalWeeks = prog?.durationWeeks ?? 0;
    currentWeek = coachData?.currentWeek ?? 1;
  } catch {}

  const latestWeight = bodyWeightEntries.length > 0
    ? (bodyWeightEntries[0].weightLbs ?? bodyWeightEntries[0].weightKg ?? null)
    : null;
  const weeksRemaining = Math.max(0, totalWeeks - currentWeek);
  const targetWeight = latestWeight !== null && weeklyChangeLbs !== null && weeksRemaining > 0
    ? latestWeight + weeklyChangeLbs * weeksRemaining
    : null;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      {totalSessions !== null && (
        <Card style={styles.card}>
          <CardContent style={styles.sessionContent}>
            <Text style={styles.sessionNumber}>{totalSessions}</Text>
            <Text style={styles.sessionLabel}>Total Sessions</Text>
          </CardContent>
        </Card>
      )}

      <Card style={styles.card}>
        <CardHeader>
          <CardTitle>Body Weight</CardTitle>
        </CardHeader>
        <CardContent style={styles.cardContent}>
          <View style={styles.logRow}>
            <Input
              placeholder="Weight (lbs)"
              value={logWeight}
              onChangeText={setLogWeight}
              keyboardType="decimal-pad"
              containerStyle={styles.logInput}
            />
            <Button onPress={handleLogWeight} loading={logging} style={styles.logBtn}>
              Log
            </Button>
          </View>
          {!!logError && <Text style={styles.errorText}>{logError}</Text>}

          {bwLoading ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator size="small" color={colors.primary} />
            </View>
          ) : bodyWeightEntries.length === 0 ? (
            <Text style={styles.noDataText}>No weight entries yet. Log your first weigh-in above.</Text>
          ) : (
            <>
              <WeightChart entries={bodyWeightEntries} />

              {/* Weight projection */}
              {weeklyChangeLbs !== null && totalWeeks > 0 && (
                <>
                  <Text style={styles.projTitle}>Weight Projection</Text>
                  <WeightProjectionChart
                    entries={bodyWeightEntries}
                    weeklyChangeLbs={weeklyChangeLbs}
                    totalWeeks={totalWeeks}
                    currentWeek={currentWeek}
                  />
                  {targetWeight !== null && (
                    <View style={styles.targetWeightRow}>
                      <Text style={styles.targetWeightLabel}>Target at program end</Text>
                      <Text style={styles.targetWeightValue}>{targetWeight.toFixed(1)} lbs</Text>
                    </View>
                  )}
                </>
              )}

              <View style={styles.table}>
                <View style={[styles.tableRow, styles.tableHeader]}>
                  <Text style={[styles.tableCell, styles.tableHeaderText, styles.cellDate]}>Date</Text>
                  <Text style={[styles.tableCell, styles.tableHeaderText, styles.cellWeight]}>Weight (lbs)</Text>
                  <Text style={[styles.tableCell, styles.tableHeaderText, styles.cellDelta]}>Change</Text>
                </View>
                {tableEntries.map((entry, idx) => (
                  <View
                    key={entry.id ?? idx}
                    style={[styles.tableRow, idx % 2 === 0 ? styles.tableRowEven : {}]}
                  >
                    <Text style={[styles.tableCell, styles.cellDate]}>
                      {formatDate(entry.date || entry.createdAt || '')}
                    </Text>
                    <Text style={[styles.tableCell, styles.cellWeight, styles.weightValue]}>
                      {getWeight(entry).toFixed(1)}
                    </Text>
                    <Text
                      style={[
                        styles.tableCell,
                        styles.cellDelta,
                        { color: getDeltaColor(tableEntries, idx) },
                      ]}
                    >
                      {getDelta(tableEntries, idx)}
                    </Text>
                  </View>
                ))}
              </View>
            </>
          )}
        </CardContent>
      </Card>

      {hasE1RMs && (
        <Card style={styles.card}>
          <CardHeader>
            <CardTitle>Estimated 1RMs</CardTitle>
          </CardHeader>
          <CardContent style={styles.cardContent}>
            <View style={styles.table}>
              <View style={[styles.tableRow, styles.tableHeader]}>
                <Text style={[styles.tableCell, styles.tableHeaderText, { flex: 2 }]}>Lift</Text>
                <Text style={[styles.tableCell, styles.tableHeaderText, styles.cellWeight]}>e1RM</Text>
              </View>
              {Object.entries(e1RMs).map(([lift, val], idx) => (
                <View
                  key={lift}
                  style={[styles.tableRow, idx % 2 === 0 ? styles.tableRowEven : {}]}
                >
                  <Text style={[styles.tableCell, { flex: 2, color: colors.foreground }]}>{lift}</Text>
                  <Text style={[styles.tableCell, styles.cellWeight, styles.weightValue]}>
                    {typeof val === 'number' ? val.toFixed(1) : val}
                  </Text>
                </View>
              ))}
            </View>
          </CardContent>
        </Card>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xxl },
  card: {},
  cardContent: { paddingTop: 0, gap: spacing.sm },
  sessionContent: { alignItems: 'center', paddingVertical: spacing.lg },
  sessionNumber: { fontSize: 56, fontWeight: fontWeight.bold, color: colors.primary, lineHeight: 64 },
  sessionLabel: { fontSize: fontSize.sm, color: colors.mutedForeground },
  logRow: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm },
  logInput: { flex: 1 },
  logBtn: { paddingHorizontal: spacing.md, height: 44 },
  errorText: { fontSize: fontSize.xs, color: colors.destructive },
  loadingRow: { alignItems: 'center', paddingVertical: spacing.md },
  noDataText: { fontSize: fontSize.sm, color: colors.mutedForeground, textAlign: 'center', paddingVertical: spacing.md },
  table: { borderRadius: radius.md, overflow: 'hidden', borderWidth: 1, borderColor: colors.border },
  tableRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm, paddingHorizontal: spacing.sm },
  tableRowEven: { backgroundColor: `${colors.muted}60` },
  tableHeader: { backgroundColor: colors.muted, borderBottomWidth: 1, borderBottomColor: colors.border },
  tableHeaderText: { fontWeight: fontWeight.semibold, color: colors.mutedForeground, fontSize: fontSize.xs, textTransform: 'uppercase', letterSpacing: 0.5 },
  tableCell: { fontSize: fontSize.sm, color: colors.mutedForeground, flex: 1 },
  cellDate: { flex: 1.2 },
  cellWeight: { flex: 1.2, textAlign: 'right' },
  cellDelta: { flex: 0.8, textAlign: 'right' },
  weightValue: { color: colors.foreground, fontWeight: fontWeight.medium },
  projTitle: {
    fontSize: fontSize.xs, fontWeight: fontWeight.semibold,
    color: colors.mutedForeground, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: spacing.sm,
  },
  targetWeightRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: `${colors.primary}10`, borderRadius: radius.md,
    paddingHorizontal: spacing.sm, paddingVertical: 8, marginTop: 4,
  },
  targetWeightLabel: { fontSize: fontSize.xs, color: colors.primary },
  targetWeightValue: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.primary },
});
