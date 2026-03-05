import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  Pressable,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../src/context/AuthContext';
import { liftCoachApi } from '../../src/lib/api';
import { Card, CardHeader, CardTitle, CardContent } from '../../src/components/ui/Card';
import { Button } from '../../src/components/ui/Button';
import { Badge } from '../../src/components/ui/Badge';
import { colors, fontSize, fontWeight, radius, spacing } from '../../src/constants/theme';

// ─── Lift name map ────────────────────────────────────────────────────────────

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
  return LIFT_NAMES[key] ?? key
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// ─── Feature card data ────────────────────────────────────────────────────────

const FEATURES = [
  {
    icon: 'analytics' as const,
    title: 'AI Diagnosis',
    description: 'Identify your exact strength limiters',
  },
  {
    icon: 'body' as const,
    title: 'Strength Profile',
    description: 'Understand your muscle balance',
  },
  {
    icon: 'barbell' as const,
    title: 'Smart Accessories',
    description: 'Targeted exercises for your limiters',
  },
  {
    icon: 'chatbubbles' as const,
    title: 'Anakin Coach',
    description: 'Your AI personal coach',
  },
];

// ─── SessionCard ──────────────────────────────────────────────────────────────

interface Session {
  id: string;
  selectedLift: string;
  status?: string;
  primaryLimiter?: string;
  confidence?: number;
  createdAt?: string;
  updatedAt?: string;
}

function SessionCard({ session }: { session: Session }) {
  const router = useRouter();
  const isCompleted =
    session.status === 'completed' || Boolean(session.primaryLimiter);

  function handlePress() {
    if (isCompleted) {
      router.push(`/diagnostic/plan?sessionId=${session.id}`);
    } else {
      router.push(`/diagnostic/chat?sessionId=${session.id}`);
    }
  }

  return (
    <Pressable onPress={handlePress} style={({ pressed }) => [{ opacity: pressed ? 0.75 : 1 }]}>
      <Card style={styles.sessionCard}>
        <View style={styles.sessionCardInner}>
          <View style={styles.sessionRow}>
            <Badge variant="default">
              {toLiftName(session.selectedLift)}
            </Badge>
            {session.createdAt && (
              <Text style={styles.sessionDate}>{formatDate(session.createdAt)}</Text>
            )}
          </View>

          {session.primaryLimiter && (
            <Text style={styles.sessionLimiter} numberOfLines={2}>
              {session.primaryLimiter}
            </Text>
          )}

          <View style={styles.sessionRow}>
            {session.confidence !== undefined && session.confidence !== null && (
              <Badge variant="secondary">{Math.round(session.confidence)}% confidence</Badge>
            )}
            <Badge variant={isCompleted ? 'success' : 'warning'}>
              {isCompleted ? 'Completed' : 'In Progress'}
            </Badge>
          </View>
        </View>
      </Card>
    </Pressable>
  );
}

// ─── Home Screen ──────────────────────────────────────────────────────────────

export default function HomeScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);

  useEffect(() => {
    async function loadSessions() {
      try {
        const data = await liftCoachApi.getSessionHistory();
        setSessions(Array.isArray(data) ? data : data.sessions ?? []);
      } catch {
        setSessions([]);
      } finally {
        setSessionsLoading(false);
      }
    }
    loadSessions();
  }, []);

  const recentSession: Session | null = sessions.length > 0 ? sessions[0] : null;
  const isPro = user?.tier === 'pro' || user?.tier === 'enterprise';

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Greeting ── */}
        <Card style={styles.greetingCard}>
          <View style={styles.greetingInner}>
            <View style={styles.greetingText}>
              <Text style={styles.greetingTitle}>
                Welcome back,{' '}
                <Text style={styles.greetingName}>
                  {user?.name ?? 'Athlete'}
                </Text>
                !
              </Text>
              <Text style={styles.greetingSubtitle}>
                Ready to crush your next session?
              </Text>
            </View>
            <Badge variant={isPro ? 'pro' : 'secondary'}>
              {isPro ? 'Pro' : 'Free'}
            </Badge>
          </View>
        </Card>

        {/* ── CTA ── */}
        <Card style={styles.ctaCard}>
          <View style={styles.ctaInner}>
            <View style={styles.ctaIconWrap}>
              <Ionicons name="barbell-outline" size={32} color={colors.primary} />
            </View>
            <Text style={styles.ctaTitle}>Start New Analysis</Text>
            <Text style={styles.ctaDescription}>
              Get AI-powered diagnosis of your strength limiters
            </Text>
            <Button
              onPress={() => router.push('/diagnostic/onboarding')}
              fullWidth
              style={styles.ctaButton}
            >
              Begin Analysis
            </Button>
          </View>
        </Card>

        {/* ── Features ── */}
        <Text style={styles.sectionTitle}>Features</Text>
        <View style={styles.featuresGrid}>
          {FEATURES.map((feat) => (
            <Card key={feat.title} style={styles.featureCard}>
              <View style={styles.featureInner}>
                <View style={styles.featureIconCircle}>
                  <Ionicons name={feat.icon} size={20} color={colors.primary} />
                </View>
                <Text style={styles.featureTitle}>{feat.title}</Text>
                <Text style={styles.featureDescription}>{feat.description}</Text>
              </View>
            </Card>
          ))}
        </View>

        {/* ── Recent Session ── */}
        <Text style={styles.sectionTitle}>Recent Session</Text>
        {sessionsLoading ? (
          <Text style={styles.mutedText}>Loading…</Text>
        ) : recentSession ? (
          <SessionCard session={recentSession} />
        ) : (
          <Card style={styles.emptyCard}>
            <View style={styles.emptyInner}>
              <Ionicons name="barbell-outline" size={36} color={colors.mutedForeground} />
              <Text style={styles.emptyText}>
                No sessions yet. Start your first analysis!
              </Text>
              <Button
                onPress={() => router.push('/diagnostic/onboarding')}
                variant="outline"
                size="sm"
              >
                Start Analysis
              </Button>
            </View>
          </Card>
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
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: spacing.md,
    paddingBottom: spacing.xxl,
    gap: 12,
  },

  // Greeting
  greetingCard: {
    padding: spacing.md,
  },
  greetingInner: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  greetingText: {
    flex: 1,
    marginRight: spacing.sm,
  },
  greetingTitle: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.bold,
    color: colors.foreground,
    marginBottom: 4,
  },
  greetingName: {
    color: colors.primary,
  },
  greetingSubtitle: {
    fontSize: fontSize.sm,
    color: colors.mutedForeground,
  },

  // CTA
  ctaCard: {
    padding: spacing.md,
  },
  ctaInner: {
    alignItems: 'center',
    gap: 10,
  },
  ctaIconWrap: {
    width: 64,
    height: 64,
    borderRadius: radius.full,
    backgroundColor: colors.muted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaTitle: {
    fontSize: fontSize.xl,
    fontWeight: fontWeight.bold,
    color: colors.foreground,
    textAlign: 'center',
  },
  ctaDescription: {
    fontSize: fontSize.sm,
    color: colors.mutedForeground,
    textAlign: 'center',
  },
  ctaButton: {
    marginTop: 4,
  },

  // Section title
  sectionTitle: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.semibold,
    color: colors.foreground,
    marginTop: 4,
    marginBottom: 2,
  },

  // Features grid
  featuresGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  featureCard: {
    width: '48%',
    padding: 12,
  },
  featureInner: {
    gap: 6,
  },
  featureIconCircle: {
    width: 40,
    height: 40,
    borderRadius: radius.full,
    backgroundColor: colors.muted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  featureTitle: {
    fontSize: 14,
    fontWeight: fontWeight.semibold,
    color: colors.foreground,
  },
  featureDescription: {
    fontSize: 12,
    color: colors.mutedForeground,
    lineHeight: 17,
  },

  // Session card
  sessionCard: {
    padding: 0,
  },
  sessionCardInner: {
    padding: 12,
    gap: 8,
  },
  sessionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    flexWrap: 'wrap',
  },
  sessionDate: {
    fontSize: fontSize.xs,
    color: colors.mutedForeground,
  },
  sessionLimiter: {
    fontSize: fontSize.sm,
    color: colors.foreground,
    lineHeight: 19,
  },

  // Empty
  emptyCard: {
    padding: spacing.md,
  },
  emptyInner: {
    alignItems: 'center',
    gap: 12,
    paddingVertical: 8,
  },
  emptyText: {
    fontSize: fontSize.sm,
    color: colors.mutedForeground,
    textAlign: 'center',
  },

  mutedText: {
    fontSize: fontSize.sm,
    color: colors.mutedForeground,
  },
});
