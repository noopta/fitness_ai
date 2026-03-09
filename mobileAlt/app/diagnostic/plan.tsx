import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  Alert,
  TouchableOpacity,
  Linking,
} from 'react-native';
import { Stack, useRouter, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { liftCoachApi } from '../../src/lib/api';
import { Button } from '../../src/components/ui/Button';
import { Card, CardHeader, CardTitle, CardContent } from '../../src/components/ui/Card';
import { Badge } from '../../src/components/ui/Badge';
import { LoadingSpinner } from '../../src/components/ui/LoadingSpinner';
import { Separator } from '../../src/components/ui/Separator';
import { StrengthRadar } from '../../src/components/StrengthRadar';
import { PhaseBreakdown } from '../../src/components/PhaseBreakdown';
import { HypothesisRankings } from '../../src/components/HypothesisRankings';
import { EfficiencyGauge } from '../../src/components/EfficiencyGauge';
import { UpgradePrompt } from '../../src/components/UpgradePrompt';
import { useAuth } from '../../src/context/AuthContext';
import { colors, spacing, fontSize, fontWeight, radius } from '../../src/constants/theme';

// ─── Types ────────────────────────────────────────────────────────────────────

interface AccessoryItem {
  name: string;
  exercise_id?: string;
  priority: number;
  category: string;
  impact: string;
  why: string;
  sets: string;
  reps: string;
  videoUrl?: string;
  videoTitle?: string;
}

interface PrimaryLift {
  exercise_name: string;
  sets: number;
  reps: number;
  intensity: number;
  rest_minutes: number;
}

interface BenchDayPlan {
  primary_lift: PrimaryLift;
  accessories: AccessoryItem[];
  progression_rules: string[];
  track_next_time: string[];
}

interface DiagnosticSignals {
  e1RMs?: Record<string, number>;
  quad_index?: number;
  posterior_index?: number;
  back_tension_index?: number;
  triceps_index?: number;
  shoulder_index?: number;
  primary_phase?: string;
  phase_confidence?: number;
  efficiency_score?: number;
  hypotheses?: Array<{ name: string; score: number }>;
  phase_scores?: Array<{ label: string; value: number }>;
}

interface DiagnosisEntry {
  limiterName: string;
  confidence: number;
  evidence: string[];
}

interface Plan {
  diagnosis: DiagnosisEntry[];
  bench_day_plan: BenchDayPlan;
  diagnosticSignals: DiagnosticSignals;
}

// ─── Normalization ────────────────────────────────────────────────────────────

/**
 * Normalize the raw plan JSON from the backend (snake_case) into the shape
 * that our UI components expect (camelCase for top-level keys, flat index values).
 */
function normalizePlan(raw: any): Plan {
  // Resolve diagnostic signals from either camelCase or snake_case key
  const ds = raw.diagnostic_signals ?? raw.diagnosticSignals ?? {};
  // Indices may be nested ({ shoulder_index: { value, confidence } }) or already flat
  const indices = ds.indices ?? {};

  function flatIndex(key: string): number | undefined {
    if (indices[key] !== undefined) {
      return typeof indices[key] === 'object' ? indices[key]?.value : indices[key];
    }
    return typeof ds[key] === 'object' ? ds[key]?.value : ds[key];
  }

  // efficiency_score may be an object { score, explanation } or a plain number
  const rawEff = ds.efficiency_score;
  const efficiencyScore: number | undefined =
    rawEff === undefined
      ? undefined
      : typeof rawEff === 'object'
      ? rawEff?.score
      : rawEff;

  // phase_scores: [{ phase_id, points }] → [{ label, value }]
  const rawPhases: any[] = ds.phase_scores ?? [];
  const phaseScores = rawPhases.map((p: any) => ({
    label: p.phase_id ?? p.label ?? '',
    value: p.points ?? p.value ?? 0,
  }));

  // hypothesis_scores: [{ key, label, score }] → [{ name, score }]
  const rawHyp: any[] = ds.hypothesis_scores ?? ds.hypotheses ?? [];
  const hypotheses = rawHyp.map((h: any) => ({
    name: h.label ?? h.name ?? h.key ?? '',
    score: h.score ?? 0,
  }));

  const normalizedSignals: DiagnosticSignals = {
    quad_index: flatIndex('quad_index'),
    posterior_index: flatIndex('posterior_index'),
    back_tension_index: flatIndex('back_tension_index'),
    triceps_index: flatIndex('triceps_index'),
    shoulder_index: flatIndex('shoulder_index'),
    primary_phase: ds.primary_phase,
    phase_confidence: ds.primary_phase_confidence ?? ds.phase_confidence,
    efficiency_score: efficiencyScore,
    phase_scores: phaseScores.length > 0 ? phaseScores : undefined,
    hypotheses: hypotheses.length > 0 ? hypotheses : undefined,
    e1RMs: ds.e1RMs ?? ds.e1rms,
  };

  // Normalize accessories: exercise_name → name
  const rawAccessories: any[] = raw.bench_day_plan?.accessories ?? [];
  const accessories: AccessoryItem[] = rawAccessories.map((a: any) => ({
    ...a,
    name: a.exercise_name ?? a.name ?? '',
    exercise_id: a.exercise_id,
  }));

  // Normalize diagnosis: may be array or object
  let diagnosis: DiagnosisEntry[] = [];
  if (Array.isArray(raw.diagnosis)) {
    diagnosis = raw.diagnosis.map((d: any) => ({
      limiterName: d.limiterName ?? d.limiter_name ?? d.name ?? '',
      confidence: d.confidence ?? 0,
      evidence: d.evidence ?? [],
    }));
  } else if (raw.diagnosis && typeof raw.diagnosis === 'object') {
    diagnosis = [{
      limiterName: raw.diagnosis.limiterName ?? raw.diagnosis.limiter_name ?? raw.diagnosis.name ?? '',
      confidence: raw.diagnosis.confidence ?? 0,
      evidence: raw.diagnosis.evidence ?? [],
    }];
  }

  return {
    ...raw,
    diagnosis,
    diagnosticSignals: normalizedSignals,
    bench_day_plan: {
      ...raw.bench_day_plan,
      accessories,
    },
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function hasIndexValues(signals: DiagnosticSignals): boolean {
  return (
    signals.quad_index !== undefined ||
    signals.posterior_index !== undefined ||
    signals.back_tension_index !== undefined ||
    signals.triceps_index !== undefined ||
    signals.shoulder_index !== undefined
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function PlanScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ sessionId?: string }>();
  const { user } = useAuth();

  const [plan, setPlan] = useState<Plan | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');
  const [rateLimited, setRateLimited] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [sessionId, setSessionId] = useState('');

  // ── Load plan on mount ──────────────────────────────────────────────────────
  useEffect(() => {
    loadPlan();
  }, []);

  const loadPlan = useCallback(async () => {
    try {
      setLoading(true);
      setError('');

      // Resolve sessionId from params or AsyncStorage
      const paramId = params.sessionId as string | undefined;
      const storedId = await AsyncStorage.getItem('axiom_session_id');
      const resolvedId = paramId || storedId || '';

      if (!resolvedId) {
        setError('No session found');
        return;
      }

      setSessionId(resolvedId);

      let rawPlan: any = null;

      // Try cached plan first
      try {
        const cached = await liftCoachApi.getCachedPlan(resolvedId);
        rawPlan = cached?.plan ?? cached;
      } catch (cacheErr: any) {
        if ((cacheErr as any)?.status !== 404) {
          // Non-404 errors on cached endpoint fall through to generate
        }
      }

      if (!rawPlan) {
        // Fall back to generating
        setGenerating(true);
        try {
          const generated = await liftCoachApi.generatePlan(resolvedId);
          rawPlan = generated?.plan ?? generated;
        } catch (genErr: any) {
          if ((genErr as any)?.status === 429) {
            setRateLimited(true);
          } else {
            setError((genErr as Error).message || 'Failed to generate plan');
          }
          return;
        } finally {
          setGenerating(false);
        }
      }

      const normalized = normalizePlan(rawPlan);

      // Fetch videos for accessories that have exercise_id (fire-and-forget per accessory)
      const accessories = normalized.bench_day_plan?.accessories ?? [];
      const withVideos = await Promise.all(
        accessories.map(async (acc: AccessoryItem) => {
          if (!acc.exercise_id) return acc;
          try {
            const vid = await liftCoachApi.getExerciseVideo(acc.exercise_id);
            return {
              ...acc,
              videoUrl: vid?.videoUrl ?? vid?.url ?? vid?.link ?? undefined,
              videoTitle: vid?.videoTitle ?? vid?.title ?? undefined,
            };
          } catch {
            return acc;
          }
        }),
      );
      normalized.bench_day_plan = { ...normalized.bench_day_plan, accessories: withVideos };

      setPlan(normalized);
    } catch (err: any) {
      setError((err as Error).message || 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }, [params.sessionId]);

  // ── Share handler ──────────────────────────────────────────────────────────
  const handleShare = useCallback(async () => {
    if (!sessionId || sharing) return;
    try {
      setSharing(true);
      const result = await liftCoachApi.sharePlan(sessionId);
      const shareUrl: string = result?.shareUrl || result?.url || '';
      if (shareUrl) {
        await Clipboard.setStringAsync(shareUrl);
        Alert.alert('Link copied!', 'Share link has been copied to your clipboard.');
      }
    } catch (err: any) {
      Alert.alert('Error', (err as Error).message || 'Could not generate share link');
    } finally {
      setSharing(false);
    }
  }, [sessionId, sharing]);

  // ── New analysis handler ───────────────────────────────────────────────────
  const handleNewAnalysis = useCallback(async () => {
    await AsyncStorage.removeItem('axiom_session_id');
    router.replace('/diagnostic/onboarding');
  }, [router]);

  // ── Render states ──────────────────────────────────────────────────────────

  const renderHeader = () => (
    <Stack.Screen
      options={{
        title: 'Your Plan',
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.foreground,
        headerTitleStyle: { fontWeight: fontWeight.semibold, fontSize: fontSize.lg },
        headerRight: () => (
          <TouchableOpacity
            onPress={handleShare}
            disabled={sharing || !plan}
            style={styles.shareButton}
          >
            <Ionicons
              name={sharing ? 'hourglass-outline' : 'share-outline'}
              size={22}
              color={plan ? colors.primary : colors.mutedForeground}
            />
          </TouchableOpacity>
        ),
      }}
    />
  );

  if (loading) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['bottom']}>
        {renderHeader()}
        <View style={styles.centeredState}>
          <LoadingSpinner size="large" />
          <Text style={styles.loadingText}>
            {generating ? 'Generating your plan...' : 'Loading your plan...'}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  if (rateLimited) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['bottom']}>
        {renderHeader()}
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          <UpgradePrompt
            userId={user?.id}
            reason="You've reached your free analysis limit. Upgrade to Pro for unlimited diagnoses."
          />
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (error || !plan) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['bottom']}>
        {renderHeader()}
        <View style={styles.centeredState}>
          <Card style={styles.errorCard}>
            <CardContent style={styles.errorContent}>
              <Ionicons name="alert-circle-outline" size={40} color={colors.destructive} />
              <Text style={styles.errorTitle}>Something went wrong</Text>
              <Text style={styles.errorMessage}>
                {error || 'Unable to load your plan. Please try again.'}
              </Text>
              <Button onPress={loadPlan} style={styles.retryButton}>
                Try Again
              </Button>
            </CardContent>
          </Card>
        </View>
      </SafeAreaView>
    );
  }

  // ── Destructure plan data safely ───────────────────────────────────────────
  const signals = plan.diagnosticSignals ?? {};
  const primaryDiagnosis = plan.diagnosis?.[0];
  const primaryLift = plan.bench_day_plan?.primary_lift;
  const accessories = [...(plan.bench_day_plan?.accessories ?? [])].sort(
    (a, b) => (a.priority ?? 99) - (b.priority ?? 99),
  );
  const progressionRules = plan.bench_day_plan?.progression_rules ?? [];
  const trackNextTime = plan.bench_day_plan?.track_next_time ?? [];

  return (
    <SafeAreaView style={styles.safeArea} edges={['bottom']}>
      {renderHeader()}
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >

        {/* ── A) Diagnosis Card ───────────────────────────────────────────── */}
        {primaryDiagnosis && (
          <Card style={[styles.card, styles.diagnosisCard]}>
            <CardHeader style={styles.diagnosisHeader}>
              <View style={styles.diagnosisBadgeRow}>
                <Badge variant="default">AI Diagnosis</Badge>
                {primaryDiagnosis.confidence !== undefined && (
                  <Badge variant="secondary">
                    {Math.round(primaryDiagnosis.confidence * 100)}% confident
                  </Badge>
                )}
              </View>
              <Text style={styles.diagnosisTitle}>
                {primaryDiagnosis.limiterName}
              </Text>
            </CardHeader>

            <Separator />

            <CardContent style={styles.evidenceContent}>
              {(primaryDiagnosis.evidence ?? []).slice(0, 4).map((item, i) => (
                <View key={i} style={styles.evidenceRow}>
                  <View style={styles.bulletDot} />
                  <Text style={styles.evidenceText}>{item}</Text>
                </View>
              ))}
            </CardContent>
          </Card>
        )}

        {/* ── B) Visualizations ───────────────────────────────────────────── */}
        {(hasIndexValues(signals) || signals.efficiency_score !== undefined) && (
          <View style={styles.vizRow}>
            {hasIndexValues(signals) && (
              <View style={styles.vizBlock}>
                <Text style={styles.vizTitle}>Strength Profile</Text>
                <StrengthRadar data={signals} size={180} />
              </View>
            )}
            {signals.efficiency_score !== undefined && (
              <View style={styles.vizBlock}>
                <Text style={styles.vizTitle}>Efficiency Score</Text>
                <EfficiencyGauge score={signals.efficiency_score} size={140} />
              </View>
            )}
          </View>
        )}

        {/* ── C) Phase Breakdown ──────────────────────────────────────────── */}
        {signals.phase_scores && signals.phase_scores.length > 0 && (
          <Card style={styles.card}>
            <CardHeader>
              <CardTitle>Training Phase Analysis</CardTitle>
              {signals.primary_phase && (
                <Text style={styles.subheading}>
                  Primary: <Text style={styles.phaseHighlight}>{signals.primary_phase}</Text>
                  {signals.phase_confidence !== undefined &&
                    ` · ${Math.round(signals.phase_confidence * 100)}% confidence`}
                </Text>
              )}
            </CardHeader>
            <CardContent>
              <PhaseBreakdown phases={signals.phase_scores} />
            </CardContent>
          </Card>
        )}

        {/* ── D) Hypothesis Rankings ─────────────────────────────────────── */}
        {signals.hypotheses && signals.hypotheses.length > 0 && (
          <Card style={styles.card}>
            <CardHeader>
              <CardTitle>Weakness Analysis</CardTitle>
              <Text style={styles.subheading}>Top candidates ranked by score</Text>
            </CardHeader>
            <CardContent>
              <HypothesisRankings hypotheses={signals.hypotheses} />
            </CardContent>
          </Card>
        )}

        {/* ── E) Primary Lift Card ────────────────────────────────────────── */}
        {primaryLift && (
          <Card style={styles.card}>
            <CardHeader>
              <CardTitle>Primary Lift Protocol</CardTitle>
            </CardHeader>
            <CardContent>
              <Text style={styles.liftName}>{primaryLift.exercise_name}</Text>
              <View style={styles.statGrid}>
                <View style={styles.statCell}>
                  <Text style={styles.statValue}>
                    {primaryLift.sets}×{primaryLift.reps}
                  </Text>
                  <Text style={styles.statLabel}>Sets × Reps</Text>
                </View>
                <View style={[styles.statCell, styles.statCellBordered]}>
                  <Text style={styles.statValue}>{primaryLift.intensity}%</Text>
                  <Text style={styles.statLabel}>Intensity</Text>
                </View>
                <View style={styles.statCell}>
                  <Text style={styles.statValue}>{primaryLift.rest_minutes}min</Text>
                  <Text style={styles.statLabel}>Rest</Text>
                </View>
              </View>
            </CardContent>
          </Card>
        )}

        {/* ── F) Accessories ──────────────────────────────────────────────── */}
        {accessories.length > 0 && (
          <View>
            <Text style={styles.sectionTitle}>Targeted Accessories</Text>
            {accessories.map((acc, i) => (
              <Card key={`${acc.name}-${i}`} style={styles.accessoryCard}>
                <CardContent style={styles.accessoryContent}>
                  <View style={styles.accessoryHeader}>
                    <Text style={styles.accessoryName}>{acc.name}</Text>
                    {acc.priority === 1 ? (
                      <Badge variant="default">Most Impactful</Badge>
                    ) : (
                      <Badge variant="secondary">#{acc.priority}</Badge>
                    )}
                  </View>

                  <View style={styles.accessoryBadgeRow}>
                    {acc.category ? (
                      <Badge variant="outline">{acc.category}</Badge>
                    ) : null}
                    {acc.impact ? (
                      <Badge variant="secondary">{acc.impact}</Badge>
                    ) : null}
                  </View>

                  <Text style={styles.accessorySetsReps}>
                    {acc.sets} sets × {acc.reps} reps
                  </Text>

                  {acc.why ? (
                    <Text style={styles.accessoryWhy}>Why: {acc.why}</Text>
                  ) : null}

                  {acc.videoUrl ? (
                    <TouchableOpacity
                      style={styles.videoLink}
                      onPress={() => Linking.openURL(acc.videoUrl!)}
                    >
                      <Ionicons name="play-circle-outline" size={16} color={colors.primary} />
                      <Text style={styles.videoLinkText}>
                        {acc.videoTitle ? acc.videoTitle : 'Watch Demo Video'}
                      </Text>
                    </TouchableOpacity>
                  ) : null}
                </CardContent>
              </Card>
            ))}
          </View>
        )}

        {/* ── G) Progression Rules ────────────────────────────────────────── */}
        {progressionRules.length > 0 && (
          <Card style={styles.card}>
            <CardHeader>
              <CardTitle>Progression Rules</CardTitle>
            </CardHeader>
            <CardContent style={styles.listContent}>
              {progressionRules.map((rule, i) => (
                <View key={i} style={styles.numberedRow}>
                  <Text style={styles.numberLabel}>{i + 1}.</Text>
                  <Text style={styles.ruleText}>{rule}</Text>
                </View>
              ))}
            </CardContent>
          </Card>
        )}

        {/* ── H) Track Next Time ──────────────────────────────────────────── */}
        {trackNextTime.length > 0 && (
          <Card style={styles.card}>
            <CardHeader>
              <CardTitle>Track Next Time</CardTitle>
            </CardHeader>
            <CardContent style={styles.listContent}>
              {trackNextTime.map((item, i) => (
                <View key={i} style={styles.checkRow}>
                  <Ionicons
                    name="checkbox-outline"
                    size={18}
                    color={colors.primary}
                    style={styles.checkIcon}
                  />
                  <Text style={styles.checkText}>{item}</Text>
                </View>
              ))}
            </CardContent>
          </Card>
        )}

        {/* ── I) Action Buttons ───────────────────────────────────────────── */}
        <View style={styles.actions}>
          <Button
            variant="outline"
            fullWidth
            onPress={handleNewAnalysis}
            style={styles.actionButton}
          >
            New Analysis
          </Button>
          <Button
            variant="outline"
            fullWidth
            onPress={() => router.push('/(tabs)/history')}
            style={styles.actionButton}
          >
            View History
          </Button>
        </View>

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
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: spacing.md,
    gap: spacing.md,
    paddingBottom: spacing.xxl,
  },

  // ── Loading / Error states ─────────────────────────────────────────────────
  centeredState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  loadingText: {
    marginTop: spacing.md,
    fontSize: fontSize.base,
    color: colors.mutedForeground,
    textAlign: 'center',
  },
  errorCard: {
    width: '100%',
  },
  errorContent: {
    alignItems: 'center',
    gap: spacing.md,
    paddingTop: spacing.md,
  },
  errorTitle: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.semibold,
    color: colors.foreground,
  },
  errorMessage: {
    fontSize: fontSize.sm,
    color: colors.mutedForeground,
    textAlign: 'center',
    lineHeight: 20,
  },
  retryButton: {
    marginTop: spacing.xs,
    width: '100%',
  },

  // ── Share button ───────────────────────────────────────────────────────────
  shareButton: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },

  // ── Common card ───────────────────────────────────────────────────────────
  card: {
    marginBottom: 0, // gap handled by scrollContent
  },

  // ── A) Diagnosis ──────────────────────────────────────────────────────────
  diagnosisCard: {
    borderColor: `${colors.primary}40`,
  },
  diagnosisHeader: {
    gap: spacing.sm,
    paddingBottom: spacing.md,
  },
  diagnosisBadgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  diagnosisTitle: {
    fontSize: fontSize.xxl,
    fontWeight: fontWeight.bold,
    color: colors.foreground,
    lineHeight: 30,
  },
  evidenceContent: {
    gap: spacing.sm,
    paddingTop: spacing.md,
  },
  evidenceRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  bulletDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.primary,
    marginTop: 6,
    flexShrink: 0,
  },
  evidenceText: {
    flex: 1,
    fontSize: fontSize.sm,
    color: colors.mutedForeground,
    lineHeight: 20,
  },

  // ── B) Visualizations ─────────────────────────────────────────────────────
  vizRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    justifyContent: 'space-around',
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  vizBlock: {
    alignItems: 'center',
    gap: spacing.sm,
  },
  vizTitle: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    color: colors.mutedForeground,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },

  // ── C) Phase ──────────────────────────────────────────────────────────────
  subheading: {
    fontSize: fontSize.sm,
    color: colors.mutedForeground,
    marginTop: 2,
  },
  phaseHighlight: {
    color: colors.primary,
    fontWeight: fontWeight.semibold,
  },

  // ── E) Primary lift ───────────────────────────────────────────────────────
  liftName: {
    fontSize: fontSize.xl,
    fontWeight: fontWeight.bold,
    color: colors.foreground,
    marginBottom: spacing.md,
  },
  statGrid: {
    flexDirection: 'row',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  statCell: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing.md,
    gap: 4,
  },
  statCellBordered: {
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: colors.border,
  },
  statValue: {
    fontSize: fontSize.xl,
    fontWeight: fontWeight.bold,
    color: colors.primary,
  },
  statLabel: {
    fontSize: fontSize.xs,
    color: colors.mutedForeground,
  },

  // ── F) Accessories ────────────────────────────────────────────────────────
  sectionTitle: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.semibold,
    color: colors.foreground,
    marginBottom: spacing.sm,
  },
  accessoryCard: {
    marginBottom: spacing.sm,
  },
  accessoryContent: {
    gap: spacing.sm,
    paddingTop: spacing.md,
  },
  accessoryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  accessoryName: {
    flex: 1,
    fontSize: fontSize.base,
    fontWeight: fontWeight.semibold,
    color: colors.foreground,
  },
  accessoryBadgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  accessorySetsReps: {
    fontSize: fontSize.sm,
    color: colors.foreground,
    fontWeight: fontWeight.medium,
  },
  accessoryWhy: {
    fontSize: fontSize.sm,
    color: colors.mutedForeground,
    fontStyle: 'italic',
    lineHeight: 19,
  },
  videoLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 2,
  },
  videoLinkText: {
    fontSize: fontSize.sm,
    color: colors.primary,
    fontWeight: fontWeight.medium,
    flexShrink: 1,
  },

  // ── G) Progression ────────────────────────────────────────────────────────
  listContent: {
    gap: spacing.sm,
    paddingTop: spacing.sm,
  },
  numberedRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'flex-start',
  },
  numberLabel: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    color: colors.primary,
    minWidth: 20,
  },
  ruleText: {
    flex: 1,
    fontSize: fontSize.sm,
    color: colors.foreground,
    lineHeight: 20,
  },

  // ── H) Track next time ────────────────────────────────────────────────────
  checkRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  checkIcon: {
    marginTop: 1,
    flexShrink: 0,
  },
  checkText: {
    flex: 1,
    fontSize: fontSize.sm,
    color: colors.foreground,
    lineHeight: 20,
  },

  // ── I) Actions ────────────────────────────────────────────────────────────
  actions: {
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  actionButton: {
    // fullWidth handles width
  },
});
