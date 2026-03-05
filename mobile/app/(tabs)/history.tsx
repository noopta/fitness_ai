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
import { liftCoachApi } from '../../src/lib/api';
import { Card } from '../../src/components/ui/Card';
import { Button } from '../../src/components/ui/Button';
import { Badge } from '../../src/components/ui/Badge';
import { LoadingSpinner } from '../../src/components/ui/LoadingSpinner';
import { colors, fontSize, fontWeight, spacing } from '../../src/constants/theme';

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

// ─── Types ────────────────────────────────────────────────────────────────────

interface Session {
  id: string;
  selectedLift: string;
  status?: string;
  primaryLimiter?: string;
  confidence?: number;
  createdAt?: string;
  updatedAt?: string;
}

// ─── SessionCard ──────────────────────────────────────────────────────────────

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
    <Pressable
      onPress={handlePress}
      style={({ pressed }) => [{ opacity: pressed ? 0.72 : 1 }]}
    >
      <Card style={styles.sessionCard}>
        {/* Row 1: lift name + date */}
        <View style={styles.row}>
          <Text style={styles.liftName} numberOfLines={1}>
            {toLiftName(session.selectedLift)}
          </Text>
          {session.createdAt && (
            <Text style={styles.dateText}>{formatDate(session.createdAt)}</Text>
          )}
        </View>

        {/* Row 2: primary limiter + confidence badge */}
        {session.primaryLimiter ? (
          <View style={styles.row}>
            <Text style={styles.limiterText} numberOfLines={2}>
              {session.primaryLimiter}
            </Text>
            {session.confidence !== undefined && session.confidence !== null && (
              <Badge variant="secondary">
                {Math.round(session.confidence)}%
              </Badge>
            )}
          </View>
        ) : null}

        {/* Row 3: status badge */}
        <View style={styles.statusRow}>
          <Badge variant={isCompleted ? 'success' : 'warning'}>
            {isCompleted ? 'Completed' : 'In Progress'}
          </Badge>
          <Ionicons
            name="chevron-forward"
            size={16}
            color={colors.mutedForeground}
          />
        </View>
      </Card>
    </Pressable>
  );
}

// ─── Section Header ───────────────────────────────────────────────────────────

function SectionHeader({ title, count }: { title: string; count: number }) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <Badge variant="secondary">{String(count)}</Badge>
    </View>
  );
}

// ─── History Screen ───────────────────────────────────────────────────────────

export default function HistoryScreen() {
  const router = useRouter();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadSessions() {
      try {
        const data = await liftCoachApi.getSessionHistory();
        setSessions(Array.isArray(data) ? data : data.sessions ?? []);
      } catch {
        setSessions([]);
      } finally {
        setLoading(false);
      }
    }
    loadSessions();
  }, []);

  const completed = sessions.filter(
    (s) => s.status === 'completed' || Boolean(s.primaryLimiter),
  );
  const inProgress = sessions.filter(
    (s) => s.status !== 'completed' && !s.primaryLimiter,
  );

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      {/* ── Top bar ── */}
      <View style={styles.topBar}>
        <Text style={styles.screenTitle}>Session History</Text>
        <Button
          onPress={() => router.push('/diagnostic/onboarding')}
          variant="outline"
          size="sm"
        >
          + New
        </Button>
      </View>

      {/* ── Content ── */}
      {loading ? (
        <View style={styles.center}>
          <LoadingSpinner message="Loading sessions…" />
        </View>
      ) : sessions.length === 0 ? (
        /* Empty state */
        <View style={styles.center}>
          <Card style={styles.emptyCard}>
            <View style={styles.emptyInner}>
              <Ionicons name="time-outline" size={40} color={colors.mutedForeground} />
              <Text style={styles.emptyTitle}>No sessions yet</Text>
              <Text style={styles.emptySubtitle}>
                Complete your first analysis to see your history here.
              </Text>
              <Button
                onPress={() => router.push('/diagnostic/onboarding')}
                size="sm"
              >
                Start Analysis
              </Button>
            </View>
          </Card>
        </View>
      ) : (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {/* Completed */}
          {completed.length > 0 && (
            <View>
              <SectionHeader title="Completed" count={completed.length} />
              {completed.map((s) => (
                <SessionCard key={s.id} session={s} />
              ))}
            </View>
          )}

          {/* In Progress */}
          {inProgress.length > 0 && (
            <View>
              <SectionHeader title="In Progress" count={inProgress.length} />
              {inProgress.map((s) => (
                <SessionCard key={s.id} session={s} />
              ))}
            </View>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },

  // Top bar
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  screenTitle: {
    fontSize: fontSize.xl,
    fontWeight: fontWeight.bold,
    color: colors.foreground,
  },

  // Scroll
  scroll: { flex: 1 },
  scrollContent: {
    padding: spacing.md,
    paddingBottom: spacing.xxl,
    gap: 16,
  },

  // Section header
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  sectionTitle: {
    fontSize: fontSize.base,
    fontWeight: fontWeight.semibold,
    color: colors.foreground,
  },

  // Session card
  sessionCard: {
    padding: 14,
    marginBottom: 10,
    gap: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    flexWrap: 'wrap',
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  liftName: {
    fontSize: 15,
    fontWeight: fontWeight.semibold,
    color: colors.foreground,
    flex: 1,
  },
  dateText: {
    fontSize: 12,
    color: colors.mutedForeground,
  },
  limiterText: {
    fontSize: fontSize.sm,
    color: colors.foreground,
    flex: 1,
    lineHeight: 19,
  },

  // Center / empty
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.md,
  },
  emptyCard: {
    padding: spacing.md,
    width: '100%',
  },
  emptyInner: {
    alignItems: 'center',
    gap: 12,
    paddingVertical: 8,
  },
  emptyTitle: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.semibold,
    color: colors.foreground,
  },
  emptySubtitle: {
    fontSize: fontSize.sm,
    color: colors.mutedForeground,
    textAlign: 'center',
  },
});
