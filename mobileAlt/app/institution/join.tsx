import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Alert, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { institutionApi } from '../../src/lib/api';
import { colors, fontSize, fontWeight, radius, spacing } from '../../src/constants/theme';

interface InviteInfo {
  institutionName: string;
  institutionSlug: string;
  role: string;
}

export default function JoinInstitutionScreen() {
  const router = useRouter();
  const { token } = useLocalSearchParams<{ token: string }>();
  const [info, setInfo] = useState<InviteInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setError('Invalid invite link.');
      setLoading(false);
      return;
    }
    institutionApi.validateInvite(token)
      .then((data) => {
        setInfo({
          institutionName: data.institutionName ?? data.institution?.name ?? 'Institution',
          institutionSlug: data.institutionSlug ?? data.institution?.slug ?? '',
          role: data.role ?? 'athlete',
        });
      })
      .catch((err) => setError(err?.message ?? 'Invalid or expired invite link.'))
      .finally(() => setLoading(false));
  }, [token]);

  const handleJoin = async () => {
    if (!token || !info) return;
    setJoining(true);
    try {
      const data = await institutionApi.claimInvite(token);
      const role: string = data.role ?? info.role;
      const slug: string = data.slug ?? data.institution?.slug ?? info.institutionSlug;

      if (role === 'coach') {
        router.replace(`/institution/coach?slug=${slug}`);
      } else {
        router.replace(`/institution/athlete?slug=${slug}`);
      }
    } catch (err: any) {
      Alert.alert('Error', err?.message ?? 'Could not join institution.');
      setJoining(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <View style={styles.topBar}>
        <TouchableOpacity style={styles.backButton} activeOpacity={0.8} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={styles.screenTitle}>Join Institution</Text>
      </View>

      <View style={styles.body}>
        {loading ? (
          <ActivityIndicator size="large" color={colors.foreground} />
        ) : error ? (
          <View style={styles.center}>
            <Ionicons name="alert-circle-outline" size={48} color={colors.destructive} />
            <Text style={styles.errorTitle}>Invite Invalid</Text>
            <Text style={styles.errorSub}>{error}</Text>
            <TouchableOpacity style={styles.primaryButton} activeOpacity={0.8} onPress={() => router.back()}>
              <Text style={styles.primaryButtonText}>Go Back</Text>
            </TouchableOpacity>
          </View>
        ) : info ? (
          <View style={styles.center}>
            <View style={styles.iconContainer}>
              <Ionicons name="business-outline" size={48} color={colors.foreground} />
            </View>
            <Text style={styles.institutionName}>{info.institutionName}</Text>
            <View style={styles.roleBadge}>
              <Ionicons
                name={info.role === 'coach' ? 'person-outline' : 'barbell-outline'}
                size={14}
                color={colors.foreground}
              />
              <Text style={styles.roleText}>Joining as {info.role.charAt(0).toUpperCase() + info.role.slice(1)}</Text>
            </View>
            <Text style={styles.subtitle}>
              You have been invited to join this institution. Tap the button below to accept.
            </Text>
            <TouchableOpacity
              style={[styles.primaryButton, joining && styles.primaryButtonDisabled]}
              activeOpacity={0.8}
              onPress={handleJoin}
              disabled={joining}
            >
              {joining ? (
                <ActivityIndicator size="small" color={colors.primaryForeground} />
              ) : (
                <Text style={styles.primaryButtonText}>Join {info.institutionName}</Text>
              )}
            </TouchableOpacity>
          </View>
        ) : null}
      </View>
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
  screenTitle: { fontSize: fontSize.xl, fontWeight: fontWeight.bold, color: colors.foreground },

  body: { flex: 1, justifyContent: 'center', padding: spacing.xl },
  center: { alignItems: 'center', gap: spacing.lg },

  iconContainer: {
    width: 80,
    height: 80,
    borderRadius: radius.xl,
    backgroundColor: colors.muted,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  institutionName: { fontSize: fontSize.xxl, fontWeight: fontWeight.bold, color: colors.foreground, textAlign: 'center' },

  roleBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.muted,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    borderRadius: radius.full,
  },
  roleText: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.foreground },

  subtitle: {
    fontSize: fontSize.sm,
    color: colors.mutedForeground,
    textAlign: 'center',
    lineHeight: 20,
    maxWidth: 300,
  },

  primaryButton: {
    backgroundColor: colors.foreground,
    paddingHorizontal: spacing.xl,
    paddingVertical: 14,
    borderRadius: radius.xl,
    minWidth: 200,
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  primaryButtonDisabled: { opacity: 0.5 },
  primaryButtonText: { fontSize: fontSize.base, fontWeight: fontWeight.semibold, color: colors.primaryForeground },

  errorTitle: { fontSize: fontSize.xl, fontWeight: fontWeight.semibold, color: colors.foreground },
  errorSub: { fontSize: fontSize.sm, color: colors.mutedForeground, textAlign: 'center' },
});
