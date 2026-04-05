import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { nutritionApi } from '../lib/api';
import { colors, fontSize, fontWeight, radius, spacing } from '../constants/theme';

// ─── Types ────────────────────────────────────────────────────────────────────

interface MacroSplit { proteinPct: number; carbsPct: number; fatPct: number }

interface Metrics {
  loggedDays: number;
  consistencyPct: number;
  avgCalories: number;
  avgProtein: number;
  avgCarbs: number;
  avgFat: number;
  macroSplit: MacroSplit;
  proteinPerKg: number | null;
  calorieTrend: 'increasing' | 'decreasing' | 'stable';
  trendDelta: number;
  avgMealsPerDay: number;
}

interface Insight {
  category: 'performance' | 'mood' | 'recovery' | 'body_composition' | 'habits';
  title: string;
  body: string;
}

interface MacroRec {
  proteinG: number;
  carbsG: number;
  fatG: number;
  calories: number;
  rationale: string;
}

interface Analysis {
  overallScore?: number;
  overallGrade?: string;
  summary?: string;
  strengths?: string[];
  improvements?: string[];
  insights?: Insight[];
  suggestions?: string[];
  macroRecommendation?: MacroRec;
}

interface Profile {
  hasData: boolean;
  message?: string;
  metrics?: Metrics;
  analysis?: Analysis;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const INSIGHT_ICONS: Record<string, string> = {
  performance:      'barbell-outline',
  mood:             'happy-outline',
  recovery:         'moon-outline',
  body_composition: 'body-outline',
  habits:           'calendar-outline',
};

const GRADE_COLOR: Record<string, string> = {
  A: '#22c55e',
  B: '#84cc16',
  C: '#f59e0b',
  D: '#ef4444',
};

function MacroBar({ label, pct, color }: { label: string; pct: number; color: string }) {
  return (
    <View style={barStyles.row}>
      <Text style={barStyles.label}>{label}</Text>
      <View style={barStyles.track}>
        <View style={[barStyles.fill, { width: `${Math.min(pct, 100)}%` as any, backgroundColor: color }]} />
      </View>
      <Text style={barStyles.pct}>{pct}%</Text>
    </View>
  );
}

const barStyles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  label: { fontSize: fontSize.xs, color: colors.mutedForeground, width: 52, fontWeight: fontWeight.medium },
  track: { flex: 1, height: 8, backgroundColor: colors.muted, borderRadius: 4, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 4 },
  pct: { fontSize: fontSize.xs, color: colors.foreground, fontWeight: fontWeight.semibold, width: 32, textAlign: 'right' },
});

// ─── Main Component ───────────────────────────────────────────────────────────

export function NutritionProfile() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true); else setLoading(true);
    setError(null);
    try {
      const data = await nutritionApi.getProfile();
      setProfile(data);
    } catch (err: any) {
      setError(err?.message ?? 'Failed to load nutrition profile');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.foreground} size="large" />
        <Text style={styles.loadingText}>Analysing your nutrition…</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.centered}>
        <Ionicons name="alert-circle-outline" size={40} color={colors.mutedForeground} />
        <Text style={styles.emptyTitle}>Something went wrong</Text>
        <Text style={styles.emptyBody}>{error}</Text>
        <TouchableOpacity style={styles.retryBtn} onPress={() => load()}>
          <Text style={styles.retryText}>Try again</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!profile?.hasData) {
    return (
      <View style={styles.centered}>
        <Ionicons name="nutrition-outline" size={48} color={colors.mutedForeground} />
        <Text style={styles.emptyTitle}>No nutrition data yet</Text>
        <Text style={styles.emptyBody}>
          {profile?.message ?? 'Log meals in the Nutrition tab to build your profile.'}
        </Text>
      </View>
    );
  }

  const { metrics, analysis } = profile;

  return (
    <ScrollView
      showsVerticalScrollIndicator={false}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} />}
    >
      {/* ── Overall score card ──────────────────────────────────────────── */}
      {analysis?.overallScore !== undefined && (
        <View style={styles.scoreCard}>
          <View style={styles.scoreLeft}>
            <Text style={styles.scoreLabel}>Nutrition Score</Text>
            <Text style={styles.scoreValue}>{analysis.overallScore}</Text>
            <Text style={styles.scoreMax}>/100</Text>
          </View>
          {analysis.overallGrade && (
            <View style={[styles.gradeBadge, { borderColor: GRADE_COLOR[analysis.overallGrade] ?? colors.border }]}>
              <Text style={[styles.gradeText, { color: GRADE_COLOR[analysis.overallGrade] ?? colors.foreground }]}>
                {analysis.overallGrade}
              </Text>
            </View>
          )}
        </View>
      )}

      {analysis?.summary && (
        <View style={styles.summaryCard}>
          <Text style={styles.summaryText}>{analysis.summary}</Text>
        </View>
      )}

      {/* ── Key metrics ─────────────────────────────────────────────────── */}
      {metrics && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Daily Averages</Text>
          <View style={styles.metricsGrid}>
            <MetricTile label="Calories" value={`${metrics.avgCalories}`} unit="kcal" />
            <MetricTile label="Protein" value={`${metrics.avgProtein}g`} unit="" />
            <MetricTile label="Carbs" value={`${metrics.avgCarbs}g`} unit="" />
            <MetricTile label="Fat" value={`${metrics.avgFat}g`} unit="" />
            <MetricTile label="Consistency" value={`${metrics.consistencyPct}%`} unit={`${metrics.loggedDays} days`} />
            <MetricTile label="Meals/day" value={`${metrics.avgMealsPerDay}`} unit="avg" />
          </View>

          {metrics.proteinPerKg !== null && (
            <View style={styles.infoRow}>
              <Ionicons name="barbell-outline" size={14} color={colors.mutedForeground} />
              <Text style={styles.infoText}>
                Protein: {metrics.proteinPerKg}g/kg bodyweight
                {metrics.proteinPerKg >= 1.6
                  ? ' · Good for muscle retention'
                  : ' · Below optimal for strength athletes (aim 1.6–2.2g/kg)'}
              </Text>
            </View>
          )}

          <View style={styles.infoRow}>
            <Ionicons
              name={metrics.calorieTrend === 'increasing' ? 'trending-up' : metrics.calorieTrend === 'decreasing' ? 'trending-down' : 'remove'}
              size={14}
              color={metrics.calorieTrend === 'stable' ? colors.mutedForeground : colors.foreground}
            />
            <Text style={styles.infoText}>
              Calorie trend: {metrics.calorieTrend}
              {metrics.trendDelta !== 0 ? ` (${metrics.trendDelta > 0 ? '+' : ''}${metrics.trendDelta} kcal vs first half)` : ''}
            </Text>
          </View>
        </View>
      )}

      {/* ── Macro split ─────────────────────────────────────────────────── */}
      {metrics?.macroSplit && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Macro Split</Text>
          <View style={styles.card}>
            <MacroBar label="Protein" pct={metrics.macroSplit.proteinPct} color="#6366f1" />
            <MacroBar label="Carbs"   pct={metrics.macroSplit.carbsPct}   color="#f59e0b" />
            <MacroBar label="Fat"     pct={metrics.macroSplit.fatPct}      color="#22c55e" />
          </View>
        </View>
      )}

      {/* ── Strengths & improvements ─────────────────────────────────────── */}
      {(analysis?.strengths?.length || analysis?.improvements?.length) ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Habits</Text>
          <View style={styles.habitsRow}>
            {analysis.strengths?.length ? (
              <View style={[styles.habitCard, styles.habitCardGreen]}>
                <Text style={styles.habitCardTitle}>Strengths</Text>
                {analysis.strengths.map((s, i) => (
                  <View key={i} style={styles.habitItem}>
                    <Ionicons name="checkmark-circle" size={14} color="#22c55e" />
                    <Text style={styles.habitText}>{s}</Text>
                  </View>
                ))}
              </View>
            ) : null}
            {analysis.improvements?.length ? (
              <View style={[styles.habitCard, styles.habitCardAmber]}>
                <Text style={styles.habitCardTitle}>To Improve</Text>
                {analysis.improvements.map((s, i) => (
                  <View key={i} style={styles.habitItem}>
                    <Ionicons name="arrow-up-circle" size={14} color="#f59e0b" />
                    <Text style={styles.habitText}>{s}</Text>
                  </View>
                ))}
              </View>
            ) : null}
          </View>
        </View>
      ) : null}

      {/* ── AI Insights ─────────────────────────────────────────────────── */}
      {analysis?.insights?.length ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Insights</Text>
          {analysis.insights.map((insight, i) => (
            <View key={i} style={styles.insightCard}>
              <View style={styles.insightIcon}>
                <Ionicons name={INSIGHT_ICONS[insight.category] as any ?? 'bulb-outline'} size={18} color={colors.foreground} />
              </View>
              <View style={styles.insightBody}>
                <Text style={styles.insightTitle}>{insight.title}</Text>
                <Text style={styles.insightText}>{insight.body}</Text>
              </View>
            </View>
          ))}
        </View>
      ) : null}

      {/* ── Smart suggestions ────────────────────────────────────────────── */}
      {analysis?.suggestions?.length ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Recommendations</Text>
          <View style={styles.card}>
            {analysis.suggestions.map((s, i) => (
              <View key={i} style={[styles.suggestionRow, i > 0 && styles.suggestionDivider]}>
                <View style={styles.suggestionDot} />
                <Text style={styles.suggestionText}>{s}</Text>
              </View>
            ))}
          </View>
        </View>
      ) : null}

      {/* ── Macro recommendation ─────────────────────────────────────────── */}
      {analysis?.macroRecommendation && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Target Macros</Text>
          <View style={styles.card}>
            <View style={styles.targetRow}>
              <TargetMacro label="Calories" value={`${analysis.macroRecommendation.calories}`} unit="kcal" color="#09090b" />
              <TargetMacro label="Protein"  value={`${analysis.macroRecommendation.proteinG}g`} unit="" color="#6366f1" />
              <TargetMacro label="Carbs"    value={`${analysis.macroRecommendation.carbsG}g`}   unit="" color="#f59e0b" />
              <TargetMacro label="Fat"      value={`${analysis.macroRecommendation.fatG}g`}      unit="" color="#22c55e" />
            </View>
            <Text style={styles.rationaleText}>{analysis.macroRecommendation.rationale}</Text>
          </View>
        </View>
      )}

      <Text style={styles.disclaimer}>
        Analysis based on last 90 days of logged nutrition. Updates each time you view this profile.
      </Text>
    </ScrollView>
  );
}

function MetricTile({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <View style={styles.metricTile}>
      <Text style={styles.metricValue}>{value}</Text>
      {unit ? <Text style={styles.metricUnit}>{unit}</Text> : null}
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

function TargetMacro({ label, value, unit, color }: { label: string; value: string; unit: string; color: string }) {
  return (
    <View style={styles.targetMacro}>
      <Text style={[styles.targetValue, { color }]}>{value}{unit}</Text>
      <Text style={styles.targetLabel}>{label}</Text>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  content: { padding: spacing.md, gap: spacing.lg, paddingBottom: 40 },

  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    gap: spacing.md,
    minHeight: 300,
  },
  loadingText: { fontSize: fontSize.sm, color: colors.mutedForeground, marginTop: spacing.sm },
  emptyTitle: { fontSize: fontSize.lg, fontWeight: fontWeight.bold, color: colors.foreground, textAlign: 'center' },
  emptyBody: { fontSize: fontSize.sm, color: colors.mutedForeground, textAlign: 'center', lineHeight: 20 },
  retryBtn: { marginTop: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: 10, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md },
  retryText: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.foreground },

  scoreCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.foreground,
    borderRadius: radius.lg,
    padding: spacing.lg,
  },
  scoreLeft: { flexDirection: 'row', alignItems: 'baseline', gap: 4 },
  scoreLabel: { position: 'absolute', top: -18, left: 0, fontSize: fontSize.xs, color: '#ffffff99', fontWeight: fontWeight.medium },
  scoreValue: { fontSize: 48, fontWeight: fontWeight.bold, color: '#ffffff', lineHeight: 54 },
  scoreMax: { fontSize: fontSize.lg, color: '#ffffff99', fontWeight: fontWeight.medium },
  gradeBadge: {
    width: 52, height: 52, borderRadius: 26,
    borderWidth: 2,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  gradeText: { fontSize: 26, fontWeight: fontWeight.bold },

  summaryCard: {
    backgroundColor: colors.muted,
    borderRadius: radius.lg,
    padding: spacing.md,
  },
  summaryText: { fontSize: fontSize.sm, color: colors.foreground, lineHeight: 21 },

  section: { gap: spacing.sm },
  sectionTitle: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
    color: colors.mutedForeground,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },

  metricsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  metricTile: {
    flex: 1,
    minWidth: '28%',
    backgroundColor: colors.muted,
    borderRadius: radius.md,
    padding: spacing.md,
    alignItems: 'center',
    gap: 2,
  },
  metricValue: { fontSize: fontSize.lg, fontWeight: fontWeight.bold, color: colors.foreground },
  metricUnit: { fontSize: fontSize.xs, color: colors.mutedForeground },
  metricLabel: { fontSize: fontSize.xs, color: colors.mutedForeground, textAlign: 'center' },

  infoRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, paddingHorizontal: 2 },
  infoText: { fontSize: fontSize.xs, color: colors.mutedForeground, flex: 1, lineHeight: 18 },

  card: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.md,
  },

  habitsRow: { flexDirection: 'row', gap: spacing.sm },
  habitCard: {
    flex: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.sm,
    borderWidth: 1,
  },
  habitCardGreen: { backgroundColor: '#f0fdf4', borderColor: '#bbf7d0' },
  habitCardAmber: { backgroundColor: '#fffbeb', borderColor: '#fde68a' },
  habitCardTitle: { fontSize: fontSize.xs, fontWeight: fontWeight.semibold, color: colors.foreground, marginBottom: 2 },
  habitItem: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  habitText: { fontSize: fontSize.xs, color: colors.foreground, flex: 1, lineHeight: 17 },

  insightCard: {
    flexDirection: 'row',
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.md,
  },
  insightIcon: {
    width: 36, height: 36,
    borderRadius: radius.sm,
    backgroundColor: colors.muted,
    alignItems: 'center', justifyContent: 'center',
    flexShrink: 0,
  },
  insightBody: { flex: 1, gap: 4 },
  insightTitle: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.foreground },
  insightText: { fontSize: fontSize.xs, color: colors.mutedForeground, lineHeight: 18 },

  suggestionRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, paddingVertical: 8 },
  suggestionDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  suggestionDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.foreground, marginTop: 5, flexShrink: 0 },
  suggestionText: { fontSize: fontSize.sm, color: colors.foreground, flex: 1, lineHeight: 20 },

  targetRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.sm },
  targetMacro: { alignItems: 'center', gap: 2 },
  targetValue: { fontSize: fontSize.lg, fontWeight: fontWeight.bold },
  targetLabel: { fontSize: fontSize.xs, color: colors.mutedForeground },
  rationaleText: {
    fontSize: fontSize.xs, color: colors.mutedForeground,
    fontStyle: 'italic', lineHeight: 18,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border,
    paddingTop: spacing.sm, marginTop: 4,
  },

  disclaimer: {
    fontSize: 11,
    color: colors.mutedForeground,
    textAlign: 'center',
    lineHeight: 16,
    marginTop: spacing.sm,
  },
});
