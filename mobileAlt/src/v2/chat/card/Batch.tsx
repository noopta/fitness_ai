// Past workouts (WRK-13) — "Show the count up front. Open a row to check it.
// Undo the whole batch at once." (design spec, 7 Oct 2026).
//
// list:  up to 12 sessions. A tick per session (all on; undated ones off until
//        dated), lift names by default, tap a row for its sets. An undated
//        session is a row with an inline date.
// weeks: over 12. A count hero, sessions per week as bars, then one row per
//        week that opens to its days (and a day to its sets). No ticks — big
//        batches are adjusted by asking Anakin ("skip the week of 27 Jul").
// No scroll area inside the card: the chat scrolls.

import React, { useState } from 'react';
import { View, Text, Pressable, Platform, StyleSheet } from 'react-native';
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import type { BatchBlock, BatchSession } from '@axiom/agent-ui-core';
import { K, S } from './tokens';
import { Hero, Bars } from './charts';
import { haptics } from '../../haptics';
import { v2 } from '../../theme';

const HIT = { top: 8, bottom: 8, left: 8, right: 8 };
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** YYYY-MM-DD in local time. */
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
/** "Wed 15 Jul" for a YYYY-MM-DD. */
export const dayLabel = (s: string) => { const d = new Date(`${s}T12:00:00`); return `${WD[d.getDay()]} ${d.getDate()} ${MO[d.getMonth()]}`; };

export interface BatchPick {
  /** Ticked: on by default for dated sessions, off for undated until dated. */
  ticked: (s: BatchSession) => boolean;
  toggle: (s: BatchSession) => void;
  /** A date the user gave an undated session. */
  dateFor: (s: BatchSession) => string | undefined;
  setDate: (s: BatchSession, d: string) => void;
}

export function BatchView({ cardId, batch, live, pick }: { cardId: string; batch: BatchBlock; live: boolean; pick: BatchPick }) {
  if (batch.kind === 'weeks') return <Weeks cardId={cardId} batch={batch} />;
  return (
    <View>
      {batch.sessions.map((s, i) => (
        <SessionRow key={s.i} s={s} last={i === batch.sessions.length - 1} tick={batch.selectable && live} pick={pick} live={live} />
      ))}
      {batch.leftOut ? <Text style={[S.note, { marginTop: 12 }]}>{batch.leftOut}</Text> : null}
    </View>
  );
}

function SessionRow({ s, last, tick, pick, live, indent }: { s: BatchSession; last?: boolean; tick?: boolean; pick?: BatchPick; live?: boolean; indent?: boolean }) {
  const [open, setOpen] = useState(false);
  const [iosDate, setIosDate] = useState<Date | null>(null);
  const given = pick?.dateFor(s);
  const date = s.date ?? given ?? null;
  const on = pick ? pick.ticked(s) : true;
  const undated = !s.date;

  const askDate = () => {
    if (!live || !pick) return;
    haptics.select();
    const start = given ? new Date(`${given}T12:00:00`) : new Date();
    const max = new Date();
    const min = new Date(); min.setFullYear(min.getFullYear() - 1);
    if (Platform.OS === 'android') {
      DateTimePickerAndroid.open({ value: start, mode: 'date', maximumDate: max, minimumDate: min, onChange: (e, d) => { if (e.type === 'set' && d) pick.setDate(s, iso(d)); } });
    } else setIosDate(start);
  };

  return (
    <View style={[st.row, !last && st.rowLine, indent && { paddingLeft: 0 }]}>
      <View style={st.rowTop}>
        {tick ? (
          <Pressable onPress={() => { if (undated && !date) { askDate(); return; } haptics.select(); pick!.toggle(s); }} hitSlop={HIT}
            accessibilityRole="checkbox" accessibilityState={{ checked: on }} accessibilityLabel={`${date ? dayLabel(date) : 'Undated'} ${s.title ?? 'workout'}`}>
            <View style={[st.tick, on ? st.tickOn : st.tickOff]}>{on ? <Text style={st.tickMark}>✓</Text> : null}</View>
          </Pressable>
        ) : null}
        <Pressable style={{ flex: 1, minWidth: 0 }} onPress={() => { haptics.select(); setOpen((o) => !o); }} accessibilityRole="button" accessibilityState={{ expanded: open }}
          accessibilityLabel={`${date ? dayLabel(date) : 'No date'}, ${s.title ?? 'Workout'}, ${s.count}`}>
          <View style={st.line1}>
            {undated && !given ? (
              <Text style={[S.rowKey, { color: live ? K.crimson : K.muted, fontFamily: v2.font.semibold }]} onPress={live ? askDate : undefined} suppressHighlighting>Add a date</Text>
            ) : (
              <Text style={[S.rowKey, { fontFamily: v2.font.semibold }]} onPress={undated && live ? askDate : undefined} suppressHighlighting>{dayLabel(date!)}</Text>
            )}
            <Text style={[S.rowSub, { fontSize: 13, marginLeft: 8, flexShrink: 1 }]} numberOfLines={1}>{s.title ?? 'Workout'}</Text>
            <View style={{ flex: 1 }} />
            <Text style={[S.rowSub, { fontSize: 13 }]}>{undated && !given ? 'No date' : s.count} {open ? '⌄' : '›'}</Text>
          </View>
          <Text style={[S.rowSub, { marginTop: 2 }]} numberOfLines={1}>{s.names}</Text>
        </Pressable>
      </View>
      {iosDate ? (
        <View style={st.picker}>
          <DateTimePicker value={iosDate} mode="date" display="compact" maximumDate={new Date()} onChange={(_e, d) => d && setIosDate(d)} />
          <View style={{ flexDirection: 'row', gap: 18, marginTop: 6 }}>
            <Pressable onPress={() => setIosDate(null)} hitSlop={HIT}><Text style={S.secondary}>Cancel</Text></Pressable>
            <Pressable onPress={() => { const d = iosDate; setIosDate(null); pick?.setDate(s, iso(d)); }} hitSlop={HIT}><Text style={S.primary}>Set date</Text></Pressable>
          </View>
        </View>
      ) : null}
      {open ? (
        <View style={[st.detail, tick && { paddingLeft: TICK + 12 }]}>
          {s.detail.map((d, k) => (
            <View key={k} style={st.detailRow}>
              <Text style={[S.rowSub, { fontSize: 13, color: K.ink, flex: 1 }]} numberOfLines={1}>{d.name}</Text>
              <Text style={[S.rowSub, { fontSize: 13, fontVariant: ['tabular-nums'] }]}>{d.value}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function Weeks({ cardId, batch }: { cardId: string; batch: BatchBlock }) {
  const [open, setOpen] = useState<number | null>(null);
  const byId = new Map(batch.sessions.map((s) => [s.i, s]));
  return (
    <View>
      {batch.hero ? (
        <View style={{ marginBottom: 12 }}>
          <Hero cardId={cardId} hero={{ value: batch.hero.value, unit: batch.hero.unit }} />
          <Text style={[S.note, { marginTop: 2 }]}>{batch.hero.sub}</Text>
        </View>
      ) : null}
      {batch.bars?.v.length ? (
        <View style={{ marginBottom: 6 }}>
          <Bars cardId={cardId} bars={{ v: batch.bars.v }} />
          <View style={{ flexDirection: 'row', marginTop: 6 }}>
            <Text style={[S.tileName, { flex: 1, color: K.faint }]}>{batch.bars.from}</Text>
            <Text style={[S.tileName, { color: K.faint }]}>{batch.bars.to}</Text>
          </View>
        </View>
      ) : null}
      {(batch.weeks ?? []).map((w, i, all) => (
        <View key={w.label} style={[st.row, i < all.length - 1 && st.rowLine]}>
          <Pressable onPress={() => { haptics.select(); setOpen(open === i ? null : i); }} accessibilityRole="button" accessibilityState={{ expanded: open === i }} accessibilityLabel={`${w.label}, ${w.count}`}>
            <View style={st.line1}>
              <Text style={[S.rowKey, { fontFamily: v2.font.semibold }]}>{w.label}</Text>
              <View style={{ flex: 1 }} />
              <Text style={[S.rowSub, { fontSize: 13 }]}>{w.count} {open === i ? '⌄' : '›'}</Text>
            </View>
            <Text style={[S.rowSub, { marginTop: 2 }]} numberOfLines={1}>{w.sub}</Text>
          </Pressable>
          {open === i ? (
            <View style={{ marginTop: 6, paddingLeft: 12 }}>
              {w.ids.map((id, k) => { const s = byId.get(id); return s ? <SessionRow key={id} s={s} last={k === w.ids.length - 1} indent /> : null; })}
            </View>
          ) : null}
        </View>
      ))}
      {batch.leftOut ? <Text style={[S.note, { marginTop: 12 }]}>{batch.leftOut}</Text> : null}
    </View>
  );
}

const TICK = 22;
const st = StyleSheet.create({
  row: { paddingVertical: 10 },
  rowLine: { borderBottomWidth: 1, borderBottomColor: K.rowLine },
  rowTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  line1: { flexDirection: 'row', alignItems: 'baseline' },
  tick: { width: TICK, height: TICK, borderRadius: TICK / 2, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  tickOn: { backgroundColor: K.ink },
  tickOff: { borderWidth: 1.5, borderColor: K.dim },
  tickMark: { color: '#ffffff', fontSize: 12, fontFamily: v2.font.bold, lineHeight: 14 },
  detail: { marginTop: 8, gap: 6 },
  detailRow: { flexDirection: 'row', alignItems: 'baseline', gap: 12 },
  picker: { alignItems: 'flex-start', marginTop: 8, paddingLeft: TICK + 12 },
});
