import { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { storage, historyApi } from '@/lib/api';
import { colors, fontSize, fontWeight, spacing, radius } from '@/constants/theme';

interface HistorySession {
  id: string;
  selectedLift: string;
  createdAt: string;
  status: string;
  primaryLimiter?: string;
  confidence?: number;
}

function formatLiftName(id: string): string {
  return id.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function HistoryScreen() {
  const [sessions, setSessions] = useState<HistorySession[]>([]);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    historyApi.getHistory()
      .then(data => {
        const list = Array.isArray(data) ? data : (data as any)?.sessions ?? [];
        setSessions(list);
      })
      .catch(() => setSessions([]))
      .finally(() => setLoading(false));
  }, []);

  const completed = sessions.filter(s => s.primaryLimiter != null);
  const inProgress = sessions.filter(s => s.primaryLimiter == null);

  async function openSession(s: HistorySession) {
    await storage.set('liftoff_session_id', s.id);
    await storage.set('liftoff_selected_lift', s.selectedLift);
    if (s.primaryLimiter) {
      router.push('/diagnostic/plan');
    } else {
      router.push('/diagnostic/chat');
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.headerRow}>
        <View style={styles.headerLeft}>
          <View style={styles.headerIcon}>
            <Ionicons name="time" size={20} color={colors.primary} />
          </View>
          <View>
            <Text style={styles.title}>My Analyses</Text>
            <Text style={styles.subtitle}>
              {sessions.length === 0
                ? 'No sessions yet'
                : `${sessions.length} diagnostic session${sessions.length !== 1 ? 's' : ''}`}
            </Text>
          </View>
        </View>
        <Button
          size="sm"
          onPress={() => router.push('/diagnostic/onboarding')}
        >
          New
        </Button>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator size="large" color={colors.mutedForeground} />
          </View>
        ) : sessions.length === 0 ? (
          <Card style={styles.emptyCard}>
            <View style={styles.emptyIcon}>
              <Ionicons name="barbell" size={28} color={colors.primary} />
            </View>
            <Text style={styles.emptyTitle}>No analyses yet</Text>
            <Text style={styles.emptyDescription}>
              Run your first diagnostic to see your lift analysis here.
            </Text>
            <Button
              onPress={() => router.push('/diagnostic/onboarding')}
              style={{ marginTop: 20 }}
            >
              Start Your First Analysis
            </Button>
          </Card>
        ) : (
          <View style={styles.list}>
            {completed.length > 0 && (
              <View>
                <Text style={styles.sectionLabel}>COMPLETED - {completed.length}</Text>
                {completed.map((s) => (
                  <SessionCard key={s.id} session={s} onPress={() => openSession(s)} />
                ))}
              </View>
            )}

            {inProgress.length > 0 && (
              <View style={{ marginTop: completed.length > 0 ? 24 : 0 }}>
                <Text style={styles.sectionLabel}>IN PROGRESS - {inProgress.length}</Text>
                {inProgress.map((s) => (
                  <SessionCard key={s.id} session={s} onPress={() => openSession(s)} />
                ))}
              </View>
            )}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function SessionCard({ session: s, onPress }: { session: HistorySession; onPress: () => void }) {
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.7}>
      <Card style={styles.sessionCard}>
        <View style={styles.sessionRow}>
          <View style={styles.sessionLeft}>
            <View style={styles.sessionIcon}>
              <Ionicons name="barbell-outline" size={16} color={colors.mutedForeground} />
            </View>
            <View style={styles.sessionInfo}>
              <Text style={styles.sessionLift}>{formatLiftName(s.selectedLift)}</Text>
              <Text style={styles.sessionDate}>{formatDate(s.createdAt)}</Text>
              {s.primaryLimiter && (
                <View style={styles.limiterRow}>
                  <Text style={styles.limiterLabel}>Limiting factor: </Text>
                  <Text style={styles.limiterValue}>{s.primaryLimiter}</Text>
                  {s.confidence !== undefined && (
                    <Badge variant="secondary" style={{ marginLeft: 6 }}>
                      {`${Math.round(s.confidence * 100)}%`}
                    </Badge>
                  )}
                </View>
              )}
            </View>
          </View>
          <View style={styles.sessionRight}>
            <Badge variant={s.status === 'completed' ? 'default' : 'secondary'}>
              {s.status === 'completed' ? 'Complete' : 'In progress'}
            </Badge>
            <Ionicons name="chevron-forward" size={16} color={colors.mutedForeground} />
          </View>
        </View>
      </Card>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  headerIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    backgroundColor: colors.primary + '15',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    color: colors.foreground,
    fontSize: fontSize.xl,
    fontWeight: fontWeight.bold,
  },
  subtitle: {
    color: colors.mutedForeground,
    fontSize: fontSize.sm,
    marginTop: 2,
  },
  scrollContent: {
    padding: spacing.lg,
    paddingBottom: 40,
  },
  center: {
    paddingTop: 80,
    alignItems: 'center',
  },
  emptyCard: {
    alignItems: 'center',
    paddingVertical: 40,
  },
  emptyIcon: {
    width: 48,
    height: 48,
    borderRadius: radius.md,
    backgroundColor: colors.primary + '15',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  emptyTitle: {
    color: colors.foreground,
    fontSize: fontSize.base,
    fontWeight: fontWeight.semibold,
  },
  emptyDescription: {
    color: colors.mutedForeground,
    fontSize: fontSize.sm,
    marginTop: 4,
    textAlign: 'center',
  },
  list: {
    gap: 8,
  },
  sectionLabel: {
    color: colors.mutedForeground,
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
    letterSpacing: 1,
    marginBottom: 8,
  },
  sessionCard: {
    padding: 16,
    marginBottom: 8,
  },
  sessionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sessionLeft: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    flex: 1,
  },
  sessionIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sessionInfo: {
    flex: 1,
  },
  sessionLift: {
    color: colors.foreground,
    fontSize: fontSize.base,
    fontWeight: fontWeight.semibold,
  },
  sessionDate: {
    color: colors.mutedForeground,
    fontSize: fontSize.xs,
    marginTop: 2,
  },
  limiterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    marginTop: 6,
  },
  limiterLabel: {
    color: colors.mutedForeground,
    fontSize: fontSize.xs,
  },
  limiterValue: {
    color: colors.foreground,
    fontSize: fontSize.xs,
    fontWeight: fontWeight.medium,
  },
  sessionRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
});
