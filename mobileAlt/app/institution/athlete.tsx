import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, Alert, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { institutionApi, socialApi } from '../../src/lib/api';
import { colors, fontSize, fontWeight, radius, spacing } from '../../src/constants/theme';

interface Institution {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  logoUrl?: string | null;
}

interface Coach {
  id: string;
  name: string | null;
  email: string | null;
  role?: string;
}

export default function AthleteInstitutionScreen() {
  const router = useRouter();
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const [institution, setInstitution] = useState<Institution | null>(null);
  const [coaches, setCoaches] = useState<Coach[]>([]);
  const [loading, setLoading] = useState(true);
  const [messagingId, setMessagingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!slug) return;
    try {
      const [instData, coachData] = await Promise.all([
        institutionApi.getInstitution(slug),
        institutionApi.getCoachInfo(slug).catch(() => []),
      ]);
      setInstitution(instData.institution ?? instData);
      setCoaches(Array.isArray(coachData) ? coachData : coachData.coaches ?? []);
    } catch (err: any) {
      Alert.alert('Error', err?.message ?? 'Could not load institution.');
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => { load(); }, [load]);

  const handleMessageCoach = async (coach: Coach) => {
    setMessagingId(coach.id);
    try {
      const data = await socialApi.createConversation(coach.id);
      const convId = data.id ?? data.conversationId;
      if (convId) {
        router.push(`/social/conversation?id=${convId}&name=${encodeURIComponent(coach.name ?? coach.email ?? 'Coach')}`);
      } else {
        Alert.alert('Error', 'Could not start conversation.');
      }
    } catch (err: any) {
      Alert.alert('Error', err?.message ?? 'Could not start conversation.');
    } finally {
      setMessagingId(null);
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

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <View style={styles.topBar}>
        <TouchableOpacity style={styles.backButton} activeOpacity={0.8} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={styles.screenTitle} numberOfLines={1}>
          {institution?.name ?? 'My Institution'}
        </Text>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Institution header */}
        {institution && (
          <View style={styles.institutionCard}>
            <View style={styles.institutionIcon}>
              <Ionicons name="business-outline" size={32} color={colors.foreground} />
            </View>
            <View style={styles.institutionInfo}>
              <Text style={styles.institutionName}>{institution.name}</Text>
              {institution.description ? (
                <Text style={styles.institutionDesc}>{institution.description}</Text>
              ) : null}
            </View>
          </View>
        )}

        {/* Coaches section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Coaches</Text>
          {coaches.length === 0 ? (
            <View style={styles.emptyBox}>
              <Text style={styles.mutedText}>No coaches listed yet.</Text>
            </View>
          ) : (
            coaches.map((coach) => (
              <View key={coach.id} style={styles.card}>
                <View style={styles.cardRow}>
                  <View style={styles.avatarCircle}>
                    <Text style={styles.avatarText}>
                      {((coach.name ?? coach.email ?? 'C')[0]).toUpperCase()}
                    </Text>
                  </View>
                  <View style={styles.cardContent}>
                    <Text style={styles.cardName}>{coach.name ?? 'Coach'}</Text>
                    {coach.email ? <Text style={styles.cardSub}>{coach.email}</Text> : null}
                  </View>
                  <TouchableOpacity
                    style={[styles.messageButton, messagingId === coach.id && styles.messageButtonDisabled]}
                    activeOpacity={0.8}
                    onPress={() => handleMessageCoach(coach)}
                    disabled={messagingId === coach.id}
                  >
                    {messagingId === coach.id ? (
                      <ActivityIndicator size="small" color={colors.primaryForeground} />
                    ) : (
                      <>
                        <Ionicons name="chatbubble-outline" size={14} color={colors.primaryForeground} />
                        <Text style={styles.messageButtonText}>Message</Text>
                      </>
                    )}
                  </TouchableOpacity>
                </View>
              </View>
            ))
          )}
        </View>
      </ScrollView>
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
  scrollContent: { padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.lg },

  institutionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    backgroundColor: colors.card,
  },
  institutionIcon: {
    width: 60,
    height: 60,
    borderRadius: radius.lg,
    backgroundColor: colors.muted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  institutionInfo: { flex: 1 },
  institutionName: { fontSize: fontSize.lg, fontWeight: fontWeight.bold, color: colors.foreground },
  institutionDesc: { fontSize: fontSize.sm, color: colors.mutedForeground, marginTop: 4 },

  section: { gap: spacing.sm },
  sectionTitle: { fontSize: fontSize.base, fontWeight: fontWeight.semibold, color: colors.foreground },

  card: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.md,
    backgroundColor: colors.card,
  },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  avatarCircle: {
    width: 44,
    height: 44,
    borderRadius: radius.full,
    backgroundColor: colors.muted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontSize: fontSize.base, fontWeight: fontWeight.semibold, color: colors.foreground },
  cardContent: { flex: 1 },
  cardName: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.foreground },
  cardSub: { fontSize: fontSize.xs, color: colors.mutedForeground, marginTop: 2 },

  messageButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.foreground,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: radius.sm,
    minWidth: 80,
    justifyContent: 'center',
  },
  messageButtonDisabled: { opacity: 0.5 },
  messageButtonText: { fontSize: fontSize.xs, fontWeight: fontWeight.semibold, color: colors.primaryForeground },

  emptyBox: { alignItems: 'center', paddingVertical: spacing.lg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  mutedText: { fontSize: fontSize.sm, color: colors.mutedForeground },
});
