// Finished-programs archive — lists every prior program the user has run
// with the stats snapshot captured at archive time. Tapping a row opens the
// detail screen. Backed by GET /coach/completed-programs.

import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, RefreshControl, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { coachApi } from '../../src/lib/api';
import { colors, fontSize, fontWeight, radius, spacing } from '../../src/constants/theme';

interface CompletedRow {
  id: string;
  startDate: string;
  endDate: string;
  goal: string | null;
  durationWeeks: number | null;
  daysPerWeek: number | null;
  reason: 'completed' | 'replaced' | null;
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

export default function CompletedProgramsScreen() {
  const router = useRouter();
  const [rows, setRows] = useState<CompletedRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    try {
      const r = await coachApi.getCompletedPrograms();
      setRows(((r as any)?.programs ?? []) as CompletedRow[]);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={10}>
          <Ionicons name="chevron-back" size={24} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={styles.title}>Finished programs</Text>
        <View style={{ width: 24 }} />
      </View>

      {loading ? (
        <View style={styles.loadingBox}><ActivityIndicator color={colors.foreground} /></View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(r) => r.id}
          contentContainerStyle={{ padding: spacing.md, gap: spacing.sm }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} />}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>No finished programs yet</Text>
              <Text style={styles.emptySub}>Your past programs will be archived here automatically when you start a new one.</Text>
            </View>
          }
          renderItem={({ item }) => {
            const dur = item.stats?.durationWeeks ?? item.durationWeeks;
            const wo = item.stats?.workoutsLogged ?? 0;
            const bwChange = item.stats?.bodyWeightChangeLb ?? null;
            return (
              <TouchableOpacity
                style={styles.row}
                onPress={() => router.push(`/completed-programs/${item.id}`)}
                activeOpacity={0.85}
              >
                <View style={styles.rowHead}>
                  <Text style={styles.rowGoal}>{(item.goal ?? 'Program').toString().toUpperCase()}</Text>
                  {item.reason === 'completed' ? (
                    <View style={styles.badgeDone}><Text style={styles.badgeDoneText}>Completed</Text></View>
                  ) : (
                    <View style={styles.badgeRepl}><Text style={styles.badgeReplText}>Replaced</Text></View>
                  )}
                </View>
                <Text style={styles.rowDates}>{fmtDate(item.startDate)} – {fmtDate(item.endDate)}{dur ? `  ·  ${dur}wk` : ''}</Text>
                <View style={styles.statRow}>
                  <Stat label="Workouts" value={String(wo)} />
                  <Stat label="Volume" value={item.stats ? fmtVolume(item.stats.totalVolumeLb) : '—'} />
                  <Stat label="BW Δ" value={bwChange != null ? `${bwChange > 0 ? '+' : ''}${bwChange} lb` : '—'} />
                </View>
              </TouchableOpacity>
            );
          }}
        />
      )}
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
  loadingBox: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  empty: { padding: spacing.xl, alignItems: 'center', gap: spacing.xs },
  emptyTitle: { fontSize: fontSize.base, fontWeight: fontWeight.semibold, color: colors.foreground },
  emptySub: { fontSize: fontSize.sm, color: colors.mutedForeground, textAlign: 'center', lineHeight: 20 },
  row: {
    padding: spacing.md, borderRadius: radius.md,
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border,
    gap: 6,
  },
  rowHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  rowGoal: { fontSize: fontSize.xs, color: colors.primary, fontWeight: fontWeight.bold, letterSpacing: 0.5 },
  rowDates: { fontSize: fontSize.sm, color: colors.foreground },
  badgeDone: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: radius.sm, backgroundColor: `${colors.primary}22` },
  badgeDoneText: { fontSize: fontSize.xs, color: colors.primary, fontWeight: fontWeight.semibold },
  badgeRepl: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: radius.sm, backgroundColor: colors.muted },
  badgeReplText: { fontSize: fontSize.xs, color: colors.mutedForeground, fontWeight: fontWeight.semibold },
  statRow: { flexDirection: 'row', gap: spacing.md, marginTop: 4 },
  stat: { flex: 1 },
  statValue: { fontSize: fontSize.base, fontWeight: fontWeight.bold, color: colors.foreground },
  statLabel: { fontSize: fontSize.xs, color: colors.mutedForeground, marginTop: 1 },
});
