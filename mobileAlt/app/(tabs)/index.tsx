import React, { useEffect, useState, useMemo } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../src/context/AuthContext';
import { liftCoachApi, coachApi } from '../../src/lib/api';
import { Badge } from '../../src/components/ui/Badge';
import { colors, fontSize, fontWeight, radius, spacing } from '../../src/constants/theme';

// ─── Constants ────────────────────────────────────────────────────────────────

const GREETINGS = [
  "Let's get to work,",
  'Welcome back,',
  "Let's get after it,",
  'Stay consistent,',
  'Keep pushing,',
  'Good to see you,',
  'One rep at a time,',
  'Show up again,',
];

function derivePhaseLabel(maturity?: string, sessionCount?: number): string {
  if (maturity === 'advanced') return 'Phase 3: Mastery';
  if (maturity === 'intermediate') return 'Phase 2: Development';
  if (sessionCount != null && sessionCount >= 9) return 'Phase 3: Mastery';
  if (sessionCount != null && sessionCount >= 4) return 'Phase 2: Development';
  return 'Phase 1: Foundation';
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function HomeScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const [sessions, setSessions] = useState<any[]>([]);
  const [strengthProfile, setStrengthProfile] = useState<any>(null);
  const [welcomeMessage, setWelcomeMessage] = useState<string | null>(null);

  const greeting = useMemo(() => GREETINGS[Math.floor(Math.random() * GREETINGS.length)], []);

  useEffect(() => {
    liftCoachApi.getSessionHistory()
      .then((data) => setSessions(Array.isArray(data) ? data : data.sessions ?? []))
      .catch(() => setSessions([]));
    coachApi.getStrengthProfile()
      .then((data) => setStrengthProfile(data))
      .catch(() => {});
    coachApi.getWelcomeMessage()
      .then((data) => setWelcomeMessage(data.message ?? null))
      .catch(() => {});
  }, []);

  const isPro = user?.tier === 'pro' || user?.tier === 'enterprise';
  const phaseLabel = derivePhaseLabel(strengthProfile?.maturityTier, sessions.length);
  const firstName = user?.name?.split(' ')[0] ?? 'Athlete';

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Phase label + tier badge ── */}
        <View style={styles.topBar}>
          <Text style={styles.phaseLabel}>{phaseLabel.toUpperCase()}</Text>
          {isPro && <Badge variant="pro">PRO</Badge>}
        </View>

        {/* ── Greeting headline ── */}
        <Text style={styles.greetingTitle}>
          {greeting}{'\n'}{firstName}.
        </Text>

        {/* ── Hero card ── */}
        {isPro ? (
          /* Paid: Coach Anakin card */
          <TouchableOpacity
            style={styles.heroCard}
            activeOpacity={0.85}
            onPress={() => router.push('/(tabs)/coach')}
          >
            <View style={styles.heroIconBox}>
              <Ionicons name="sparkles" size={22} color={colors.primaryForeground} />
            </View>
            <View style={styles.heroBottom}>
              <View style={styles.heroTextCol}>
                <Text style={styles.heroTitle}>Coach{'\n'}Anakin</Text>
                <Text style={styles.heroSubtitle}>Open Dashboard</Text>
              </View>
              <View style={styles.heroArrowBtn}>
                <Ionicons name="arrow-forward" size={18} color={colors.foreground} />
              </View>
            </View>
          </TouchableOpacity>
        ) : (
          /* Free: New Analysis card */
          <TouchableOpacity
            style={styles.heroCard}
            activeOpacity={0.85}
            onPress={() => router.push('/diagnostic/onboarding')}
          >
            <View style={styles.heroIconBox}>
              <Ionicons name="barbell-outline" size={22} color={colors.primaryForeground} />
            </View>
            <View style={styles.heroBottom}>
              <View style={styles.heroTextCol}>
                <Text style={styles.heroTitle}>New{'\n'}Analysis</Text>
                <Text style={styles.heroSubtitle}>Begin Session</Text>
              </View>
              <View style={styles.heroArrowBtn}>
                <Ionicons name="arrow-forward" size={18} color={colors.foreground} />
              </View>
            </View>
          </TouchableOpacity>
        )}

        {/* ── Secondary card ── */}
        {isPro ? (
          /* Paid: Anakin's Note */
          welcomeMessage ? (
            <View style={styles.noteCard}>
              <View style={styles.noteAvatarRow}>
                <View style={styles.noteAvatar}>
                  <Ionicons name="sparkles" size={12} color={colors.primaryForeground} />
                </View>
                <Text style={styles.noteLabel}>ANAKIN'S NOTE</Text>
              </View>
              <Text style={styles.noteText}>"{welcomeMessage}"</Text>
            </View>
          ) : null
        ) : (
          /* Free: Unlock AI Coaching upsell */
          <TouchableOpacity
            style={styles.upsellCard}
            activeOpacity={0.82}
            onPress={() => router.push('/(tabs)/coach')}
          >
            <View style={styles.upsellIconBox}>
              <Ionicons name="sparkles" size={18} color={colors.mutedForeground} />
            </View>
            <View style={styles.upsellText}>
              <Text style={styles.upsellTitle}>Unlock AI Coaching</Text>
              <Text style={styles.upsellSubtitle}>
                Get personalized programming and feedback from Anakin.
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.mutedForeground} />
          </TouchableOpacity>
        )}

        {/* ── New Analysis row (for paid users, as a secondary action) ── */}
        {isPro && (
          <TouchableOpacity
            style={styles.rowAction}
            activeOpacity={0.8}
            onPress={() => router.push('/diagnostic/onboarding')}
          >
            <View style={styles.rowActionIcon}>
              <Ionicons name="barbell-outline" size={18} color={colors.foreground} />
            </View>
            <View style={styles.rowActionText}>
              <Text style={styles.rowActionTitle}>New Analysis</Text>
              <Text style={styles.rowActionSubtitle}>Record a manual movement</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={colors.mutedForeground} />
          </TouchableOpacity>
        )}

      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  scroll: { flex: 1 },
  scrollContent: { padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.lg },

  // Top bar
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  phaseLabel: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
    color: colors.mutedForeground,
    letterSpacing: 1.2,
  },

  // Greeting
  greetingTitle: {
    fontSize: 36,
    fontWeight: fontWeight.bold,
    color: colors.foreground,
    letterSpacing: -1,
    lineHeight: 42,
  },

  // Hero card (large black card)
  heroCard: {
    backgroundColor: colors.foreground,
    borderRadius: radius.xl,
    padding: spacing.lg,
    height: 220,
    justifyContent: 'space-between',
  },
  heroIconBox: {
    width: 52,
    height: 52,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroBottom: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
  },
  heroTextCol: { gap: 4 },
  heroTitle: {
    fontSize: 34,
    fontWeight: fontWeight.bold,
    color: colors.primaryForeground,
    letterSpacing: -0.8,
    lineHeight: 38,
  },
  heroSubtitle: {
    fontSize: fontSize.sm,
    color: 'rgba(255,255,255,0.55)',
  },
  heroArrowBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.primaryForeground,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Anakin's Note card (paid)
  noteCard: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: spacing.sm,
  },
  noteAvatarRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  noteAvatar: {
    width: 22,
    height: 22,
    borderRadius: radius.full,
    backgroundColor: colors.foreground,
    alignItems: 'center',
    justifyContent: 'center',
  },
  noteLabel: {
    fontSize: 11,
    fontWeight: fontWeight.semibold,
    color: colors.mutedForeground,
    letterSpacing: 1,
  },
  noteText: {
    fontSize: fontSize.sm,
    color: colors.foreground,
    lineHeight: 21,
  },

  // Upsell card (free)
  upsellCard: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  upsellIconBox: {
    width: 38,
    height: 38,
    borderRadius: radius.sm,
    backgroundColor: colors.muted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  upsellText: { flex: 1, gap: 2 },
  upsellTitle: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    color: colors.foreground,
  },
  upsellSubtitle: {
    fontSize: fontSize.xs,
    color: colors.mutedForeground,
    lineHeight: 17,
  },

  // Row action (secondary action for paid users)
  rowAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.md,
  },
  rowActionIcon: {
    width: 38,
    height: 38,
    borderRadius: radius.sm,
    backgroundColor: colors.muted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowActionText: { flex: 1, gap: 2 },
  rowActionTitle: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    color: colors.foreground,
  },
  rowActionSubtitle: { fontSize: fontSize.xs, color: colors.mutedForeground },

});
