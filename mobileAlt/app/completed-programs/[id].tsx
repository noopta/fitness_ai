// Single finished-program detail — full archived program shape plus the
// stats snapshot. Pulled from GET /coach/completed-programs/:id.

import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, ActivityIndicator, TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { coachApi } from '../../src/lib/api';
import { colors, fontSize, fontWeight, radius, spacing } from '../../src/constants/theme';

interface Detail {
  id: string;
  startDate: string;
  endDate: string;
  goal: string | null;
  durationWeeks: number | null;
  daysPerWeek: number | null;
  reason: 'completed' | 'replaced' | null;
  programJson: any;
  stats: null | {
    workoutsLogged: number;
    daysActive: number;
    totalVolumeLb: number;
    bodyWeightStartLb: number | null;
    bodyWeightEndLb: number | null;
    bodyWeightChangeLb: number | null;
    durationWeeks: number | null;
  };
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtVolume(lb: number): string {
  if (lb >= 1_000_000) return `${(lb / 1_000_000).toFixed(1)}M lb`;
  if (lb >= 1000) return `${(lb / 1000).toFixed(1)}k lb`;
  return `${lb} lb`;
}

export default function CompletedProgramDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [data, setData] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    coachApi.getCompletedProgram(id)
      .then((r) => setData(r as Detail))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <SafeAreaView style={styles.root} edges={['top']}>
        <View style={styles.center}><ActivityIndicator color={colors.foreground} /></View>
      </SafeAreaView>
    );
  }
  if (!data) {
    return (
      <SafeAreaView style={styles.root} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} hitSlop={10}>
            <Ionicons name="chevron-back" size={24} color={colors.foreground} />
          </TouchableOpacity>
          <Text style={styles.title}>Program</Text>
          <View style={{ width: 24 }} />
        </View>
        <View style={styles.center}><Text style={styles.muted}>Not found.</Text></View>
      </SafeAreaView>
    );
  }

  const phases = Array.isArray(data.programJson?.phases) ? data.programJson.phases : [];
  const dur = data.stats?.durationWeeks ?? data.durationWeeks;

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={10}>
          <Ionicons name="chevron-back" size={24} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={styles.title}>{(data.goal ?? 'Program').toString()}</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.md, gap: spacing.md }}>
        <View style={styles.headBox}>
          <Text style={styles.dates}>{fmtDate(data.startDate)} – {fmtDate(data.endDate)}{dur ? `  ·  ${dur}wk` : ''}{data.daysPerWeek ? `  ·  ${data.daysPerWeek}d/wk` : ''}</Text>
          <View style={[data.reason === 'completed' ? styles.badgeDone : styles.badgeRepl, { alignSelf: 'flex-start', marginTop: 6 }]}>
            <Text style={data.reason === 'completed' ? styles.badgeDoneText : styles.badgeReplText}>
              {data.reason === 'completed' ? 'Completed' : 'Replaced'}
            </Text>
          </View>
        </View>

        {data.stats ? (
          <View style={styles.statGrid}>
            <Stat label="Workouts logged" value={String(data.stats.workoutsLogged)} />
            <Stat label="Days active" value={String(data.stats.daysActive)} />
            <Stat label="Total volume" value={fmtVolume(data.stats.totalVolumeLb)} />
            <Stat
              label="Bodyweight change"
              value={data.stats.bodyWeightChangeLb != null
                ? `${data.stats.bodyWeightChangeLb > 0 ? '+' : ''}${data.stats.bodyWeightChangeLb} lb`
                : '—'}
            />
          </View>
        ) : null}

        {phases.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Phases</Text>
            {phases.map((p: any, i: number) => (
              <View key={i} style={styles.phaseRow}>
                <Text style={styles.phaseName}>
                  {p?.phaseName ?? p?.name ?? `Phase ${i + 1}`}
                </Text>
                <Text style={styles.phaseSub}>
                  {(p?.durationWeeks ?? p?.weeks ?? 1)}wk · {(p?.trainingDays ?? p?.days ?? []).length} training days
                </Text>
              </View>
            ))}
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  title: { fontSize: fontSize.base, fontWeight: fontWeight.bold, color: colors.foreground },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  muted: { color: colors.mutedForeground, fontSize: fontSize.sm },
  headBox: { padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  dates: { fontSize: fontSize.sm, color: colors.foreground },
  badgeDone: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: radius.sm, backgroundColor: `${colors.primary}22` },
  badgeDoneText: { fontSize: fontSize.xs, color: colors.primary, fontWeight: fontWeight.semibold },
  badgeRepl: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: radius.sm, backgroundColor: colors.muted },
  badgeReplText: { fontSize: fontSize.xs, color: colors.mutedForeground, fontWeight: fontWeight.semibold },

  statGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  stat: {
    flexBasis: '47%', flexGrow: 1,
    padding: spacing.md, borderRadius: radius.md,
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border,
  },
  statValue: { fontSize: fontSize.lg, fontWeight: fontWeight.bold, color: colors.foreground },
  statLabel: { fontSize: fontSize.xs, color: colors.mutedForeground, marginTop: 2 },

  section: { gap: spacing.xs },
  sectionLabel: { fontSize: fontSize.xs, color: colors.mutedForeground, fontWeight: fontWeight.semibold, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 },
  phaseRow: { padding: spacing.sm, borderRadius: radius.md, backgroundColor: colors.muted, borderWidth: 1, borderColor: colors.border },
  phaseName: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.foreground },
  phaseSub: { fontSize: fontSize.xs, color: colors.mutedForeground, marginTop: 2 },
});
