import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  ActivityIndicator, Image, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { socialApi } from '../../src/lib/api';
import { colors, fontSize, fontWeight, radius, spacing } from '../../src/constants/theme';
import { trackScreen, trackScreenTime, Analytics } from '../../src/lib/analytics';

const LIFT_LABELS: Record<string, string> = {
  flat_bench_press: 'Bench Press',
  deadlift: 'Deadlift',
  barbell_back_squat: 'Back Squat',
  barbell_front_squat: 'Front Squat',
  incline_bench_press: 'Incline Bench',
  power_clean: 'Power Clean',
  hang_clean: 'Hang Clean',
  clean_and_jerk: 'Clean & Jerk',
  snatch: 'Snatch',
};

const RANK_COLORS = ['#f59e0b', '#9ca3af', '#cd7c2f'];
const RANK_ICONS = ['🥇', '🥈', '🥉'];

interface LeaderboardEntry {
  userId: string;
  name: string | null;
  username: string | null;
  avatarBase64: string | null;
  e1RM: number;
  isYou: boolean;
  rank: number;
}

export default function LeaderboardScreen() {
  const router = useRouter();
  const [availableLifts, setAvailableLifts] = useState<string[]>([]);
  const [selectedLift, setSelectedLift] = useState('flat_bench_press');
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadLifts = useCallback(async () => {
    try {
      const data = await socialApi.getLeaderboardLifts();
      const lifts: string[] = data.lifts ?? [];
      setAvailableLifts(lifts.length > 0 ? lifts : ['flat_bench_press']);
      if (lifts.length > 0 && !lifts.includes(selectedLift)) {
        setSelectedLift(lifts[0]);
      }
    } catch { /* use default */ }
  }, [selectedLift]);

  const loadLeaderboard = useCallback(async (lift: string) => {
    setLoading(true);
    try {
      const data = await socialApi.getLeaderboard(lift);
      setEntries(data.entries ?? []);
    } catch {
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    trackScreen('Leaderboard');
    return trackScreenTime('Leaderboard');
  }, []);

  useEffect(() => { loadLifts(); }, []);
  useEffect(() => {
    Analytics.leaderboardViewed(selectedLift);
    loadLeaderboard(selectedLift);
  }, [selectedLift]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadLeaderboard(selectedLift);
    setRefreshing(false);
  }, [selectedLift, loadLeaderboard]);

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="arrow-back" size={22} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={styles.title}>Leaderboard</Text>
        <View style={{ width: 22 }} />
      </View>

      {/* Lift selector */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.liftSelector}
      >
        {(availableLifts.length > 0 ? availableLifts : Object.keys(LIFT_LABELS)).map((lift) => (
          <TouchableOpacity
            key={lift}
            style={[styles.liftChip, selectedLift === lift && styles.liftChipActive]}
            onPress={() => setSelectedLift(lift)}
            activeOpacity={0.8}
          >
            <Text style={[styles.liftChipText, selectedLift === lift && styles.liftChipTextActive]}>
              {LIFT_LABELS[lift] ?? lift}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.mutedForeground} />
        </View>
      ) : entries.length === 0 ? (
        <View style={styles.center}>
          <Ionicons name="barbell-outline" size={40} color={colors.mutedForeground} />
          <Text style={styles.emptyTitle}>No data yet</Text>
          <Text style={styles.emptySubtitle}>
            Complete a diagnostic session for {LIFT_LABELS[selectedLift] ?? selectedLift} to appear on the board.
          </Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        >
          {/* Podium for top 3 */}
          {entries.length >= 2 && (
            <View style={styles.podium}>
              {/* 2nd place */}
              <PodiumSlot entry={entries[1]} height={80} />
              {/* 1st place */}
              <PodiumSlot entry={entries[0]} height={110} />
              {/* 3rd place */}
              {entries[2] ? <PodiumSlot entry={entries[2]} height={60} /> : <View style={styles.podiumSlotEmpty} />}
            </View>
          )}

          {/* Full ranked list */}
          <Text style={styles.sectionLabel}>Rankings — {LIFT_LABELS[selectedLift] ?? selectedLift}</Text>
          {entries.map((entry) => (
            <View key={entry.userId} style={[styles.row, entry.isYou && styles.rowYou]}>
              <Text style={[styles.rankText, entry.rank <= 3 && { color: RANK_COLORS[entry.rank - 1] }]}>
                {entry.rank <= 3 ? RANK_ICONS[entry.rank - 1] : `#${entry.rank}`}
              </Text>
              {entry.avatarBase64 ? (
                <Image source={{ uri: entry.avatarBase64 }} style={styles.avatar} />
              ) : (
                <View style={styles.avatarCircle}>
                  <Text style={styles.avatarText}>
                    {(entry.username ?? entry.name ?? '?')[0].toUpperCase()}
                  </Text>
                </View>
              )}
              <View style={styles.nameBlock}>
                <Text style={styles.displayName}>
                  {entry.username ? `@${entry.username}` : (entry.name ?? 'User')}
                  {entry.isYou ? '  (you)' : ''}
                </Text>
                {entry.name && entry.username && (
                  <Text style={styles.realName}>{entry.name}</Text>
                )}
              </View>
              <Text style={styles.e1rmText}>{entry.e1RM} kg</Text>
            </View>
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function PodiumSlot({ entry, height }: { entry: LeaderboardEntry; height: number }) {
  return (
    <View style={styles.podiumSlot}>
      {entry.avatarBase64 ? (
        <Image source={{ uri: entry.avatarBase64 }} style={styles.podiumAvatar} />
      ) : (
        <View style={[styles.avatarCircle, styles.podiumAvatarCircle]}>
          <Text style={styles.podiumAvatarText}>
            {(entry.username ?? entry.name ?? '?')[0].toUpperCase()}
          </Text>
        </View>
      )}
      <Text style={styles.podiumUsername} numberOfLines={1}>
        {entry.username ? `@${entry.username}` : (entry.name ?? 'User')}
      </Text>
      <Text style={styles.podiumE1rm}>{entry.e1RM} kg</Text>
      <View style={[styles.podiumBar, { height }]}>
        <Text style={styles.podiumRank}>{RANK_ICONS[entry.rank - 1]}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  title: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.bold,
    color: colors.foreground,
  },
  liftSelector: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    gap: 8,
    flexDirection: 'row',
  },
  liftChip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    alignSelf: 'flex-start',
  },
  liftChipActive: {
    backgroundColor: colors.foreground,
    borderColor: colors.foreground,
    alignSelf: 'flex-start',
  },
  liftChipText: {
    fontSize: fontSize.sm,
    color: colors.mutedForeground,
    fontWeight: fontWeight.medium,
  },
  liftChipTextActive: {
    color: colors.primaryForeground,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    gap: spacing.sm,
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
    lineHeight: 20,
  },
  list: {
    padding: spacing.lg,
    gap: spacing.sm,
  },

  // Podium
  podium: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'center',
    marginBottom: spacing.xl,
    gap: 8,
  },
  podiumSlot: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
  },
  podiumSlotEmpty: { flex: 1 },
  podiumAvatar: { width: 40, height: 40, borderRadius: 20 },
  podiumAvatarCircle: { width: 40, height: 40, borderRadius: 20 },
  podiumAvatarText: { fontSize: 16, fontWeight: fontWeight.bold, color: colors.foreground },
  podiumUsername: { fontSize: 10, color: colors.mutedForeground, fontWeight: fontWeight.medium, maxWidth: 80 },
  podiumE1rm: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.foreground },
  podiumBar: {
    width: '100%',
    backgroundColor: colors.muted,
    borderTopLeftRadius: 6,
    borderTopRightRadius: 6,
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingTop: 8,
  },
  podiumRank: { fontSize: 20 },

  sectionLabel: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
    color: colors.mutedForeground,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
  },

  // Rows
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  rowYou: {
    borderColor: colors.foreground,
    backgroundColor: colors.muted,
  },
  rankText: {
    width: 32,
    fontSize: fontSize.base,
    fontWeight: fontWeight.bold,
    color: colors.mutedForeground,
    textAlign: 'center',
  },
  avatar: { width: 36, height: 36, borderRadius: 18 },
  avatarCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.muted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontSize: fontSize.base, fontWeight: fontWeight.bold, color: colors.foreground },
  nameBlock: { flex: 1 },
  displayName: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.foreground },
  realName: { fontSize: fontSize.xs, color: colors.mutedForeground },
  e1rmText: {
    fontSize: fontSize.base,
    fontWeight: fontWeight.bold,
    color: colors.foreground,
    minWidth: 60,
    textAlign: 'right',
  },
});
