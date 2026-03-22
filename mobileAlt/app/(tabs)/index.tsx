import React, { useEffect, useState, useMemo } from 'react';
import {
  View, Text, ScrollView, StyleSheet, Pressable, TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../src/context/AuthContext';
import { liftCoachApi, coachApi } from '../../src/lib/api';
import { Card } from '../../src/components/ui/Card';
import { Badge } from '../../src/components/ui/Badge';
import { AxiomLogo } from '../../src/components/ui/AxiomLogo';
import { colors, fontSize, fontWeight, radius, spacing } from '../../src/constants/theme';

const LIFT_NAMES: Record<string, string> = {
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

function toLiftName(key: string): string {
  return LIFT_NAMES[key] ?? key.split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

const GREETINGS: Array<{ title: string; subtitle: string }> = [
  { title: 'Good work,', subtitle: 'Ready for your next session?' },
  { title: 'Welcome back,', subtitle: 'Your AI coach is ready.' },
  { title: "Let's get after it,", subtitle: 'Time to find your limiters.' },
  { title: 'Stay consistent,', subtitle: 'Every session counts.' },
  { title: 'Keep pushing,', subtitle: "What are we working on today?" },
  { title: 'Good to see you,', subtitle: 'Progress is progress.' },
  { title: 'One rep at a time,', subtitle: 'Your strength is building.' },
  { title: 'Show up again,', subtitle: "That's how champions are made." },
];

const FEATURES = [
  { icon: 'analytics-outline' as const, title: 'AI Diagnosis', description: 'Identify your exact strength limiters' },
  { icon: 'body-outline' as const, title: 'Strength Profile', description: 'Understand your muscle balance' },
  { icon: 'barbell-outline' as const, title: 'Smart Accessories', description: 'Targeted exercises for your limiters' },
  { icon: 'chatbubbles-outline' as const, title: 'AI Coach', description: 'Your personal AI strength coach' },
];

interface Session {
  id: string;
  selectedLift: string;
  status?: string;
  primaryLimiter?: string;
  confidence?: number;
  createdAt?: string;
}

function SessionCard({ session }: { session: Session }) {
  const router = useRouter();
  const isCompleted = session.status === 'completed' || Boolean(session.primaryLimiter);

  return (
    <Pressable
      onPress={() => router.push(isCompleted ? `/diagnostic/plan?sessionId=${session.id}` : `/diagnostic/chat?sessionId=${session.id}`)}
      style={({ pressed }) => [{ opacity: pressed ? 0.75 : 1 }]}
    >
      <View style={styles.sessionCard}>
        <View style={styles.sessionCardInner}>
          <View style={styles.sessionRow}>
            <Text style={styles.liftName}>{toLiftName(session.selectedLift)}</Text>
            {session.createdAt && <Text style={styles.sessionDate}>{formatDate(session.createdAt)}</Text>}
          </View>
          {session.primaryLimiter && (
            <Text style={styles.sessionLimiter} numberOfLines={2}>{session.primaryLimiter}</Text>
          )}
          <View style={styles.sessionRow}>
            {session.confidence != null && (
              <Badge variant="secondary">{Math.round(session.confidence)}% confidence</Badge>
            )}
            <Badge variant={isCompleted ? 'success' : 'warning'}>
              {isCompleted ? 'Completed' : 'In Progress'}
            </Badge>
          </View>
        </View>
      </View>
    </Pressable>
  );
}

export default function HomeScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [strengthProfile, setStrengthProfile] = useState<any>(null);
  const [welcomeMessage, setWelcomeMessage] = useState<string | null>(null);

  const greeting = useMemo(
    () => GREETINGS[Math.floor(Math.random() * GREETINGS.length)],
    [],
  );

  useEffect(() => {
    liftCoachApi.getSessionHistory()
      .then((data) => setSessions(Array.isArray(data) ? data : data.sessions ?? []))
      .catch(() => setSessions([]))
      .finally(() => setSessionsLoading(false));
    coachApi.getStrengthProfile()
      .then((data) => setStrengthProfile(data))
      .catch(() => {});
    coachApi.getWelcomeMessage()
      .then((data) => setWelcomeMessage(data.message ?? null))
      .catch(() => {});
  }, []);

  function dismissWelcome() {
    setWelcomeMessage(null);
    coachApi.dismissWelcomeMessage().catch(() => {});
  }

  const recentSession = sessions[0] ?? null;
  const isPro = user?.tier === 'pro' || user?.tier === 'enterprise';

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Top bar ── */}
        <View style={styles.topBar}>
          <AxiomLogo size={32} />
          <Badge variant={isPro ? 'pro' : 'secondary'}>{isPro ? 'Pro' : 'Free'}</Badge>
        </View>

        {/* ── Greeting ── */}
        <View style={styles.greetingSection}>
          <Text style={styles.greetingTitle}>
            {greeting.title}{'\n'}<Text style={styles.greetingName}>{user?.name ?? 'Athlete'}</Text>.
          </Text>
          <Text style={styles.greetingSubtitle}>{greeting.subtitle}</Text>
        </View>

        {/* ── Anakin Welcome Message ── */}
        {welcomeMessage && (
          <View style={styles.welcomeCard}>
            <View style={styles.welcomeHeader}>
              <View style={styles.welcomeAvatarRow}>
                <View style={styles.welcomeAvatar}>
                  <Ionicons name="sparkles" size={14} color={colors.primaryForeground} />
                </View>
                <Text style={styles.welcomeFrom}>Anakin</Text>
              </View>
              <TouchableOpacity onPress={dismissWelcome} hitSlop={12}>
                <Ionicons name="close" size={18} color={colors.mutedForeground} />
              </TouchableOpacity>
            </View>
            <Text style={styles.welcomeText}>{welcomeMessage}</Text>
          </View>
        )}

        {/* ── Quick Actions ── */}
        <View style={styles.quickActions}>
          <TouchableOpacity
            style={styles.ctaCard}
            activeOpacity={0.82}
            onPress={() => router.push('/diagnostic/onboarding')}
          >
            <View style={styles.ctaIconBox}>
              <Ionicons name="barbell-outline" size={20} color={colors.primaryForeground} />
            </View>
            <View style={styles.ctaText}>
              <Text style={styles.ctaTitle}>New Analysis</Text>
              <Text style={styles.ctaDescription}>Find your limiters</Text>
            </View>
            <Ionicons name="arrow-forward" size={16} color={colors.primaryForeground} />
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.coachCard}
            activeOpacity={0.82}
            onPress={() => router.push('/(tabs)/coach')}
          >
            <View style={styles.coachIconBox}>
              <Ionicons name="sparkles" size={20} color={colors.foreground} />
            </View>
            <View style={styles.ctaText}>
              <Text style={styles.coachTitle}>Talk to Anakin</Text>
              <Text style={styles.coachDescription}>Your AI coach</Text>
            </View>
            <Ionicons name="arrow-forward" size={16} color={colors.foreground} />
          </TouchableOpacity>
        </View>

        {/* ── Features ── */}
        <Text style={styles.sectionTitle}>What Axiom does</Text>
        <View style={styles.featuresGrid}>
          {FEATURES.map((feat) => (
            <View key={feat.title} style={styles.featureCard}>
              <View style={styles.featureIconBox}>
                <Ionicons name={feat.icon} size={18} color={colors.foreground} />
              </View>
              <Text style={styles.featureTitle}>{feat.title}</Text>
              <Text style={styles.featureDescription}>{feat.description}</Text>
            </View>
          ))}
        </View>

        {/* ── Strength Profile ── */}
        {strengthProfile && (strengthProfile.indices || strengthProfile.dominanceArchetype) && (
          <>
            <Text style={styles.sectionTitle}>Strength Profile</Text>
            <Card>
              <View style={styles.spCard}>
                {strengthProfile.dominanceArchetype && (
                  <View style={styles.spArchetypeRow}>
                    <Ionicons name="body-outline" size={16} color={colors.foreground} />
                    <Text style={styles.spArchetype}>{strengthProfile.dominanceArchetype}</Text>
                    {strengthProfile.efficiencyScore != null && (
                      <View style={styles.spScoreBadge}>
                        <Text style={styles.spScoreText}>{strengthProfile.efficiencyScore}</Text>
                      </View>
                    )}
                  </View>
                )}
                {strengthProfile.indices && (
                  <View style={styles.spIndices}>
                    {Object.entries(strengthProfile.indices as Record<string, number>).map(([key, val]) => (
                      <View key={key} style={styles.spIndexRow}>
                        <Text style={styles.spIndexLabel}>
                          {key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
                        </Text>
                        <View style={styles.spIndexTrack}>
                          <View style={[styles.spIndexBar, { width: `${Math.min(val, 100)}%` as any }]} />
                        </View>
                        <Text style={styles.spIndexVal}>{Math.round(val)}</Text>
                      </View>
                    ))}
                  </View>
                )}
              </View>
            </Card>
          </>
        )}

        {/* ── Recent Session ── */}
        <Text style={styles.sectionTitle}>Recent Session</Text>
        {sessionsLoading ? (
          <Text style={styles.mutedText}>Loading…</Text>
        ) : recentSession ? (
          <SessionCard session={recentSession} />
        ) : (
          <View style={styles.emptyCard}>
            <Ionicons name="barbell-outline" size={32} color={colors.mutedForeground} />
            <Text style={styles.emptyText}>No sessions yet. Start your first analysis!</Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  scroll: { flex: 1 },
  scrollContent: { padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.lg },

  // Top bar
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },

  // Greeting
  greetingSection: { gap: 4, marginTop: spacing.sm },
  greetingTitle: {
    fontSize: 32,
    fontWeight: fontWeight.bold,
    color: colors.foreground,
    letterSpacing: -0.8,
    lineHeight: 38,
  },
  greetingName: { color: colors.foreground },
  greetingSubtitle: { fontSize: fontSize.base, color: colors.mutedForeground },

  // Quick actions row
  quickActions: { gap: spacing.sm },

  // Primary CTA card (black)
  ctaCard: {
    backgroundColor: colors.foreground,
    borderRadius: radius.lg,
    padding: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  ctaIconBox: {
    width: 40,
    height: 40,
    borderRadius: radius.sm,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaText: { flex: 1 },
  ctaTitle: { fontSize: fontSize.base, fontWeight: fontWeight.semibold, color: colors.primaryForeground },
  ctaDescription: { fontSize: fontSize.sm, color: 'rgba(255,255,255,0.6)', marginTop: 2 },

  // Coach CTA card (muted)
  coachCard: {
    backgroundColor: colors.muted,
    borderRadius: radius.lg,
    padding: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  coachIconBox: {
    width: 40,
    height: 40,
    borderRadius: radius.sm,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  coachTitle: { fontSize: fontSize.base, fontWeight: fontWeight.semibold, color: colors.foreground },
  coachDescription: { fontSize: fontSize.sm, color: colors.mutedForeground, marginTop: 2 },

  // Section title
  sectionTitle: {
    fontSize: fontSize.base,
    fontWeight: fontWeight.semibold,
    color: colors.foreground,
  },

  // Features grid
  featuresGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  featureCard: {
    width: '48%',
    backgroundColor: colors.muted,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: 6,
  },
  featureIconBox: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  featureTitle: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.foreground },
  featureDescription: { fontSize: 12, color: colors.mutedForeground, lineHeight: 17 },

  // Session card
  sessionCard: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    overflow: 'hidden',
    backgroundColor: colors.background,
  },
  sessionCardInner: { padding: spacing.md, gap: 8 },
  sessionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    flexWrap: 'wrap',
  },
  liftName: { fontSize: fontSize.base, fontWeight: fontWeight.semibold, color: colors.foreground, flex: 1 },
  sessionDate: { fontSize: fontSize.xs, color: colors.mutedForeground },
  sessionLimiter: { fontSize: fontSize.sm, color: colors.mutedForeground, lineHeight: 19 },

  // Empty
  emptyCard: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.xl,
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.muted,
  },
  emptyText: { fontSize: fontSize.sm, color: colors.mutedForeground, textAlign: 'center' },
  mutedText: { fontSize: fontSize.sm, color: colors.mutedForeground },

  // Welcome card
  welcomeCard: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.md,
    backgroundColor: colors.card,
    gap: spacing.sm,
  },
  welcomeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  welcomeAvatarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  welcomeAvatar: {
    width: 26,
    height: 26,
    borderRadius: radius.full,
    backgroundColor: colors.foreground,
    alignItems: 'center',
    justifyContent: 'center',
  },
  welcomeFrom: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    color: colors.foreground,
  },
  welcomeText: {
    fontSize: fontSize.sm,
    color: colors.foreground,
    lineHeight: 21,
  },

  // Strength profile card
  spCard: { padding: spacing.md, gap: spacing.sm },
  spArchetypeRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginBottom: 4 },
  spArchetype: { flex: 1, fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.foreground },
  spScoreBadge: {
    backgroundColor: colors.foreground, borderRadius: radius.full,
    paddingHorizontal: 8, paddingVertical: 2,
  },
  spScoreText: { fontSize: fontSize.xs, fontWeight: fontWeight.bold, color: colors.primaryForeground },
  spIndices: { gap: 6 },
  spIndexRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  spIndexLabel: { fontSize: fontSize.xs, color: colors.mutedForeground, width: 110 },
  spIndexTrack: {
    flex: 1, height: 5, borderRadius: radius.full,
    backgroundColor: colors.muted, overflow: 'hidden',
  },
  spIndexBar: { height: '100%', borderRadius: radius.full, backgroundColor: colors.foreground },
  spIndexVal: { fontSize: fontSize.xs, fontWeight: fontWeight.semibold, color: colors.foreground, width: 24, textAlign: 'right' },
});
