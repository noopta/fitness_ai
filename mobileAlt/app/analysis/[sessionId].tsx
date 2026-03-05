import React, { useEffect, useState } from 'react';
import {
  ScrollView,
  View,
  Text,
  StyleSheet,
  useWindowDimensions,
} from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { liftCoachApi } from '../../src/lib/api';
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from '../../src/components/ui/Card';
import { Badge } from '../../src/components/ui/Badge';
import { Button } from '../../src/components/ui/Button';
import { LoadingSpinner } from '../../src/components/ui/LoadingSpinner';
import { colors, spacing, fontSize, fontWeight, radius } from '../../src/constants/theme';

const LIFT_LABELS: Record<string, string> = {
  flat_bench_press: 'Flat Bench Press',
  incline_bench_press: 'Incline Bench Press',
  deadlift: 'Deadlift',
  barbell_back_squat: 'Barbell Back Squat',
  barbell_front_squat: 'Barbell Front Squat',
  clean_and_jerk: 'Clean & Jerk',
  snatch: 'Snatch',
  power_clean: 'Power Clean',
  hang_clean: 'Hang Clean',
};

function formatLiftName(raw: string): string {
  if (!raw) return raw;
  return LIFT_LABELS[raw] ?? raw.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function PublicAnalysisScreen() {
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>();
  const router = useRouter();
  const { width: screenWidth } = useWindowDimensions();

  const [plan, setPlan] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!sessionId) {
      setNotFound(true);
      setLoading(false);
      return;
    }

    (async () => {
      try {
        const data = await liftCoachApi.getPublicSession(sessionId);
        setPlan(data);
      } catch (err: any) {
        if (err?.status === 404) {
          setNotFound(true);
        } else {
          setNotFound(true);
        }
      } finally {
        setLoading(false);
      }
    })();
  }, [sessionId]);

  // ── Loading ──────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <Stack.Screen options={{ title: 'Analysis' }} />
        <View style={styles.centeredFill}>
          <LoadingSpinner message="Loading analysis..." />
        </View>
      </SafeAreaView>
    );
  }

  // ── Not Found ────────────────────────────────────────────────────────────────
  if (notFound || !plan) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <Stack.Screen options={{ title: 'Analysis' }} />
        <View style={styles.centeredFill}>
          <Card style={styles.notFoundCard}>
            <CardHeader>
              <CardTitle style={styles.notFoundTitle}>Analysis not found</CardTitle>
            </CardHeader>
            <CardContent>
              <Text style={styles.mutedText}>
                This analysis link may have expired or does not exist.
              </Text>
              <Button
                style={styles.registerButton}
                onPress={() => router.push('/(auth)/register')}
              >
                Create Free Account
              </Button>
            </CardContent>
          </Card>
        </View>
      </SafeAreaView>
    );
  }

  // ── Derived data ─────────────────────────────────────────────────────────────
  const diagnosis: any[] = plan.diagnosis ?? [];
  const primaryDiagnosis = diagnosis[0] ?? null;
  const topDiagnoses = diagnosis.slice(0, 3);
  const primaryLift = plan.bench_day_plan?.primary_lift ?? null;
  const accessories: any[] = plan.bench_day_plan?.accessories ?? [];
  const topAccessories = accessories.slice(0, 4);

  const maxConfidence = topDiagnoses.reduce(
    (m: number, d: any) => Math.max(m, d.confidence ?? 0),
    1,
  );

  // ── Loaded ───────────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.safeArea} edges={['bottom', 'left', 'right']}>
      <Stack.Screen options={{ title: 'Analysis' }} />
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* ── 1. Header Card ───────────────────────────────────────────────── */}
        <Card style={styles.headerCard}>
          <CardHeader>
            <Badge variant="default" style={styles.aiBadge}>AI Analysis</Badge>
            <Text style={styles.liftName}>{formatLiftName(plan.selected_lift)}</Text>
            {primaryDiagnosis && (
              <View style={styles.limiterRow}>
                <Text style={styles.limiterName}>{primaryDiagnosis.limiterName}</Text>
                <Badge variant="outline" style={styles.confidenceBadge}>
                  {Math.round((primaryDiagnosis.confidence ?? 0) * 100)}% confidence
                </Badge>
              </View>
            )}
          </CardHeader>
        </Card>

        {/* ── 2. Diagnosis Evidence Card ───────────────────────────────────── */}
        {primaryDiagnosis && (
          <Card style={styles.card}>
            <CardHeader>
              <CardTitle>Primary Limiter</CardTitle>
            </CardHeader>
            <CardContent>
              <Text style={styles.diagnosisName}>{primaryDiagnosis.limiterName}</Text>
              <Badge variant="secondary" style={styles.smallBadge}>
                {Math.round((primaryDiagnosis.confidence ?? 0) * 100)}% confidence
              </Badge>

              {/* Evidence bullets */}
              {Array.isArray(primaryDiagnosis.evidence) &&
                primaryDiagnosis.evidence.length > 0 && (
                  <View style={styles.evidenceList}>
                    {primaryDiagnosis.evidence.map((item: string, i: number) => (
                      <View key={i} style={styles.evidenceRow}>
                        <Text style={styles.bullet}>•</Text>
                        <Text style={styles.evidenceText}>{item}</Text>
                      </View>
                    ))}
                  </View>
                )}

              {/* Top 3 confidence bars */}
              {topDiagnoses.length > 1 && (
                <View style={styles.barsSection}>
                  <Text style={styles.barsSectionTitle}>All Candidates</Text>
                  {topDiagnoses.map((d: any, i: number) => {
                    const pct = maxConfidence > 0
                      ? (d.confidence ?? 0) / maxConfidence
                      : 0;
                    const barWidth = Math.max(pct * (screenWidth - 80), 4);
                    return (
                      <View key={i} style={styles.barRow}>
                        <Text style={styles.barLabel} numberOfLines={1}>
                          {d.limiterName}
                        </Text>
                        <View style={styles.barTrack}>
                          <View
                            style={[
                              styles.barFill,
                              { width: barWidth },
                            ]}
                          />
                        </View>
                        <Text style={styles.barPct}>
                          {Math.round((d.confidence ?? 0) * 100)}%
                        </Text>
                      </View>
                    );
                  })}
                </View>
              )}
            </CardContent>
          </Card>
        )}

        {/* ── 3. Primary Lift Card ─────────────────────────────────────────── */}
        {primaryLift && (
          <Card style={styles.card}>
            <CardHeader>
              <CardTitle>{primaryLift.exercise_name}</CardTitle>
            </CardHeader>
            <CardContent>
              <View style={styles.statGrid}>
                <View style={styles.statCell}>
                  <Text style={styles.statValue}>
                    {primaryLift.sets}×{primaryLift.reps}
                  </Text>
                  <Text style={styles.statLabel}>Volume</Text>
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

        {/* ── 4. Accessories Card ──────────────────────────────────────────── */}
        {topAccessories.length > 0 && (
          <Card style={styles.card}>
            <CardHeader>
              <CardTitle>Recommended Accessories</CardTitle>
            </CardHeader>
            <CardContent>
              {topAccessories.map((acc: any, i: number) => (
                <View
                  key={i}
                  style={[
                    styles.accessoryItem,
                    i < topAccessories.length - 1 && styles.accessoryDivider,
                  ]}
                >
                  <View style={styles.accessoryHeader}>
                    <Text style={styles.accessoryName}>{acc.name}</Text>
                    {acc.priority && (
                      <Badge variant="pro" style={styles.priorityBadge}>
                        {acc.priority}
                      </Badge>
                    )}
                  </View>
                  <View style={styles.accessoryBadgeRow}>
                    {acc.category && (
                      <Badge variant="secondary" style={styles.smallBadge}>
                        {acc.category}
                      </Badge>
                    )}
                    {acc.impact && (
                      <Badge variant="outline" style={styles.smallBadge}>
                        {acc.impact}
                      </Badge>
                    )}
                  </View>
                  {acc.why && (
                    <Text style={styles.accessoryWhy}>Why: {acc.why}</Text>
                  )}
                </View>
              ))}
            </CardContent>
          </Card>
        )}

        {/* ── 5. CTA Card ──────────────────────────────────────────────────── */}
        <Card style={[styles.card, styles.ctaCard]}>
          <CardHeader style={styles.ctaHeader}>
            <CardTitle style={styles.ctaTitle}>Get Your Own Analysis</CardTitle>
          </CardHeader>
          <CardContent style={styles.ctaContent}>
            <Text style={styles.ctaSubtitle}>
              Join thousands of athletes identifying their strength limiters
            </Text>
            <Button
              fullWidth
              onPress={() => router.push('/(auth)/register')}
              style={styles.ctaButton}
            >
              Create Free Account
            </Button>
          </CardContent>
        </Card>

        <View style={styles.bottomSpacer} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  centeredFill: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  scrollContent: {
    padding: spacing.md,
    gap: spacing.md,
  },

  // ── Not Found ────────────────────────────────────────────────────────────────
  notFoundCard: {
    width: '100%',
    maxWidth: 360,
  },
  notFoundTitle: {
    textAlign: 'center',
  },
  mutedText: {
    color: colors.mutedForeground,
    fontSize: fontSize.sm,
    textAlign: 'center',
    marginBottom: spacing.md,
  },
  registerButton: {
    marginTop: spacing.sm,
  },

  // ── Header card ──────────────────────────────────────────────────────────────
  headerCard: {
    backgroundColor: 'rgba(99,102,241,0.10)',
    borderColor: 'rgba(99,102,241,0.30)',
  },
  aiBadge: {
    marginBottom: spacing.sm,
  },
  liftName: {
    fontSize: fontSize.xxl,
    fontWeight: fontWeight.bold,
    color: colors.foreground,
    marginBottom: spacing.sm,
  },
  limiterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  limiterName: {
    fontSize: fontSize.xl,
    fontWeight: fontWeight.bold,
    color: colors.foreground,
    flexShrink: 1,
  },
  confidenceBadge: {
    marginLeft: spacing.xs,
  },

  // ── Generic card ─────────────────────────────────────────────────────────────
  card: {
    marginBottom: 0,
  },

  // ── Diagnosis ────────────────────────────────────────────────────────────────
  diagnosisName: {
    fontSize: fontSize.xl,
    fontWeight: fontWeight.bold,
    color: colors.foreground,
    marginBottom: spacing.sm,
  },
  smallBadge: {
    marginBottom: spacing.sm,
  },
  evidenceList: {
    marginTop: spacing.sm,
    gap: spacing.xs,
  },
  evidenceRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'flex-start',
  },
  bullet: {
    color: colors.primary,
    fontSize: fontSize.base,
    lineHeight: 22,
  },
  evidenceText: {
    flex: 1,
    color: colors.foreground,
    fontSize: fontSize.sm,
    lineHeight: 20,
  },

  // ── Confidence bars ──────────────────────────────────────────────────────────
  barsSection: {
    marginTop: spacing.md,
    gap: spacing.sm,
  },
  barsSectionTitle: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    color: colors.mutedForeground,
    marginBottom: spacing.xs,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  barRow: {
    gap: spacing.xs,
  },
  barLabel: {
    fontSize: fontSize.sm,
    color: colors.foreground,
    marginBottom: 2,
  },
  barTrack: {
    height: 6,
    backgroundColor: colors.muted,
    borderRadius: radius.full,
    overflow: 'hidden',
  },
  barFill: {
    height: 6,
    backgroundColor: colors.primary,
    borderRadius: radius.full,
  },
  barPct: {
    fontSize: fontSize.xs,
    color: colors.mutedForeground,
    marginTop: 2,
  },

  // ── Stat grid ────────────────────────────────────────────────────────────────
  statGrid: {
    flexDirection: 'row',
  },
  statCell: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  statCellBordered: {
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: colors.border,
  },
  statValue: {
    fontSize: fontSize.xl,
    fontWeight: fontWeight.bold,
    color: colors.foreground,
  },
  statLabel: {
    fontSize: fontSize.xs,
    color: colors.mutedForeground,
    marginTop: spacing.xs,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },

  // ── Accessories ──────────────────────────────────────────────────────────────
  accessoryItem: {
    paddingVertical: spacing.sm,
    gap: spacing.xs,
  },
  accessoryDivider: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    marginBottom: spacing.xs,
  },
  accessoryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  accessoryName: {
    fontSize: fontSize.base,
    fontWeight: fontWeight.bold,
    color: colors.foreground,
    flex: 1,
  },
  priorityBadge: {
    flexShrink: 0,
  },
  accessoryBadgeRow: {
    flexDirection: 'row',
    gap: spacing.xs,
    flexWrap: 'wrap',
  },
  accessoryWhy: {
    fontSize: fontSize.sm,
    color: colors.mutedForeground,
    lineHeight: 20,
    marginTop: spacing.xs,
  },

  // ── CTA ──────────────────────────────────────────────────────────────────────
  ctaCard: {
    borderColor: 'rgba(99,102,241,0.30)',
  },
  ctaHeader: {
    alignItems: 'center',
  },
  ctaTitle: {
    textAlign: 'center',
    fontSize: fontSize.xl,
  },
  ctaContent: {
    alignItems: 'center',
    gap: spacing.md,
  },
  ctaSubtitle: {
    fontSize: fontSize.sm,
    color: colors.mutedForeground,
    textAlign: 'center',
    lineHeight: 20,
  },
  ctaButton: {
    marginTop: spacing.xs,
  },

  bottomSpacer: {
    height: spacing.xl,
  },
});
