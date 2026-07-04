// Train Together — the overlap calendar (hero screen). Shows the next weeks
// as day rows with one lane per person; days are ranked by match tier using
// a monochrome intensity ramp (exact: solid fill badge + strong border,
// strong: outline, flexible: dashed, none: recedes). Tapping a day opens the
// detail sheet: who's doing what, why it matched, and "Plan to train
// together" (creates a pin — a social annotation; nobody's program changes).

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator,
  Modal, TextInput, Alert, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { trainTogetherApi } from '../../src/lib/api';
import { colors, fontSize, fontWeight, radius, spacing } from '../../src/constants/theme';

type Tier = 'exact' | 'strong' | 'flexible' | 'none';

interface Participant { userId: string; isMe: boolean; name: string; splitLabel: string | null }
interface DaySession { userId: string; rest: boolean; label: string | null }
interface OverlapDay { date: string; tier: Tier; reason: string | null; sessions: DaySession[] }
interface PinRef { id: string; date: string; status: string }

const TIER_LABEL: Record<Tier, string> = {
  exact: 'Exact match', strong: 'Strong match', flexible: 'Could join', none: '',
};
const TIER_ORDER: Record<Tier, number> = { exact: 3, strong: 2, flexible: 1, none: 0 };

type Filter = 'all' | 'strong' | 'exact';
const FILTER_MIN: Record<Filter, number> = { all: 1, strong: 2, exact: 3 };

function weekdayShort(date: string): string {
  return new Date(date + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short' });
}
function dayOfMonth(date: string): string {
  return String(new Date(date + 'T12:00:00Z').getUTCDate());
}
function prettyDate(date: string): string {
  return new Date(date + 'T12:00:00Z').toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric',
  });
}

export default function OverlapCalendarScreen() {
  const router = useRouter();
  const { friendIds } = useLocalSearchParams<{ friendIds: string }>();
  const ids = useMemo(() => String(friendIds ?? '').split(',').filter(Boolean), [friendIds]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dates, setDates] = useState<string[]>([]);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [days, setDays] = useState<OverlapDay[]>([]);
  const [pins, setPins] = useState<PinRef[]>([]);
  const [filter, setFilter] = useState<Filter>('all');
  const [detail, setDetail] = useState<OverlapDay | null>(null);
  const [note, setNote] = useState('');
  const [pinBusy, setPinBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res: any = await trainTogetherApi.getOverlap(ids, 4);
      setDates(res.dates ?? []);
      setParticipants(res.participants ?? []);
      setDays(res.days ?? []);
      setPins(res.pins ?? []);
    } catch (err: any) {
      setError(err?.message ?? 'Could not load schedules');
    } finally {
      setLoading(false);
    }
  }, [ids]);

  useEffect(() => { load(); }, [load]);

  const pinnedDates = useMemo(() => new Set(pins.map(p => p.date)), [pins]);
  const matchCount = useMemo(
    () => days.filter(d => TIER_ORDER[d.tier] >= FILTER_MIN[filter]).length,
    [days, filter],
  );

  const weeks = useMemo(() => {
    const out: OverlapDay[][] = [];
    for (let i = 0; i < days.length; i += 7) out.push(days.slice(i, i + 7));
    return out;
  }, [days]);

  const createPin = async () => {
    if (!detail) return;
    setPinBusy(true);
    try {
      await trainTogetherApi.createPin(detail.date, ids, note.trim() || undefined);
      setDetail(null);
      setNote('');
      Alert.alert('Planned 🤝', `Your friends will get an invite for ${prettyDate(detail.date)}.`);
      load();
    } catch (err: any) {
      Alert.alert('Could not plan it', err?.message ?? 'Please try again.');
    } finally {
      setPinBusy(false);
    }
  };

  const nameOf = (userId: string) => participants.find(p => p.userId === userId);

  const renderDayRow = (day: OverlapDay) => {
    const dimmed = TIER_ORDER[day.tier] < FILTER_MIN[filter];
    const pinned = pinnedDates.has(day.date);
    return (
      <TouchableOpacity
        key={day.date}
        activeOpacity={0.8}
        onPress={() => setDetail(day)}
        style={[
          styles.dayRow,
          day.tier === 'exact' && styles.dayRowExact,
          day.tier === 'strong' && styles.dayRowStrong,
          day.tier === 'flexible' && styles.dayRowFlexible,
          dimmed && styles.dayRowDimmed,
        ]}
      >
        <View style={styles.dayDateCol}>
          <Text style={styles.dayWeekday}>{weekdayShort(day.date)}</Text>
          <Text style={styles.dayNum}>{dayOfMonth(day.date)}</Text>
        </View>
        <View style={styles.lanes}>
          {day.sessions.map(s => {
            const p = nameOf(s.userId);
            return (
              <View key={s.userId} style={styles.lane}>
                <Text style={styles.laneName} numberOfLines={1}>{p?.isMe ? 'You' : p?.name ?? '?'}</Text>
                <Text style={[styles.laneSession, s.rest && styles.laneRest]} numberOfLines={1}>
                  {s.rest ? 'Rest' : s.label ?? '—'}
                </Text>
              </View>
            );
          })}
        </View>
        <View style={styles.dayMetaCol}>
          {pinned && <Text style={styles.pinFlag}>🤝</Text>}
          {day.tier !== 'none' && (
            <View style={[
              styles.tierBadge,
              day.tier === 'exact' && styles.tierBadgeExact,
              day.tier === 'strong' && styles.tierBadgeStrong,
              day.tier === 'flexible' && styles.tierBadgeFlexible,
            ]}>
              <Text style={[styles.tierBadgeText, day.tier === 'exact' && styles.tierBadgeTextExact]}>
                {TIER_LABEL[day.tier]}
              </Text>
            </View>
          )}
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={10}>
          <Ionicons name="chevron-back" size={24} color={colors.foreground} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.title}>Overlap</Text>
          <Text style={styles.subtitle} numberOfLines={1}>
            {participants.map(p => `${p.isMe ? 'You' : p.name}${p.splitLabel ? ` (${p.splitLabel})` : ''}`).join(' + ')}
          </Text>
        </View>
        <View style={{ width: 24 }} />
      </View>

      {/* Tier filter */}
      <View style={styles.filterRow}>
        {(['all', 'strong', 'exact'] as Filter[]).map(f => (
          <TouchableOpacity
            key={f}
            style={[styles.filterChip, filter === f && styles.filterChipActive]}
            onPress={() => setFilter(f)}
          >
            <Text style={[styles.filterChipText, filter === f && styles.filterChipTextActive]}>
              {f === 'all' ? 'All days' : f === 'strong' ? 'Strong +' : 'Exact only'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={colors.foreground} /></View>
      ) : error ? (
        <View style={styles.center}>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={load}>
            <Text style={styles.retryBtnText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : matchCount === 0 ? (
        <View style={styles.center}>
          <Text style={styles.emptyTitle}>No natural overlap yet</Text>
          <Text style={styles.emptyBody}>
            Nothing lines up at this filter in the next 4 weeks. Try "All days" — a friend's rest
            day is a chance to train together too.
          </Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scroll}>
          {weeks.map((week, wi) => (
            <View key={wi}>
              <Text style={styles.weekLabel}>{wi === 0 ? 'This week' : `Week of ${prettyDate(week[0].date).replace(/^\w+, /, '')}`}</Text>
              {week.map(renderDayRow)}
            </View>
          ))}
          <Text style={styles.footNote}>
            Matches compare session types only — everyone keeps their own program.
          </Text>
        </ScrollView>
      )}

      {/* Day detail sheet */}
      <Modal visible={!!detail} transparent animationType="slide" onRequestClose={() => setDetail(null)}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.sheetBackdrop}
        >
          <TouchableOpacity style={{ flex: 1 }} onPress={() => setDetail(null)} />
          {detail && (
            <View style={styles.sheet}>
              <Text style={styles.sheetDate}>{prettyDate(detail.date)}</Text>
              {detail.tier !== 'none' ? (
                <View style={styles.sheetTierRow}>
                  <View style={[
                    styles.tierBadge,
                    detail.tier === 'exact' && styles.tierBadgeExact,
                    detail.tier === 'strong' && styles.tierBadgeStrong,
                    detail.tier === 'flexible' && styles.tierBadgeFlexible,
                  ]}>
                    <Text style={[styles.tierBadgeText, detail.tier === 'exact' && styles.tierBadgeTextExact]}>
                      {TIER_LABEL[detail.tier]}
                    </Text>
                  </View>
                  {detail.reason ? <Text style={styles.sheetReason}>{detail.reason}</Text> : null}
                </View>
              ) : (
                <Text style={styles.sheetReason}>Different focuses this day — no natural match.</Text>
              )}

              <View style={styles.sheetSessions}>
                {detail.sessions.map(s => {
                  const p = nameOf(s.userId);
                  return (
                    <View key={s.userId} style={styles.sheetSessionRow}>
                      <Text style={styles.sheetSessionName}>{p?.isMe ? 'You' : p?.name ?? '?'}</Text>
                      <Text style={[styles.sheetSessionLabel, s.rest && styles.laneRest]}>
                        {s.rest ? 'Rest day' : s.label ?? '—'}
                      </Text>
                    </View>
                  );
                })}
              </View>

              {pinnedDates.has(detail.date) ? (
                <Text style={styles.sheetPinned}>🤝 Already planned — check Upcoming plans.</Text>
              ) : (
                <>
                  <TextInput
                    style={styles.noteInput}
                    placeholder="Add a note — time, gym… (optional)"
                    placeholderTextColor={colors.mutedForeground}
                    value={note}
                    onChangeText={setNote}
                    maxLength={200}
                  />
                  <TouchableOpacity
                    style={[styles.cta, pinBusy && { opacity: 0.6 }]}
                    disabled={pinBusy}
                    onPress={createPin}
                  >
                    {pinBusy
                      ? <ActivityIndicator color={colors.primaryForeground} />
                      : <Text style={styles.ctaText}>Plan to train together 🤝</Text>}
                  </TouchableOpacity>
                </>
              )}
            </View>
          )}
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm, gap: spacing.sm,
  },
  headerCenter: { flex: 1, alignItems: 'center' },
  title: { fontSize: fontSize.lg, fontWeight: fontWeight.bold, color: colors.foreground },
  subtitle: { fontSize: fontSize.xs, color: colors.mutedForeground, marginTop: 2 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },

  filterRow: {
    flexDirection: 'row', gap: spacing.xs,
    paddingHorizontal: spacing.md, paddingBottom: spacing.sm,
  },
  filterChip: {
    borderWidth: 1, borderColor: colors.border, borderRadius: 999,
    paddingHorizontal: spacing.md, paddingVertical: 6,
  },
  filterChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  filterChipText: { fontSize: fontSize.sm, color: colors.foreground },
  filterChipTextActive: { color: colors.primaryForeground, fontWeight: fontWeight.semibold },

  scroll: { paddingHorizontal: spacing.md, paddingBottom: spacing.xxl },
  weekLabel: {
    fontSize: fontSize.xs, fontWeight: fontWeight.semibold, color: colors.mutedForeground,
    textTransform: 'uppercase', letterSpacing: 0.8,
    marginTop: spacing.md, marginBottom: spacing.xs,
  },

  dayRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    padding: spacing.sm, marginBottom: spacing.xs, backgroundColor: colors.card,
  },
  dayRowExact: { borderColor: colors.foreground, borderWidth: 1.5 },
  dayRowStrong: { borderColor: colors.mutedForeground, borderWidth: 1.5 },
  dayRowFlexible: { borderStyle: 'dashed', borderColor: colors.mutedForeground },
  dayRowDimmed: { opacity: 0.35 },
  dayDateCol: { width: 40, alignItems: 'center' },
  dayWeekday: { fontSize: fontSize.xs, color: colors.mutedForeground, textTransform: 'uppercase' },
  dayNum: { fontSize: fontSize.lg, fontWeight: fontWeight.bold, color: colors.foreground },
  lanes: { flex: 1, gap: 2 },
  lane: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  laneName: { fontSize: fontSize.xs, color: colors.mutedForeground, width: 52 },
  laneSession: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.foreground, flex: 1 },
  laneRest: { color: colors.mutedForeground, fontWeight: fontWeight.normal, fontStyle: 'italic' },
  dayMetaCol: { alignItems: 'flex-end', gap: 4 },
  pinFlag: { fontSize: fontSize.sm },

  tierBadge: {
    borderRadius: radius.sm, paddingHorizontal: 8, paddingVertical: 3,
    borderWidth: 1, borderColor: 'transparent',
  },
  tierBadgeExact: { backgroundColor: colors.primary },
  tierBadgeStrong: { borderColor: colors.foreground },
  tierBadgeFlexible: { borderColor: colors.mutedForeground, borderStyle: 'dashed' },
  tierBadgeText: { fontSize: fontSize.xs, fontWeight: fontWeight.semibold, color: colors.foreground },
  tierBadgeTextExact: { color: colors.primaryForeground },

  errorText: { fontSize: fontSize.sm, color: colors.destructive, textAlign: 'center' },
  retryBtn: {
    marginTop: spacing.md, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.sm, paddingHorizontal: spacing.lg, paddingVertical: 8,
  },
  retryBtnText: { color: colors.foreground, fontSize: fontSize.sm },
  emptyTitle: { fontSize: fontSize.lg, fontWeight: fontWeight.bold, color: colors.foreground },
  emptyBody: {
    fontSize: fontSize.sm, color: colors.mutedForeground, textAlign: 'center',
    marginTop: spacing.sm, lineHeight: 19,
  },
  footNote: {
    fontSize: fontSize.xs, color: colors.mutedForeground, textAlign: 'center',
    marginTop: spacing.lg,
  },

  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    backgroundColor: colors.background, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg,
    padding: spacing.lg, paddingBottom: spacing.xl,
  },
  sheetDate: { fontSize: fontSize.lg, fontWeight: fontWeight.bold, color: colors.foreground },
  sheetTierRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm },
  sheetReason: { flex: 1, fontSize: fontSize.sm, color: colors.mutedForeground },
  sheetSessions: {
    marginTop: spacing.md, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md, overflow: 'hidden',
  },
  sheetSessionRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border,
  },
  sheetSessionName: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.foreground },
  sheetSessionLabel: { fontSize: fontSize.sm, color: colors.foreground },
  sheetPinned: { marginTop: spacing.md, fontSize: fontSize.sm, color: colors.mutedForeground },
  noteInput: {
    marginTop: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm,
    paddingHorizontal: spacing.md, paddingVertical: 10,
    fontSize: fontSize.sm, color: colors.foreground,
  },
  cta: {
    marginTop: spacing.md, backgroundColor: colors.primary, borderRadius: radius.md,
    paddingVertical: 14, alignItems: 'center',
  },
  ctaText: { color: colors.primaryForeground, fontSize: fontSize.base, fontWeight: fontWeight.semibold },
});
