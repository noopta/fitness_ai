// Train Together — overlap calendar, the hero screen. Recreated from the RN
// implementation spec v1.1 §02 (layout), §03 (match display engine), §04 (day
// detail sheet) and §07 (pin create sheet). Every literal (px, hex, weight)
// comes from the approved prototype — do not restyle ad hoc.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator,
  TextInput, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import Svg, { Path } from 'react-native-svg';
import { trainTogetherApi } from '../../src/lib/api';
import {
  tt, shadowSm, OverlapMark, TTAvatar, TTAvatarStack, TierBadge, SplitBadge,
  PrimaryButton, OutlinedButton, MicroLabel, TTSheet, RowReveal,
} from '../../src/components/trainTogether/primitives';
import {
  type Filter, type OverlapDayDTO, rowState, rowTier, insightLine,
  weekLabel, longDate, weekdayShort, RANK,
} from '../../src/lib/trainTogetherMatch';
import { usePinsRefresh } from '../../src/lib/ttEvents';

interface Participant { userId: string; isMe: boolean; name: string; splitLabel: string | null }
interface PinRef { id: string; date: string; status: string }

const Chevron = ({ dir, size = 14, color = tt.muted, stroke = 2.2 }: {
  dir: 'left' | 'right'; size?: number; color?: string; stroke?: number;
}) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Path
      d={dir === 'left' ? 'M15 18l-6-6 6-6' : 'M9 6l6 6-6 6'}
      stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round"
    />
  </Svg>
);

const firstName = (n: string) => (n || '').split(' ')[0] || n;

export default function OverlapCalendarScreen() {
  const router = useRouter();
  const { friendIds } = useLocalSearchParams<{ friendIds: string }>();
  const ids = useMemo(() => String(friendIds ?? '').split(',').filter(Boolean), [friendIds]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dates, setDates] = useState<string[]>([]);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [days, setDays] = useState<OverlapDayDTO[]>([]);
  const [pins, setPins] = useState<PinRef[]>([]);
  const [filter, setFilter] = useState<Filter>('strong'); // spec: default Strong & up
  const [week, setWeek] = useState(0);                    // horizon: current + 3 weeks
  // ONE sheet, two contents. iOS cannot present a second <Modal> while
  // another is up/dismissing (it swallows the presentation and wedges the
  // UI), so the day-detail and pin-create sheets share a single Modal and
  // swap content inside it.
  const [detail, setDetail] = useState<OverlapDayDTO | null>(null);
  const [sheetMode, setSheetMode] = useState<'day' | 'pin'>('day');
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);

  const openDay = (day: OverlapDayDTO) => { setSheetMode('day'); setDetail(day); };
  const closeSheet = () => { setDetail(null); setNote(''); };
  // Navigate only after the Modal has fully dismissed — pushing a route while
  // a modal is mid-dismissal is the same iOS wedge in a different costume.
  const closeThenPush = (path: string) => {
    closeSheet();
    setTimeout(() => router.push(path as any), 320);
  };

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
  // Keep pin pills current when a partner responds while this screen is up.
  // Refreshes pins only — no loading spinner, no full-screen churn.
  const refreshPins = useCallback(() => {
    trainTogetherApi.getPins()
      .then((r: any) => {
        if (!Array.isArray(r)) return;
        setPins(r
          .filter((p: any) => p.status !== 'cancelled')
          .map((p: any) => ({ id: p.id, date: p.date, status: p.status })));
      })
      .catch(() => {});
  }, []);
  usePinsRefresh(refreshPins);

  const others = useMemo(() => participants.filter(p => !p.isMe), [participants]);
  const otherNames = useMemo(() => others.map(o => firstName(o.name)), [others]);
  const pinByDate = useMemo(() => {
    const m = new Map<string, PinRef>();
    for (const p of pins) if (p.status !== 'cancelled') m.set(p.date, p);
    return m;
  }, [pins]);

  const weekDays = useMemo(() => days.slice(week * 7, week * 7 + 7), [days, week]);
  const weekDates = useMemo(() => dates.slice(week * 7, week * 7 + 7), [dates, week]);
  const insight = useMemo(() => insightLine(days, otherNames), [days, otherNames]);
  const exactEmpty = filter === 'exact' && !weekDays.some(d => rowTier(d) === 'exact');
  const matchedDows = useMemo(() => {
    const set: string[] = [];
    for (const d of days) {
      const t = rowTier(d);
      if ((t === 'exact' || t === 'strong') && !set.includes(weekdayShort(d.date))) set.push(weekdayShort(d.date));
    }
    return set.slice(0, 2);
  }, [days]);

  const nameOf = (userId: string) => participants.find(p => p.userId === userId);
  const laneName = (userId: string) => {
    const p = nameOf(userId);
    return p?.isMe ? 'You' : firstName(p?.name ?? '?');
  };

  async function sendInvite() {
    if (!detail) return;
    setSending(true);
    try {
      const pin: any = await trainTogetherApi.createPin(detail.date, ids, note.trim() || undefined);
      load();
      if (pin?.id) closeThenPush(`/train-together/pin/${pin.id}`);
      else closeSheet();
    } catch (err: any) {
      Alert.alert("Couldn't send the invite", err?.message ?? 'Please try again.');
    } finally {
      setSending(false);
    }
  }

  // ── Day row (§02 D — the core component, 4 visual states) ──────────────────
  const renderDayRow = (day: OverlapDayDTO, i: number) => {
    const st = rowState(day, filter);
    const pin = pinByDate.get(day.date);
    const textColor = st.dim ? tt.dim : tt.ink;
    return (
      <RowReveal key={day.date} index={i}>
        <Pressable
          disabled={st.rest}
          onPress={() => openDay(day)}
          style={({ pressed }) => [
            s.dayRow,
            st.hi ? [s.dayRowMatched, shadowSm] : st.dim ? s.dayRowDimmed : s.dayRowHairline,
            pressed && !st.rest && { opacity: 0.82 },
          ]}
        >
          <View style={s.dateCol}>
            <Text style={[s.dow, { color: st.dim ? tt.dim : tt.ink }]}>{weekdayShort(day.date).toUpperCase()}</Text>
            <Text style={[s.dateNum, { color: st.dim ? tt.dim : tt.ink }]}>
              {new Date(day.date + 'T12:00:00Z').getUTCDate()}
            </Text>
          </View>
          <View style={s.lanes}>
            {st.rest ? (
              <Text style={[s.laneText, { color: tt.dim }]}>
                {participants.length > 2 ? 'Everyone resting' : 'Both resting'}
              </Text>
            ) : (
              day.sessions.map(sess => {
                const restLane = sess.rest;
                const laneColor = st.dim ? tt.dim : restLane ? tt.muted : tt.ink;
                return (
                  <Text key={sess.userId} style={[s.laneText, { color: laneColor }]} numberOfLines={1}>
                    <Text style={{ fontWeight: '500' }}>{laneName(sess.userId)}</Text>
                    <Text style={{ fontWeight: '400' }}>
                      {' · '}
                      {restLane ? (st.tier === 'flex' ? 'Rest — could join' : 'Rest') : sess.label ?? '—'}
                    </Text>
                  </Text>
                );
              })
            )}
          </View>
          <View style={s.tierCol}>
            {pin && (
              <View style={s.pinPill}>
                <OverlapMark width={12} height={8} color={tt.white} variant="solid" />
                <Text style={s.pinPillText}>Pinned</Text>
              </View>
            )}
            {!st.dim && !st.rest && <TierBadge tier={st.tier as any} />}
          </View>
        </Pressable>
      </RowReveal>
    );
  };

  // ── Day detail sheet (§04) ──────────────────────────────────────────────────
  const detailState = detail ? rowState(detail, 'all') : null;
  const detailTier = detail ? rowTier(detail) : 'none';
  const detailPin = detail ? pinByDate.get(detail.date) : undefined;
  const detailMatched = detailTier === 'exact' || detailTier === 'strong' || detailTier === 'flex';
  const reasonParts = useMemo(() => {
    const r = detail?.reason ?? '';
    const m = r.match(/^(.*share )(.+)$/i);
    return m ? { pre: m[1], bold: m[2] } : { pre: r, bold: '' };
  }, [detail?.reason]);

  return (
    <SafeAreaView style={s.root} edges={['top']}>
      {/* A · Header */}
      <View style={s.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={({ pressed }) => pressed && { opacity: 0.82 }}>
          <Chevron dir="left" size={20} color={tt.ink} stroke={2.2} />
        </Pressable>
        <Text style={s.title}>Train together</Text>
        <View style={{ width: 20 }} />
      </View>

      {loading ? (
        <View style={s.center}><ActivityIndicator color={tt.ink} /></View>
      ) : error ? (
        <View style={s.center}>
          <Text style={s.errorText}>{error}</Text>
          <OutlinedButton label="Retry" onPress={load} style={{ marginTop: 16, alignSelf: 'stretch' }} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
          {/* B · Participant chips */}
          <View style={s.chipsRow}>
            {[...participants].sort((a, b) => (b.isMe ? 1 : 0) - (a.isMe ? 1 : 0)).map(p => (
              <View key={p.userId} style={s.chip}>
                <TTAvatar name={p.isMe ? 'You' : p.name} self={p.isMe} size={22}
                  style={!p.isMe ? { backgroundColor: tt.white, borderWidth: 1, borderColor: tt.hairline } : undefined} />
                <Text style={s.chipName}>{p.isMe ? 'You' : firstName(p.name)}</Text>
                <SplitBadge label={p.splitLabel} textOnly />
              </View>
            ))}
            <Pressable onPress={() => router.back()} style={({ pressed }) => [s.addBtn, pressed && { opacity: 0.82 }]}>
              <Text style={s.addBtnText}>+</Text>
            </Pressable>
          </View>

          {/* C · Filter + week pager */}
          <View style={s.filterRow}>
            <View style={s.segTrack}>
              {(['exact', 'strong', 'all'] as Filter[]).map(f => {
                const sel = filter === f;
                return (
                  <Pressable key={f} onPress={() => setFilter(f)}
                    style={[s.segItem, sel && s.segItemSel]}>
                    <Text style={[s.segText, sel && s.segTextSel]}>
                      {f === 'exact' ? 'Exact' : f === 'strong' ? 'Strong & up' : 'All'}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <View style={s.pager}>
              <Pressable disabled={week === 0} onPress={() => setWeek(w => w - 1)} hitSlop={10}
                style={week === 0 && { opacity: 0.3 }}>
                <Chevron dir="left" />
              </Pressable>
              <Text style={s.pagerLabel}>{weekLabel(weekDates)}</Text>
              <Pressable disabled={week >= 3} onPress={() => setWeek(w => w + 1)} hitSlop={10}
                style={week >= 3 && { opacity: 0.3 }}>
                <Chevron dir="right" />
              </Pressable>
            </View>
          </View>

          {/* E · Exact-filter empty card */}
          {exactEmpty && (
            <View style={s.emptyCard}>
              <Text style={s.emptyCardText}>
                No exact matches this week. <Text style={{ color: tt.ink, fontWeight: '600' }}>Strong & up</Text> finds
                sessions that pair well together.
              </Text>
              <Pressable onPress={() => setFilter('strong')}
                style={({ pressed }) => [s.lowerBarBtn, pressed && { opacity: 0.82 }]}>
                <Text style={s.lowerBarText}>Lower the bar</Text>
              </Pressable>
            </View>
          )}

          {/* D · Day rows */}
          <View style={{ gap: 6, marginTop: 12 }} key={`${week}-${filter}`}>
            {weekDays.map(renderDayRow)}
          </View>

          {/* Insight line */}
          {insight && (
            <Text style={s.insight}>
              {insight.pre}
              <Text style={{ color: tt.ink, fontWeight: '600' }}>{insight.bold}</Text>
              {insight.post}
            </Text>
          )}
        </ScrollView>
      )}

      {/* ── Single sheet: day detail (§04) or pin create (§07) ─────────────── */}
      <TTSheet visible={!!detail} onClose={closeSheet}>
        {detail && sheetMode === 'day' && (
          <View>
            <View style={s.sheetTitleRow}>
              <View style={{ flex: 1 }}>
                <Text style={s.sheetTitle}>{longDate(detail.date)}</Text>
                <Text style={s.sheetParticipants}>
                  {participants.map(p => (p.isMe ? 'You' : firstName(p.name))).join(' + ')}
                </Text>
              </View>
              {!detailState?.rest && detailTier !== 'none' && <TierBadge tier={detailTier as any} scaleUp />}
            </View>

            {/* Session cards */}
            <View style={{ marginTop: 16, gap: 8 }}>
              {detail.sessions.map(sess => {
                const p = nameOf(sess.userId);
                const muscles = (sess as any).muscles as string[] | undefined;
                return (
                  <View key={sess.userId} style={s.sessionCard}>
                    <TTAvatar name={p?.isMe ? 'You' : p?.name} self={p?.isMe} size={32} />
                    <View style={{ flex: 1 }}>
                      <Text style={s.sessionName}>
                        {sess.rest ? 'Rest day' : sess.label ?? '—'}
                      </Text>
                      <Text style={s.sessionMuscles} numberOfLines={1}>
                        {sess.rest
                          ? (p?.isMe ? 'You could join' : `${firstName(p?.name ?? '')} could join`)
                          : muscles?.length ? muscles.join(', ') : (p?.isMe ? 'Your session' : `${firstName(p?.name ?? '')}'s session`)}
                      </Text>
                    </View>
                    <SplitBadge label={p?.splitLabel} />
                  </View>
                );
              })}
            </View>

            {/* Reason block */}
            {!!detail.reason && (
              <View style={s.reasonBlock}>
                <Text style={s.reasonText}>
                  {reasonParts.pre}
                  <Text style={{ fontWeight: '600' }}>{reasonParts.bold}</Text>
                </Text>
              </View>
            )}

            {/* CTA — three variants */}
            <View style={{ marginTop: 16 }}>
              {detailPin ? (
                <OutlinedButton label="Manage this pin"
                  onPress={() => closeThenPush(`/train-together/pin/${detailPin.id}`)} />
              ) : detailMatched ? (
                <PrimaryButton
                  label="Plan to train together"
                  icon={<OverlapMark width={16} height={11} color={tt.white} variant="solid" />}
                  onPress={() => setSheetMode('pin')}
                />
              ) : (
                <View style={s.noMatchRow}>
                  <Text style={s.noMatchText}>
                    These sessions don't overlap{matchedDows.length ? ` — ${matchedDows.join(' and ')} do.` : '.'}
                  </Text>
                </View>
              )}
            </View>
          </View>
        )}

        {/* Pin create content (§07) — same Modal, swapped content */}
        {detail && sheetMode === 'pin' && (
          <View>
            <View style={s.pinTitleRow}>
              <OverlapMark width={26} height={18} color={tt.ink} variant="solid" />
              <Text style={s.sheetTitle}>Plan to train together</Text>
            </View>

            <View style={{ marginTop: 16, gap: 8 }}>
              <View style={s.fieldCard}>
                <View style={{ flex: 1 }}>
                  <MicroLabel>Date</MicroLabel>
                  <Text style={s.fieldValue}>{longDate(detail.date)}</Text>
                </View>
                {detailTier !== 'none' && detailTier !== 'rest' && <TierBadge tier={detailTier as any} />}
              </View>
              <View style={s.fieldCard}>
                <View style={{ flex: 1 }}>
                  <MicroLabel>With</MicroLabel>
                  <Text style={s.fieldValue}>{otherNames.join(', ')}</Text>
                </View>
                <TTAvatarStack size={26} people={others.map(o => ({ name: o.name }))} />
              </View>
              <View style={s.fieldCard}>
                <View style={{ flex: 1 }}>
                  <MicroLabel>Note · Optional</MicroLabel>
                  <TextInput
                    style={s.noteInput}
                    value={note}
                    onChangeText={setNote}
                    placeholder="Time, gym, meet spot…"
                    placeholderTextColor={tt.muted}
                    maxLength={200}
                  />
                </View>
              </View>
            </View>

            <Text style={s.scopeLine}>
              {otherNames.join(' and ')} {others.length === 1 ? 'gets' : 'get'} an invite. Nobody's program
              changes — this is just a plan on top of {others.length === 1 ? 'both' : 'your'} schedules.
            </Text>

            <PrimaryButton
              label={sending ? 'Sending…' : 'Send invite'}
              disabled={sending}
              onPress={sendInvite}
              style={{ marginTop: 14 }}
            />
          </View>
        )}
      </TTSheet>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: tt.white },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20 },
  errorText: { fontSize: 12.5, color: tt.muted, textAlign: 'center' },
  scroll: { paddingHorizontal: 20, paddingBottom: 48 },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingTop: 8,
  },
  title: { fontSize: 16, fontWeight: '600', letterSpacing: -0.32, color: tt.ink },

  chipsRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12, flexWrap: 'wrap' },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: tt.surface, borderRadius: 9999,
    paddingVertical: 4, paddingLeft: 4, paddingRight: 10,
  },
  chipName: { fontSize: 12, fontWeight: '600', color: tt.ink },
  addBtn: {
    width: 26, height: 26, borderRadius: 13, marginLeft: 'auto',
    borderWidth: 1, borderStyle: 'dashed', borderColor: tt.dim,
    alignItems: 'center', justifyContent: 'center',
  },
  addBtnText: { fontSize: 14, fontWeight: '500', color: tt.muted, marginTop: -1 },

  filterRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginTop: 12, gap: 8,
  },
  segTrack: { flexDirection: 'row', backgroundColor: tt.surface, borderRadius: 10, padding: 2 },
  segItem: { paddingVertical: 5, paddingHorizontal: 10, borderRadius: 8 },
  segItemSel: {
    backgroundColor: tt.white, borderWidth: 1, borderColor: tt.hairline,
    shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: 1,
  },
  segText: { fontSize: 11, fontWeight: '500', color: tt.muted },
  segTextSel: { fontWeight: '600', color: tt.ink },
  pager: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  pagerLabel: { fontSize: 11.5, fontWeight: '600', color: tt.ink },

  emptyCard: {
    marginTop: 12, borderWidth: 1, borderStyle: 'dashed', borderColor: '#d4d4d8',
    borderRadius: 14, paddingVertical: 13, paddingHorizontal: 14,
    flexDirection: 'row', alignItems: 'center', gap: 10,
  },
  emptyCardText: { flex: 1, fontSize: 11.5, color: tt.muted, lineHeight: 16 },
  lowerBarBtn: { backgroundColor: tt.ink, borderRadius: 9999, paddingVertical: 6, paddingHorizontal: 11 },
  lowerBarText: { fontSize: 11, fontWeight: '600', color: tt.white },

  dayRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 10, paddingHorizontal: 12, borderRadius: 14,
    borderWidth: 1, minHeight: 44, backgroundColor: tt.white,
  },
  dayRowMatched: { borderColor: tt.ink },
  dayRowHairline: { borderColor: tt.hairline },
  dayRowDimmed: { borderColor: 'transparent' },
  dateCol: { width: 34 },
  dow: { fontSize: 9, fontWeight: '700', letterSpacing: 1 },
  dateNum: { fontSize: 15, fontWeight: '700' },
  lanes: { flex: 1, gap: 3 },
  laneText: { fontSize: 12 },
  tierCol: { alignItems: 'flex-end', gap: 4 },
  pinPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: tt.ink, borderRadius: 9999, paddingVertical: 3, paddingHorizontal: 8,
  },
  pinPillText: { fontSize: 10, fontWeight: '600', color: tt.white },

  insight: { marginTop: 14, fontSize: 11, lineHeight: 16.5, color: tt.muted },

  sheetTitleRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 },
  sheetTitle: { fontSize: 19, fontWeight: '700', letterSpacing: -0.38, color: tt.ink },
  sheetParticipants: { fontSize: 12, color: tt.muted, marginTop: 2 },
  sessionCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    borderWidth: 1, borderColor: tt.hairline, borderRadius: 14, padding: 12,
  },
  sessionName: { fontSize: 13, fontWeight: '600', color: tt.ink },
  sessionMuscles: { fontSize: 11, color: tt.muted, marginTop: 1 },
  reasonBlock: {
    marginTop: 14, backgroundColor: tt.surface, borderRadius: 12,
    paddingVertical: 12, paddingHorizontal: 14,
  },
  reasonText: { fontSize: 12.5, color: tt.ink, lineHeight: 19.4 },
  noMatchRow: {
    borderWidth: 1, borderStyle: 'dashed', borderColor: '#d4d4d8',
    borderRadius: 14, padding: 13,
  },
  noMatchText: { fontSize: 12, color: tt.muted, textAlign: 'center' },

  pinTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  fieldCard: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderWidth: 1, borderColor: tt.hairline, borderRadius: 14,
    paddingVertical: 13, paddingHorizontal: 14,
  },
  fieldValue: { fontSize: 13.5, fontWeight: '600', color: tt.ink, marginTop: 2 },
  noteInput: { fontSize: 13.5, color: tt.ink, marginTop: 2, padding: 0 },
  scopeLine: { marginTop: 12, fontSize: 11.5, lineHeight: 17.25, color: tt.muted },
});
