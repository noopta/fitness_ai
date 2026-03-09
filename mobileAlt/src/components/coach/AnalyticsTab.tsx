import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import Svg, { Polyline, Circle, Line, Text as SvgText } from 'react-native-svg';
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
});
