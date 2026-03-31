import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, Alert, ActivityIndicator,
  Modal, TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { institutionApi, socialApi } from '../../src/lib/api';
import { colors, fontSize, fontWeight, radius, spacing } from '../../src/constants/theme';

interface LiftEntry {
  liftName: string;
  bestWeightKg: number;
  unit?: string;
}

interface WorkoutLog {
  id: string;
  date: string;
  title?: string;
  exercises?: Array<{ name: string; sets: number; reps: string }>;
}

interface WellnessEntry {
  date: string;
  mood?: number;
  energy?: number;
  sleepHours?: number;
}

interface AthleteDetail {
  id: string;
  name: string | null;
  email: string | null;
  strengthIndex?: number | null;
  tier?: string | null;
  topLifts?: LiftEntry[];
  recentWorkouts?: WorkoutLog[];
  recentWellness?: WellnessEntry[];
}

function LiftCard({ lift }: { lift: LiftEntry }) {
  return (
    <View style={styles.liftCard}>
      <Text style={styles.liftName} numberOfLines={2}>
        {lift.liftName.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
      </Text>
      <Text style={styles.liftWeight}>{lift.bestWeightKg}{lift.unit ?? 'kg'}</Text>
    </View>
  );
}

function WorkoutRow({ log }: { log: WorkoutLog }) {
  const date = new Date(log.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return (
    <View style={styles.workoutRow}>
      <View style={styles.workoutDate}>
        <Text style={styles.workoutDateText}>{date}</Text>
      </View>
      <View style={styles.workoutInfo}>
        <Text style={styles.workoutTitle} numberOfLines={1}>{log.title ?? 'Workout'}</Text>
        {log.exercises && log.exercises.length > 0 && (
          <Text style={styles.workoutSub} numberOfLines={1}>
            {log.exercises.slice(0, 3).map((e) => e.name).join(', ')}
            {log.exercises.length > 3 ? ` +${log.exercises.length - 3}` : ''}
          </Text>
        )}
      </View>
    </View>
  );
}

function WellnessRow({ entry }: { entry: WellnessEntry }) {
  const date = new Date(entry.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return (
    <View style={styles.wellnessRow}>
      <Text style={styles.wellnessDate}>{date}</Text>
      {entry.mood != null && (
        <View style={styles.wellnessPill}>
          <Ionicons name="happy-outline" size={12} color={colors.mutedForeground} />
          <Text style={styles.wellnessPillText}>Mood {entry.mood}/10</Text>
        </View>
      )}
      {entry.energy != null && (
        <View style={styles.wellnessPill}>
          <Ionicons name="flash-outline" size={12} color={colors.mutedForeground} />
          <Text style={styles.wellnessPillText}>Energy {entry.energy}/10</Text>
        </View>
      )}
      {entry.sleepHours != null && (
        <View style={styles.wellnessPill}>
          <Ionicons name="moon-outline" size={12} color={colors.mutedForeground} />
          <Text style={styles.wellnessPillText}>{entry.sleepHours}h sleep</Text>
        </View>
      )}
    </View>
  );
}

export default function AthleteDetailScreen() {
  const router = useRouter();
  const { slug, userId } = useLocalSearchParams<{ slug: string; userId: string }>();
  const [athlete, setAthlete] = useState<AthleteDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [modalVisible, setModalVisible] = useState(false);
  const [messageText, setMessageText] = useState('');
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    if (!slug || !userId) return;
    try {
      const data = await institutionApi.getAthleteDetail(slug, userId);
      setAthlete(data.athlete ?? data);
    } catch (err: any) {
      Alert.alert('Error', err?.message ?? 'Could not load athlete.');
    } finally {
      setLoading(false);
    }
  }, [slug, userId]);

  useEffect(() => { load(); }, [load]);

  const handleSendMessage = async () => {
    const text = messageText.trim();
    if (!text || !slug || !userId) return;
    setSending(true);
    try {
      const data = await institutionApi.messageAthlete(slug, userId, text);
      const convId = data.conversationId ?? data.id;
      setModalVisible(false);
      setMessageText('');
      if (convId) {
        router.push(`/social/conversation?id=${convId}&name=${encodeURIComponent(athlete?.name ?? 'Athlete')}`);
      } else {
        Alert.alert('Sent', 'Message sent successfully.');
      }
    } catch (err: any) {
      Alert.alert('Error', err?.message ?? 'Could not send message.');
    } finally {
      setSending(false);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.foreground} />
        </View>
      </SafeAreaView>
    );
  }

  const topLifts = (athlete?.topLifts ?? []).slice(0, 4);
  const recentWorkouts = (athlete?.recentWorkouts ?? []).slice(0, 5);
  const recentWellness = (athlete?.recentWellness ?? []).slice(0, 5);

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <View style={styles.topBar}>
        <TouchableOpacity style={styles.backButton} activeOpacity={0.8} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={styles.screenTitle} numberOfLines={1}>
          {athlete?.name ?? 'Athlete'}
        </Text>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Profile header */}
        <View style={styles.profileCard}>
          <View style={styles.avatarCircleLarge}>
            <Text style={styles.avatarTextLarge}>
              {((athlete?.name ?? athlete?.email ?? 'A')[0]).toUpperCase()}
            </Text>
          </View>
          <View style={styles.profileInfo}>
            <Text style={styles.profileName}>{athlete?.name ?? 'Athlete'}</Text>
            {athlete?.email ? <Text style={styles.profileEmail}>{athlete.email}</Text> : null}
            <View style={styles.profileBadges}>
              {athlete?.tier && (
                <View style={styles.tierBadge}>
                  <Text style={styles.tierText}>{athlete.tier}</Text>
                </View>
              )}
              {athlete?.strengthIndex != null && (
                <View style={styles.indexBadge}>
                  <Ionicons name="trending-up-outline" size={12} color={colors.mutedForeground} />
                  <Text style={styles.indexText}>SI: {athlete.strengthIndex.toFixed(1)}</Text>
                </View>
              )}
            </View>
          </View>
        </View>

        {/* Top lifts */}
        {topLifts.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Top Lifts</Text>
            <View style={styles.liftsGrid}>
              {topLifts.map((lift, i) => <LiftCard key={i} lift={lift} />)}
            </View>
          </View>
        )}

        {/* Recent workouts */}
        {recentWorkouts.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Recent Workouts</Text>
            <View style={styles.listCard}>
              {recentWorkouts.map((log, i) => (
                <View key={log.id}>
                  {i > 0 && <View style={styles.divider} />}
                  <WorkoutRow log={log} />
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Recent wellness */}
        {recentWellness.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Recent Wellness</Text>
            <View style={styles.listCard}>
              {recentWellness.map((entry, i) => (
                <View key={entry.date + i}>
                  {i > 0 && <View style={styles.divider} />}
                  <WellnessRow entry={entry} />
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Spacer for bottom button */}
        <View style={{ height: spacing.xxl }} />
      </ScrollView>

      {/* Message button */}
      <View style={styles.bottomBar}>
        <TouchableOpacity
          style={styles.messageButton}
          activeOpacity={0.8}
          onPress={() => setModalVisible(true)}
        >
          <Ionicons name="chatbubble-outline" size={18} color={colors.primaryForeground} />
          <Text style={styles.messageButtonText}>Message Athlete</Text>
        </TouchableOpacity>
      </View>

      {/* Message modal */}
      <Modal
        visible={modalVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Message {athlete?.name ?? 'Athlete'}</Text>
              <TouchableOpacity onPress={() => setModalVisible(false)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons name="close" size={22} color={colors.foreground} />
              </TouchableOpacity>
            </View>
            <TextInput
              style={styles.modalInput}
              placeholder="Type your message…"
              placeholderTextColor={colors.mutedForeground}
              value={messageText}
              onChangeText={setMessageText}
              multiline
              maxLength={1000}
              autoFocus
            />
            <TouchableOpacity
              style={[styles.sendButton, (!messageText.trim() || sending) && styles.sendButtonDisabled]}
              activeOpacity={0.8}
              onPress={handleSendMessage}
              disabled={!messageText.trim() || sending}
            >
              {sending ? (
                <ActivityIndicator size="small" color={colors.primaryForeground} />
              ) : (
                <Text style={styles.sendButtonText}>Send Message</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },

  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  backButton: { padding: 4 },
  screenTitle: { flex: 1, fontSize: fontSize.xl, fontWeight: fontWeight.bold, color: colors.foreground },

  scroll: { flex: 1 },
  scrollContent: { padding: spacing.lg, gap: spacing.lg },

  profileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    backgroundColor: colors.card,
  },
  avatarCircleLarge: {
    width: 60,
    height: 60,
    borderRadius: radius.full,
    backgroundColor: colors.muted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarTextLarge: { fontSize: fontSize.xxl, fontWeight: fontWeight.bold, color: colors.foreground },
  profileInfo: { flex: 1 },
  profileName: { fontSize: fontSize.lg, fontWeight: fontWeight.bold, color: colors.foreground },
  profileEmail: { fontSize: fontSize.sm, color: colors.mutedForeground, marginTop: 2 },
  profileBadges: { flexDirection: 'row', gap: 6, marginTop: 6, flexWrap: 'wrap' },
  tierBadge: {
    backgroundColor: colors.foreground,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.full,
  },
  tierText: { fontSize: fontSize.xs, fontWeight: fontWeight.semibold, color: colors.primaryForeground },
  indexBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: colors.muted,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.full,
  },
  indexText: { fontSize: fontSize.xs, color: colors.mutedForeground },

  section: { gap: spacing.sm },
  sectionTitle: { fontSize: fontSize.base, fontWeight: fontWeight.semibold, color: colors.foreground },

  liftsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  liftCard: {
    flex: 1,
    minWidth: '45%',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    backgroundColor: colors.card,
    gap: 4,
  },
  liftName: { fontSize: fontSize.xs, color: colors.mutedForeground },
  liftWeight: { fontSize: fontSize.lg, fontWeight: fontWeight.bold, color: colors.foreground },

  listCard: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    backgroundColor: colors.card,
    overflow: 'hidden',
  },
  divider: { height: 1, backgroundColor: colors.border },

  workoutRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
  },
  workoutDate: {
    width: 44,
    alignItems: 'center',
  },
  workoutDateText: { fontSize: fontSize.xs, color: colors.mutedForeground, textAlign: 'center' },
  workoutInfo: { flex: 1 },
  workoutTitle: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.foreground },
  workoutSub: { fontSize: fontSize.xs, color: colors.mutedForeground, marginTop: 2 },

  wellnessRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    padding: spacing.md,
    flexWrap: 'wrap',
  },
  wellnessDate: { fontSize: fontSize.xs, color: colors.mutedForeground, width: 52 },
  wellnessPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: colors.muted,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: radius.full,
  },
  wellnessPillText: { fontSize: fontSize.xs, color: colors.mutedForeground },

  bottomBar: {
    padding: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
  },
  messageButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.foreground,
    paddingVertical: 14,
    borderRadius: radius.xl,
  },
  messageButtonText: { fontSize: fontSize.base, fontWeight: fontWeight.semibold, color: colors.primaryForeground },

  // Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: radius.xxl,
    borderTopRightRadius: radius.xxl,
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
    gap: spacing.md,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  modalTitle: { fontSize: fontSize.lg, fontWeight: fontWeight.semibold, color: colors.foreground },
  modalInput: {
    backgroundColor: colors.muted,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    fontSize: fontSize.base,
    color: colors.foreground,
    minHeight: 100,
    textAlignVertical: 'top',
  },
  sendButton: {
    backgroundColor: colors.foreground,
    paddingVertical: 14,
    borderRadius: radius.xl,
    alignItems: 'center',
  },
  sendButtonDisabled: { opacity: 0.4 },
  sendButtonText: { fontSize: fontSize.base, fontWeight: fontWeight.semibold, color: colors.primaryForeground },

  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
