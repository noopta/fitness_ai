import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, Pressable, TouchableOpacity, Alert, Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Swipeable } from 'react-native-gesture-handler';
import { liftCoachApi } from '../../src/lib/api';
import { Badge } from '../../src/components/ui/Badge';
import { LoadingSpinner } from '../../src/components/ui/LoadingSpinner';
import { colors, fontSize, fontWeight, radius, spacing } from '../../src/constants/theme';
import { trackScreen, trackScreenTime } from '../../src/lib/analytics';

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

interface Session {
  id: string;
  selectedLift: string;
  status?: string;
  primaryLimiter?: string;
  confidence?: number;
  createdAt?: string;
}

function SessionCard({ session, onDelete }: { session: Session; onDelete: (id: string) => void }) {
  const router = useRouter();
  const swipeRef = useRef<Swipeable>(null);
  const isCompleted = session.status === 'completed' || Boolean(session.primaryLimiter);

  function handleDelete() {
    swipeRef.current?.close();
    Alert.alert(
      'Delete Analysis',
      'Are you sure you want to delete this analysis? This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => onDelete(session.id) },
      ]
    );
  }

  function renderRightActions(_progress: any, dragX: Animated.AnimatedInterpolation<number>) {
    const opacity = dragX.interpolate({ inputRange: [-80, 0], outputRange: [1, 0], extrapolate: 'clamp' });
    return (
      <Animated.View style={[styles.deleteAction, { opacity }]}>
        <TouchableOpacity style={styles.deleteBtn} onPress={handleDelete} activeOpacity={0.8}>
          <Ionicons name="trash-outline" size={20} color="#fff" />
          <Text style={styles.deleteBtnText}>Delete</Text>
        </TouchableOpacity>
      </Animated.View>
    );
  }

  return (
    <Swipeable ref={swipeRef} renderRightActions={renderRightActions} rightThreshold={40} overshootRight={false}>
      <Pressable
        onPress={() => router.push(isCompleted ? `/diagnostic/plan?sessionId=${session.id}` : `/diagnostic/chat?sessionId=${session.id}`)}
        style={({ pressed }) => [styles.sessionCard, { opacity: pressed ? 0.72 : 1 }]}
      >
        <View style={styles.row}>
          <Text style={styles.liftName} numberOfLines={1}>{toLiftName(session.selectedLift)}</Text>
          {session.createdAt && <Text style={styles.dateText}>{formatDate(session.createdAt)}</Text>}
        </View>
        {session.primaryLimiter && (
          <Text style={styles.limiterText} numberOfLines={2}>{session.primaryLimiter}</Text>
        )}
        <View style={styles.statusRow}>
          <View style={styles.badgeRow}>
            {session.confidence != null && (
              <Badge variant="secondary">{Math.round((session.confidence ?? 0) * 100)}%</Badge>
            )}
            <Badge variant={isCompleted ? 'success' : 'warning'}>
              {isCompleted ? 'Completed' : 'In Progress'}
            </Badge>
          </View>
          <Ionicons name="chevron-forward" size={16} color={colors.mutedForeground} />
        </View>
      </Pressable>
    </Swipeable>
  );
}

function SectionLabel({ title, count }: { title: string; count: number }) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <Badge variant="secondary">{String(count)}</Badge>
    </View>
  );
}

export default function HistoryScreen() {
  const router = useRouter();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    trackScreen('History');
    return trackScreenTime('History');
  }, []);

  useEffect(() => {
    liftCoachApi.getSessionHistory()
      .then((data) => setSessions(Array.isArray(data) ? data : data.sessions ?? []))
      .catch(() => setSessions([]))
      .finally(() => setLoading(false));
  }, []);

  async function handleDelete(id: string) {
    try {
      await liftCoachApi.deleteSession(id);
      setSessions((prev) => prev.filter((s) => s.id !== id));
    } catch {
      Alert.alert('Error', 'Failed to delete analysis. Please try again.');
    }
  }

  const completed = sessions.filter((s) => s.status === 'completed' || Boolean(s.primaryLimiter));
  const inProgress = sessions.filter((s) => s.status !== 'completed' && !s.primaryLimiter);

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      {/* Top bar */}
      <View style={styles.topBar}>
        <Text style={styles.screenTitle}>History</Text>
        <TouchableOpacity
          style={styles.newButton}
          activeOpacity={0.82}
          onPress={() => router.push('/diagnostic/onboarding')}
        >
          <Ionicons name="add" size={18} color={colors.primaryForeground} />
          <Text style={styles.newButtonText}>New</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.center}>
          <LoadingSpinner message="Loading sessions…" />
        </View>
      ) : sessions.length === 0 ? (
        <View style={styles.center}>
          <Ionicons name="time-outline" size={40} color={colors.mutedForeground} />
          <Text style={styles.emptyTitle}>No sessions yet</Text>
          <Text style={styles.emptySubtitle}>Complete your first analysis to see your history here.</Text>
          <TouchableOpacity
            style={styles.startButton}
            activeOpacity={0.82}
            onPress={() => router.push('/diagnostic/onboarding')}
          >
            <Text style={styles.startButtonText}>Start Analysis</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {completed.length > 0 && (
            <View style={styles.section}>
              <SectionLabel title="Completed" count={completed.length} />
              {completed.map((s) => <SessionCard key={s.id} session={s} onDelete={handleDelete} />)}
            </View>
          )}
          {inProgress.length > 0 && (
            <View style={styles.section}>
              <SectionLabel title="In Progress" count={inProgress.length} />
              {inProgress.map((s) => <SessionCard key={s.id} session={s} onDelete={handleDelete} />)}
            </View>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },

  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  screenTitle: { fontSize: fontSize.xxl, fontWeight: fontWeight.bold, color: colors.foreground },
  newButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.foreground,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radius.md,
  },
  newButtonText: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.primaryForeground },

  scroll: { flex: 1 },
  scrollContent: { padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.lg },

  section: { gap: 10 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sectionTitle: { fontSize: fontSize.base, fontWeight: fontWeight.semibold, color: colors.foreground },

  // Session card
  sessionCard: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: 8,
    backgroundColor: colors.background,
  },
  deleteAction: {
    justifyContent: 'center',
    alignItems: 'flex-end',
    marginLeft: spacing.sm,
  },
  deleteBtn: {
    backgroundColor: '#ef4444',
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    minWidth: 72,
    height: '100%',
  },
  deleteBtnText: {
    color: '#fff',
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
  },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' },
  statusRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  badgeRow: { flexDirection: 'row', gap: 6 },
  liftName: { fontSize: fontSize.base, fontWeight: fontWeight.semibold, color: colors.foreground, flex: 1 },
  dateText: { fontSize: fontSize.xs, color: colors.mutedForeground },
  limiterText: { fontSize: fontSize.sm, color: colors.mutedForeground, lineHeight: 19 },

  // Empty / center
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.md },
  emptyTitle: { fontSize: fontSize.lg, fontWeight: fontWeight.semibold, color: colors.foreground },
  emptySubtitle: { fontSize: fontSize.sm, color: colors.mutedForeground, textAlign: 'center' },
  startButton: {
    backgroundColor: colors.foreground,
    paddingHorizontal: spacing.xl,
    paddingVertical: 13,
    borderRadius: radius.xl,
    marginTop: spacing.sm,
  },
  startButtonText: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.primaryForeground },
});
