import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useFocusEffect } from 'expo-router';
import { trackScreen, trackScreenTime, Analytics } from '../../src/lib/analytics';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  RefreshControl,
  Dimensions,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Polyline, Circle, Line, Text as SvgText, Polygon, Path } from 'react-native-svg';
import { GestureDetector, Gesture } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';
import { coachApi } from '../../src/lib/api';
import { colors, spacing, fontSize, fontWeight, radius } from '../../src/constants/theme';
import { Card, CardHeader, CardTitle, CardContent } from '../../src/components/ui/Card';
import { LoadingSpinner } from '../../src/components/ui/LoadingSpinner';
import { NutritionProfile } from '../../src/components/NutritionProfile';
import { TierHeroCard } from '../../src/components/strength/TierHeroCard';
import { RadarChart, type RadarAxis } from '../../src/components/strength/RadarChart';
import { LiftRow, type LiftRowData } from '../../src/components/strength/LiftRow';
import { TierExplainerSheet } from '../../src/components/strength/TierExplainerSheet';
import { LiftDetailSheet } from '../../src/components/strength/LiftDetailSheet';
import { RadarAxisDrillSheet, deriveFeedingLifts } from '../../src/components/strength/RadarAxisDrillSheet';
import { AnakinsRead } from '../../src/components/strength/AnakinsRead';
import { StrengthBalance } from '../../src/components/strength/StrengthBalance';
import { PatternCoverage } from '../../src/components/strength/PatternCoverage';
import { RelativeStrength } from '../../src/components/strength/RelativeStrength';
import type { AthleteModel } from '../../src/lib/athleteModel';
import {
  buildAxesForLevel, MOVEMENT_TO_MUSCLES, type RadarLevel, type MovementBucket,
} from '../../src/lib/muscleHierarchy';

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
  /** Optional — only present when the muscle drill-down feature flag is on. */
  muscleScores?: Record<string, number>;
  muscleTargets?: { default: number };
  muscleGroupsKnown?: readonly string[];
  /** The full Athlete Model — ledger, insights, ratios. Flag-gated. */
  athleteModel?: AthleteModel;
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
            <View style={liftStyles.rmRow}>
              <Text style={liftStyles.rm1}>{lift.current1RMLbs}</Text>
              <Text style={liftStyles.rmUnit}> lbs</Text>
            </View>
            <Text style={liftStyles.rmKg}>{lift.current1RMkg} kg · est. 1RM</Text>
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
  rmRow: { flexDirection: 'row', alignItems: 'flex-end' },
  rm1: { fontSize: fontSize.xl, fontWeight: fontWeight.bold, color: colors.foreground, lineHeight: 26 },
  rmUnit: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.foreground, lineHeight: 22 },
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

// ─── Backend → Design data mapping ────────────────────────────────────────────
//
// The handoff spec is shaped around `tierIndex (1..6)`, `wilks`, `percentile`,
// six radar axes on a 0..100 scale, and `delta30d`. Our backend currently
// returns five-axis 0..10 radar scores, a tier *string* (no index), and an
// overall strength index instead of a Wilks score. These helpers bridge that
// gap so the new components stay strict and the screen remains pretty even
// when fields aren't populated yet (handoff edge cases — show em-dash, never
// fake-zero, never break layout).

const TIER_INDEX: Record<string, number> = {
  'Not enough data': 0,
  Beginner:     1,
  Novice:       2,
  Intermediate: 4, // backend has one Intermediate; design has I/II — map to II
  Advanced:     5,
  Elite:        6,
};

function mapLiftToRow(lift: LiftSummary): LiftRowData {
  const series = lift.weekSeries ?? [];
  // 30D delta: difference between latest e1RM and ~4 weeks back. Falls back
  // to monthlyGainPct expressed in lbs if the series is shorter than 4 weeks
  // (we'd rather show a working number than em-dash a row a user has logged).
  let delta30d: number | null = null;
  if (series.length >= 5) {
    delta30d = Math.round((series[series.length - 1].rmLbs - series[series.length - 5].rmLbs));
  } else if (series.length >= 2 && lift.monthlyGainPct != null) {
    delta30d = Math.round(lift.current1RMLbs * (lift.monthlyGainPct / 100));
  }
  return {
    name: lift.canonicalName,
    e1rm: lift.current1RMLbs ?? null,
    unit: 'lb',
    delta30d,
    spark: series.map(p => p.rmLbs).filter(n => Number.isFinite(n)),
  };
}

// ─── Breadcrumb chip ──────────────────────────────────────────────────────────
// Drill-down crumbs above the radar. Tap "Overview" or use the back arrow to
// pop back to the level-1 view. Visible only when the user is at level 2.
//
// Animation: subtle slide-in from above on mount via Reanimated's
// FadeInUp + opacity start at 0. Polish-pass-friendly — Claude Design can
// retune timing/spring without touching the parent screen.

function BreadcrumbChip({ label, onBack }: { label: string; onBack: () => void }) {
  return (
    <TouchableOpacity
      onPress={onBack}
      activeOpacity={0.7}
      style={styles.crumb}
      accessibilityRole="button"
      accessibilityLabel={`Back to Overview from ${label}`}
    >
      <Text style={styles.crumbBackIcon}>{'‹'}</Text>
      <Text style={styles.crumbOverviewLabel}>Overview</Text>
      <Text style={styles.crumbSep}>{'·'}</Text>
      <Text style={styles.crumbCurrentLabel}>{label}</Text>
    </TouchableOpacity>
  );
}

// ─── Page Component ───────────────────────────────────────────────────────────

type ProfileTab = 'strength' | 'nutrition';

export default function StrengthProfileScreen() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<ProfileTab>('strength');
  const [data, setData] = useState<StrengthProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  // Radar level — `overview` shows the 6 movement axes; `bucket` morphs the
  // chart into the muscles that feed the tapped movement. Reset on tab focus.
  const [radarLevel, setRadarLevel] = useState<RadarLevel>({ kind: 'overview' });

  // Sheet visibility — at-most-one open at a time, but the sheets are
  // independent components so collisions don't matter (BottomSheet renders a
  // <Modal>; iOS only shows the most recent one).
  const [tierSheetOpen, setTierSheetOpen] = useState(false);
  const [liftSheet, setLiftSheet] = useState<LiftRowData | null>(null);
  const [axisSheet, setAxisSheet] = useState<RadarAxis | null>(null);
  // Two-finger long-press on the radar toggles the dashed target polygon —
  // power-user shortcut from the handoff. Default visible.
  const [showRadarTarget, setShowRadarTarget] = useState(true);

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

  useEffect(() => {
    trackScreen('Strength Profile');
    Analytics.strengthProfileViewed();
    return trackScreenTime('Strength Profile');
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // Re-fetch each time the tab comes into focus so a freshly-logged workout
  // or a background strength-profile recalculation is reflected immediately.
  // Also reset the drill-down level so a user landing on the tab always sees
  // the familiar overview, never a forgotten level-2 view from last time.
  const isFirstFocus = useRef(true);
  useFocusEffect(useCallback(() => {
    setRadarLevel({ kind: 'overview' });
    if (isFirstFocus.current) { isFirstFocus.current = false; return; }
    loadData();
  }, [loadData]));

  function onRefresh() { setRefreshing(true); loadData(); }

  // Long-press a lift row → action menu. Using the built-in Alert API rather
  // than ActionSheetIOS so the menu works the same on Android. Mute is wired
  // as a toast-only no-op for now (backend doesn't yet have a per-lift mute
  // flag); other actions route to the real flows.
  function handleLongPressLift(lift: LiftRowData) {
    Alert.alert(
      lift.name,
      undefined,
      [
        { text: 'Log set',     onPress: () => router.push('/(tabs)/coach') },
        { text: 'View history', onPress: () => router.push('/(tabs)/history') },
        { text: 'Mute', style: 'destructive', onPress: () => Alert.alert('Mute coming soon') },
        { text: 'Cancel', style: 'cancel' },
      ],
      { cancelable: true },
    );
  }

  // Two-finger long press on the radar — toggles dashed target polygon.
  // Constructed at the top level (gestures must be stable across renders).
  // Reanimated `runOnJS` flips the React state from the worklet thread.
  const radarToggleGesture = Gesture.LongPress()
    .numberOfPointers(2)
    .minDuration(450)
    .onStart(() => {
      'worklet';
      runOnJS(setShowRadarTarget)(prev => !prev);
    });

  // Tap a radar axis. Behavior depends on the current drill level:
  //   - overview: tap → morph the radar into the muscles for that bucket.
  //   - bucket:   tap → open RadarAxisDrillSheet for that muscle.
  function handleAxisPress(axisLabel: string) {
    if (radarLevel.kind === 'overview') {
      // Only drill if the tapped axis maps to a known bucket with at least 3
      // muscle scores available — otherwise fall through to the sheet (matches
      // the handoff "<3 axes → no radar" rule).
      const asBucket = axisLabel as MovementBucket;
      if (!MOVEMENT_TO_MUSCLES[asBucket]) {
        const ax = currentRadarAxes.find(a => a.axis === axisLabel);
        if (ax) setAxisSheet(ax);
        return;
      }
      const muscleAxes = buildAxesForLevel(
        { kind: 'bucket', bucket: asBucket },
        data?.radarScores,
        data?.muscleScores,
      );
      if (muscleAxes.length >= 3) {
        setRadarLevel({ kind: 'bucket', bucket: asBucket });
      } else {
        // Not enough muscle data to render a meaningful sub-radar — open the
        // sheet at the movement-bucket level instead. User still gets the
        // contributing-lifts breakdown.
        const overviewAx = currentRadarAxes.find(a => a.axis === axisLabel);
        if (overviewAx) setAxisSheet(overviewAx);
      }
      return;
    }

    // bucket level — terminal tap opens the muscle sheet.
    const ax = currentRadarAxes.find(a => a.axis === axisLabel);
    if (ax) setAxisSheet(ax);
  }

  // Long-press a radar axis at any level → open the sheet immediately. Lets
  // power users skip the drill animation and jump straight to the details.
  function handleAxisLongPress(axisLabel: string) {
    const ax = currentRadarAxes.find(a => a.axis === axisLabel);
    if (ax) setAxisSheet(ax);
  }

  // Swipe-down inside the radar area → back out one drill level. Combined
  // with breadcrumb tap, gives users three ways to escape from level 2.
  const swipeBackGesture = Gesture.Pan()
    .activeOffsetY(20)
    .failOffsetY(-10)
    .onEnd(() => {
      'worklet';
      runOnJS(setRadarLevel)({ kind: 'overview' });
    });

  // The radar axes to render right now — recomputed when level or data
  // changes. `useMemo` not strictly necessary since buildAxesForLevel is
  // cheap, but it stabilizes the prop identity for RadarChart's deep-eq
  // dep check.
  const currentRadarAxes = React.useMemo(() => {
    return buildAxesForLevel(radarLevel, data?.radarScores, data?.muscleScores);
  }, [radarLevel, data?.radarScores, data?.muscleScores]);

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
          <Text style={styles.headerTitle}>My Profile</Text>
          <Text style={styles.headerSub}>Adapts as you train</Text>
        </View>
        {activeTab === 'strength' && (
          <TouchableOpacity style={styles.refreshBtn} onPress={onRefresh}>
            <Ionicons name="refresh-outline" size={18} color={colors.mutedForeground} />
          </TouchableOpacity>
        )}
      </View>

      {/* ── Tab switcher ─────────────────────────────────────────────────── */}
      <View style={styles.tabBar}>
        {(['strength', 'nutrition'] as ProfileTab[]).map((tab) => (
          <TouchableOpacity
            key={tab}
            style={[styles.tabItem, activeTab === tab && styles.tabItemActive]}
            onPress={() => setActiveTab(tab)}
            activeOpacity={0.8}
          >
            <Ionicons
              name={tab === 'strength' ? 'barbell-outline' : 'nutrition-outline'}
              size={15}
              color={activeTab === tab ? colors.foreground : colors.mutedForeground}
            />
            <Text style={[styles.tabLabel, activeTab === tab && styles.tabLabelActive]}>
              {tab === 'strength' ? 'Strength' : 'Nutrition'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* ── Nutrition tab ────────────────────────────────────────────────── */}
      {activeTab === 'nutrition' && <NutritionProfile />}

      {/* ── Strength tab ─────────────────────────────────────────────────── */}
      {/* ── Sheets — rendered at SafeAreaView level so they stack correctly
          regardless of which tab is active ─────────────────────────────── */}
      <TierExplainerSheet
        visible={tierSheetOpen}
        onClose={() => setTierSheetOpen(false)}
        currentTierIndex={data ? (TIER_INDEX[data.strengthTier] ?? 0) : 0}
      />
      <LiftDetailSheet
        visible={!!liftSheet}
        onClose={() => setLiftSheet(null)}
        lift={liftSheet}
        percentile={null}
        onLogSet={() => { setLiftSheet(null); router.push('/(tabs)/coach'); }}
        onHistory={() => { setLiftSheet(null); router.push('/(tabs)/history'); }}
      />
      <RadarAxisDrillSheet
        visible={!!axisSheet}
        onClose={() => setAxisSheet(null)}
        axisName={axisSheet?.axis ?? null}
        current={axisSheet?.current ?? null}
        target={axisSheet?.target ?? null}
        feedingLifts={
          axisSheet
            ? deriveFeedingLifts(
                axisSheet.axis,
                (data?.lifts ?? []).map(l => ({
                  name: l.canonicalName,
                  category: l.category,
                  current1RMLbs: l.current1RMLbs,
                })),
              )
            : []
        }
        onApplyFix={() => { setAxisSheet(null); router.push('/(tabs)/coach'); }}
        ledgerEntry={
          // Level-2 muscle taps: surface the muscle's Athlete-Model ledger
          // entry (trend / weekly sets / zone mix / confidence). Movement
          // buckets at level 1 won't match a muscle key — undefined is fine.
          axisSheet ? (data?.athleteModel?.ledger.entries[axisSheet.axis] ?? null) : null
        }
      />

      {activeTab === 'strength' && <ScrollView
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
            {/* ── Tier hero card ─────────────────────────────────────────── */}
            <TierHeroCard
              tier={data!.strengthTier === 'Not enough data' ? 'Building…' : data!.strengthTier}
              tierIndex={TIER_INDEX[data!.strengthTier] ?? 0}
              percentile={null /* backend doesn't yet expose a percentile */}
              wilks={data!.overallStrengthIndex}
              delta30d={null /* backend doesn't yet expose 30D wilks delta */}
              confidence={data!.athleteModel?.confidence ?? null}
              onPress={() => setTierSheetOpen(true)}
            />

            {/* ── Movement balance — radar (with muscle drill-down) ───────── */}
            {currentRadarAxes.length >= 3 && (
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  {radarLevel.kind === 'bucket' ? (
                    <BreadcrumbChip
                      label={radarLevel.bucket}
                      onBack={() => setRadarLevel({ kind: 'overview' })}
                    />
                  ) : (
                    <Text style={styles.eyebrow}>Movement balance</Text>
                  )}
                  <Text style={styles.sectionMeta}>
                    {showRadarTarget ? 'vs target' : 'current only'}
                  </Text>
                </View>
                <GestureDetector gesture={
                  // Combine target-toggle + (when at level 2) swipe-back-to-overview.
                  radarLevel.kind === 'bucket'
                    ? Gesture.Race(radarToggleGesture, swipeBackGesture)
                    : radarToggleGesture
                }>
                  <View style={{ alignItems: 'center', marginTop: 8 }}>
                    <RadarChart
                      axes={currentRadarAxes}
                      size={Math.min(310, CARD_W)}
                      showTarget={showRadarTarget}
                      onAxisPress={handleAxisPress}
                      onAxisLongPress={handleAxisLongPress}
                    />
                  </View>
                </GestureDetector>
                {radarLevel.kind === 'overview' && (
                  <Text style={styles.radarHint}>
                    Tap a movement to see the muscles inside it. Long-press for details.
                  </Text>
                )}
              </View>
            )}

            {/* ── Anakin's Read — proactive insight feed (Athlete Model) ──── */}
            {data!.athleteModel && (
              <AnakinsRead
                insights={data!.athleteModel.insights}
                ratios={data!.athleteModel.ratios}
                confidence={data!.athleteModel.confidence ?? 0}
                onInsightPress={() => router.push('/(tabs)/coach')}
              />
            )}

            {/* ── Strength Balance — ratio scoreboard (Athlete Model) ─────── */}
            {data!.athleteModel && data!.athleteModel.ratios.length > 0 && (
              <StrengthBalance ratios={data!.athleteModel.ratios} />
            )}

            {/* ── Pattern Coverage — movement-pattern grid (Athlete Model) ── */}
            {data!.athleteModel && data!.athleteModel.patternCoverage.length > 0 && (
              <PatternCoverage
                patterns={data!.athleteModel.patternCoverage}
                onCellPress={() => router.push('/(tabs)/coach')}
              />
            )}

            {/* ── Relative Strength — tiered BW-multiple bars (Athlete Model) ─ */}
            {data!.athleteModel && data!.athleteModel.relativeStrength.length > 0 && (
              <RelativeStrength results={data!.athleteModel.relativeStrength} />
            )}

            {/* ── Working e1RMs — list ───────────────────────────────────── */}
            {(data!.lifts ?? []).length > 0 && (
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <Text style={styles.eyebrow}>Working e1RMs</Text>
                  <Text style={styles.sectionMeta}>30D</Text>
                </View>
                <View style={{ gap: 6, marginTop: 10 }}>
                  {(data!.lifts ?? [])
                    .filter(l => l.current1RMLbs != null)
                    .slice(0, 8)
                    .map((lift, i) => (
                      <LiftRow
                        key={lift.canonicalName}
                        lift={mapLiftToRow(lift)}
                        rowIndex={i}
                        onPress={(l) => setLiftSheet(l)}
                        onLongPress={handleLongPressLift}
                      />
                    ))}
                </View>
              </View>
            )}

            {/* ── 1RM Trend Chart (kept from prior screen) ──────────────── */}
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

            {/* ── Legacy AI Insights — "Anakin's Read" supersedes this when
                the Athlete Model is available. Kept as a fallback for the
                rare case the model fails to build, so the user still sees
                insights rather than a blank section. ─── */}
            {!data!.athleteModel && (data!.aiInsights ?? []).length > 0 && (
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
      </ScrollView>}
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
  scrollContent: { paddingTop: 0, paddingHorizontal: 0, paddingBottom: 80, gap: spacing.lg },

  // Tier+Radar handoff sections — flush layout (no card chrome) so the screen
  // matches the design's edge-to-edge feel. The hero card owns its own
  // horizontal margin; section headers align to a 20px screen padding.
  section: { paddingHorizontal: 20, marginTop: 4 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  eyebrow: {
    fontSize: 11, fontWeight: '700' as const, letterSpacing: 1.5,
    textTransform: 'uppercase' as const, color: '#71717A',
  },
  sectionMeta: {
    fontSize: 11, color: '#71717A', fontFamily: 'Menlo',
  },
  radarHint: {
    fontSize: 11, color: '#A1A1AA', textAlign: 'center', marginTop: 6,
    fontStyle: 'italic',
  },

  // Drill-down breadcrumb chip — pill that says "← Overview · {bucket}".
  // Tappable to zoom back out, mirroring the swipe-down gesture on the radar.
  crumb: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999,
    backgroundColor: '#F4F4F5', borderWidth: 1, borderColor: '#E4E4E7',
  },
  crumbBackIcon: { color: '#71717A', fontSize: 14, fontWeight: '700' as const, marginRight: 2 },
  crumbOverviewLabel: { fontSize: 10.5, color: '#71717A', fontWeight: '600' as const, letterSpacing: 0.6, textTransform: 'uppercase' as const },
  crumbSep: { fontSize: 10, color: '#A1A1AA', marginHorizontal: 4 },
  crumbCurrentLabel: { fontSize: 10.5, color: '#09090B', fontWeight: '700' as const, letterSpacing: 0.6, textTransform: 'uppercase' as const },
  tabBar: {
    flexDirection: 'row',
    marginHorizontal: spacing.md,
    marginVertical: spacing.sm,
    backgroundColor: colors.muted,
    borderRadius: radius.md,
    padding: 3,
  },
  tabItem: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: 8,
    borderRadius: radius.sm,
  },
  tabItemActive: {
    backgroundColor: colors.background,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 2,
    elevation: 2,
  },
  tabLabel: { fontSize: fontSize.sm, color: colors.mutedForeground, fontWeight: fontWeight.medium },
  tabLabelActive: { color: colors.foreground, fontWeight: fontWeight.semibold },
  card: { marginHorizontal: 20 },

  // Hero card
  heroCard: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.xl,
    padding: spacing.lg,
    gap: spacing.md,
  },
  heroBadgeRow: { flexDirection: 'row', gap: spacing.xs },
  heroBadge: {
    paddingHorizontal: spacing.sm, paddingVertical: 4,
    borderRadius: radius.full, borderWidth: 1,
  },
  heroBadgeText: { fontSize: fontSize.xs, fontWeight: fontWeight.semibold },
  heroTierHeadline: {
    fontSize: 42,
    fontWeight: fontWeight.bold,
    letterSpacing: -1,
    lineHeight: 46,
  },
  heroIndexSub: { fontSize: fontSize.sm, color: colors.mutedForeground, marginTop: -spacing.xs },
  heroConfidenceSection: { gap: 6 },
  heroConfidenceRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  heroConfidenceLabel: { fontSize: fontSize.xs, color: colors.mutedForeground, fontWeight: fontWeight.medium },
  heroConfidencePct: { fontSize: fontSize.xs, color: colors.mutedForeground },
  matBar: { height: 6, backgroundColor: colors.muted, borderRadius: radius.full, overflow: 'hidden' },
  matBarFill: { height: '100%', borderRadius: radius.full },
  statsRow: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.md },
  statItem: { flex: 1, alignItems: 'center', gap: 2 },
  statBorder: { borderLeftWidth: 1, borderRightWidth: 1, borderColor: colors.border },
  statVal: { fontSize: fontSize.lg, fontWeight: fontWeight.bold, color: colors.foreground },
  statLbl: { fontSize: 10, color: colors.mutedForeground, textAlign: 'center' },

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
