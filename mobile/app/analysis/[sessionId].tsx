import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Share } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { StrengthRadar } from '@/components/plan/StrengthRadar';
import { PhaseBreakdown } from '@/components/plan/PhaseBreakdown';
import { HypothesisRankings } from '@/components/plan/HypothesisRankings';
import { liftCoachApi, SessionDetails, WorkoutPlan } from '@/lib/api';
import { colors, fontSize, fontWeight, spacing, radius } from '@/constants/theme';

function formatLiftName(id: string): string {
  return id.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function AnalysisDetailScreen() {
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>();
  const router = useRouter();
  const [session, setSession] = useState<SessionDetails | null>(null);
  const [plan, setPlan] = useState<WorkoutPlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionId) return;
    loadSession();
  }, [sessionId]);

  async function loadSession() {
    setLoading(true);
    setError(null);
    try {
      const data = await liftCoachApi.getSession(sessionId!);
      setSession(data);

      try {
        const planData = await liftCoachApi.getCachedPlan(sessionId!);
        setPlan(planData.plan);
      } catch {}
    } catch (err: any) {
      setError(err.message || 'Failed to load session.');
    } finally {
      setLoading(false);
    }
  }

  async function handleShare() {
    if (!session) return;
    const text = [
      `Axiom Analysis - ${formatLiftName(session.selectedLift)}`,
      `Date: ${formatDate(session.createdAt)}`,
      session.diagnosis ? `Limiting Factor: ${session.diagnosis.primaryLimiter}` : '',
      session.diagnosis?.reasoning ? `Reasoning: ${session.diagnosis.reasoning}` : '',
    ].filter(Boolean).join('\n');
    await Share.share({ message: text });
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.navbar}>
          <TouchableOpacity onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={24} color={colors.foreground} />
          </TouchableOpacity>
          <Text style={styles.navTitle}>Analysis</Text>
          <View style={{ width: 24 }} />
        </View>
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingText}>Loading analysis...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (error || !session) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.navbar}>
          <TouchableOpacity onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={24} color={colors.foreground} />
          </TouchableOpacity>
          <Text style={styles.navTitle}>Analysis</Text>
          <View style={{ width: 24 }} />
        </View>
        <View style={styles.center}>
          <Ionicons name="alert-circle" size={48} color={colors.destructive} />
          <Text style={styles.errorTitle}>Failed to Load</Text>
          <Text style={styles.errorText}>{error || 'Session not found.'}</Text>
          <Button onPress={loadSession} style={{ marginTop: 16 }}>Retry</Button>
        </View>
      </SafeAreaView>
    );
  }

  const liftName = formatLiftName(session.selectedLift);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.navbar}>
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={styles.navTitle} numberOfLines={1}>{liftName}</Text>
        <TouchableOpacity onPress={handleShare}>
          <Ionicons name="share-outline" size={22} color={colors.foreground} />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Card style={styles.headerCard}>
          <View style={styles.headerRow}>
            <View style={styles.headerIcon}>
              <Ionicons name="barbell" size={20} color={colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.headerTitle}>{liftName}</Text>
              <Text style={styles.headerDate}>{formatDate(session.createdAt)}</Text>
            </View>
            <Badge variant={session.status === 'completed' ? 'default' : 'secondary'}>
              {session.status === 'completed' ? 'Complete' : 'In Progress'}
            </Badge>
          </View>
        </Card>

        {session.diagnosis && (
          <Card style={{ marginBottom: 16 }}>
            <View style={styles.sectionHeader}>
              <Ionicons name="search" size={18} color={colors.primary} />
              <Text style={styles.sectionTitle}>Diagnosis</Text>
            </View>

            <View style={styles.diagnosisBox}>
              <Text style={styles.diagnosisLabel}>Primary Limiting Factor</Text>
              <Text style={styles.diagnosisValue}>{session.diagnosis.primaryLimiter}</Text>
              {session.diagnosis.muscleGroup && (
                <Badge variant="secondary" style={{ marginTop: 6 }}>
                  {session.diagnosis.muscleGroup}
                </Badge>
              )}
            </View>

            {session.diagnosis.reasoning && (
              <View style={styles.reasoningBox}>
                <Text style={styles.reasoningLabel}>Reasoning</Text>
                <Text style={styles.reasoningText}>{session.diagnosis.reasoning}</Text>
              </View>
            )}
          </Card>
        )}

        {session.snapshots && session.snapshots.length > 0 && (
          <Card style={{ marginBottom: 16 }}>
            <View style={styles.sectionHeader}>
              <Ionicons name="list" size={18} color={colors.primary} />
              <Text style={styles.sectionTitle}>Strength Snapshot</Text>
            </View>
            <Text style={styles.sectionSubtitle}>{session.snapshots.length} exercises recorded</Text>

            {session.snapshots.map((snap, idx) => (
              <View key={snap.id || idx} style={styles.snapRow}>
                <Text style={styles.snapExercise}>
                  {snap.exerciseId.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')}
                </Text>
                <View style={styles.snapStats}>
                  <Badge variant="outline">{`${snap.weight} ${snap.weightUnit}`}</Badge>
                  <Badge variant="outline">{`${snap.reps} reps`}</Badge>
                  {snap.rpe && <Badge variant="outline">{`RPE ${snap.rpe}`}</Badge>}
                  {snap.estimatedOneRepMax && (
                    <Badge variant="secondary">{`E1RM: ${Math.round(snap.estimatedOneRepMax)}`}</Badge>
                  )}
                </View>
              </View>
            ))}
          </Card>
        )}

        {plan && plan.diagnostic_signals && Object.keys(plan.diagnostic_signals.indices).length > 0 && (
          <Card style={{ marginBottom: 16 }}>
            <View style={styles.sectionHeader}>
              <Ionicons name="pulse" size={18} color={colors.primary} />
              <Text style={styles.sectionTitle}>Strength Profile</Text>
            </View>
            <StrengthRadar signals={plan.diagnostic_signals} liftId={session.selectedLift} />
          </Card>
        )}

        {plan && plan.diagnostic_signals && (
          <Card style={{ marginBottom: 16 }}>
            <View style={styles.sectionHeader}>
              <Ionicons name="bar-chart" size={18} color={colors.primary} />
              <Text style={styles.sectionTitle}>Phase Breakdown</Text>
            </View>
            <PhaseBreakdown
              phaseScores={plan.diagnostic_signals.phase_scores}
              primaryPhase={plan.diagnostic_signals.primary_phase}
              primaryPhaseConfidence={plan.diagnostic_signals.primary_phase_confidence}
              liftId={session.selectedLift}
            />
          </Card>
        )}

        {plan && plan.diagnostic_signals && plan.diagnostic_signals.hypothesis_scores.length > 0 && (
          <Card style={{ marginBottom: 16 }}>
            <View style={styles.sectionHeader}>
              <Ionicons name="flash" size={18} color={colors.primary} />
              <Text style={styles.sectionTitle}>Hypothesis Rankings</Text>
            </View>
            <HypothesisRankings hypotheses={plan.diagnostic_signals.hypothesis_scores} />
          </Card>
        )}

        {plan && plan.bench_day_plan && (
          <Card style={{ marginBottom: 16 }}>
            <View style={styles.sectionHeader}>
              <Ionicons name="shield" size={18} color={colors.primary} />
              <Text style={styles.sectionTitle}>Prescribed Plan</Text>
            </View>

            <View style={styles.primaryLiftBox}>
              <Text style={styles.primaryLiftLabel}>Primary Lift</Text>
              <Text style={styles.primaryLiftName}>{plan.bench_day_plan.primary_lift.exercise_name}</Text>
              <View style={styles.badgeRow}>
                <Badge variant="secondary">
                  {`${plan.bench_day_plan.primary_lift.sets} x ${plan.bench_day_plan.primary_lift.reps}`}
                </Badge>
                <Badge variant="outline">{plan.bench_day_plan.primary_lift.intensity}</Badge>
              </View>
            </View>

            <Text style={[styles.sectionSubtitle, { marginTop: 16 }]}>
              Accessories ({plan.bench_day_plan.accessories.length})
            </Text>

            {plan.bench_day_plan.accessories
              .sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99))
              .map((acc, idx) => (
                <View key={acc.exercise_id || idx} style={styles.accessoryItem}>
                  <View style={styles.accessoryHeader}>
                    <Text style={styles.accessoryName}>{acc.exercise_name}</Text>
                    <Badge variant="outline">{`${acc.sets}x${acc.reps}`}</Badge>
                  </View>
                  <Text style={styles.accessoryWhy}>{acc.why}</Text>
                  <View style={styles.badgeRow}>
                    <Badge variant="secondary">{acc.category}</Badge>
                    {acc.impact && <Badge variant="outline">{acc.impact}</Badge>}
                  </View>
                </View>
              ))}
          </Card>
        )}

        {session.messages && session.messages.length > 0 && (
          <Card style={{ marginBottom: 32 }}>
            <View style={styles.sectionHeader}>
              <Ionicons name="chatbubbles" size={18} color={colors.primary} />
              <Text style={styles.sectionTitle}>Diagnostic Chat</Text>
            </View>
            <Text style={styles.sectionSubtitle}>{session.messages.length} messages</Text>

            {session.messages.map((msg, idx) => (
              <View
                key={idx}
                style={[styles.messageItem, msg.role === 'user' && styles.messageItemUser]}
              >
                <View style={styles.messageRoleBadge}>
                  <Ionicons
                    name={msg.role === 'user' ? 'person' : 'hardware-chip'}
                    size={12}
                    color={msg.role === 'user' ? colors.primary : colors.mutedForeground}
                  />
                  <Text style={styles.messageRoleText}>
                    {msg.role === 'user' ? 'You' : 'AI'}
                  </Text>
                </View>
                <Text style={styles.messageContent}>{msg.content}</Text>
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
  navTitle: { color: colors.foreground, fontSize: fontSize.lg, fontWeight: fontWeight.semibold, flex: 1, textAlign: 'center', marginHorizontal: 12 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  loadingText: { color: colors.mutedForeground, fontSize: fontSize.sm, marginTop: 12 },
  errorTitle: { color: colors.foreground, fontSize: fontSize.lg, fontWeight: fontWeight.semibold, marginTop: 12 },
  errorText: { color: colors.mutedForeground, fontSize: fontSize.sm, marginTop: 4, textAlign: 'center' },
  scrollContent: { padding: spacing.lg },
  headerCard: { marginBottom: 16 },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  headerIcon: {
    width: 44, height: 44, borderRadius: radius.md,
    backgroundColor: colors.primary + '15', alignItems: 'center', justifyContent: 'center',
  },
  headerTitle: { color: colors.foreground, fontSize: fontSize.lg, fontWeight: fontWeight.bold },
  headerDate: { color: colors.mutedForeground, fontSize: fontSize.xs, marginTop: 2 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  sectionTitle: { color: colors.foreground, fontSize: fontSize.base, fontWeight: fontWeight.semibold },
  sectionSubtitle: { color: colors.mutedForeground, fontSize: fontSize.sm, marginBottom: 12 },
  diagnosisBox: {
    backgroundColor: colors.primary + '10', borderWidth: 1, borderColor: colors.primary + '30',
    borderRadius: radius.lg, padding: 14, marginBottom: 12,
  },
  diagnosisLabel: { color: colors.mutedForeground, fontSize: fontSize.xs, fontWeight: fontWeight.semibold, marginBottom: 4 },
  diagnosisValue: { color: colors.foreground, fontSize: fontSize.lg, fontWeight: fontWeight.bold },
  reasoningBox: {
    backgroundColor: colors.secondary, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.lg, padding: 14,
  },
  reasoningLabel: { color: colors.mutedForeground, fontSize: fontSize.xs, fontWeight: fontWeight.semibold, marginBottom: 4 },
  reasoningText: { color: colors.foreground, fontSize: fontSize.sm, lineHeight: 20 },
  snapRow: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    padding: 12, marginBottom: 8, backgroundColor: colors.secondary,
  },
  snapExercise: { color: colors.foreground, fontSize: fontSize.sm, fontWeight: fontWeight.semibold, marginBottom: 6 },
  snapStats: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  primaryLiftBox: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg,
    padding: 14, backgroundColor: colors.secondary,
  },
  primaryLiftLabel: { color: colors.mutedForeground, fontSize: fontSize.xs, fontWeight: fontWeight.semibold, marginBottom: 4 },
  primaryLiftName: { color: colors.foreground, fontSize: fontSize.base, fontWeight: fontWeight.bold, marginBottom: 8 },
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  accessoryItem: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    padding: 12, marginBottom: 8, backgroundColor: colors.secondary,
  },
  accessoryHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  accessoryName: { color: colors.foreground, fontSize: fontSize.sm, fontWeight: fontWeight.semibold, flex: 1 },
  accessoryWhy: { color: colors.mutedForeground, fontSize: fontSize.xs, lineHeight: 16, marginBottom: 8 },
  messageItem: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    padding: 12, marginBottom: 8, backgroundColor: colors.secondary,
  },
  messageItemUser: { backgroundColor: colors.primary + '08', borderColor: colors.primary + '20' },
  messageRoleBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 4 },
  messageRoleText: { color: colors.mutedForeground, fontSize: fontSize.xs, fontWeight: fontWeight.semibold },
  messageContent: { color: colors.foreground, fontSize: fontSize.sm, lineHeight: 20 },
});
