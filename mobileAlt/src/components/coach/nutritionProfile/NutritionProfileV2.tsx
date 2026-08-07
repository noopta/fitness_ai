// Nutrition Profile (effects-first) — the redesigned Strength → Nutrition
// surface (spec "Axiom nutrition profiling designs" §4). Read-only: it reads
// the day's meals from Coach and renders a body-system read on top. Logging is
// NOT here. Six deep screens push onto the native stack (app/nutrition-profile).
//
// Layout (§4): fixed sync header → range selector → hero summary → 5 body-system
// cards → highest-leverage move → meals (or day list) → footer actions.
// Empty/loading states per §7. Status is always dot + pill + number, never
// colour alone (§10).
//
// RANGES. The screen renders the same effects UI for Today, 7 days and 30 days.
// For the windows the server returns MEAN DAILY intake across LOGGED days only,
// so a user who logged nothing today still sees their week. Every figure is
// therefore a per-day rate under a window — see rangeCopy for why the labels
// have to change with it.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, ActivityIndicator, Animated,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { nutritionProfileApi, type NpDayProfile, type NpRange, type NpSystem } from '../../../lib/api';
import { todayStr } from '../../../lib/localDate';
import { requestNutritionTab } from '../../../lib/nutritionPrefill';
import { fontWeight } from '../../../constants/theme';
import { STATUS_STYLE, NP } from './npTokens';
import { NpSegmented } from './NpSegmented';
import { NP_RANGES, rangeCopy, rangeSpokenLabel, type RangeCopy } from './rangeCopy';

// Note: nutrition-profile route paths are cast (`as never`) because expo-router's
// generated typed-routes union hasn't regenerated for these new files yet; it
// refreshes on the next dev-server/EAS build. Matches the repo's existing
// dynamic-route casting (see app/(tabs)/index.tsx, train-together/calendar).
export function NutritionProfileV2() {
  const router = useRouter();
  const [range, setRange] = useState<NpRange>('today');
  const [data, setData] = useState<NpDayProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [staleServer, setStaleServer] = useState(false);
  const spin = React.useRef(new Animated.Value(0)).current;
  // Monotonic request token: toggling 30d → Today can land the slower 30d
  // response last, which would render 30-day numbers under a "Today" pill.
  const reqId = useRef(0);

  // `range` is a parameter, not a closure capture, so this stays stable and the
  // effect below doesn't re-create it on every toggle.
  const load = useCallback(async (r: NpRange, isSync = false) => {
    const id = ++reqId.current;
    if (isSync) setSyncing(true); else setLoading(true);
    try {
      // Always ask for the user's LOCAL day. The endpoint would otherwise
      // default to the server's UTC date and hide meals logged this evening.
      const d = await nutritionProfileApi.getDay(todayStr(), r);
      if (id !== reqId.current) return; // superseded by a newer toggle
      // Backend and mobile deploy independently. An older server ignores the
      // unknown `range` param and answers with TODAY's numbers — which would
      // render under a "30 days" pill as a silent fabrication. Refuse it.
      if (r !== 'today' && d?.range !== r) {
        setStaleServer(true);
        setRange('today');
        return;
      }
      setStaleServer(false);
      setData(d);
    } catch {
      if (id !== reqId.current) return;
      setData(prev => prev ?? { date: '', hasData: false, mealsLogged: 0 });
    } finally {
      if (id === reqId.current) { setLoading(false); setSyncing(false); }
    }
  }, []);

  useEffect(() => { load(range); }, [range, load]);

  // Sync glyph rotates once per pull (§6).
  const onSync = () => {
    spin.setValue(0);
    Animated.timing(spin, { toValue: 1, duration: 600, useNativeDriver: true }).start();
    load(range, true);
  };
  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  // Trust the server's echo over local state for copy, so a window's labels can
  // never describe a range the numbers didn't come from.
  const effRange = data?.range ?? range;
  const copy = rangeCopy(effRange, data?.loggedDays ?? 0, data?.windowDays ?? 1, data?.partialDays ?? 0);

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

      {/* Range selector sits OUTSIDE the ternary below so it stays mounted
          through loading and empty states — that's what lets an unlogged today
          switch to a populated week without navigating away. */}
      <NpSegmented options={NP_RANGES} value={range} onChange={setRange} />

      {staleServer ? (
        <Text style={styles.staleNote}>
          Ranges need a newer app version. Update to see your 7- and 30-day analysis.
        </Text>
      ) : null}

      {loading ? (
        <LoadingSkeleton />
      ) : !data?.hasData ? (
        <EmptyState
          copy={copy}
          range={effRange}
          onGoToCoach={() => { requestNutritionTab(); router.push('/(tabs)/coach'); }}
          onSwitchRange={setRange}
        />
      ) : (
        <>
          <HeroCard data={data} copy={copy} syncing={syncing} />

          <Text style={styles.sectionLabel}>HOW YOUR FOOD IS ACTING</Text>

          {(data.systems ?? []).map(sys => (
            <SystemCard
              key={sys.id}
              sys={sys}
              onPress={() => router.push(`/nutrition-profile/effect/${sys.id}?range=${effRange}` as never)}
            />
          ))}

          {data.topMove ? (
            <TopMoveCard
              move={data.topMove}
              kicker={copy.moveKicker}
              onPress={() => router.push(`/nutrition-profile/recommendations?range=${effRange}` as never)}
            />
          ) : null}

          {/* §4.6 meals for today; one row per calendar day for a window (a
              month of undifferentiated meal rows is not readable). */}
          <Text style={styles.sectionLabel}>{copy.mealsLabel}</Text>
          {effRange === 'today' ? (
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
          ) : (
            <DayList days={data.days ?? []} />
          )}

          {/* §4.7 footer actions */}
          <View style={styles.footerRow}>
            <TouchableOpacity
              style={[styles.footerBtn, styles.footerPrimary]}
              onPress={() => router.push(`/nutrition-profile/recommendations?range=${effRange}` as never)}
              accessibilityRole="button"
            >
              <Text style={styles.footerPrimaryText}>What to eat next</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.footerBtn, styles.footerSecondary]}
              onPress={() => router.push(`/nutrition-profile/trend?range=${effRange === 'today' ? '7d' : effRange}` as never)}
              accessibilityRole="button"
            >
              {/* The averaged hero and the chart's per-day bars are different
                  statistics; this is the "day by day" half of that pair. */}
              <Text style={styles.footerSecondaryText}>Day-by-day trend</Text>
            </TouchableOpacity>
          </View>
        </>
      )}
    </ScrollView>
  );
}

// ─── Hero (§4.3) ──────────────────────────────────────────────────────────────
function HeroCard({ data, copy, syncing }: { data: NpDayProfile; copy: RangeCopy; syncing: boolean }) {
  return (
    <View style={styles.hero}>
      <Text style={styles.heroMicro}>{copy.heroKicker}</Text>
      <Text style={styles.heroHeadline}>{data.headline}</Text>
      <View style={styles.statRail}>
        {/* Under a window this is a per-day mean, so the label must say so —
            read as a window total it understates by up to 30x. */}
        <Stat value={`${data.kcalLogged ?? 0}`} label={copy.kcalLabel} />
        <View style={styles.statRule} />
        <Stat value={`${data.microCoveragePct ?? 0}%`} label="MICRO COVERAGE" />
        <View style={styles.statRule} />
        <Stat value={`${data.profileScore ?? 0}`} label="PROFILE SCORE" />
      </View>
      {copy.coverageNote ? <Text style={styles.provisional}>{copy.coverageNote}</Text> : null}
      {data.profileScoreProvisional ? (
        <Text style={styles.provisional}>Profile score is provisional{syncing ? ' · syncing…' : ''}</Text>
      ) : null}
    </View>
  );
}

// ─── Day list (window ranges) ────────────────────────────────────────────────
// Stands in for the meals list when a window is selected. Unlogged days render
// as a hollow row rather than a zero, mirroring the trend chart's convention —
// a week of silence must not read as a week of bad eating.
function DayList({ days }: { days: NpDayProfile['days'] & {} }) {
  return (
    <View style={styles.mealsCard}>
      {days.map((d, i) => {
        const label = new Date(`${d.date}T12:00:00Z`).toLocaleDateString(undefined, {
          weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC',
        });
        return (
          <View key={d.date} style={[styles.mealRow, i > 0 && styles.mealRowDivider]}>
            <Text
              style={[styles.mealName, { flex: 1 }, !d.logged && styles.dayRowMuted]}
              numberOfLines={1}
            >
              {label}
            </Text>
            <Text style={[styles.mealSlot, !d.logged && styles.dayRowMuted]}>
              {d.logged ? `${d.mealCount} meal${d.mealCount === 1 ? '' : 's'}` : 'not logged'}
            </Text>
            <Text style={[styles.mealKcal, !d.logged && styles.dayRowMuted]}>
              {d.logged ? `${d.kcal}` : '—'}
            </Text>
          </View>
        );
      })}
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
function TopMoveCard({ move, kicker, onPress }: { move: NonNullable<NpDayProfile['topMove']>; kicker: string; onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.moveCard} onPress={onPress} activeOpacity={0.9} accessibilityRole="button">
      <View style={styles.moveHead}>
        <Ionicons name="sparkles" size={13} color={NP.ink} />
        <Text style={styles.moveKicker}>{kicker}</Text>
      </View>
      <Text style={styles.moveTitle}>{move.title} <Text style={styles.moveGain}>{move.gain}</Text></Text>
      <Text style={styles.moveMech}>{move.mechanism}</Text>
      <Text style={styles.moveLink}>See all recommendations ›</Text>
    </TouchableOpacity>
  );
}

// ─── Empty (§7) ───────────────────────────────────────────────────────────────
// Today stays honestly empty — we never auto-switch range, because that would
// hide the fact that today is unlogged. Instead it offers the windows inline:
// nothing logged TODAY is not nothing logged EVER, and the user shouldn't have
// to navigate away to find that out.
function EmptyState({ copy, range, onGoToCoach, onSwitchRange }: {
  copy: RangeCopy;
  range: NpRange;
  onGoToCoach: () => void;
  onSwitchRange: (r: NpRange) => void;
}) {
  // Fragment (not a View) so the parent ScrollView's `gap` applies between the
  // hero and the card — wrapping them made them one child and flush together.
  return (
    <>
      <View style={styles.hero}>
        <Text style={styles.heroMicro}>{copy.heroKicker}</Text>
        <View style={styles.statRail}>
          <Stat value="—" label={copy.kcalLabel} />
          <View style={styles.statRule} />
          <Stat value="—" label="MICRO COVERAGE" />
          <View style={styles.statRule} />
          <Stat value="—" label="PROFILE SCORE" />
        </View>
      </View>
      <View style={styles.emptyCard}>
        <Text style={styles.emptyText}>{copy.emptyText}</Text>
        <TouchableOpacity onPress={onGoToCoach} accessibilityRole="button">
          <Text style={styles.emptyLink}>Go to Coach → Nutrition</Text>
        </TouchableOpacity>
        {/* Only offered from Today. Offering a switch to a window we already
            know is empty is a dead end. */}
        {range === 'today' ? (
          <View style={styles.emptyPillRow}>
            {(['7d', '30d'] as const).map(r => (
              <TouchableOpacity
                key={r}
                style={styles.emptyPill}
                onPress={() => onSwitchRange(r)}
                accessibilityRole="button"
                accessibilityLabel={`Show ${rangeSpokenLabel(r)}`}
              >
                <Text style={styles.emptyPillText}>See {rangeSpokenLabel(r)}</Text>
              </TouchableOpacity>
            ))}
          </View>
        ) : null}
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
  scroll: { flex: 1 },
  staleNote: { fontSize: 12, color: NP.mutedInk, lineHeight: 17 },
  dayRowMuted: { color: NP.mutedInk, opacity: 0.6 },
  emptyPillRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', justifyContent: 'center' },
  emptyPill: { borderWidth: 1, borderColor: NP.border, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
  emptyPillText: { fontSize: 12, fontWeight: fontWeight.semibold, color: NP.ink },
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

  sectionLabel: { fontSize: 10, fontWeight: fontWeight.bold, letterSpacing: 1.2, color: NP.mutedInk },

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
