import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, Alert, ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { institutionApi } from '../../src/lib/api';
import { colors, fontSize, fontWeight, radius, spacing } from '../../src/constants/theme';

interface Athlete {
  id: string;
  name: string | null;
  email: string | null;
}

export default function CoachDashboardScreen() {
  const router = useRouter();
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const [athletes, setAthletes] = useState<Athlete[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [inviting, setInviting] = useState(false);

  const loadAthletes = useCallback(async () => {
    if (!slug) return;
    try {
      const data = await institutionApi.getAthletes(slug);
      setAthletes(Array.isArray(data) ? data : data.athletes ?? []);
    } catch (err: any) {
      Alert.alert('Error', err?.message ?? 'Could not load athletes.');
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => { loadAthletes(); }, [loadAthletes]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadAthletes();
    setRefreshing(false);
  }, [loadAthletes]);

  const handleInviteAthlete = async () => {
    if (!slug) return;
    setInviting(true);
    try {
      const data = await institutionApi.invite(slug, { role: 'athlete' });
      const link = data.link ?? data.url ?? data.inviteUrl ?? data.token ?? JSON.stringify(data);
      Alert.alert('Invite Athlete', `Share this link:\n\n${link}`, [{ text: 'OK' }]);
    } catch (err: any) {
      Alert.alert('Error', err?.message ?? 'Could not generate invite link.');
    } finally {
      setInviting(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <View style={styles.topBar}>
        <TouchableOpacity style={styles.backButton} activeOpacity={0.8} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={styles.screenTitle}>Coach Dashboard</Text>
        <TouchableOpacity
          style={[styles.inviteButton, inviting && styles.inviteButtonDisabled]}
          activeOpacity={0.8}
          onPress={handleInviteAthlete}
          disabled={inviting}
        >
          {inviting ? (
            <ActivityIndicator size="small" color={colors.primaryForeground} />
          ) : (
            <>
              <Ionicons name="person-add-outline" size={14} color={colors.primaryForeground} />
              <Text style={styles.inviteButtonText}>Invite</Text>
            </>
          )}
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.foreground} />
        </View>
      ) : (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        >
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Athletes</Text>
            <View style={styles.countBadge}>
              <Text style={styles.countBadgeText}>{athletes.length}</Text>
            </View>
          </View>

          {athletes.length === 0 ? (
            <View style={styles.emptyBox}>
              <Ionicons name="people-outline" size={40} color={colors.mutedForeground} />
              <Text style={styles.emptyTitle}>No athletes yet</Text>
              <Text style={styles.emptySubtitle}>Use the Invite button to add athletes to your roster.</Text>
            </View>
          ) : (
            athletes.map((athlete) => (
              <View key={athlete.id} style={styles.card}>
                <View style={styles.cardRow}>
                  <View style={styles.avatarCircle}>
                    <Text style={styles.avatarText}>
                      {((athlete.name ?? athlete.email ?? 'A')[0]).toUpperCase()}
                    </Text>
                  </View>
                  <View style={styles.cardContent}>
                    <Text style={styles.cardName}>{athlete.name ?? 'Athlete'}</Text>
                    {athlete.email ? <Text style={styles.cardSub}>{athlete.email}</Text> : null}
                  </View>
                  <TouchableOpacity
                    style={styles.viewButton}
                    activeOpacity={0.8}
                    onPress={() => router.push(`/institution/athlete-detail?slug=${slug}&userId=${athlete.id}`)}
                  >
                    <Text style={styles.viewButtonText}>View</Text>
                    <Ionicons name="chevron-forward" size={14} color={colors.primaryForeground} />
                  </TouchableOpacity>
                </View>
              </View>
            ))
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
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: spacing.sm,
  },
  backButton: { padding: 4 },
  screenTitle: { flex: 1, fontSize: fontSize.xl, fontWeight: fontWeight.bold, color: colors.foreground },
  inviteButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.foreground,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radius.md,
    minWidth: 72,
    justifyContent: 'center',
  },
  inviteButtonDisabled: { opacity: 0.5 },
  inviteButtonText: { fontSize: fontSize.xs, fontWeight: fontWeight.semibold, color: colors.primaryForeground },

  scroll: { flex: 1 },
  scrollContent: { padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.sm },

  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: spacing.xs },
  sectionTitle: { fontSize: fontSize.base, fontWeight: fontWeight.semibold, color: colors.foreground },
  countBadge: {
    backgroundColor: colors.muted,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.full,
    minWidth: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  countBadgeText: { fontSize: fontSize.xs, fontWeight: fontWeight.semibold, color: colors.foreground },

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

  viewButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    backgroundColor: colors.foreground,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: radius.sm,
  },
  viewButtonText: { fontSize: fontSize.xs, fontWeight: fontWeight.semibold, color: colors.primaryForeground },

  emptyBox: { alignItems: 'center', paddingVertical: spacing.xxl, gap: spacing.md },
  emptyTitle: { fontSize: fontSize.lg, fontWeight: fontWeight.semibold, color: colors.foreground },
  emptySubtitle: { fontSize: fontSize.sm, color: colors.mutedForeground, textAlign: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
