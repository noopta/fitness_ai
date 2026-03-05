import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
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
  weightKg: number;
  date: string;
  createdAt?: string;
}

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
      const entries: BodyWeightEntry[] = Array.isArray(data)
        ? data
        : data?.entries ?? data?.weights ?? [];
      // Sort descending by date, take last 7
      const sorted = [...entries].sort((a, b) => {
        const da = new Date(a.date || a.createdAt || 0).getTime();
        const db = new Date(b.date || b.createdAt || 0).getTime();
        return db - da;
      });
      setBodyWeightEntries(sorted.slice(0, 7));
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
      setLogError(err?.message || 'Failed to log weight. Please try again.');
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

  function getDelta(entries: BodyWeightEntry[], idx: number): string {
    if (idx >= entries.length - 1) return '—';
    const diff = entries[idx].weightKg - entries[idx + 1].weightKg;
    if (diff === 0) return '±0';
    return diff > 0 ? `+${diff.toFixed(1)}` : `${diff.toFixed(1)}`;
  }

  function getDeltaColor(entries: BodyWeightEntry[], idx: number): string {
    if (idx >= entries.length - 1) return colors.mutedForeground;
    const diff = entries[idx].weightKg - entries[idx + 1].weightKg;
    if (diff === 0) return colors.mutedForeground;
    return diff > 0 ? colors.destructive : colors.success;
  }

  // e1RMs from coachData
  const e1RMs: Record<string, number> = coachData?.e1RMs ?? {};
  const hasE1RMs = Object.keys(e1RMs).length > 0;

  // Total sessions
  const totalSessions = coachData?.totalSessions ?? coachData?.sessionCount ?? null;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      {/* Total sessions */}
      {totalSessions !== null && (
        <Card style={styles.card}>
          <CardContent style={styles.sessionContent}>
            <Text style={styles.sessionNumber}>{totalSessions}</Text>
            <Text style={styles.sessionLabel}>Total Sessions</Text>
          </CardContent>
        </Card>
      )}

      {/* Body weight log */}
      <Card style={styles.card}>
        <CardHeader>
          <CardTitle>Body Weight</CardTitle>
        </CardHeader>
        <CardContent style={styles.cardContent}>
          {/* Log form */}
          <View style={styles.logRow}>
            <Input
              placeholder="Weight (kg)"
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

          {/* Weight history table */}
          {bwLoading ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator size="small" color={colors.primary} />
            </View>
          ) : bodyWeightEntries.length === 0 ? (
            <Text style={styles.noDataText}>No weight entries yet. Log your first weigh-in above.</Text>
          ) : (
            <View style={styles.table}>
              {/* Header */}
              <View style={[styles.tableRow, styles.tableHeader]}>
                <Text style={[styles.tableCell, styles.tableHeaderText, styles.cellDate]}>Date</Text>
                <Text style={[styles.tableCell, styles.tableHeaderText, styles.cellWeight]}>Weight (kg)</Text>
                <Text style={[styles.tableCell, styles.tableHeaderText, styles.cellDelta]}>Change</Text>
              </View>
              {bodyWeightEntries.map((entry, idx) => (
                <View
                  key={entry.id ?? idx}
                  style={[styles.tableRow, idx % 2 === 0 ? styles.tableRowEven : {}]}
                >
                  <Text style={[styles.tableCell, styles.cellDate]}>
                    {formatDate(entry.date || entry.createdAt || '')}
                  </Text>
                  <Text style={[styles.tableCell, styles.cellWeight, styles.weightValue]}>
                    {entry.weightKg.toFixed(1)}
                  </Text>
                  <Text
                    style={[
                      styles.tableCell,
                      styles.cellDelta,
                      { color: getDeltaColor(bodyWeightEntries, idx) },
                    ]}
                  >
                    {getDelta(bodyWeightEntries, idx)}
                  </Text>
                </View>
              ))}
            </View>
          )}
        </CardContent>
      </Card>

      {/* e1RM strength progress */}
      {hasE1RMs && (
        <Card style={styles.card}>
          <CardHeader>
            <CardTitle>Estimated 1RMs</CardTitle>
          </CardHeader>
          <CardContent style={styles.cardContent}>
            <View style={styles.table}>
              <View style={[styles.tableRow, styles.tableHeader]}>
                <Text style={[styles.tableCell, styles.tableHeaderText, { flex: 2 }]}>Lift</Text>
                <Text style={[styles.tableCell, styles.tableHeaderText, styles.cellWeight]}>e1RM (kg)</Text>
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
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: spacing.md,
    gap: spacing.md,
    paddingBottom: spacing.xxl,
  },
  card: {},
  cardContent: {
    paddingTop: 0,
    gap: spacing.sm,
  },
  sessionContent: {
    alignItems: 'center',
    paddingVertical: spacing.lg,
  },
  sessionNumber: {
    fontSize: 56,
    fontWeight: fontWeight.bold,
    color: colors.primary,
    lineHeight: 64,
  },
  sessionLabel: {
    fontSize: fontSize.sm,
    color: colors.mutedForeground,
  },
  logRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
  },
  logInput: {
    flex: 1,
  },
  logBtn: {
    paddingHorizontal: spacing.md,
    height: 44,
  },
  errorText: {
    fontSize: fontSize.xs,
    color: colors.destructive,
  },
  loadingRow: {
    alignItems: 'center',
    paddingVertical: spacing.md,
  },
  noDataText: {
    fontSize: fontSize.sm,
    color: colors.mutedForeground,
    textAlign: 'center',
    paddingVertical: spacing.md,
  },
  table: {
    borderRadius: radius.md,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
  },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
  },
  tableRowEven: {
    backgroundColor: `${colors.muted}60`,
  },
  tableHeader: {
    backgroundColor: colors.muted,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  tableHeaderText: {
    fontWeight: fontWeight.semibold,
    color: colors.mutedForeground,
    fontSize: fontSize.xs,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  tableCell: {
    fontSize: fontSize.sm,
    color: colors.mutedForeground,
    flex: 1,
  },
  cellDate: {
    flex: 1.2,
  },
  cellWeight: {
    flex: 1.2,
    textAlign: 'right',
  },
  cellDelta: {
    flex: 0.8,
    textAlign: 'right',
  },
  weightValue: {
    color: colors.foreground,
    fontWeight: fontWeight.medium,
  },
});
