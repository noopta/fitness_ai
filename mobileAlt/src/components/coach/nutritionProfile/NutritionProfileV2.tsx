// Nutrition Profile (effects-first) — the redesigned Strength → Nutrition
// surface (spec "Axiom nutrition profiling designs" §4). Read-only: it reads
// the day's meals from Coach and renders a body-system read on top. Logging is
// NOT here. Six deep screens push onto the native stack (app/nutrition-profile).
//
// Layout (§4): fixed sync header → hero summary → 5 body-system cards → today's
// highest-leverage move → today's meals → footer actions. Empty/loading states
// per §7. Status is always dot + pill + number, never colour alone (§10).

import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, ActivityIndicator, Animated,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { nutritionProfileApi, type NpDayProfile, type NpSystem } from '../../../lib/api';
import { todayStr } from '../../../lib/localDate';
import { requestNutritionTab } from '../../../lib/nutritionPrefill';
import { fontWeight } from '../../../constants/theme';
import { STATUS_STYLE, NP } from './npTokens';

// Note: nutrition-profile route paths are cast (`as never`) because expo-router's
// generated typed-routes union hasn't regenerated for these new files yet; it
// refreshes on the next dev-server/EAS build. Matches the repo's existing
// dynamic-route casting (see app/(tabs)/index.tsx, train-together/calendar).
export function NutritionProfileV2() {
  const router = useRouter();
  const [data, setData] = useState<NpDayProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const spin = React.useRef(new Animated.Value(0)).current;

  const load = useCallback(async (isSync = false) => {
    if (isSync) setSyncing(true); else setLoading(true);
    try {
      // Always ask for the user's LOCAL day. The endpoint would otherwise
      // default to the server's UTC date and hide meals logged this evening.
      const d = await nutritionProfileApi.getDay(todayStr());
      setData(d);
    } catch {
      setData(prev => prev ?? { date: '', hasData: false, mealsLogged: 0 });
    } finally {
      setLoading(false); setSyncing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Sync glyph rotates once per pull (§6).
  const onSync = () => {
    spin.setValue(0);
    Animated.timing(spin, { toValue: 1, duration: 600, useNativeDriver: true }).start();
    load(true);
  };
  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      {/* §4.1 sync header */}
      <View style={styles.syncRow}>
        <Text style={styles.syncLabel}>SYNCED FROM COACH</Text>
        <TouchableOpacity onPress={onSync} accessibilityRole="button" accessibilityLabel="Re-sync from Coach" hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Animated.View style={{ transform: [{ rotate }] }}>
            <Ionicons name="refresh" size={14} color={NP.mutedInk} />
          </Animated.View>
        </TouchableOpacity>
      </View>

      {loading ? (
        <LoadingSkeleton />
      ) : !data?.hasData ? (
        <>
          <EmptyState onGoToCoach={() => { requestNutritionTab(); router.push('/(tabs)/coach'); }} />
          {/* Nothing logged TODAY ≠ nothing logged ever. The trend screen
              (7d/30d toggle) reads past days — keep its entry visible so
              returning users can always reach their history. */}
          <TouchableOpacity
            style={styles.emptyTrendLink}
            onPress={() => router.push('/nutrition-profile/trend' as never)}
            accessibilityRole="button"
          >
            <Text style={styles.trendLink}>View past days · 7d / 30d trend ›</Text>
          </TouchableOpacity>
        </>
      ) : (
        <>
          <HeroCard data={data} syncing={syncing} />

          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionLabel}>HOW YOUR FOOD IS ACTING</Text>
            <TouchableOpacity onPress={() => router.push('/nutrition-profile/trend' as never)} accessibilityRole="button">
              <Text style={styles.trendLink}>7-day trend ›</Text>
            </TouchableOpacity>
          </View>

          {(data.systems ?? []).map(sys => (
            <SystemCard
              key={sys.id}
              sys={sys}
              onPress={() => router.push(`/nutrition-profile/effect/${sys.id}` as never)}
            />
          ))}

          {data.topMove ? (
            <TopMoveCard
              move={data.topMove}
              onPress={() => router.push('/nutrition-profile/recommendations' as never)}
            />
          ) : null}

          {/* §4.6 today's meals */}
          <Text style={styles.sectionLabel}>TODAY'S MEALS · SYNCED FROM COACH</Text>
          <View style={styles.mealsCard}>
            {(data.meals ?? []).map((m, i) => (
              <TouchableOpacity
                key={m.id}
                style={[styles.mealRow, i > 0 && styles.mealRowDivider]}
                onPress={() => router.push(`/nutrition-profile/meal/${m.id}` as never)}
                activeOpacity={0.82}
                accessibilityRole="button"
                accessibilityLabel={`${m.name}, ${m.calories} kcal, opens breakdown`}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.mealName} numberOfLines={1}>{m.name}</Text>
                  <Text style={styles.mealSlot}>{m.mealType}</Text>
                </View>
                <Text style={styles.mealKcal}>{m.calories}</Text>
                <Ionicons name="chevron-forward" size={15} color={NP.mutedInk} />
              </TouchableOpacity>
            ))}
          </View>

          {/* §4.7 footer actions */}
          <View style={styles.footerRow}>
            <TouchableOpacity
              style={[styles.footerBtn, styles.footerPrimary]}
              onPress={() => router.push('/nutrition-profile/recommendations' as never)}
              accessibilityRole="button"
            >
              <Text style={styles.footerPrimaryText}>What to eat next</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.footerBtn, styles.footerSecondary]}
              onPress={() => router.push('/nutrition-profile/trend' as never)}
              accessibilityRole="button"
            >
              <Text style={styles.footerSecondaryText}>7-day trend</Text>
            </TouchableOpacity>
          </View>
        </>
      )}
    </ScrollView>
  );
}

// ─── Hero (§4.3) ──────────────────────────────────────────────────────────────
function HeroCard({ data, syncing }: { data: NpDayProfile; syncing: boolean }) {
  return (
    <View style={styles.hero}>
      <Text style={styles.heroMicro}>TODAY · BY BODY SYSTEM</Text>
      <Text style={styles.heroHeadline}>{data.headline}</Text>
      <View style={styles.statRail}>
        <Stat value={`${data.kcalLogged ?? 0}`} label="KCAL LOGGED" />
        <View style={styles.statRule} />
        <Stat value={`${data.microCoveragePct ?? 0}%`} label="MICRO COVERAGE" />
        <View style={styles.statRule} />
        <Stat value={`${data.profileScore ?? 0}`} label="PROFILE SCORE" />
      </View>
      {data.profileScoreProvisional ? (
        <Text style={styles.provisional}>Profile score is provisional{syncing ? ' · syncing…' : ''}</Text>
      ) : null}
    </View>
  );
}
function Stat({ value, label }: { value: string; label: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

// ─── Body-system card (§4.4) ──────────────────────────────────────────────────
function SystemCard({ sys, onPress }: { sys: NpSystem; onPress: () => void }) {
  const st = STATUS_STYLE[sys.status];
  return (
    <TouchableOpacity
      style={styles.sysCard}
      onPress={onPress}
      activeOpacity={0.82}
      accessibilityRole="button"
      accessibilityLabel={`${sys.name}, status ${st.label}, opens detail`}
    >
      <View style={styles.sysRow1}>
        <View style={[styles.dot, { backgroundColor: st.dot }]} />
        <Text style={styles.sysName}>{sys.name}</Text>
        <View style={[styles.pill, { backgroundColor: st.pillBg }]}>
          <Text style={[styles.pillText, { color: st.pillInk }]}>{st.label}</Text>
        </View>
      </View>
      <Text style={styles.sysDriver}>{sys.driver}</Text>
      <View style={styles.chipRow}>
        {sys.chips.map((c, i) => (
          <View key={i} style={styles.chip}><Text style={styles.chipText}>{c}</Text></View>
        ))}
        <View style={{ flex: 1 }} />
        <Ionicons name="chevron-forward" size={15} color={NP.mutedInk} />
      </View>
    </TouchableOpacity>
  );
}

// ─── Top move (§4.5) ──────────────────────────────────────────────────────────
function TopMoveCard({ move, onPress }: { move: NonNullable<NpDayProfile['topMove']>; onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.moveCard} onPress={onPress} activeOpacity={0.9} accessibilityRole="button">
      <View style={styles.moveHead}>
        <Ionicons name="sparkles" size={13} color={NP.ink} />
        <Text style={styles.moveKicker}>TODAY'S HIGHEST-LEVERAGE MOVE</Text>
      </View>
      <Text style={styles.moveTitle}>{move.title} <Text style={styles.moveGain}>{move.gain}</Text></Text>
      <Text style={styles.moveMech}>{move.mechanism}</Text>
      <Text style={styles.moveLink}>See all recommendations ›</Text>
    </TouchableOpacity>
  );
}

// ─── Empty (§7) ───────────────────────────────────────────────────────────────
function EmptyState({ onGoToCoach }: { onGoToCoach: () => void }) {
  // Fragment (not a View) so the parent ScrollView's `gap` applies between the
  // hero and the card — wrapping them made them one child and flush together.
  return (
    <>
      <View style={styles.hero}>
        <Text style={styles.heroMicro}>TODAY · BY BODY SYSTEM</Text>
        <View style={styles.statRail}>
          <Stat value="—" label="KCAL LOGGED" />
          <View style={styles.statRule} />
          <Stat value="—" label="MICRO COVERAGE" />
          <View style={styles.statRule} />
          <Stat value="—" label="PROFILE SCORE" />
        </View>
      </View>
      <View style={styles.emptyCard}>
        <Text style={styles.emptyText}>No meals logged today. Log food in Coach → Nutrition and your profile updates automatically.</Text>
        <TouchableOpacity onPress={onGoToCoach} accessibilityRole="button">
          <Text style={styles.emptyLink}>Go to Coach → Nutrition</Text>
        </TouchableOpacity>
      </View>
    </>
  );
}

// ─── Loading (§7) ─────────────────────────────────────────────────────────────
function LoadingSkeleton() {
  return (
    <>
      <View style={[styles.hero, styles.skeletonHero]}>
        <ActivityIndicator color="#FFFFFF" />
      </View>
      {[0, 1, 2, 3, 4].map(i => <View key={i} style={styles.skeletonCard} />)}
    </>
  );
}

const styles = StyleSheet.create({
  emptyTrendLink: { alignItems: 'center', paddingVertical: 14 },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 16, paddingBottom: 120, gap: 16 },

  syncRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 2 },
  syncLabel: { fontSize: 10, fontWeight: fontWeight.bold, letterSpacing: 1.2, color: NP.mutedInk },

  hero: { backgroundColor: NP.heroBg, borderRadius: 22, padding: 20, gap: 14 },
  skeletonHero: { alignItems: 'center', justifyContent: 'center', minHeight: 150 },
  heroMicro: { fontSize: 10, fontWeight: fontWeight.bold, letterSpacing: 1.2, color: NP.heroMicro },
  heroHeadline: { fontSize: 22, fontWeight: fontWeight.bold, color: NP.heroInk, lineHeight: 28, letterSpacing: -0.4 },
  statRail: { flexDirection: 'row', alignItems: 'stretch' },
  stat: { flex: 1, gap: 3 },
  statValue: { fontSize: 21, fontWeight: fontWeight.bold, color: NP.heroInk, fontVariant: ['tabular-nums'] },
  statLabel: { fontSize: 9, fontWeight: fontWeight.bold, letterSpacing: 0.4, color: NP.heroMicro },
  statRule: { width: 1, backgroundColor: NP.heroRule, marginHorizontal: 12 },
  provisional: { fontSize: 10, color: NP.heroMicro },

  sectionHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionLabel: { fontSize: 10, fontWeight: fontWeight.bold, letterSpacing: 1.2, color: NP.mutedInk },
  trendLink: { fontSize: 12, fontWeight: fontWeight.semibold, color: NP.ink },

  sysCard: { backgroundColor: NP.cardBg, borderRadius: 16, borderWidth: 1, borderColor: NP.border, padding: 15, gap: 10, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 2, shadowOffset: { width: 0, height: 1 } },
  sysRow1: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  sysName: { flex: 1, fontSize: 15, fontWeight: fontWeight.bold, color: NP.ink },
  pill: { paddingHorizontal: 9, paddingVertical: 3, borderRadius: 999 },
  pillText: { fontSize: 10, fontWeight: fontWeight.bold, letterSpacing: 0.3 },
  sysDriver: { fontSize: 12.5, color: NP.mutedInk, lineHeight: 17 },
  chipRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'nowrap' },
  chip: { backgroundColor: NP.muted, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4 },
  chipText: { fontSize: 10, fontWeight: fontWeight.semibold, color: NP.ink },

  moveCard: { backgroundColor: '#FAFAFA', borderRadius: 16, borderWidth: 1, borderColor: NP.ink, padding: 16, gap: 8 },
  moveHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  moveKicker: { fontSize: 10, fontWeight: fontWeight.bold, letterSpacing: 0.8, color: NP.ink },
  moveTitle: { fontSize: 15, fontWeight: fontWeight.bold, color: NP.ink },
  moveGain: { color: '#15803D', fontWeight: fontWeight.bold },
  moveMech: { fontSize: 12, color: NP.mutedInk, lineHeight: 17 },
  moveLink: { fontSize: 12, fontWeight: fontWeight.semibold, color: NP.ink, marginTop: 2 },

  mealsCard: { borderWidth: 1, borderColor: NP.border, borderRadius: 16, overflow: 'hidden' },
  mealRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 12 },
  mealRowDivider: { borderTopWidth: 1, borderTopColor: NP.border },
  mealName: { fontSize: 13, fontWeight: fontWeight.bold, color: NP.ink },
  mealSlot: { fontSize: 11, color: NP.mutedInk, textTransform: 'capitalize' },
  mealKcal: { fontSize: 11, fontWeight: fontWeight.bold, color: NP.ink, fontVariant: ['tabular-nums'] },

  footerRow: { flexDirection: 'row', gap: 10, marginTop: 2 },
  footerBtn: { flex: 1, height: 46, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  footerPrimary: { backgroundColor: NP.ink },
  footerPrimaryText: { color: '#FFFFFF', fontSize: 13, fontWeight: fontWeight.bold },
  footerSecondary: { backgroundColor: NP.cardBg, borderWidth: 1, borderColor: NP.border },
  footerSecondaryText: { color: NP.ink, fontSize: 13, fontWeight: fontWeight.bold },

  emptyCard: { alignItems: 'center', gap: 14, paddingVertical: 28, paddingHorizontal: 22, borderWidth: 1, borderColor: NP.border, borderRadius: 16 },
  emptyText: { fontSize: 13, color: NP.mutedInk, textAlign: 'center', lineHeight: 19 },
  emptyLink: { fontSize: 13, fontWeight: fontWeight.bold, color: NP.ink },

  skeletonCard: { height: 92, borderRadius: 16, backgroundColor: NP.muted },
});
