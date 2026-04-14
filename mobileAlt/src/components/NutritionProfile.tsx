import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, RefreshControl,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Svg, { Polygon, Circle, Line, Text as SvgText } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import { nutritionApi } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { colors, fontSize, fontWeight, radius, spacing } from '../constants/theme';

const PROFILE_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

async function getCachedProfile(key: string): Promise<Profile | null> {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return null;
    const { data, ts } = JSON.parse(raw);
    if (Date.now() - ts > PROFILE_CACHE_TTL_MS) return null;
    return data as Profile;
  } catch { return null; }
}

async function setCachedProfile(key: string, data: Profile): Promise<void> {
  try {
    await AsyncStorage.setItem(key, JSON.stringify({ data, ts: Date.now() }));
  } catch { /* ignore */ }
}

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
  trainingDaysPerWeek: number;
  trainingDayCalories: number | null;
  restDayCalories: number | null;
  trainingDayProtein: number | null;
  trainingDayCarbs: number | null;
  morningMealPct: number;
  avgMorningProtein: number;
  avgMorningCals: number;
  avgEveningCals: number;
  eveningCaloriePct: number | null;
  trackedLifts: string[];
  wellnessDataPoints: number;
  highProteinEnergyAvg: number | null;
  lowProteinEnergyAvg: number | null;
}

interface DimensionScores {
  dailyLife: number;
  gymPerformance: number;
  mentalClarity: number;
  recovery: number;
  nutritionTiming: number;
  bodyComposition: number;
}

interface EnergyWindow { level: string; detail: string }

interface Analysis {
  overallScore?: number;
  overallGrade?: string;
  summary?: string;
  dimensionScores?: DimensionScores;
  dailyLifeImpact?: {
    score: number; grade: string; summary: string;
    morningEnergy: string; afternoonEnergy: string; eveningEnergy: string;
    morningEnergyDetail: string; afternoonEnergyDetail: string; eveningEnergyDetail: string;
    moodStabilityRating: number; moodStabilityDetail: string;
    keyFactors: string[]; recommendations: string[];
  };
  gymPerformance?: {
    score: number; grade: string; summary: string;
    strengthCapacity: string; strengthCapacityDetail: string;
    enduranceCapacity: string; enduranceCapacityDetail: string;
    recoveryBetweenSets: string; recoveryBetweenSetsDetail: string;
    keyLimiter: string; preWorkoutReadiness: string; postWorkoutRecovery: string;
    recommendations: string[];
  };
  liftImpact?: Array<{
    lift: string; impactLevel: string;
    currentImpact: string; scienceBacking: string; recommendation: string;
  }>;
  mentalClarity?: {
    score: number; grade: string; summary: string;
    focusRating: number; glucoseStabilityRating: number; glucoseStabilityDetail: string;
    brainFuelAdequacy: string; brainFuelDetail: string;
    neurotransmitterSupport: string; neurotransmitterDetail: string;
    keyFactors: string[]; recommendations: string[];
  };
  energyPattern?: {
    pattern: string; summary: string;
    morningWindow: EnergyWindow; midDayWindow: EnergyWindow;
    afternoonWindow: EnergyWindow; eveningWindow: EnergyWindow;
    crashRisk: string; crashRiskDetail: string;
    optimalMealTiming: string; recommendations: string[];
  };
  recoveryAndSleep?: {
    score: number; grade: string; summary: string;
    muscleRepairCapacity: string; muscleRepairDetail: string;
    sleepQualityImpact: string; sleepQualityDetail: string;
    inflammationRisk: string; inflammationDetail: string;
    hormoneSupport: string; hormonalDetail: string; recommendations: string[];
  };
  strengths?: string[];
  improvements?: string[];
  suggestions?: string[];
  biochemicalDomains?: {
    energyGlucose: { headline: string; detail: string };
    recoveryInflammation: { headline: string; detail: string };
    cognitiveMood: { headline: string; detail: string };
    bodyCompositionHormones: { headline: string; detail: string };
  };
  macroRecommendation?: {
    proteinG: number; carbsG: number; fatG: number; calories: number;
    trainingDayProteinG?: number; trainingDayCarbsG?: number;
    restDayProteinG?: number; restDayCarbsG?: number;
    rationale: string;
  };
}

interface Profile {
  hasData: boolean;
  message?: string;
  metrics?: Metrics;
  analysis?: Analysis;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const GRADE_COLOR: Record<string, string> = {
  'A+': '#16a34a', A: '#16a34a', 'A-': '#22c55e',
  'B+': '#2563eb', B: '#3b82f6', 'B-': '#60a5fa',
  'C+': '#d97706', C: '#f59e0b', 'C-': '#fbbf24',
  D: '#dc2626', F: '#991b1b',
};

const IMPACT_COLOR: Record<string, string> = {
  optimal: '#16a34a', good: '#22c55e', moderate: '#f59e0b',
  limited: '#ef4444', poor: '#dc2626',
};

const ENERGY_LEVEL_COLOR: Record<string, string> = {
  very_high: '#16a34a', high: '#22c55e', moderate: '#f59e0b',
  low: '#ef4444', very_low: '#dc2626',
};

const DIMENSION_LABELS = [
  'Daily Life', 'Gym', 'Mental', 'Recovery', 'Timing', 'Body Comp',
];
const DIMENSION_KEYS: (keyof DimensionScores)[] = [
  'dailyLife', 'gymPerformance', 'mentalClarity', 'recovery', 'nutritionTiming', 'bodyComposition',
];
const DIMENSION_COLORS = ['#6366f1', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'];

function gradeColor(grade?: string) {
  if (!grade) return colors.mutedForeground;
  return GRADE_COLOR[grade] ?? colors.mutedForeground;
}

function ScoreBadge({ score, grade }: { score?: number; grade?: string }) {
  return (
    <View style={[styles.scoreBadge, { borderColor: gradeColor(grade) + '40' }]}>
      <Text style={[styles.scoreBadgeNum, { color: gradeColor(grade) }]}>{score ?? '–'}</Text>
      {grade && (
        <Text style={[styles.scoreBadgeGrade, { color: gradeColor(grade) }]}>{grade}</Text>
      )}
    </View>
  );
}

function MacroBar({ m }: { m: MacroSplit }) {
  return (
    <View style={styles.macroBarWrap}>
      <View style={styles.macroBarTrack}>
        <View style={[styles.macroBarSeg, { flex: m.proteinPct, backgroundColor: '#3b82f6' }]} />
        <View style={[styles.macroBarSeg, { flex: m.carbsPct,   backgroundColor: '#f59e0b' }]} />
        <View style={[styles.macroBarSeg, { flex: m.fatPct,     backgroundColor: '#ef4444' }]} />
      </View>
      <View style={styles.macroBarLegend}>
        {[
          { label: `P ${m.proteinPct}%`, color: '#3b82f6' },
          { label: `C ${m.carbsPct}%`,   color: '#f59e0b' },
          { label: `F ${m.fatPct}%`,     color: '#ef4444' },
        ].map(({ label, color }) => (
          <View key={label} style={styles.macroLegendItem}>
            <View style={[styles.macroLegendDot, { backgroundColor: color }]} />
            <Text style={styles.macroLegendText}>{label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

// ─── Radar Chart ─────────────────────────────────────────────────────────────

function RadarChart({ scores }: { scores: DimensionScores }) {
  const SIZE = 160;
  const cx = SIZE / 2, cy = SIZE / 2;
  const R = (SIZE / 2) * 0.75;
  const n = DIMENSION_KEYS.length;

  const angleOf = (i: number) => (Math.PI * 2 * i) / n - Math.PI / 2;

  const outerPts = DIMENSION_KEYS.map((_, i) => ({
    x: cx + R * Math.cos(angleOf(i)),
    y: cy + R * Math.sin(angleOf(i)),
  }));

  const valuePts = DIMENSION_KEYS.map((k, i) => {
    const r = R * Math.max(0.05, (scores[k] ?? 0) / 100);
    return { x: cx + r * Math.cos(angleOf(i)), y: cy + r * Math.sin(angleOf(i)) };
  });

  const toPolygon = (pts: { x: number; y: number }[]) =>
    pts.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');

  const labelPts = DIMENSION_KEYS.map((_, i) => {
    const r = R * 1.22;
    return { x: cx + r * Math.cos(angleOf(i)), y: cy + r * Math.sin(angleOf(i)) };
  });

  return (
    <View style={styles.radarWrap}>
      <Svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
        {/* Grid rings */}
        {[0.25, 0.5, 0.75, 1].map(t => (
          <Polygon
            key={t}
            points={outerPts.map((_, i) => {
              const r = R * t;
              return `${(cx + r * Math.cos(angleOf(i))).toFixed(1)},${(cy + r * Math.sin(angleOf(i))).toFixed(1)}`;
            }).join(' ')}
            fill="none"
            stroke={colors.border}
            strokeWidth={0.8}
          />
        ))}
        {/* Axes */}
        {outerPts.map((p, i) => (
          <Line key={i} x1={cx} y1={cy} x2={p.x} y2={p.y} stroke={colors.border} strokeWidth={0.8} />
        ))}
        {/* Value polygon */}
        <Polygon
          points={toPolygon(valuePts)}
          fill="#6366f122"
          stroke="#6366f1"
          strokeWidth={1.5}
        />
        {/* Value dots */}
        {valuePts.map((p, i) => (
          <Circle key={i} cx={p.x} cy={p.y} r={3} fill={DIMENSION_COLORS[i]} />
        ))}
        {/* Labels */}
        {labelPts.map((p, i) => (
          <SvgText
            key={i}
            x={p.x}
            y={p.y + 3}
            fontSize={6.5}
            fill={colors.mutedForeground}
            textAnchor="middle"
          >
            {DIMENSION_LABELS[i]}
          </SvgText>
        ))}
      </Svg>
      {/* Legend */}
      <View style={styles.radarLegend}>
        {DIMENSION_KEYS.map((k, i) => (
          <View key={k} style={styles.radarLegendRow}>
            <View style={[styles.radarLegendDot, { backgroundColor: DIMENSION_COLORS[i] }]} />
            <Text style={styles.radarLegendLabel}>{DIMENSION_LABELS[i]}</Text>
            <Text style={[styles.radarLegendScore, { color: DIMENSION_COLORS[i] }]}>
              {scores[k] ?? '–'}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

// ─── Energy Level Dot ─────────────────────────────────────────────────────────

function EnergyDot({ level }: { level: string }) {
  const color = ENERGY_LEVEL_COLOR[level] ?? colors.mutedForeground;
  const label = level.replace('_', ' ');
  return (
    <View style={styles.energyDotRow}>
      <View style={[styles.energyDot, { backgroundColor: color }]} />
      <Text style={[styles.energyDotLabel, { color }]}>{label}</Text>
    </View>
  );
}

// ─── Section Card ─────────────────────────────────────────────────────────────

function SectionCard({
  icon, iconColor, title, grade, score, children,
}: {
  icon: any; iconColor: string; title: string;
  grade?: string; score?: number; children: React.ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <View style={styles.sectionCard}>
      <TouchableOpacity
        style={styles.sectionHeader}
        onPress={() => setExpanded(e => !e)}
        activeOpacity={0.7}
      >
        <View style={[styles.sectionIconWrap, { backgroundColor: iconColor + '20' }]}>
          <Ionicons name={icon} size={16} color={iconColor} />
        </View>
        <Text style={styles.sectionTitle}>{title}</Text>
        <View style={styles.sectionHeaderRight}>
          {(score !== undefined || grade) && (
            <View style={[styles.sectionGradePill, { backgroundColor: gradeColor(grade) + '15' }]}>
              {score !== undefined && (
                <Text style={[styles.sectionGradeScore, { color: gradeColor(grade) }]}>{score}</Text>
              )}
              {grade && (
                <Text style={[styles.sectionGradeText, { color: gradeColor(grade) }]}>{grade}</Text>
              )}
            </View>
          )}
          <Ionicons
            name={expanded ? 'chevron-up' : 'chevron-down'}
            size={16}
            color={colors.mutedForeground}
          />
        </View>
      </TouchableOpacity>
      {expanded && <View style={styles.sectionBody}>{children}</View>}
    </View>
  );
}

function Bullet({ text, color = colors.mutedForeground }: { text: string; color?: string }) {
  return (
    <View style={styles.bulletRow}>
      <View style={[styles.bulletDot, { backgroundColor: color }]} />
      <Text style={styles.bulletText}>{text}</Text>
    </View>
  );
}

function InfoRow({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <View style={styles.infoValueWrap}>
        <Text style={styles.infoValue}>{value}</Text>
        {sub && <Text style={styles.infoSub}>{sub}</Text>}
      </View>
    </View>
  );
}

function RecommendationList({ items }: { items: string[] }) {
  return (
    <View style={styles.recList}>
      {items.map((r, i) => (
        <View key={i} style={styles.recItem}>
          <View style={styles.recNum}>
            <Text style={styles.recNumText}>{i + 1}</Text>
          </View>
          <Text style={styles.recText}>{r}</Text>
        </View>
      ))}
    </View>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function NutritionProfile() {
  const { user } = useAuth();
  const [data, setData] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const cacheKey = `nutrition_profile_${user?.id ?? 'anon'}`;

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) {
      setRefreshing(true);
    } else {
      // Try cache first
      const cached = await getCachedProfile(cacheKey);
      if (cached) {
        setData(cached);
        setLoading(false);
      }
    }
    try {
      const d = await nutritionApi.getProfile();
      setData(d);
      if (d?.hasData) setCachedProfile(cacheKey, d);
    } catch { /* silently fail */ }
    finally { setLoading(false); setRefreshing(false); }
  }, [cacheKey]);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.primary} size="large" />
        <Text style={styles.loadingText}>Analyzing your nutrition…</Text>
      </View>
    );
  }

  if (!data?.hasData) {
    return (
      <View style={styles.centered}>
        <Ionicons name="nutrition-outline" size={48} color={colors.mutedForeground} />
        <Text style={styles.emptyTitle}>No nutrition data yet</Text>
        <Text style={styles.emptyText}>
          Log meals for a few days to unlock your AI-powered nutrition profile.
        </Text>
      </View>
    );
  }

  const { metrics: m, analysis: a } = data;
  if (!m || !a) return null;

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} />}
    >
      {/* ── Overall Score Card ───────────────────────────────────────────── */}
      <View style={styles.overallCard}>
        <View style={styles.overallLeft}>
          <ScoreBadge score={a.overallScore} grade={a.overallGrade} />
        </View>
        <View style={styles.overallRight}>
          <Text style={styles.overallTitle}>Nutrition Profile</Text>
          <Text style={styles.overallSummary} numberOfLines={4}>{a.summary}</Text>
          <Text style={styles.overallMeta}>Based on {m.loggedDays} days · {m.consistencyPct}% consistency</Text>
        </View>
      </View>

      {/* ── Dimension Radar ──────────────────────────────────────────────── */}
      {a.dimensionScores && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Performance Dimensions</Text>
          <RadarChart scores={a.dimensionScores} />
        </View>
      )}

      {/* ── Quick Stats Row ──────────────────────────────────────────────── */}
      <View style={styles.statsGrid}>
        {[
          { label: 'Calories', value: `${m.avgCalories}`, unit: 'kcal', color: '#f97316' },
          { label: 'Protein',  value: `${m.avgProtein}`,  unit: 'g',    color: '#3b82f6' },
          { label: 'Carbs',    value: `${m.avgCarbs}`,    unit: 'g',    color: '#f59e0b' },
          { label: 'Fat',      value: `${m.avgFat}`,      unit: 'g',    color: '#ef4444' },
        ].map(({ label, value, unit, color }) => (
          <View key={label} style={styles.statCell}>
            <Text style={[styles.statValue, { color }]}>{value}</Text>
            <Text style={styles.statUnit}>{unit}</Text>
            <Text style={styles.statLabel}>{label}</Text>
          </View>
        ))}
      </View>

      {/* Macro split bar */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Macro Split</Text>
        <MacroBar m={m.macroSplit} />
        {m.proteinPerKg !== null && (
          <View style={styles.proteinKgRow}>
            <Text style={styles.proteinKgLabel}>Protein / kg bodyweight</Text>
            <Text style={[
              styles.proteinKgValue,
              { color: m.proteinPerKg >= 1.6 ? '#22c55e' : m.proteinPerKg >= 1.2 ? '#f59e0b' : '#ef4444' }
            ]}>
              {m.proteinPerKg}g/kg
              <Text style={styles.proteinKgAdequacy}>
                {'  '}{m.proteinPerKg >= 1.6 ? '✓ Optimal' : m.proteinPerKg >= 1.2 ? 'Adequate' : 'Below target'}
              </Text>
            </Text>
          </View>
        )}
      </View>

      {/* Training day vs rest day */}
      {m.trainingDayCalories !== null && m.restDayCalories !== null && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Training vs Rest Day Nutrition</Text>
          <View style={styles.trainRestRow}>
            <View style={styles.trainRestCell}>
              <Text style={styles.trainRestValue}>{m.trainingDayCalories}</Text>
              <Text style={styles.trainRestLabel}>Training day kcal</Text>
              {m.trainingDayProtein && <Text style={styles.trainRestSub}>P: {m.trainingDayProtein}g · C: {m.trainingDayCarbs}g</Text>}
            </View>
            <View style={styles.trainRestDivider} />
            <View style={styles.trainRestCell}>
              <Text style={styles.trainRestValue}>{m.restDayCalories}</Text>
              <Text style={styles.trainRestLabel}>Rest day kcal</Text>
              <Text style={[styles.trainRestSub, {
                color: m.trainingDayCalories > m.restDayCalories ? '#22c55e' : '#ef4444'
              }]}>
                {m.trainingDayCalories > m.restDayCalories
                  ? `+${m.trainingDayCalories - m.restDayCalories} on training days ✓`
                  : `${m.trainingDayCalories - m.restDayCalories} vs rest days ⚠`}
              </Text>
            </View>
          </View>
        </View>
      )}

      {/* Wellness correlation */}
      {m.highProteinEnergyAvg !== null && m.lowProteinEnergyAvg !== null && (
        <View style={[styles.card, styles.wellnessCorr]}>
          <Ionicons name="pulse-outline" size={16} color="#8b5cf6" />
          <View style={{ flex: 1, marginLeft: 10 }}>
            <Text style={styles.wellnessCorrTitle}>Wellness Correlation</Text>
            <Text style={styles.wellnessCorrText}>
              High-protein days → next-day energy{' '}
              <Text style={{ color: '#22c55e', fontWeight: fontWeight.bold }}>{m.highProteinEnergyAvg}/10</Text>
              {' '}vs low-protein days{' '}
              <Text style={{ color: '#ef4444', fontWeight: fontWeight.bold }}>{m.lowProteinEnergyAvg}/10</Text>
            </Text>
          </View>
        </View>
      )}

      {/* ── Section 1: Daily Life Impact ─────────────────────────────────── */}
      {a.dailyLifeImpact && (
        <SectionCard
          icon="sunny-outline" iconColor="#f59e0b" title="Daily Life Impact"
          grade={a.dailyLifeImpact.grade} score={a.dailyLifeImpact.score}
        >
          <Text style={styles.sectionSummary}>{a.dailyLifeImpact.summary}</Text>
          <View style={styles.energyWindows}>
            {[
              { label: 'Morning',   level: a.dailyLifeImpact.morningEnergy,   detail: a.dailyLifeImpact.morningEnergyDetail },
              { label: 'Afternoon', level: a.dailyLifeImpact.afternoonEnergy, detail: a.dailyLifeImpact.afternoonEnergyDetail },
              { label: 'Evening',   level: a.dailyLifeImpact.eveningEnergy,   detail: a.dailyLifeImpact.eveningEnergyDetail },
            ].map(({ label, level, detail }) => (
              <View key={label} style={styles.energyWindowCard}>
                <Text style={styles.energyWindowLabel}>{label}</Text>
                <EnergyDot level={level} />
                <Text style={styles.energyWindowDetail}>{detail}</Text>
              </View>
            ))}
          </View>
          {a.dailyLifeImpact.moodStabilityDetail && (
            <View style={styles.infoBox}>
              <Text style={styles.infoBoxTitle}>Mood Stability  {a.dailyLifeImpact.moodStabilityRating}/10</Text>
              <Text style={styles.infoBoxText}>{a.dailyLifeImpact.moodStabilityDetail}</Text>
            </View>
          )}
          {a.dailyLifeImpact.keyFactors?.length > 0 && (
            <>
              <Text style={styles.subHeading}>Key Factors</Text>
              {a.dailyLifeImpact.keyFactors.map((f, i) => <Bullet key={i} text={f} color="#f59e0b" />)}
            </>
          )}
          {a.dailyLifeImpact.recommendations?.length > 0 && (
            <>
              <Text style={styles.subHeading}>Recommendations</Text>
              <RecommendationList items={a.dailyLifeImpact.recommendations} />
            </>
          )}
        </SectionCard>
      )}

      {/* ── Section 2: Gym Performance ───────────────────────────────────── */}
      {a.gymPerformance && (
        <SectionCard
          icon="barbell-outline" iconColor="#6366f1" title="Gym Performance"
          grade={a.gymPerformance.grade} score={a.gymPerformance.score}
        >
          <Text style={styles.sectionSummary}>{a.gymPerformance.summary}</Text>
          <View style={styles.performanceGrid}>
            {[
              { label: 'Strength',    value: a.gymPerformance.strengthCapacity },
              { label: 'Endurance',   value: a.gymPerformance.enduranceCapacity },
              { label: 'Between Sets', value: a.gymPerformance.recoveryBetweenSets },
              { label: 'Pre-Workout', value: a.gymPerformance.preWorkoutReadiness },
              { label: 'Post-Workout', value: a.gymPerformance.postWorkoutRecovery },
            ].map(({ label, value }) => {
              const clr = value === 'optimal' || value === 'excellent' ? '#22c55e'
                        : value === 'good' ? '#86efac'
                        : value === 'adequate' || value === 'average' ? '#f59e0b'
                        : '#ef4444';
              return (
                <View key={label} style={styles.perfCell}>
                  <Text style={[styles.perfValue, { color: clr }]}>{value?.replace(/_/g, ' ')}</Text>
                  <Text style={styles.perfLabel}>{label}</Text>
                </View>
              );
            })}
          </View>
          {a.gymPerformance.keyLimiter && (
            <View style={[styles.infoBox, styles.warningBox]}>
              <Text style={styles.infoBoxTitle}>Key Limiter</Text>
              <Text style={styles.infoBoxText}>{a.gymPerformance.keyLimiter}</Text>
            </View>
          )}
          <Text style={styles.subHeading}>Details</Text>
          {[
            a.gymPerformance.strengthCapacityDetail,
            a.gymPerformance.enduranceCapacityDetail,
            a.gymPerformance.recoveryBetweenSetsDetail,
          ].filter(Boolean).map((d, i) => <Bullet key={i} text={d} color="#6366f1" />)}
          {a.gymPerformance.recommendations?.length > 0 && (
            <>
              <Text style={styles.subHeading}>Recommendations</Text>
              <RecommendationList items={a.gymPerformance.recommendations} />
            </>
          )}
        </SectionCard>
      )}

      {/* ── Section 3: Lift Impact ───────────────────────────────────────── */}
      {a.liftImpact && a.liftImpact.length > 0 && (
        <SectionCard icon="fitness-outline" iconColor="#22c55e" title="Lift-by-Lift Impact">
          {a.liftImpact.map((lift, i) => (
            <View key={i} style={styles.liftCard}>
              <View style={styles.liftCardHeader}>
                <Text style={styles.liftName}>{lift.lift}</Text>
                <View style={[
                  styles.liftImpactBadge,
                  { backgroundColor: (IMPACT_COLOR[lift.impactLevel] ?? colors.mutedForeground) + '20' }
                ]}>
                  <Text style={[
                    styles.liftImpactText,
                    { color: IMPACT_COLOR[lift.impactLevel] ?? colors.mutedForeground }
                  ]}>
                    {lift.impactLevel?.replace(/_/g, ' ')}
                  </Text>
                </View>
              </View>
              <Text style={styles.liftDetail}>{lift.currentImpact}</Text>
              {lift.scienceBacking && (
                <View style={styles.scienceTag}>
                  <Ionicons name="flask-outline" size={11} color="#8b5cf6" />
                  <Text style={styles.scienceText}>{lift.scienceBacking}</Text>
                </View>
              )}
              {lift.recommendation && (
                <View style={styles.liftRec}>
                  <Ionicons name="arrow-forward-circle-outline" size={14} color="#22c55e" />
                  <Text style={styles.liftRecText}>{lift.recommendation}</Text>
                </View>
              )}
            </View>
          ))}
        </SectionCard>
      )}

      {/* ── Section 4: Mental Clarity ────────────────────────────────────── */}
      {a.mentalClarity && (
        <SectionCard
          icon="brain-outline" iconColor="#8b5cf6" title="Mental Clarity & Focus"
          grade={a.mentalClarity.grade} score={a.mentalClarity.score}
        >
          <Text style={styles.sectionSummary}>{a.mentalClarity.summary}</Text>
          <View style={styles.clarityRatings}>
            {[
              { label: 'Focus', val: a.mentalClarity.focusRating, color: '#8b5cf6' },
              { label: 'Glucose Stability', val: a.mentalClarity.glucoseStabilityRating, color: '#f59e0b' },
            ].map(({ label, val, color }) => (
              <View key={label} style={styles.clarityRatingCell}>
                <Text style={[styles.clarityRatingNum, { color }]}>{val}<Text style={styles.clarityRatingMax}>/10</Text></Text>
                <Text style={styles.clarityRatingLabel}>{label}</Text>
              </View>
            ))}
          </View>
          {[
            { title: 'Glucose Stability', text: a.mentalClarity.glucoseStabilityDetail },
            { title: 'Brain Fuel', text: a.mentalClarity.brainFuelDetail },
            { title: 'Neurotransmitters', text: a.mentalClarity.neurotransmitterDetail },
          ].filter(x => x.text).map(({ title, text }) => (
            <View key={title} style={styles.infoBox}>
              <Text style={styles.infoBoxTitle}>{title}</Text>
              <Text style={styles.infoBoxText}>{text}</Text>
            </View>
          ))}
          {a.mentalClarity.keyFactors?.length > 0 && (
            <>
              <Text style={styles.subHeading}>Key Factors</Text>
              {a.mentalClarity.keyFactors.map((f, i) => <Bullet key={i} text={f} color="#8b5cf6" />)}
            </>
          )}
          {a.mentalClarity.recommendations?.length > 0 && (
            <>
              <Text style={styles.subHeading}>Recommendations</Text>
              <RecommendationList items={a.mentalClarity.recommendations} />
            </>
          )}
        </SectionCard>
      )}

      {/* ── Section 5: Energy Pattern ────────────────────────────────────── */}
      {a.energyPattern && (
        <SectionCard icon="flash-outline" iconColor="#f97316" title="Energy Throughout the Day">
          <Text style={styles.sectionSummary}>{a.energyPattern.summary}</Text>
          <View style={styles.energyTimeline}>
            {[
              { label: 'Morning',   data: a.energyPattern.morningWindow   },
              { label: 'Mid-Day',   data: a.energyPattern.midDayWindow    },
              { label: 'Afternoon', data: a.energyPattern.afternoonWindow },
              { label: 'Evening',   data: a.energyPattern.eveningWindow   },
            ].map(({ label, data }, i) => (
              <View key={label} style={styles.timelineStep}>
                <View style={styles.timelineConnector}>
                  <View style={[
                    styles.timelineDot,
                    { backgroundColor: ENERGY_LEVEL_COLOR[data?.level] ?? colors.mutedForeground }
                  ]} />
                  {i < 3 && <View style={styles.timelineLine} />}
                </View>
                <View style={styles.timelineContent}>
                  <View style={styles.timelineHeader}>
                    <Text style={styles.timelineLabel}>{label}</Text>
                    <EnergyDot level={data?.level} />
                  </View>
                  <Text style={styles.timelineDetail}>{data?.detail}</Text>
                </View>
              </View>
            ))}
          </View>
          {a.energyPattern.crashRiskDetail && (
            <View style={[styles.infoBox, styles.warningBox]}>
              <Text style={styles.infoBoxTitle}>
                Crash Risk: <Text style={{ color: a.energyPattern.crashRisk === 'low' ? '#22c55e' : a.energyPattern.crashRisk === 'moderate' ? '#f59e0b' : '#ef4444' }}>
                  {a.energyPattern.crashRisk?.replace('_', ' ')}
                </Text>
              </Text>
              <Text style={styles.infoBoxText}>{a.energyPattern.crashRiskDetail}</Text>
            </View>
          )}
          {a.energyPattern.optimalMealTiming && (
            <View style={styles.infoBox}>
              <Text style={styles.infoBoxTitle}>Optimal Meal Timing for You</Text>
              <Text style={styles.infoBoxText}>{a.energyPattern.optimalMealTiming}</Text>
            </View>
          )}
          {a.energyPattern.recommendations?.length > 0 && (
            <>
              <Text style={styles.subHeading}>Recommendations</Text>
              <RecommendationList items={a.energyPattern.recommendations} />
            </>
          )}
        </SectionCard>
      )}

      {/* ── Section 6: Recovery & Sleep ──────────────────────────────────── */}
      {a.recoveryAndSleep && (
        <SectionCard
          icon="moon-outline" iconColor="#06b6d4" title="Recovery & Sleep"
          grade={a.recoveryAndSleep.grade} score={a.recoveryAndSleep.score}
        >
          <Text style={styles.sectionSummary}>{a.recoveryAndSleep.summary}</Text>
          <View style={styles.recoveryGrid}>
            {[
              { label: 'Muscle Repair',   value: a.recoveryAndSleep.muscleRepairCapacity },
              { label: 'Sleep Quality',   value: a.recoveryAndSleep.sleepQualityImpact },
              { label: 'Inflammation',    value: a.recoveryAndSleep.inflammationRisk },
              { label: 'Hormone Support', value: a.recoveryAndSleep.hormoneSupport },
            ].map(({ label, value }) => {
              const good = ['excellent', 'good', 'positive', 'low'];
              const bad  = ['poor', 'below_average', 'negative', 'high'];
              const clr  = good.includes(value) ? '#22c55e' : bad.includes(value) ? '#ef4444' : '#f59e0b';
              return (
                <View key={label} style={styles.recoveryCell}>
                  <Text style={[styles.recoveryValue, { color: clr }]}>{value?.replace(/_/g, ' ')}</Text>
                  <Text style={styles.recoveryLabel}>{label}</Text>
                </View>
              );
            })}
          </View>
          {[
            { title: 'Muscle Repair', text: a.recoveryAndSleep.muscleRepairDetail },
            { title: 'Sleep Impact',  text: a.recoveryAndSleep.sleepQualityDetail },
            { title: 'Inflammation',  text: a.recoveryAndSleep.inflammationDetail },
            { title: 'Hormones',      text: a.recoveryAndSleep.hormonalDetail },
          ].filter(x => x.text).map(({ title, text }) => (
            <View key={title} style={styles.infoBox}>
              <Text style={styles.infoBoxTitle}>{title}</Text>
              <Text style={styles.infoBoxText}>{text}</Text>
            </View>
          ))}
          {a.recoveryAndSleep.recommendations?.length > 0 && (
            <>
              <Text style={styles.subHeading}>Recommendations</Text>
              <RecommendationList items={a.recoveryAndSleep.recommendations} />
            </>
          )}
        </SectionCard>
      )}

      {/* ── Biochemical Domains ──────────────────────────────────────────── */}
      {a.biochemicalDomains && (() => {
        const bd = a.biochemicalDomains!;
        const domains = [
          { key: 'energyGlucose',           label: 'Energy & Glucose',         icon: 'flash',           color: '#f59e0b', data: bd.energyGlucose },
          { key: 'recoveryInflammation',     label: 'Recovery & Inflammation',  icon: 'fitness',         color: '#ef4444', data: bd.recoveryInflammation },
          { key: 'cognitiveMood',            label: 'Cognitive & Mood',         icon: 'bulb',            color: '#8b5cf6', data: bd.cognitiveMood },
          { key: 'bodyCompositionHormones',  label: 'Body Comp & Hormones',     icon: 'body',            color: '#06b6d4', data: bd.bodyCompositionHormones },
        ] as const;
        return (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Food Effects Analysis</Text>
            <Text style={styles.sectionSubtitle}>How your recent meals are impacting key physiological systems</Text>
            {domains.map((d) => (
              <View key={d.key} style={styles.domainBlock}>
                <View style={styles.domainHeader}>
                  <Ionicons name={d.icon as any} size={16} color={d.color} />
                  <Text style={[styles.domainLabel, { color: d.color }]}>{d.label}</Text>
                </View>
                <Text style={styles.domainHeadline}>{d.data.headline}</Text>
                <Text style={styles.domainDetail}>{d.data.detail}</Text>
              </View>
            ))}
          </View>
        );
      })()}

      {/* ── Strengths & Improvements ─────────────────────────────────────── */}
      {(a.strengths?.length || a.improvements?.length) ? (
        <View style={styles.siRow}>
          {a.strengths?.length ? (
            <View style={[styles.siCard, { flex: 1 }]}>
              <View style={styles.siHeader}>
                <Ionicons name="checkmark-circle" size={14} color="#22c55e" />
                <Text style={[styles.siTitle, { color: '#22c55e' }]}>Strengths</Text>
              </View>
              {a.strengths.map((s, i) => <Bullet key={i} text={s} color="#22c55e" />)}
            </View>
          ) : null}
          {a.improvements?.length ? (
            <View style={[styles.siCard, { flex: 1 }]}>
              <View style={styles.siHeader}>
                <Ionicons name="arrow-up-circle" size={14} color="#f59e0b" />
                <Text style={[styles.siTitle, { color: '#f59e0b' }]}>Improve</Text>
              </View>
              {a.improvements.map((s, i) => <Bullet key={i} text={s} color="#f59e0b" />)}
            </View>
          ) : null}
        </View>
      ) : null}

      {/* ── Target Macros ────────────────────────────────────────────────── */}
      {a.macroRecommendation && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Recommended Targets</Text>
          <View style={styles.targetGrid}>
            {[
              { label: 'Calories', value: a.macroRecommendation.calories, unit: 'kcal', color: '#f97316',
                current: m.avgCalories },
              { label: 'Protein',  value: a.macroRecommendation.proteinG,  unit: 'g',    color: '#3b82f6',
                current: m.avgProtein },
              { label: 'Carbs',    value: a.macroRecommendation.carbsG,    unit: 'g',    color: '#f59e0b',
                current: m.avgCarbs },
              { label: 'Fat',      value: a.macroRecommendation.fatG,      unit: 'g',    color: '#ef4444',
                current: m.avgFat },
            ].map(({ label, value, unit, color, current }) => {
              const diff = value - current;
              return (
                <View key={label} style={styles.targetCell}>
                  <Text style={[styles.targetValue, { color }]}>{value}<Text style={styles.targetUnit}>{unit}</Text></Text>
                  <Text style={styles.targetLabel}>{label}</Text>
                  {diff !== 0 && (
                    <Text style={[styles.targetDiff, { color: diff > 0 ? '#22c55e' : '#ef4444' }]}>
                      {diff > 0 ? '+' : ''}{Math.round(diff)}{unit}
                    </Text>
                  )}
                </View>
              );
            })}
          </View>
          {(a.macroRecommendation.trainingDayProteinG || a.macroRecommendation.trainingDayCarbsG) && (
            <View style={styles.periodizationBox}>
              <Text style={styles.periodizationTitle}>Carb Periodization</Text>
              <View style={styles.periodizationRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.periodizationLabel}>Training Days</Text>
                  <Text style={styles.periodizationValue}>
                    P: {a.macroRecommendation.trainingDayProteinG}g  C: {a.macroRecommendation.trainingDayCarbsG}g
                  </Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.periodizationLabel}>Rest Days</Text>
                  <Text style={styles.periodizationValue}>
                    P: {a.macroRecommendation.restDayProteinG}g  C: {a.macroRecommendation.restDayCarbsG}g
                  </Text>
                </View>
              </View>
            </View>
          )}
          <Text style={styles.rationaleText}>{a.macroRecommendation.rationale}</Text>
        </View>
      )}

      {/* ── Top Suggestions ──────────────────────────────────────────────── */}
      {a.suggestions?.length ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Action Plan</Text>
          {a.suggestions.map((s, i) => (
            <View key={i} style={styles.suggestionRow}>
              <View style={styles.suggestionNum}>
                <Text style={styles.suggestionNumText}>{i + 1}</Text>
              </View>
              <Text style={styles.suggestionText}>{s}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </ScrollView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  content: { padding: spacing.md, paddingBottom: spacing.xxl, gap: spacing.md },

  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.xl },
  loadingText: { fontSize: fontSize.sm, color: colors.mutedForeground },
  emptyTitle: { fontSize: fontSize.lg, fontWeight: fontWeight.semibold, color: colors.foreground },
  emptyText: { fontSize: fontSize.sm, color: colors.mutedForeground, textAlign: 'center', maxWidth: 280 },

  overallCard: {
    flexDirection: 'row', gap: spacing.md,
    backgroundColor: colors.card, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border, padding: spacing.md,
  },
  overallLeft: { justifyContent: 'center' },
  overallRight: { flex: 1, gap: 4 },
  overallTitle: { fontSize: fontSize.lg, fontWeight: fontWeight.bold, color: colors.foreground },
  overallSummary: { fontSize: fontSize.sm, color: colors.mutedForeground, lineHeight: 18 },
  overallMeta: { fontSize: fontSize.xs, color: colors.mutedForeground, marginTop: 2 },

  scoreBadge: {
    width: 64, height: 64, borderRadius: 32,
    borderWidth: 3, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.background,
  },
  scoreBadgeNum: { fontSize: 20, fontWeight: fontWeight.bold, lineHeight: 24 },
  scoreBadgeGrade: { fontSize: fontSize.xs, fontWeight: fontWeight.semibold },

  card: {
    backgroundColor: colors.card, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border, padding: spacing.md, gap: spacing.sm,
  },
  cardTitle: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.foreground },

  statsGrid: {
    flexDirection: 'row', gap: spacing.sm,
    backgroundColor: colors.card, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border, padding: spacing.md,
  },
  statCell: { flex: 1, alignItems: 'center' },
  statValue: { fontSize: fontSize.xl, fontWeight: fontWeight.bold },
  statUnit: { fontSize: 10, color: colors.mutedForeground },
  statLabel: { fontSize: 10, color: colors.mutedForeground, marginTop: 2 },

  macroBarWrap: { gap: spacing.xs },
  macroBarTrack: { flexDirection: 'row', height: 10, borderRadius: 5, overflow: 'hidden', gap: 2 },
  macroBarSeg: { borderRadius: 3 },
  macroBarLegend: { flexDirection: 'row', gap: spacing.md },
  macroLegendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  macroLegendDot: { width: 8, height: 8, borderRadius: 4 },
  macroLegendText: { fontSize: fontSize.xs, color: colors.mutedForeground },

  proteinKgRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: spacing.xs, borderTopWidth: 1, borderTopColor: colors.border },
  proteinKgLabel: { fontSize: fontSize.sm, color: colors.mutedForeground },
  proteinKgValue: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold },
  proteinKgAdequacy: { fontWeight: fontWeight.normal, fontSize: fontSize.xs },

  trainRestRow: { flexDirection: 'row', alignItems: 'center' },
  trainRestCell: { flex: 1, alignItems: 'center', gap: 2 },
  trainRestDivider: { width: 1, height: 48, backgroundColor: colors.border, marginHorizontal: spacing.sm },
  trainRestValue: { fontSize: fontSize.xl, fontWeight: fontWeight.bold, color: colors.foreground },
  trainRestLabel: { fontSize: fontSize.xs, color: colors.mutedForeground },
  trainRestSub: { fontSize: 10, color: colors.mutedForeground, textAlign: 'center' },

  wellnessCorr: {
    flexDirection: 'row', alignItems: 'flex-start',
  },
  wellnessCorrTitle: { fontSize: fontSize.xs, fontWeight: fontWeight.semibold, color: colors.foreground, marginBottom: 2 },
  wellnessCorrText: { fontSize: fontSize.sm, color: colors.mutedForeground },

  radarWrap: { alignItems: 'center', gap: spacing.sm },
  radarLegend: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, justifyContent: 'center' },
  radarLegendRow: { flexDirection: 'row', alignItems: 'center', gap: 4, minWidth: 100 },
  radarLegendDot: { width: 8, height: 8, borderRadius: 4 },
  radarLegendLabel: { fontSize: fontSize.xs, color: colors.mutedForeground, flex: 1 },
  radarLegendScore: { fontSize: fontSize.xs, fontWeight: fontWeight.bold },

  sectionCard: {
    backgroundColor: colors.card, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border, overflow: 'hidden',
  },
  sectionHeader: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    padding: spacing.md,
  },
  sectionIconWrap: { width: 30, height: 30, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  sectionTitle: { flex: 1, fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.foreground },
  sectionHeaderRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  sectionGradePill: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    paddingHorizontal: 7, paddingVertical: 3, borderRadius: radius.full,
  },
  sectionGradeScore: { fontSize: 11, fontWeight: fontWeight.bold },
  sectionGradeText: { fontSize: 11, fontWeight: fontWeight.bold },
  sectionBody: { paddingHorizontal: spacing.md, paddingBottom: spacing.md, gap: spacing.sm },
  sectionSummary: { fontSize: fontSize.sm, color: colors.mutedForeground, lineHeight: 18 },

  subHeading: { fontSize: fontSize.xs, fontWeight: fontWeight.semibold, color: colors.foreground, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 4 },

  bulletRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  bulletDot: { width: 6, height: 6, borderRadius: 3, marginTop: 5, flexShrink: 0 },
  bulletText: { fontSize: fontSize.sm, color: colors.mutedForeground, flex: 1, lineHeight: 18 },

  infoRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  infoLabel: { fontSize: fontSize.sm, color: colors.mutedForeground },
  infoValueWrap: { alignItems: 'flex-end' },
  infoValue: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.foreground },
  infoSub: { fontSize: fontSize.xs, color: colors.mutedForeground },

  infoBox: {
    backgroundColor: colors.muted, borderRadius: radius.md,
    padding: spacing.sm, gap: 3,
  },
  warningBox: { backgroundColor: '#fef2f2' },
  infoBoxTitle: { fontSize: fontSize.xs, fontWeight: fontWeight.semibold, color: colors.foreground },
  infoBoxText: { fontSize: fontSize.xs, color: colors.mutedForeground, lineHeight: 16 },

  recList: { gap: spacing.xs },
  recItem: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  recNum: {
    width: 18, height: 18, borderRadius: 9,
    backgroundColor: colors.primary + '20', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  recNumText: { fontSize: 10, fontWeight: fontWeight.bold, color: colors.primary },
  recText: { fontSize: fontSize.sm, color: colors.mutedForeground, flex: 1, lineHeight: 18 },

  energyWindows: { gap: spacing.xs },
  energyWindowCard: {
    backgroundColor: colors.muted, borderRadius: radius.md, padding: spacing.sm, gap: 3,
  },
  energyWindowLabel: { fontSize: fontSize.xs, fontWeight: fontWeight.semibold, color: colors.foreground },
  energyWindowDetail: { fontSize: fontSize.xs, color: colors.mutedForeground, lineHeight: 15 },
  energyDotRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  energyDot: { width: 8, height: 8, borderRadius: 4 },
  energyDotLabel: { fontSize: fontSize.xs, fontWeight: fontWeight.semibold, textTransform: 'capitalize' },

  performanceGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  perfCell: { minWidth: 80, alignItems: 'center', backgroundColor: colors.muted, borderRadius: radius.sm, padding: spacing.xs },
  perfValue: { fontSize: 11, fontWeight: fontWeight.semibold, textTransform: 'capitalize', textAlign: 'center' },
  perfLabel: { fontSize: 10, color: colors.mutedForeground, textAlign: 'center', marginTop: 1 },

  liftCard: {
    backgroundColor: colors.muted, borderRadius: radius.md,
    padding: spacing.sm, gap: 5,
  },
  liftCardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  liftName: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.foreground, flex: 1 },
  liftImpactBadge: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: radius.full },
  liftImpactText: { fontSize: 10, fontWeight: fontWeight.semibold, textTransform: 'capitalize' },
  liftDetail: { fontSize: fontSize.xs, color: colors.mutedForeground, lineHeight: 15 },
  scienceTag: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 4,
    backgroundColor: '#ede9fe', borderRadius: radius.sm, padding: 5,
  },
  scienceText: { fontSize: 10, color: '#7c3aed', flex: 1, lineHeight: 14 },
  liftRec: { flexDirection: 'row', alignItems: 'flex-start', gap: 5 },
  liftRecText: { fontSize: fontSize.xs, color: '#15803d', flex: 1, lineHeight: 15 },

  clarityRatings: { flexDirection: 'row', gap: spacing.md },
  clarityRatingCell: { flex: 1, backgroundColor: colors.muted, borderRadius: radius.md, padding: spacing.sm, alignItems: 'center' },
  clarityRatingNum: { fontSize: 22, fontWeight: fontWeight.bold },
  clarityRatingMax: { fontSize: fontSize.xs, color: colors.mutedForeground, fontWeight: fontWeight.normal },
  clarityRatingLabel: { fontSize: fontSize.xs, color: colors.mutedForeground, textAlign: 'center' },

  energyTimeline: { gap: 0 },
  timelineStep: { flexDirection: 'row', gap: spacing.sm, minHeight: 60 },
  timelineConnector: { width: 20, alignItems: 'center' },
  timelineDot: { width: 12, height: 12, borderRadius: 6, marginTop: 4 },
  timelineLine: { flex: 1, width: 2, backgroundColor: colors.border, marginTop: 2 },
  timelineContent: { flex: 1, paddingBottom: spacing.sm, gap: 3 },
  timelineHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  timelineLabel: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.foreground },
  timelineDetail: { fontSize: fontSize.xs, color: colors.mutedForeground, lineHeight: 15 },

  recoveryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  recoveryCell: { minWidth: '45%', flex: 1, backgroundColor: colors.muted, borderRadius: radius.sm, padding: spacing.xs, alignItems: 'center' },
  recoveryValue: { fontSize: 11, fontWeight: fontWeight.semibold, textTransform: 'capitalize', textAlign: 'center' },
  recoveryLabel: { fontSize: 10, color: colors.mutedForeground, textAlign: 'center', marginTop: 1 },

  siRow: { flexDirection: 'row', gap: spacing.sm },
  siCard: {
    backgroundColor: colors.card, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border, padding: spacing.sm, gap: spacing.xs,
  },
  siHeader: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 2 },
  siTitle: { fontSize: fontSize.xs, fontWeight: fontWeight.semibold, textTransform: 'uppercase', letterSpacing: 0.4 },

  targetGrid: { flexDirection: 'row', gap: spacing.sm },
  targetCell: { flex: 1, alignItems: 'center', backgroundColor: colors.muted, borderRadius: radius.sm, padding: spacing.xs, gap: 1 },
  targetValue: { fontSize: fontSize.lg, fontWeight: fontWeight.bold },
  targetUnit: { fontSize: 10, fontWeight: fontWeight.normal, color: colors.mutedForeground },
  targetLabel: { fontSize: 10, color: colors.mutedForeground },
  targetDiff: { fontSize: 10, fontWeight: fontWeight.semibold },

  periodizationBox: { backgroundColor: colors.muted, borderRadius: radius.md, padding: spacing.sm, gap: spacing.xs },
  periodizationTitle: { fontSize: fontSize.xs, fontWeight: fontWeight.semibold, color: colors.foreground },
  periodizationRow: { flexDirection: 'row', gap: spacing.md },
  periodizationLabel: { fontSize: fontSize.xs, color: colors.mutedForeground },
  periodizationValue: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.foreground },

  rationaleText: { fontSize: fontSize.xs, color: colors.mutedForeground, lineHeight: 16 },

  suggestionRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  suggestionNum: {
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1,
  },
  suggestionNumText: { fontSize: 11, fontWeight: fontWeight.bold, color: colors.primaryForeground },
  suggestionText: { fontSize: fontSize.sm, color: colors.mutedForeground, flex: 1, lineHeight: 18 },

  sectionSubtitle: { fontSize: fontSize.xs, color: colors.mutedForeground, marginBottom: spacing.sm },
  domainBlock: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.sm, marginTop: spacing.sm },
  domainHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginBottom: 4 },
  domainLabel: { fontSize: fontSize.xs, fontWeight: fontWeight.semibold, textTransform: 'uppercase', letterSpacing: 0.5 },
  domainHeadline: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.foreground, marginBottom: 4 },
  domainDetail: { fontSize: fontSize.xs, color: colors.mutedForeground, lineHeight: 17 },
});
