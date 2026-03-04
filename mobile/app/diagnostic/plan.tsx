import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Alert, Share } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { StrengthRadar } from '@/components/plan/StrengthRadar';
import { PhaseBreakdown } from '@/components/plan/PhaseBreakdown';
import { HypothesisRankings } from '@/components/plan/HypothesisRankings';
import { liftCoachApi, WorkoutPlan, storage } from '@/lib/api';
import { colors, fontSize, fontWeight, spacing, radius } from '@/constants/theme';

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  );
}

function formatLiftName(id: string): string {
  return id.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

export default function PlanScreen() {
  const router = useRouter();
  const [plan, setPlan] = useState<WorkoutPlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedLift, setSelectedLift] = useState('');

  useEffect(() => {
    loadPlan();
  }, []);

  async function loadPlan() {
    const sessionId = await storage.get('liftoff_session_id');
    const lift = await storage.get('liftoff_selected_lift');
    if (lift) setSelectedLift(lift);

    if (!sessionId) {
      setError('No session found.');
      router.replace('/diagnostic/onboarding');
      return;
    }

    const cacheKey = `liftoff_plan_${sessionId}`;
    const cached = await storage.get(cacheKey);
    if (cached) {
      try {
        setPlan(JSON.parse(cached));
        setLoading(false);
        return;
      } catch {
        await storage.remove(cacheKey);
      }
    }

    setLoading(true);
    try {
      try {
        const cachedPlan = await liftCoachApi.getCachedPlan(sessionId);
        setPlan(cachedPlan.plan);
        await storage.set(cacheKey, JSON.stringify(cachedPlan.plan));
        return;
      } catch {}

      const response = await liftCoachApi.generatePlan(sessionId);
      setPlan(response.plan);
      await storage.set(cacheKey, JSON.stringify(response.plan));
    } catch (err: any) {
      if (err.status === 429) {
        setError('Rate limited. Please try again later or upgrade to Pro.');
      } else {
        setError('Failed to generate plan. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleShare() {
    if (!plan) return;
    const primary = plan.bench_day_plan?.primary_lift;
    const diag = plan.diagnosis?.[0];

    const text = [
      `Axiom - ${formatLiftName(selectedLift)} Plan`,
      '',
      `Diagnosis: ${diag?.limiterName || 'Unknown'}`,
      ...(diag?.evidence || []).map(e => `  - ${e}`),
      '',
      `Primary: ${primary?.exercise_name} ${primary?.sets}x${primary?.reps} @ ${primary?.intensity}`,
      '',
      'Accessories:',
      ...(plan.bench_day_plan?.accessories || []).map(a =>
        `  - ${a.exercise_name}: ${a.sets}x${a.reps} [${a.category}]`
      ),
    ].join('\n');

    await Share.share({ message: text });
  }

  async function startNewSession() {
    await storage.remove('liftoff_session_id');
    await storage.remove('liftoff_selected_lift');
    router.replace('/diagnostic/onboarding');
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.navbar}>
          <TouchableOpacity onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={24} color={colors.foreground} />
          </TouchableOpacity>
          <Text style={styles.navTitle}>Step 4 of 4</Text>
          <View style={{ width: 24 }} />
        </View>
        <View style={styles.loadingContainer}>
          <View style={styles.loadingIcon}>
            <ActivityIndicator size="large" color={colors.primary} />
          </View>
          <Text style={styles.loadingTitle}>Generating Your Personalized Plan</Text>
          <Text style={styles.loadingDescription}>
            Our AI is analyzing your lift mechanics, working weights, and diagnostic responses...
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  if (error || !plan) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.navbar}>
          <TouchableOpacity onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={24} color={colors.foreground} />
          </TouchableOpacity>
          <Text style={styles.navTitle}>Step 4 of 4</Text>
          <View style={{ width: 24 }} />
        </View>
        <View style={styles.loadingContainer}>
          <View style={[styles.loadingIcon, { backgroundColor: colors.red100 }]}>
            <Ionicons name="shield" size={32} color={colors.destructive} />
          </View>
          <Text style={styles.loadingTitle}>Failed to Generate Plan</Text>
          <Text style={styles.loadingDescription}>{error || 'Something went wrong.'}</Text>
          <View style={{ flexDirection: 'row', gap: 12, marginTop: 20 }}>
            <Button onPress={loadPlan}>Try Again</Button>
            <Button variant="secondary" onPress={startNewSession}>Start Over</Button>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  const primaryDiagnosis = plan.diagnosis[0];
  const primary = plan.bench_day_plan.primary_lift;
  const accessories = plan.bench_day_plan.accessories;

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.navbar}>
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={styles.navTitle}>Step 4 of 4</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Card style={styles.aiCard}>
          <View style={styles.aiCardRow}>
            <View style={styles.aiIcon}>
              <Ionicons name="sparkles" size={20} color={colors.primary} />
            </View>
            <View style={styles.aiCardContent}>
              <Text style={styles.aiCardTitle}>AI Analysis Complete</Text>
              <View style={styles.aiFactRow}>
                <Text style={styles.aiFactLabel}>Limiting factor: </Text>
                <Text style={styles.aiFactValue}>{primaryDiagnosis?.limiterName || 'Unknown'}</Text>
                {primaryDiagnosis?.confidence && (
                  <Badge variant="secondary" style={{ marginLeft: 8 }}>
                    {`${Math.round(primaryDiagnosis.confidence * 100)}% confidence`}
                  </Badge>
                )}
              </View>
              <Text style={styles.aiEvidence}>
                {primaryDiagnosis?.evidence?.[0] || 'Analysis based on your lift data and diagnostic responses.'}
              </Text>
            </View>
          </View>
        </Card>

        <View style={styles.actionRow}>
          <Button variant="outline" size="sm" onPress={handleShare}>
            Share
          </Button>
          <Button variant="secondary" size="sm" onPress={() => router.push('/(tabs)/history')}>
            History
          </Button>
          <Button size="sm" onPress={startNewSession}>
            New Session
          </Button>
        </View>

        <View style={styles.statsRow}>
          <Stat label="Limiter" value={primaryDiagnosis?.limiterName || 'Unknown'} />
          <Stat label="Confidence" value={primaryDiagnosis ? `${Math.round(primaryDiagnosis.confidence * 100)}%` : 'N/A'} />
          <Stat label="Accessories" value={`${accessories.length}`} />
        </View>

        <Card style={{ marginBottom: 16 }}>
          <Text style={styles.sectionTitle}>Diagnosis</Text>
          <Text style={styles.sectionSubtitle}>Identified weak points based on your data</Text>

          {plan.diagnosis.map((d, idx) => (
            <View key={idx} style={styles.diagnosisItem}>
              <View style={styles.diagnosisHeader}>
                <Text style={styles.diagnosisLimiter}>{d.limiterName}</Text>
                <Badge variant="outline">{`${Math.round(d.confidence * 100)}%`}</Badge>
              </View>
              {d.evidence.map((e, eIdx) => (
                <View key={eIdx} style={styles.evidenceRow}>
                  <Ionicons name="checkmark-circle" size={14} color={colors.primary} />
                  <Text style={styles.evidenceText}>{e}</Text>
                </View>
              ))}
            </View>
          ))}
        </Card>

        {plan.diagnostic_signals && Object.keys(plan.diagnostic_signals.indices).length > 0 && (
          <Card style={{ marginBottom: 16 }}>
            <View style={styles.vizHeader}>
              <Ionicons name="pulse" size={16} color={colors.primary} />
              <View>
                <Text style={styles.vizTitle}>Strength Profile</Text>
                <Text style={styles.vizSubtitle}>Muscle group indices (0-100)</Text>
              </View>
            </View>
            <StrengthRadar signals={plan.diagnostic_signals} liftId={plan.selected_lift} />
          </Card>
        )}

        {plan.diagnostic_signals && (
          <Card style={{ marginBottom: 16 }}>
            <View style={styles.vizHeader}>
              <Ionicons name="bar-chart" size={16} color={colors.primary} />
              <View>
                <Text style={styles.vizTitle}>Lift Phase Breakdown</Text>
                <Text style={styles.vizSubtitle}>Where the signal is strongest</Text>
              </View>
            </View>
            <PhaseBreakdown
              phaseScores={plan.diagnostic_signals.phase_scores}
              primaryPhase={plan.diagnostic_signals.primary_phase}
              primaryPhaseConfidence={plan.diagnostic_signals.primary_phase_confidence}
              liftId={plan.selected_lift}
            />
          </Card>
        )}

        {plan.diagnostic_signals && plan.diagnostic_signals.hypothesis_scores.length > 0 && (
          <Card style={{ marginBottom: 16 }}>
            <View style={styles.vizHeader}>
              <Ionicons name="flash" size={16} color={colors.primary} />
              <View>
                <Text style={styles.vizTitle}>Weakness Hypotheses</Text>
                <Text style={styles.vizSubtitle}>Ranked by diagnostic confidence</Text>
              </View>
            </View>
            <HypothesisRankings hypotheses={plan.diagnostic_signals.hypothesis_scores} />
          </Card>
        )}

        <Card style={{ marginBottom: 16 }}>
          <View style={styles.sectionHeader}>
            <Ionicons name="locate" size={18} color={colors.primary} />
            <Text style={styles.sectionTitle}>Primary Lift</Text>
          </View>

          <View style={styles.primaryLiftBox}>
            <Text style={styles.primaryLiftName}>{primary.exercise_name}</Text>
            <View style={styles.badgeRow}>
              <Badge variant="secondary">{`${primary.sets} x ${primary.reps}`}</Badge>
              <Badge variant="outline">{primary.intensity}</Badge>
              <Badge variant="outline">{`Rest ${primary.rest_minutes} min`}</Badge>
            </View>
          </View>
        </Card>

        <Card style={{ marginBottom: 16 }}>
          <View style={styles.sectionHeader}>
            <Ionicons name="shield" size={18} color={colors.primary} />
            <Text style={styles.sectionTitle}>Accessories</Text>
          </View>
          <Text style={styles.sectionSubtitle}>
            Ranked by impact — prioritize the top ones if short on time
          </Text>

          {[...accessories]
            .sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99))
            .map((a, idx) => {
              const isTopPick = a.priority === 1;
              return (
                <View
                  key={a.exercise_id || idx}
                  style={[styles.accessoryCard, isTopPick && styles.accessoryCardTop]}
                >
                  <View style={styles.accessoryHeader}>
                    <View style={styles.accessoryLeft}>
                      <View style={[styles.rankBadge, isTopPick && styles.rankBadgeTop]}>
                        <Text style={[styles.rankText, isTopPick && styles.rankTextTop]}>
                          {isTopPick ? '★' : `${idx + 1}`}
                        </Text>
                      </View>
                      <Text style={styles.accessoryName}>{a.exercise_name}</Text>
                      {isTopPick && (
                        <View style={styles.impactTag}>
                          <Text style={styles.impactTagText}>Most Impactful</Text>
                        </View>
                      )}
                    </View>
                    <Badge variant="secondary">{`${a.sets} x ${a.reps}`}</Badge>
                  </View>
                  <Text style={styles.accessoryWhy}>{a.why}</Text>
                  <View style={styles.accessoryCategoryRow}>
                    <Badge variant="outline">{a.category}</Badge>
                    {a.impact && (
                      <Badge
                        variant={a.impact === 'high' ? 'destructive' : 'secondary'}
                      >
                        {a.impact}
                      </Badge>
                    )}
                  </View>
                </View>
              );
            })}
        </Card>

        {plan.progression_rules.length > 0 && (
          <Card style={{ marginBottom: 16 }}>
            <View style={styles.sectionHeader}>
              <Ionicons name="trending-up" size={18} color={colors.primary} />
              <Text style={styles.sectionTitle}>Progression Rules</Text>
            </View>
            {plan.progression_rules.map((rule, idx) => (
              <View key={idx} style={styles.ruleRow}>
                <Ionicons name="checkmark-circle" size={14} color={colors.primary} />
                <Text style={styles.ruleText}>{rule}</Text>
              </View>
            ))}
          </Card>
        )}

        {plan.track_next_time.length > 0 && (
          <Card style={{ marginBottom: 32 }}>
            <View style={styles.sectionHeader}>
              <Ionicons name="eye" size={18} color={colors.primary} />
              <Text style={styles.sectionTitle}>Track Next Time</Text>
            </View>
            {plan.track_next_time.map((item, idx) => (
              <View key={idx} style={styles.ruleRow}>
                <Ionicons name="ellipse-outline" size={14} color={colors.mutedForeground} />
                <Text style={styles.ruleText}>{item}</Text>
              </View>
            ))}
          </Card>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  navbar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  navTitle: { color: colors.foreground, fontSize: fontSize.sm, fontWeight: fontWeight.semibold },
  scrollContent: { padding: spacing.lg },
  loadingContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  loadingIcon: {
    width: 64, height: 64, borderRadius: radius.lg,
    backgroundColor: colors.primary + '15', alignItems: 'center', justifyContent: 'center',
    marginBottom: 16,
  },
  loadingTitle: {
    color: colors.foreground, fontSize: fontSize.xl, fontWeight: fontWeight.semibold, textAlign: 'center',
  },
  loadingDescription: {
    color: colors.mutedForeground, fontSize: fontSize.sm, textAlign: 'center',
    marginTop: 8, lineHeight: 20, maxWidth: 300,
  },
  aiCard: {
    backgroundColor: colors.primary + '10', borderColor: colors.primary + '30', marginBottom: 16,
  },
  aiCardRow: { flexDirection: 'row', gap: 12 },
  aiIcon: {
    width: 40, height: 40, borderRadius: radius.md,
    backgroundColor: colors.primary + '15', alignItems: 'center', justifyContent: 'center',
  },
  aiCardContent: { flex: 1 },
  aiCardTitle: { color: colors.primary, fontSize: fontSize.lg, fontWeight: fontWeight.semibold, marginBottom: 8 },
  aiFactRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
  aiFactLabel: { color: colors.foreground, fontSize: fontSize.sm },
  aiFactValue: { color: colors.foreground, fontSize: fontSize.sm, fontWeight: fontWeight.bold },
  aiEvidence: { color: colors.mutedForeground, fontSize: fontSize.sm, marginTop: 6, lineHeight: 18 },
  actionRow: {
    flexDirection: 'row', gap: 8, marginBottom: 16, justifyContent: 'flex-end',
  },
  statsRow: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  stat: {
    flex: 1, backgroundColor: colors.secondary, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.lg, padding: 12,
  },
  statLabel: { color: colors.mutedForeground, fontSize: fontSize.xs, fontWeight: fontWeight.semibold },
  statValue: { color: colors.foreground, fontSize: fontSize.sm, fontWeight: fontWeight.semibold, marginTop: 4 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  sectionTitle: { color: colors.foreground, fontSize: fontSize.base, fontWeight: fontWeight.semibold },
  sectionSubtitle: { color: colors.mutedForeground, fontSize: fontSize.sm, marginBottom: 12 },
  diagnosisItem: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg,
    padding: 14, marginBottom: 8, backgroundColor: colors.secondary,
  },
  diagnosisHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  diagnosisLimiter: { color: colors.foreground, fontSize: fontSize.base, fontWeight: fontWeight.semibold },
  evidenceRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 6 },
  evidenceText: { color: colors.mutedForeground, fontSize: fontSize.sm, flex: 1, lineHeight: 18 },
  vizHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 16 },
  vizTitle: { color: colors.foreground, fontSize: fontSize.sm, fontWeight: fontWeight.semibold },
  vizSubtitle: { color: colors.mutedForeground, fontSize: fontSize.xs },
  primaryLiftBox: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg,
    padding: 14, backgroundColor: colors.secondary,
  },
  primaryLiftName: { color: colors.foreground, fontSize: fontSize.base, fontWeight: fontWeight.semibold, marginBottom: 8 },
  badgeRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  accessoryCard: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg,
    padding: 14, marginBottom: 10, backgroundColor: colors.secondary,
  },
  accessoryCardTop: {
    borderColor: colors.primary + '40', backgroundColor: colors.primary + '08',
  },
  accessoryHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: 8, flexWrap: 'wrap', gap: 6,
  },
  accessoryLeft: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
  rankBadge: {
    width: 24, height: 24, borderRadius: 12,
    backgroundColor: colors.primary + '15', alignItems: 'center', justifyContent: 'center',
  },
  rankBadgeTop: { backgroundColor: colors.primary },
  rankText: { color: colors.primary, fontSize: fontSize.xs, fontWeight: fontWeight.bold },
  rankTextTop: { color: colors.primaryForeground },
  accessoryName: { color: colors.foreground, fontSize: fontSize.base, fontWeight: fontWeight.semibold, flex: 1 },
  impactTag: {
    backgroundColor: colors.primary + '15', paddingHorizontal: 6, paddingVertical: 2, borderRadius: radius.full,
  },
  impactTagText: { color: colors.primary, fontSize: 10, fontWeight: fontWeight.semibold },
  accessoryWhy: { color: colors.mutedForeground, fontSize: fontSize.sm, lineHeight: 18, marginBottom: 8 },
  accessoryCategoryRow: { flexDirection: 'row', gap: 6 },
  ruleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 8 },
  ruleText: { color: colors.mutedForeground, fontSize: fontSize.sm, flex: 1, lineHeight: 18 },
});
