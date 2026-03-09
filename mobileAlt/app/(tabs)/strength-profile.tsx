import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../src/context/AuthContext';
import { coachApi } from '../../src/lib/api';
import { colors, spacing, fontSize, fontWeight, radius } from '../../src/constants/theme';
import { Card, CardHeader, CardTitle, CardContent } from '../../src/components/ui/Card';
import { Badge } from '../../src/components/ui/Badge';
import { LoadingSpinner } from '../../src/components/ui/LoadingSpinner';
import { StrengthRadar } from '../../src/components/StrengthRadar';

// ─── Types ────────────────────────────────────────────────────────────────────

interface IndexScore { value: number; confidence: number }
interface EfficiencyPoint { date: string; score: number; lift: string }
interface LimiterEntry { name: string; count: number }
interface SessionEntry {
  id: string;
  date: string;
  selectedLift: string;
  primaryLimiter: string | null;
  efficiencyScore: number | null;
}
interface ProgressionPoint { date: string; maxWeightKg: number; sets: number; reps: string }
interface ExerciseProgression { name: string; data: ProgressionPoint[] }
interface WeekVolume { week: string; totalSets: number; totalExercises: number }

interface StrengthProfileData {
  latestIndices: Record<string, IndexScore> | null;
  efficiencyTrend: EfficiencyPoint[];
  topLimiters: LimiterEntry[];
  sessionHistory: SessionEntry[];
  progressionData: ExerciseProgression[];
  weeklyVolumeData: WeekVolume[];
  totalSessions: number;
  totalWorkouts: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatLiftName(id: string) {
  return id.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function confidenceColor(c: number): string {
  if (c >= 0.7) return '#22c55e';
  if (c >= 0.4) return '#f59e0b';
  return '#94a3b8';
}

// ─── Mini bar chart for limiters ──────────────────────────────────────────────

function LimiterBar({ name, count, maxCount }: { name: string; count: number; maxCount: number }) {
  const pct = maxCount > 0 ? (count / maxCount) * 100 : 0;
  return (
    <View style={limiterStyles.row}>
      <Text style={limiterStyles.name} numberOfLines={1}>{name}</Text>
      <View style={limiterStyles.track}>
        <View style={[limiterStyles.fill, { width: `${pct}%` as any }]} />
      </View>
      <Text style={limiterStyles.count}>{count}x</Text>
    </View>
  );
}

const limiterStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: 8,
  },
  name: {
    width: 130,
    fontSize: fontSize.xs,
    color: colors.foreground,
  },
  track: {
    flex: 1,
    height: 8,
    backgroundColor: colors.muted,
    borderRadius: radius.full,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    backgroundColor: colors.primary,
    borderRadius: radius.full,
  },
  count: {
    fontSize: fontSize.xs,
    color: colors.mutedForeground,
    width: 28,
    textAlign: 'right',
  },
});

// ─── Efficiency sparkline (simple inline bars) ────────────────────────────────

function EfficiencyTrend({ data }: { data: EfficiencyPoint[] }) {
  if (data.length === 0) return null;
  const last8 = data.slice(-8);
  const max = Math.max(...last8.map(d => d.score), 95);
  return (
    <View style={trendStyles.container}>
      {last8.map((pt, i) => {
        const h = Math.max(4, (pt.score / max) * 48);
        return (
          <View key={i} style={trendStyles.colWrap}>
            <View style={[trendStyles.bar, { height: h }]} />
            <Text style={trendStyles.score}>{pt.score}</Text>
            <Text style={trendStyles.lift} numberOfLines={1}>
              {pt.lift.split('_')[0]}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

const trendStyles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 6,
    height: 80,
    paddingBottom: 20,
  },
  colWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  bar: {
    width: '80%',
    backgroundColor: colors.primary,
    borderRadius: 3,
    marginBottom: 2,
  },
  score: {
    fontSize: 9,
    color: colors.mutedForeground,
    marginBottom: 1,
  },
  lift: {
    fontSize: 8,
    color: colors.mutedForeground,
  },
});

// ─── Page Component ───────────────────────────────────────────────────────────

export default function StrengthProfileScreen() {
  const { user } = useAuth();
  const [data, setData] = useState<StrengthProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const result = await coachApi.getStrengthProfile();
      if (result) setData(result);
    } catch {
      // Non-fatal
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  function onRefresh() {
    setRefreshing(true);
    loadData();
  }

  // Build flat radar data from latestIndices
  const radarData: Record<string, number> = {};
  if (data?.latestIndices) {
    for (const [key, val] of Object.entries(data.latestIndices)) {
      radarData[key] = typeof val === 'object' ? (val as IndexScore).value : (val as number);
    }
  }
  const hasRadar = Object.keys(radarData).length > 0;

  if (loading) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Strength Profile</Text>
          <Text style={styles.headerSub}>Powered by Anakin</Text>
        </View>
        <View style={styles.loader}>
          <LoadingSpinner size="large" />
        </View>
      </SafeAreaView>
    );
  }

  const isEmpty = !data || (data.totalSessions === 0 && data.totalWorkouts === 0);

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>Strength Profile</Text>
          <Text style={styles.headerSub}>Adapts as you train</Text>
        </View>
        <TouchableOpacity style={styles.refreshBtn} onPress={onRefresh}>
          <Ionicons name="refresh-outline" size={18} color={colors.mutedForeground} />
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        {/* Adaptive learning banner */}
        <View style={styles.learnBanner}>
          <Ionicons name="sparkles-outline" size={16} color={colors.primary} />
          <Text style={styles.learnText}>
            Your profile learns from every session — the more you train and log, the smarter and more accurate the analysis becomes.
          </Text>
        </View>

        {isEmpty ? (
          <Card style={styles.card}>
            <CardContent style={styles.emptyContent}>
              <Ionicons name="barbell-outline" size={40} color={colors.mutedForeground} />
              <Text style={styles.emptyTitle}>No data yet</Text>
              <Text style={styles.emptyDesc}>
                Complete a diagnostic analysis or log workouts to build your strength profile. Anakin will track your progress and surface smart insights over time.
              </Text>
            </CardContent>
          </Card>
        ) : (
          <>
            {/* Stats overview */}
            <View style={styles.statsRow}>
              <View style={styles.statCard}>
                <Text style={styles.statNum}>{data!.totalSessions}</Text>
                <Text style={styles.statLabel}>Analyses</Text>
              </View>
              <View style={styles.statCard}>
                <Text style={styles.statNum}>{data!.totalWorkouts}</Text>
                <Text style={styles.statLabel}>Workouts</Text>
              </View>
              {(data!.efficiencyTrend ?? []).length > 0 && (
                <View style={styles.statCard}>
                  <Text style={styles.statNum}>
                    {data!.efficiencyTrend[data!.efficiencyTrend.length - 1]?.score ?? '—'}
                  </Text>
                  <Text style={styles.statLabel}>Latest Score</Text>
                </View>
              )}
            </View>

            {/* Strength radar */}
            {hasRadar && (
              <Card style={styles.card}>
                <CardHeader>
                  <CardTitle>Strength Indices</CardTitle>
                  <Text style={styles.cardSub}>Based on your diagnostic analyses</Text>
                </CardHeader>
                <CardContent style={styles.radarContent}>
                  <StrengthRadar data={radarData} size={200} />
                  {data?.latestIndices && (
                    <View style={styles.indexList}>
                      {Object.entries(data.latestIndices).map(([key, val]) => {
                        const score = typeof val === 'object' ? val.value : val;
                        const conf = typeof val === 'object' ? val.confidence : 1;
                        const label = key.replace(/_index$/, '').split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
                        return (
                          <View key={key} style={styles.indexRow}>
                            <Text style={styles.indexLabel}>{label}</Text>
                            <View style={styles.indexRight}>
                              <Text style={styles.indexScore}>{score}</Text>
                              <View style={[styles.confDot, { backgroundColor: confidenceColor(conf) }]} />
                            </View>
                          </View>
                        );
                      })}
                    </View>
                  )}
                  <Text style={styles.confLegend}>
                    <View style={[styles.confDot, { backgroundColor: '#22c55e' }]} /> High conf{'  '}
                    <View style={[styles.confDot, { backgroundColor: '#f59e0b' }]} /> Medium{'  '}
                    <View style={[styles.confDot, { backgroundColor: '#94a3b8' }]} /> Low
                  </Text>
                </CardContent>
              </Card>
            )}

            {/* Efficiency trend */}
            {(data!.efficiencyTrend ?? []).length > 0 && (
              <Card style={styles.card}>
                <CardHeader>
                  <CardTitle>Efficiency Trend</CardTitle>
                  <Text style={styles.cardSub}>Last {Math.min(data!.efficiencyTrend.length, 8)} analyses</Text>
                </CardHeader>
                <CardContent>
                  <EfficiencyTrend data={data!.efficiencyTrend} />
                </CardContent>
              </Card>
            )}

            {/* Top limiters */}
            {(data!.topLimiters ?? []).length > 0 && (
              <Card style={styles.card}>
                <CardHeader>
                  <CardTitle>Recurring Limiters</CardTitle>
                  <Text style={styles.cardSub}>Most common weaknesses identified across sessions</Text>
                </CardHeader>
                <CardContent>
                  {data!.topLimiters.map((l, i) => (
                    <LimiterBar
                      key={i}
                      name={l.name}
                      count={l.count}
                      maxCount={data!.topLimiters[0]?.count ?? 1}
                    />
                  ))}
                </CardContent>
              </Card>
            )}

            {/* Weekly volume */}
            {(data!.weeklyVolumeData ?? []).length > 0 && (
              <Card style={styles.card}>
                <CardHeader>
                  <CardTitle>Weekly Volume</CardTitle>
                </CardHeader>
                <CardContent style={styles.volumeContent}>
                  {data!.weeklyVolumeData.slice(-6).map((w, i) => (
                    <View key={i} style={styles.volumeRow}>
                      <Text style={styles.volumeWeek}>
                        {new Date(w.week).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      </Text>
                      <Text style={styles.volumeSets}>{w.totalSets} sets</Text>
                      <Text style={styles.volumeExercises}>{w.totalExercises} exercises</Text>
                    </View>
                  ))}
                </CardContent>
              </Card>
            )}

            {/* Recent sessions */}
            {(data!.sessionHistory ?? []).length > 0 && (
              <Card style={styles.card}>
                <CardHeader>
                  <CardTitle>Recent Analyses</CardTitle>
                </CardHeader>
                <CardContent style={styles.sessionList}>
                  {data!.sessionHistory.slice(0, 5).map((s, i) => (
                    <View key={s.id} style={[styles.sessionRow, i < 4 && styles.sessionRowBorder]}>
                      <View style={styles.sessionLeft}>
                        <Text style={styles.sessionLift}>{formatLiftName(s.selectedLift)}</Text>
                        {s.primaryLimiter ? (
                          <Text style={styles.sessionLimiter}>{s.primaryLimiter}</Text>
                        ) : null}
                        <Text style={styles.sessionDate}>{formatDate(s.date)}</Text>
                      </View>
                      {s.efficiencyScore != null && (
                        <View style={styles.sessionScore}>
                          <Text style={styles.sessionScoreNum}>{s.efficiencyScore}</Text>
                          <Text style={styles.sessionScoreLabel}>score</Text>
                        </View>
                      )}
                    </View>
                  ))}
                </CardContent>
              </Card>
            )}

            {/* Smart suggestions note */}
            <View style={styles.smartBox}>
              <Ionicons name="bulb-outline" size={16} color={colors.primary} />
              <Text style={styles.smartText}>
                As you continue logging workouts and running analyses, Anakin learns your patterns and can offer increasingly precise programming, target your exact weak points, and predict plateaus before they happen.
              </Text>
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerTitle: {
    fontSize: fontSize.xl,
    fontWeight: fontWeight.bold,
    color: colors.foreground,
  },
  headerSub: {
    fontSize: fontSize.xs,
    color: colors.mutedForeground,
    marginTop: 1,
  },
  refreshBtn: {
    padding: spacing.xs,
  },
  loader: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scroll: { flex: 1 },
  scrollContent: {
    padding: spacing.md,
    gap: spacing.md,
    paddingBottom: spacing.xxl,
  },

  // Adaptive learning banner
  learnBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    backgroundColor: `${colors.primary}10`,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: `${colors.primary}25`,
    padding: spacing.sm,
  },
  learnText: {
    flex: 1,
    fontSize: fontSize.xs,
    color: colors.foreground,
    lineHeight: 17,
  },

  // Stats row
  statsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  statCard: {
    flex: 1,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.sm,
    alignItems: 'center',
    gap: 2,
  },
  statNum: {
    fontSize: fontSize.xxl,
    fontWeight: fontWeight.bold,
    color: colors.primary,
  },
  statLabel: {
    fontSize: fontSize.xs,
    color: colors.mutedForeground,
    textAlign: 'center',
  },

  // Cards
  card: {},
  cardSub: {
    fontSize: fontSize.xs,
    color: colors.mutedForeground,
    marginTop: 2,
  },

  // Radar
  radarContent: {
    alignItems: 'center',
    gap: spacing.md,
    paddingTop: 0,
  },
  indexList: {
    width: '100%',
    gap: 6,
  },
  indexRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 3,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  indexLabel: {
    fontSize: fontSize.sm,
    color: colors.foreground,
  },
  indexRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  indexScore: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    color: colors.primary,
  },
  confDot: {
    width: 8, height: 8,
    borderRadius: 4,
  },
  confLegend: {
    fontSize: 10,
    color: colors.mutedForeground,
    textAlign: 'center',
  },

  // Volume
  volumeContent: {
    paddingTop: 0,
    gap: 0,
  },
  volumeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: spacing.sm,
  },
  volumeWeek: {
    width: 72,
    fontSize: fontSize.xs,
    color: colors.mutedForeground,
  },
  volumeSets: {
    flex: 1,
    fontSize: fontSize.sm,
    color: colors.foreground,
    fontWeight: fontWeight.medium,
  },
  volumeExercises: {
    fontSize: fontSize.xs,
    color: colors.mutedForeground,
  },

  // Sessions
  sessionList: {
    paddingTop: 0,
    gap: 0,
  },
  sessionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  sessionRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  sessionLeft: { flex: 1 },
  sessionLift: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    color: colors.foreground,
  },
  sessionLimiter: {
    fontSize: fontSize.xs,
    color: colors.mutedForeground,
    marginTop: 1,
  },
  sessionDate: {
    fontSize: fontSize.xs,
    color: colors.mutedForeground,
    marginTop: 2,
  },
  sessionScore: {
    alignItems: 'center',
  },
  sessionScoreNum: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.bold,
    color: colors.primary,
  },
  sessionScoreLabel: {
    fontSize: 9,
    color: colors.mutedForeground,
  },

  // Empty
  emptyContent: {
    alignItems: 'center',
    paddingVertical: spacing.xxl,
    gap: spacing.md,
  },
  emptyTitle: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.semibold,
    color: colors.foreground,
  },
  emptyDesc: {
    fontSize: fontSize.sm,
    color: colors.mutedForeground,
    textAlign: 'center',
    lineHeight: 20,
    paddingHorizontal: spacing.md,
  },

  // Smart box
  smartBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    backgroundColor: colors.muted,
    borderRadius: radius.lg,
    padding: spacing.sm,
  },
  smartText: {
    flex: 1,
    fontSize: fontSize.xs,
    color: colors.mutedForeground,
    lineHeight: 17,
  },
});
