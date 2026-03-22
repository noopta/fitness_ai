import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  RefreshControl,
  Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Polyline, Circle, Line, Text as SvgText, Polygon, Path } from 'react-native-svg';
import { coachApi } from '../../src/lib/api';
import { colors, spacing, fontSize, fontWeight, radius } from '../../src/constants/theme';
import { Card, CardHeader, CardTitle, CardContent } from '../../src/components/ui/Card';
import { LoadingSpinner } from '../../src/components/ui/LoadingSpinner';

const SCREEN_W = Dimensions.get('window').width;
const CARD_W = SCREEN_W - spacing.md * 2;

// ─── Types ────────────────────────────────────────────────────────────────────

interface WeekPoint { week: string; rm: number; rmLbs: number }

interface LiftSummary {
  canonicalName: string;
  category: string;
  primaryMuscle: string;
  isCompound: boolean;
  current1RMkg: number;
  current1RMLbs: number;
  monthlyGainPct: number | null;
  totalTonnageKg: number;
  sessionCount: number;
  weekSeries: WeekPoint[];
}

interface StrengthProfileData {
  overallStrengthIndex: number | null;
  strengthTier: string;
  maturityLabel: string;
  maturityPct: number;
  totalLogs: number;
  monthTonnageKg: number;
  radarScores: Record<string, number>;
  lifts: LiftSummary[];
  aiInsights: string[];
}

// ─── Helpers / Constants ──────────────────────────────────────────────────────

const CATEGORY_COLOR: Record<string, string> = {
  push:  '#6366f1',
  pull:  '#22c55e',
  legs:  '#f59e0b',
  hinge: '#ef4444',
  core:  '#8b5cf6',
};

const TIER_COLOR: Record<string, string> = {
  'Not enough data': colors.mutedForeground,
  Beginner:     '#a1a1aa',
  Novice:       '#60a5fa',
  Intermediate: '#22c55e',
  Advanced:     '#a78bfa',
  Elite:        '#fbbf24',
};

const MATURITY_COLOR: Record<string, string> = {
  Bronze: '#b45309',
  Silver: '#64748b',
  Gold:   '#d97706',
};

// ─── Gain Badge ───────────────────────────────────────────────────────────────

function GainBadge({ pct }: { pct: number | null }) {
  if (pct === null) return <Text style={{ fontSize: fontSize.xs, color: colors.mutedForeground }}>—</Text>;
  if (pct > 0) return (
    <View style={gainStyles.badge}>
      <Ionicons name="trending-up" size={11} color="#22c55e" />
      <Text style={[gainStyles.text, { color: '#22c55e' }]}>+{pct}%</Text>
    </View>
  );
  if (pct < 0) return (
    <View style={gainStyles.badge}>
      <Ionicons name="trending-down" size={11} color="#ef4444" />
      <Text style={[gainStyles.text, { color: '#ef4444' }]}>{pct}%</Text>
    </View>
  );
  return <Text style={{ fontSize: fontSize.xs, color: colors.mutedForeground }}>0%</Text>;
}

const gainStyles = StyleSheet.create({
  badge: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  text: { fontSize: fontSize.xs, fontWeight: fontWeight.semibold },
});

// ─── SVG Sparkline ────────────────────────────────────────────────────────────

function Sparkline({ data, color }: { data: WeekPoint[]; color: string }) {
  const W = CARD_W - spacing.md * 4;
  const H = 48;
  const PH = 4; const PV = 4;
  if (data.length < 2) {
    return (
      <View style={{ height: H, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ fontSize: 10, color: colors.mutedForeground }}>Not enough data</Text>
      </View>
    );
  }
  const vals = data.map(d => d.rmLbs);
  const minV = Math.min(...vals); const maxV = Math.max(...vals);
  const range = maxV - minV || 1;
  const toX = (i: number) => PH + (i / (data.length - 1)) * (W - PH * 2);
  const toY = (v: number) => PV + (1 - (v - minV) / range) * (H - PV * 2);
  const pts = data.map((d, i) => `${toX(i).toFixed(1)},${toY(d.rmLbs).toFixed(1)}`).join(' ');
  return (
    <Svg width={W} height={H}>
      <Polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      <Circle cx={toX(data.length - 1)} cy={toY(vals[vals.length - 1])} r="3" fill={color} />
    </Svg>
  );
}

// ─── Movement Balance Radar ────────────────────────────────────────────────────

function MovementRadar({ scores }: { scores: Record<string, number> }) {
  const SIZE = 180;
  const cx = SIZE / 2; const cy = SIZE / 2; const R = 70;
  const cats = ['push', 'pull', 'legs', 'hinge', 'core'];
  const n = cats.length;
  const toPoint = (i: number, r: number) => {
    const angle = (i / n) * 2 * Math.PI - Math.PI / 2;
    return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
  };
  // Grid rings
  const rings = [0.25, 0.5, 0.75, 1.0].map(pct => {
    const pts = cats.map((_, i) => toPoint(i, R * pct));
    return pts.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  });
  // Data polygon
  const dataPoints = cats.map((c, i) => {
    const v = Math.min(10, Math.max(0, scores[c] ?? 0));
    return toPoint(i, (v / 10) * R);
  });
  const dataPoly = dataPoints.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  // Axis lines
  const axes = cats.map((_, i) => toPoint(i, R));
  return (
    <Svg width={SIZE} height={SIZE + 24}>
      {/* Grid rings */}
      {rings.map((pts, i) => (
        <Polygon key={i} points={pts} fill="none" stroke={colors.border} strokeWidth="1" opacity={0.6} />
      ))}
      {/* Axis lines */}
      {axes.map((pt, i) => (
        <Line key={i} x1={cx} y1={cy} x2={pt.x} y2={pt.y} stroke={colors.border} strokeWidth="1" opacity={0.4} />
      ))}
      {/* Data area */}
      <Polygon points={dataPoly} fill="#6366f1" fillOpacity={0.18} stroke="#6366f1" strokeWidth="2" />
      {/* Dots */}
      {dataPoints.map((pt, i) => (
        <Circle key={i} cx={pt.x} cy={pt.y} r="4" fill={CATEGORY_COLOR[cats[i]] ?? '#6366f1'} />
      ))}
      {/* Labels */}
      {cats.map((cat, i) => {
        const lPt = toPoint(i, R + 14);
        return (
          <SvgText key={i} x={lPt.x} y={lPt.y + 4} fontSize="10" fill={colors.mutedForeground} textAnchor="middle" fontWeight="600">
            {cat.charAt(0).toUpperCase() + cat.slice(1)}
          </SvgText>
        );
      })}
    </Svg>
  );
}

// ─── Lift Card ─────────────────────────────────────────────────────────────────

function LiftCard({ lift }: { lift: LiftSummary }) {
  const [expanded, setExpanded] = useState(false);
  const color = CATEGORY_COLOR[lift.category] ?? '#6366f1';
  return (
    <TouchableOpacity onPress={() => setExpanded(e => !e)} activeOpacity={0.85}>
      <View style={[liftStyles.card, { borderLeftColor: color, borderLeftWidth: 3 }]}>
        <View style={liftStyles.row}>
          <View style={liftStyles.left}>
            <View style={liftStyles.titleRow}>
              <Text style={liftStyles.name} numberOfLines={1}>{lift.canonicalName}</Text>
              <View style={[liftStyles.catBadge, { backgroundColor: color + '22' }]}>
                <Text style={[liftStyles.catText, { color }]}>{lift.category}</Text>
              </View>
            </View>
            <Text style={liftStyles.muscle}>{lift.primaryMuscle}</Text>
          </View>
          <View style={liftStyles.right}>
            <Text style={liftStyles.rm1}>{lift.current1RMLbs} <Text style={liftStyles.rmUnit}>lbs</Text></Text>
            <Text style={liftStyles.rmKg}>{lift.current1RMkg} kg est. 1RM</Text>
            <GainBadge pct={lift.monthlyGainPct} />
          </View>
        </View>
        <View style={liftStyles.sparkWrap}>
          <Sparkline data={lift.weekSeries} color={color} />
        </View>
        {expanded && (
          <View style={liftStyles.expandedRow}>
            <View style={liftStyles.stat}>
              <Text style={liftStyles.statVal}>{lift.sessionCount}</Text>
              <Text style={liftStyles.statLbl}>Sessions</Text>
            </View>
            <View style={liftStyles.stat}>
              <Text style={liftStyles.statVal}>{(lift.totalTonnageKg / 1000).toFixed(1)}t</Text>
              <Text style={liftStyles.statLbl}>Total Tonnage</Text>
            </View>
          </View>
        )}
      </View>
    </TouchableOpacity>
  );
}

const liftStyles = StyleSheet.create({
  card: {
    backgroundColor: colors.muted,
    borderRadius: radius.md,
    padding: spacing.sm,
    marginBottom: spacing.sm,
    gap: spacing.xs,
  },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  left: { flex: 1, gap: 2 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, flexWrap: 'wrap' },
  name: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.foreground },
  catBadge: { paddingHorizontal: 6, paddingVertical: 1, borderRadius: radius.full },
  catText: { fontSize: 9, fontWeight: fontWeight.semibold, textTransform: 'capitalize' },
  muscle: { fontSize: 10, color: colors.mutedForeground, textTransform: 'capitalize' },
  right: { alignItems: 'flex-end', gap: 1 },
  rm1: { fontSize: fontSize.lg, fontWeight: fontWeight.bold, color: colors.foreground },
  rmUnit: { fontSize: fontSize.xs, fontWeight: fontWeight.normal, color: colors.mutedForeground },
  rmKg: { fontSize: 10, color: colors.mutedForeground },
  sparkWrap: { marginTop: 4 },
  expandedRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs, paddingTop: spacing.xs, borderTopWidth: 1, borderTopColor: colors.border },
  stat: { flex: 1, alignItems: 'center' },
  statVal: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.foreground },
  statLbl: { fontSize: 10, color: colors.mutedForeground },
});

// ─── 1RM Trend Chart (multi-line) ─────────────────────────────────────────────

function TrendChart({ lifts }: { lifts: LiftSummary[] }) {
  const compound = lifts.filter(l => l.isCompound && l.weekSeries.length >= 2).slice(0, 5);
  if (compound.length === 0) return null;
  const W = CARD_W - spacing.md * 2; const H = 140; const PH = 40; const PV = 16;
  // Collect all weeks
  const weekSet = new Set<string>();
  for (const l of compound) l.weekSeries.forEach(p => weekSet.add(p.week));
  const weeks = Array.from(weekSet).sort().slice(-8);
  if (weeks.length < 2) return null;
  const allVals = compound.flatMap(l => l.weekSeries.map(p => p.rmLbs));
  const minV = Math.min(...allVals); const maxV = Math.max(...allVals); const range = maxV - minV || 1;
  const toX = (i: number) => PH + (i / (weeks.length - 1)) * (W - PH * 2);
  const toY = (v: number) => PV + (1 - (v - minV) / range) * (H - PV * 2);
  return (
    <View>
      <Svg width={W} height={H}>
        <Line x1={PH} y1={H - PV} x2={W - PH} y2={H - PV} stroke={colors.border} strokeWidth="1" />
        {compound.map((lift, li) => {
          const color = CATEGORY_COLOR[lift.category] ?? '#6366f1';
          const pts = weeks.map((wk, i) => {
            const pt = lift.weekSeries.find(p => p.week === wk);
            return pt ? `${toX(i).toFixed(1)},${toY(pt.rmLbs).toFixed(1)}` : null;
          }).filter(Boolean) as string[];
          if (pts.length < 2) return null;
          return (
            <Polyline key={li} points={pts.join(' ')} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
          );
        })}
        {/* X axis labels (every other week) */}
        {weeks.map((wk, i) => i % 2 === 0 ? (
          <SvgText key={i} x={toX(i)} y={H - 2} fontSize="8" fill={colors.mutedForeground} textAnchor="middle">
            {wk.split('-')[1] ?? wk}
          </SvgText>
        ) : null)}
        {/* Y axis labels */}
        <SvgText x={2} y={PV + 4} fontSize="8" fill={colors.mutedForeground}>{Math.round(maxV)}</SvgText>
        <SvgText x={2} y={H - PV} fontSize="8" fill={colors.mutedForeground}>{Math.round(minV)}</SvgText>
      </Svg>
      {/* Legend */}
      <View style={trendStyles.legend}>
        {compound.map((lift, i) => (
          <View key={i} style={trendStyles.legendItem}>
            <View style={[trendStyles.legendDot, { backgroundColor: CATEGORY_COLOR[lift.category] ?? '#6366f1' }]} />
            <Text style={trendStyles.legendText} numberOfLines={1}>{lift.canonicalName}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const trendStyles = StyleSheet.create({
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.xs },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { fontSize: 10, color: colors.mutedForeground, maxWidth: 90 },
});

// ─── Page Component ───────────────────────────────────────────────────────────

export default function StrengthProfileScreen() {
  const [data, setData] = useState<StrengthProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const result = await coachApi.getStrengthProfile();
      if (result) setData(result as StrengthProfileData);
    } catch {
      // Non-fatal
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  function onRefresh() { setRefreshing(true); loadData(); }

  if (loading) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Strength Profile</Text>
          <Text style={styles.headerSub}>Powered by Anakin</Text>
        </View>
        <View style={styles.loader}><LoadingSpinner size="large" /></View>
      </SafeAreaView>
    );
  }

  const isEmpty = !data || data.totalLogs === 0;
  const tierColor = TIER_COLOR[data?.strengthTier ?? ''] ?? colors.mutedForeground;
  const matColor = MATURITY_COLOR[data?.maturityLabel ?? ''] ?? colors.mutedForeground;

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
        {isEmpty ? (
          <Card style={styles.card}>
            <CardContent style={styles.emptyContent}>
              <Ionicons name="barbell-outline" size={40} color={colors.mutedForeground} />
              <Text style={styles.emptyTitle}>No data yet</Text>
              <Text style={styles.emptyDesc}>
                Log workouts with weights to start building your strength profile. 1RM estimates appear after your first session.
              </Text>
            </CardContent>
          </Card>
        ) : (
          <>
            {/* ── Hero Stats ── */}
            <Card style={styles.card}>
              <CardContent style={styles.heroContent}>
                {/* Strength Index + Tier */}
                <View style={styles.heroTop}>
                  <View style={styles.heroLeft}>
                    {data!.overallStrengthIndex !== null ? (
                      <>
                        <Text style={styles.heroIndex}>{data!.overallStrengthIndex}</Text>
                        <Text style={styles.heroIndexLabel}>Strength Index</Text>
                      </>
                    ) : (
                      <Text style={[styles.heroIndexLabel, { marginTop: 8 }]}>Index building…</Text>
                    )}
                    <View style={[styles.tierBadge, { borderColor: tierColor }]}>
                      <Text style={[styles.tierText, { color: tierColor }]}>{data!.strengthTier}</Text>
                    </View>
                  </View>
                  <View style={styles.heroRight}>
                    {/* Maturity progress */}
                    <View style={styles.maturityRow}>
                      <View style={[styles.matBadge, { backgroundColor: matColor + '22' }]}>
                        <Text style={[styles.matText, { color: matColor }]}>{data!.maturityLabel}</Text>
                      </View>
                      <Text style={styles.matPct}>{data!.maturityPct}%</Text>
                    </View>
                    <View style={styles.matBar}>
                      <View style={[styles.matBarFill, { width: `${data!.maturityPct}%` as any, backgroundColor: matColor }]} />
                    </View>
                    <Text style={styles.matSubtitle}>{data!.totalLogs} workouts logged</Text>
                  </View>
                </View>

                {/* Stats row */}
                <View style={styles.statsRow}>
                  <View style={styles.statItem}>
                    <Text style={styles.statVal}>{data!.totalLogs}</Text>
                    <Text style={styles.statLbl}>Total Logs</Text>
                  </View>
                  <View style={[styles.statItem, styles.statBorder]}>
                    <Text style={styles.statVal}>{data!.monthTonnageKg >= 1000 ? `${(data!.monthTonnageKg / 1000).toFixed(1)}t` : `${data!.monthTonnageKg}kg`}</Text>
                    <Text style={styles.statLbl}>Month Tonnage</Text>
                  </View>
                  <View style={styles.statItem}>
                    <Text style={styles.statVal}>{(data!.lifts ?? []).filter(l => l.isCompound).length}</Text>
                    <Text style={styles.statLbl}>Compounds</Text>
                  </View>
                </View>
              </CardContent>
            </Card>

            {/* ── Movement Balance Radar ── */}
            {data!.radarScores && Object.keys(data!.radarScores).length > 0 && (
              <Card style={styles.card}>
                <CardHeader><CardTitle>Movement Balance</CardTitle></CardHeader>
                <CardContent style={styles.radarContent}>
                  <MovementRadar scores={data!.radarScores} />
                  <View style={styles.radarLegend}>
                    {Object.entries(data!.radarScores).map(([cat, score]) => (
                      <View key={cat} style={styles.radarLegendItem}>
                        <View style={[styles.radarDot, { backgroundColor: CATEGORY_COLOR[cat] ?? '#6366f1' }]} />
                        <Text style={styles.radarCat}>{cat.charAt(0).toUpperCase() + cat.slice(1)}</Text>
                        <Text style={styles.radarScore}>{score}/10</Text>
                      </View>
                    ))}
                  </View>
                </CardContent>
              </Card>
            )}

            {/* ── 1RM Trend Chart ── */}
            {(data!.lifts ?? []).some(l => l.isCompound && l.weekSeries.length >= 2) && (
              <Card style={styles.card}>
                <CardHeader>
                  <CardTitle>1RM Trends</CardTitle>
                </CardHeader>
                <CardContent>
                  <TrendChart lifts={data!.lifts ?? []} />
                </CardContent>
              </Card>
            )}

            {/* ── Individual Lift Cards ── */}
            {(data!.lifts ?? []).length > 0 && (
              <Card style={styles.card}>
                <CardHeader><CardTitle>Lift Breakdown</CardTitle></CardHeader>
                <CardContent style={{ paddingTop: spacing.xs }}>
                  {(data!.lifts ?? []).slice(0, 10).map((lift, i) => (
                    <LiftCard key={i} lift={lift} />
                  ))}
                </CardContent>
              </Card>
            )}

            {/* ── AI Insights ── */}
            {(data!.aiInsights ?? []).length > 0 && (
              <Card style={styles.card}>
                <CardHeader>
                  <CardTitle>AI Insights</CardTitle>
                </CardHeader>
                <CardContent style={styles.insightsContent}>
                  {data!.aiInsights.map((insight, i) => (
                    <View key={i} style={styles.insightRow}>
                      <Ionicons name="bulb-outline" size={14} color="#fbbf24" style={styles.insightIcon} />
                      <Text style={styles.insightText}>{insight}</Text>
                    </View>
                  ))}
                </CardContent>
              </Card>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.md, paddingTop: spacing.xs, paddingBottom: spacing.xs,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  headerTitle: { fontSize: fontSize.xl, fontWeight: fontWeight.bold, color: colors.foreground },
  headerSub: { fontSize: fontSize.xs, color: colors.mutedForeground, marginTop: 1 },
  refreshBtn: { padding: spacing.xs },
  loader: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { flex: 1 },
  scrollContent: { padding: spacing.md, gap: spacing.md, paddingBottom: 80 },
  card: {},

  // Hero
  heroContent: { gap: spacing.md },
  heroTop: { flexDirection: 'row', gap: spacing.md },
  heroLeft: { flex: 1, alignItems: 'center', gap: spacing.xs },
  heroIndex: { fontSize: 40, fontWeight: fontWeight.bold, color: colors.foreground, lineHeight: 44 },
  heroIndexLabel: { fontSize: fontSize.xs, color: colors.mutedForeground },
  tierBadge: { borderWidth: 1, borderRadius: radius.full, paddingHorizontal: spacing.sm, paddingVertical: 3 },
  tierText: { fontSize: fontSize.xs, fontWeight: fontWeight.semibold },
  heroRight: { flex: 1.4, gap: spacing.xs, justifyContent: 'center' },
  maturityRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  matBadge: { paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.full },
  matText: { fontSize: fontSize.xs, fontWeight: fontWeight.semibold },
  matPct: { fontSize: fontSize.xs, color: colors.mutedForeground },
  matBar: { height: 6, backgroundColor: colors.muted, borderRadius: radius.full, overflow: 'hidden' },
  matBarFill: { height: '100%', borderRadius: radius.full },
  matSubtitle: { fontSize: 10, color: colors.mutedForeground },
  statsRow: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.sm },
  statItem: { flex: 1, alignItems: 'center', gap: 2 },
  statBorder: { borderLeftWidth: 1, borderRightWidth: 1, borderColor: colors.border },
  statVal: { fontSize: fontSize.lg, fontWeight: fontWeight.bold, color: colors.foreground },
  statLbl: { fontSize: 10, color: colors.mutedForeground },

  // Radar
  radarContent: { alignItems: 'center', gap: spacing.sm },
  radarLegend: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, justifyContent: 'center' },
  radarLegendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  radarDot: { width: 8, height: 8, borderRadius: 4 },
  radarCat: { fontSize: 11, color: colors.foreground, fontWeight: fontWeight.medium },
  radarScore: { fontSize: 10, color: colors.mutedForeground },

  // Insights
  insightsContent: { gap: spacing.sm },
  insightRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.xs },
  insightIcon: { marginTop: 1 },
  insightText: { flex: 1, fontSize: fontSize.sm, color: colors.foreground, lineHeight: 20 },

  // Empty
  emptyContent: { alignItems: 'center', paddingVertical: spacing.xxl, gap: spacing.md },
  emptyTitle: { fontSize: fontSize.lg, fontWeight: fontWeight.semibold, color: colors.foreground },
  emptyDesc: { fontSize: fontSize.sm, color: colors.mutedForeground, textAlign: 'center', lineHeight: 20, paddingHorizontal: spacing.md },
});
