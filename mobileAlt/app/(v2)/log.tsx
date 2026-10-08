// Log a workout (design handoff T-01, with T-02 exercise search and T-03
// backdate). Training → + Log. One page: the name, when it was, a note, and
// the exercises as set tables. Last time's sets show grey; tap a value to
// type it, tap the circle when the set's done — a blank set ticked takes last
// time's numbers. Only ticked sets are logged. The draft is kept on the phone
// as you go ("Draft saved"), so leaving never loses it.
//
// + Add exercise opens search (T-02): the field is the header and the keyboard
// is up straight away; results show your best recent set; no match → create it.
// When (T-03): Today, Yesterday, or a date — backdated sessions count toward
// that day's streak.

import React, { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { View, Text, TextInput, ScrollView, StyleSheet, Alert, Platform, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import AsyncStorage from '@react-native-async-storage/async-storage';
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { useQuery } from '@tanstack/react-query';
import { emptyLogger, loggerReducer, loggerToLogBody, loggerHasWork, exerciseCategory, EXERCISE_CATEGORIES, whenLabel, resumableLogger, type ExerciseCategory, type LoggerState } from '@axiom/agent-ui-core';
import { v2, T } from '../../src/v2/theme';
import { Pressable } from '../../src/v2/primitives/Pressable';
import { Row } from '../../src/v2/primitives/Row';
import { TextAction } from '../../src/v2/primitives/TextAction';
import { Sheet, PromptSheet } from '../../src/v2/primitives/Sheet';
import { workoutsApi } from '../../src/lib/api';
import { todayStr } from '../../src/lib/localDate';
import { useUnits } from '../../src/context/UnitsContext';
import { useInvalidate } from '../../src/v2/data';
import { haptics } from '../../src/v2/haptics';
import { trackScreen } from '../../src/lib/analytics';
import { KeyboardAvoider } from '../../src/components/ui/KeyboardAvoider';
import { KeyboardDoneBar, KEYBOARD_DONE_ID } from '../../src/components/ui/KeyboardDoneBar';

const DRAFT_KEY = 'v2.loggerDraft.v1';
const C = v2.color;
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const num = (t: string): number | null => { const n = Number(t.replace(',', '.')); return t.trim() && Number.isFinite(n) && n >= 0 ? n : null; };

export default function LogScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const invalidate = useInvalidate();
  const { unit, fromKg, toKg } = useUnits();
  const today = todayStr();
  const [s, dispatch] = useReducer(loggerReducer, undefined, () => emptyLogger(today, 'Workout'));
  const [loaded, setLoaded] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [searching, setSearching] = useState(false);
  const [whenOpen, setWhenOpen] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [titleOpen, setTitleOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => { trackScreen('v2.log'); }, []);
  // Pick up a draft left on this phone.
  useEffect(() => {
    void AsyncStorage.getItem(DRAFT_KEY).then((raw) => {
      const d = resumableLogger(raw ? JSON.parse(raw) : null, Date.now());
      if (d) { dispatch({ type: 'restore', state: d.state }); setSavedAt(d.savedAt); }
    }).catch(() => {}).finally(() => setLoaded(true));
  }, []);
  // Keep it as you go.
  useEffect(() => {
    if (!loaded || !s.exercises.length) return;
    const at = Date.now();
    void AsyncStorage.setItem(DRAFT_KEY, JSON.stringify({ v: 1, state: s, savedAt: at })).then(() => setSavedAt(at)).catch(() => {});
  }, [s, loaded]);
  const clearDraft = () => { void AsyncStorage.removeItem(DRAFT_KEY).catch(() => {}); };

  const addExercise = async (name: string) => {
    setSearching(false);
    let prev: { weight: number | null; reps: number }[] = [];
    try {
      const r = await workoutsApi.lastForExercises([name]);
      const sets = r?.results?.[0]?.exposures?.[0]?.sets ?? [];
      prev = sets.map((x) => ({ weight: x.weightKg != null ? Math.round(fromKg(x.weightKg)) : null, reps: x.reps }));
    } catch { /* new exercise — no history */ }
    dispatch({ type: 'add_exercise', name, prev });
    haptics.select();
  };

  const finish = async () => {
    if (busy) return;
    if (!loggerHasWork(s)) { Alert.alert('Nothing ticked yet', 'Tick the circle on each set you did — only ticked sets are logged.'); return; }
    setBusy(true);
    try {
      const body = loggerToLogBody(s, (w) => toKg(w));
      await workoutsApi.logWorkout({ ...body, title: body.title ?? undefined, exercises: body.exercises } as any);
      clearDraft();
      await invalidate.afterWorkout();
      haptics.success();
      router.back();
    } catch (e: any) {
      Alert.alert('Couldn\'t log it', `${e?.message ?? 'Try again.'} Your draft is still here.`);
      setBusy(false);
    }
  };
  const discard = () => Alert.alert('Discard this workout?', 'The draft is deleted. Nothing is logged.', [
    { text: 'Keep', style: 'cancel' },
    { text: 'Discard', style: 'destructive', onPress: () => { clearDraft(); router.back(); } },
  ]);
  const cancel = () => {
    if (!s.exercises.length) return router.back();
    Alert.alert('Leave the logger?', 'Your draft stays on this phone — open + Log again to finish it.', [
      { text: 'Stay', style: 'cancel' },
      { text: 'Leave', onPress: () => router.back() },
    ]);
  };

  if (searching) return <ExerciseSearch unit={unit} fromKg={fromKg} onPick={(n) => void addExercise(n)} onBack={() => setSearching(false)} />;

  return (
    <KeyboardAvoider style={[styles.root, { paddingTop: insets.top + 8 }]}>
      <StatusBar style="dark" />
      <View style={styles.top}>
        <Pressable onPress={cancel} hitSlop={10} accessibilityRole="button"><Text style={[T.body, { color: C.ink }]}>Cancel</Text></Pressable>
        <Text style={[T.caption, { color: C.muted }]}>{savedAt ? 'Draft saved' : ''}</Text>
      </View>

      {/* Stays above the keyboard; dragging the list puts the keyboard away. */}
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 32 }} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" showsVerticalScrollIndicator={false}>
        <Pressable onPress={() => setTitleOpen(true)} accessibilityRole="button" accessibilityLabel={`Name, ${s.title}. Edit`}>
          <Text style={styles.title} numberOfLines={1}>{s.title || 'Workout'}</Text>
        </Pressable>
        <Row name="When" value={whenLabel(s.date, today)} arrow onPress={() => setWhenOpen(true)} />
        <Row name="Note" value={s.note ? undefined : 'Add a note'} sub={s.note || undefined} onPress={() => setNoteOpen(true)} last />

        {s.exercises.map((e, ex) => (
          <View key={`${e.name}-${ex}`} style={{ marginTop: 26 }}>
            <View style={styles.exHead}>
              <Text style={[T.rowStrong, { flex: 1 }]} numberOfLines={1}>{e.name}</Text>
              <Pressable onPress={() => Alert.alert(e.name, undefined, [
                { text: 'Add a set', onPress: () => dispatch({ type: 'add_set', ex }) },
                { text: 'Remove exercise', style: 'destructive', onPress: () => dispatch({ type: 'remove_exercise', ex }) },
                { text: 'Cancel', style: 'cancel' },
              ])} hitSlop={10} accessibilityLabel={`${e.name} options`}><Text style={[T.body, { color: C.muted }]}>···</Text></Pressable>
            </View>
            {ex === 0 ? <Text style={[T.caption, { marginBottom: 6 }]}>Type the weight and reps, then tick ✓. A blank box uses the grey number — last time's.</Text> : null}
            <View style={styles.setHead}>
              <Text style={[styles.colSet, styles.headTxt]}>Set</Text>
              <Text style={[styles.colPrev, styles.headTxt]}>Last time</Text>
              <Text style={[styles.colNum, styles.headTxt]}>{unit}</Text>
              <Text style={[styles.colNum, styles.headTxt]}>Reps</Text>
              <Text style={[styles.colTick, styles.headTxt, { textAlign: 'right' }]}>Done</Text>
            </View>
            {e.sets.map((x, i) => (
              <Pressable key={i} onLongPress={() => Alert.alert(`Remove set ${i + 1}?`, undefined, [{ text: 'Keep', style: 'cancel' }, { text: 'Remove', style: 'destructive', onPress: () => dispatch({ type: 'remove_set', ex, set: i }) }])} style={styles.setRow}>
                <Text style={[styles.colSet, T.body, T.num]}>{i + 1}</Text>
                <Text style={[styles.colPrev, T.caption, T.num]}>{x.prev ? `${x.prev.weight != null ? `${x.prev.weight} × ` : ''}${x.prev.reps}` : '—'}</Text>
                <TextInput value={x.weight != null ? String(x.weight) : ''} placeholder={x.prev?.weight != null ? String(x.prev.weight) : '—'} placeholderTextColor={C.placeholder}
                  onChangeText={(t) => dispatch({ type: 'set_value', ex, set: i, field: 'weight', value: num(t) })} keyboardType="decimal-pad" selectTextOnFocus inputAccessoryViewID={KEYBOARD_DONE_ID}
                  style={[styles.box, x.done && styles.boxDone]} accessibilityLabel={`Set ${i + 1} weight in ${unit}`} />
                <TextInput value={x.reps != null ? String(x.reps) : ''} placeholder={x.prev ? String(x.prev.reps) : '—'} placeholderTextColor={C.placeholder}
                  onChangeText={(t) => dispatch({ type: 'set_value', ex, set: i, field: 'reps', value: num(t) })} keyboardType="number-pad" selectTextOnFocus inputAccessoryViewID={KEYBOARD_DONE_ID}
                  style={[styles.box, x.done && styles.boxDone]} accessibilityLabel={`Set ${i + 1} reps`} />
                <Pressable onPress={() => { haptics.select(); dispatch({ type: 'toggle_done', ex, set: i }); }} hitSlop={10} style={styles.colTick}
                  accessibilityRole="checkbox" accessibilityState={{ checked: x.done }} accessibilityLabel={`Set ${i + 1} done`}>
                  <View style={[styles.tick, x.done && styles.tickOn]}>{x.done ? <Text style={styles.tickMark}>✓</Text> : null}</View>
                </Pressable>
              </Pressable>
            ))}
            <View style={{ flexDirection: 'row', gap: 24, marginTop: 12 }}>
              <Pressable onPress={() => { haptics.select(); dispatch({ type: 'add_set', ex }); }} hitSlop={8} accessibilityRole="button">
                <Text style={[T.captionStrong, { color: C.ink }]}>+ Add set</Text>
              </Pressable>
              {e.sets.length > 1 ? (
                <Pressable onPress={() => { haptics.select(); dispatch({ type: 'remove_set', ex, set: e.sets.length - 1 }); }} hitSlop={8} accessibilityRole="button">
                  <Text style={[T.captionStrong, { color: C.muted }]}>− Remove set</Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        ))}

        <Pressable onPress={() => setSearching(true)} hitSlop={8} style={{ marginTop: 26 }} accessibilityRole="button">
          <Text style={[T.rowStrong, { color: C.crimson }]}>+ Add exercise</Text>
        </Pressable>
      </ScrollView>

      <View style={[styles.foot, { paddingBottom: insets.bottom + 12 }]}>
        <TextAction primary onPress={() => void finish()} loading={busy}>Finish</TextAction>
        {s.exercises.length ? <TextAction muted arrow={false} onPress={discard}>Discard</TextAction> : null}
      </View>

      <PromptSheet visible={titleOpen} title="Name" initial={s.title} placeholder="Push, Legs, Upper…" onSubmit={(v) => { dispatch({ type: 'title', title: v }); setTitleOpen(false); }} onClose={() => setTitleOpen(false)} />
      <PromptSheet visible={noteOpen} title="Note" initial={s.note} placeholder="How it went" saveLabel="Done" onSubmit={(v) => { dispatch({ type: 'note', note: v }); setNoteOpen(false); }} onClose={() => setNoteOpen(false)} />
      <WhenSheet visible={whenOpen} date={s.date} today={today} onPick={(d) => { dispatch({ type: 'date', date: d }); setWhenOpen(false); }} onClose={() => setWhenOpen(false)} />
      {/* Number pads have no return key on iOS: a Done bar above them. */}
      <KeyboardDoneBar />
    </KeyboardAvoider>
  );
}

/** T-03: When was it? Today, Yesterday, or a date (never the future). */
function WhenSheet({ visible, date, today, onPick, onClose }: { visible: boolean; date: string; today: string; onPick: (d: string) => void; onClose: () => void }) {
  const [earlier, setEarlier] = useState<Date | null>(null);
  useEffect(() => { if (!visible) setEarlier(null); }, [visible]);
  const yesterday = ymd(new Date(new Date(`${today}T12:00:00`).getTime() - 86_400_000));
  const max = new Date(`${today}T23:59:00`);
  const openEarlier = () => {
    const start = new Date(`${date}T12:00:00`);
    if (Platform.OS === 'android') {
      DateTimePickerAndroid.open({ value: start, mode: 'date', maximumDate: max, onChange: (e, d) => { if (e.type === 'set' && d) onPick(ymd(d)); } });
    } else setEarlier(start);
  };
  return (
    <Sheet visible={visible} onClose={onClose} title="When was it?" sub="Backdated sessions count toward that day's streak.">
      <Row name="Today" value={date === today ? '✓' : undefined} onPress={() => onPick(today)} />
      <Row name="Yesterday" value={whenLabel(yesterday, '9999-12-31')} onPress={() => onPick(yesterday)} />
      <Row name="Earlier" arrow onPress={openEarlier} last={!earlier} />
      {earlier ? (
        <View>
          <DateTimePicker value={earlier} mode="date" display="spinner" maximumDate={max} onChange={(_, d) => d && setEarlier(d)} />
          <View style={{ flexDirection: 'row', gap: 28, marginTop: 8 }}>
            <TextAction primary onPress={() => onPick(ymd(earlier))}>Set date</TextAction>
            <TextAction muted arrow={false} onPress={onClose}>Cancel</TextAction>
          </View>
        </View>
      ) : null}
    </Sheet>
  );
}

/** T-02: exercise search. The field is the header; your history first, then the library; no match → create it. */
function ExerciseSearch({ unit, fromKg, onPick, onBack }: { unit: string; fromKg: (kg: number) => number; onPick: (name: string) => void; onBack: () => void }) {
  const insets = useSafeAreaInsets();
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [cat, setCat] = useState<ExerciseCategory | 'all'>('all');
  useEffect(() => { const t = setTimeout(() => setDebounced(q.trim()), 220); return () => clearTimeout(t); }, [q]);
  const res = useQuery({ queryKey: ['v2', 'exercise-names', debounced], queryFn: () => workoutsApi.exerciseNames(debounced, 40), staleTime: 60_000 });
  const names = useMemo(() => (res.data?.names ?? []).filter((n) => cat === 'all' || exerciseCategory(n.name) === cat), [res.data, cat]);
  // Your best recent set for what's on screen (history names only).
  const mine = names.filter((n) => n.source === 'history').slice(0, 15).map((n) => n.name);
  const last = useQuery({ queryKey: ['v2', 'exercise-last', mine.join('|')], enabled: mine.length > 0, staleTime: 60_000,
    queryFn: () => workoutsApi.lastForExercises(mine) });
  const best = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of last.data?.results ?? []) {
      const top = r.exposures?.[0]?.top;
      if (top) m.set(r.name.toLowerCase(), `${top.weightKg != null ? `${Math.round(fromKg(top.weightKg))} × ` : ''}${top.reps}`);
    }
    return m;
  }, [last.data, fromKg]);
  const exact = names.some((n) => n.name.toLowerCase() === q.trim().toLowerCase());
  return (
    <KeyboardAvoider style={[styles.root, { paddingTop: insets.top + 8 }]}>
      <StatusBar style="dark" />
      <View style={styles.top}>
        <Pressable onPress={onBack} hitSlop={10} accessibilityRole="button"><Text style={[T.body, { color: C.ink }]}>← Workout</Text></Pressable>
      </View>
      <View style={styles.searchField}>
        <Text style={[T.body, { color: C.muted }]}>⌕</Text>
        <TextInput value={q} onChangeText={setQ} autoFocus placeholder="Search exercises" placeholderTextColor={C.placeholder} style={styles.searchInput}
          autoCorrect={false} returnKeyType="done" onSubmitEditing={() => { if (q.trim() && !exact) onPick(q.trim()); }} accessibilityLabel="Search exercises" />
      </View>
      <View style={styles.cats}>
        {(['all', ...EXERCISE_CATEGORIES] as const).map((c) => (
          <Pressable key={c} onPress={() => setCat(c)} hitSlop={6} accessibilityRole="button" accessibilityState={{ selected: cat === c }}>
            <Text style={[styles.cat, cat === c && styles.catOn]}>{c === 'all' ? 'All' : c.charAt(0).toUpperCase() + c.slice(1)}</Text>
          </Pressable>
        ))}
      </View>
      {/* The list ends above the keyboard, and scrolling it puts the keyboard away. */}
      <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={{ paddingBottom: 24 }}>
        {res.isLoading ? <ActivityIndicator style={{ marginTop: 20 }} color={C.muted} /> : null}
        {names.map((n, i) => {
          const c = exerciseCategory(n.name);
          const b = best.get(n.name.toLowerCase());
          return <Row key={`${n.name}-${i}`} name={n.name} sub={[c !== 'other' ? c.charAt(0).toUpperCase() + c.slice(1) : null, b ? `you: ${b}` : n.source === 'library' ? 'library' : null].filter(Boolean).join(' · ')} arrow onPress={() => onPick(n.name)} last={i === names.length - 1} />;
        })}
        {q.trim() && !exact ? (
          <Pressable onPress={() => onPick(q.trim())} hitSlop={6} style={{ marginTop: 16 }} accessibilityRole="button">
            <Text style={[T.caption, { color: C.ink }]}>Create "{q.trim()}" as a new exercise</Text>
          </Pressable>
        ) : null}
        {!res.isLoading && !names.length && !q.trim() ? <Text style={[T.bodyMuted, { marginTop: 16 }]}>Type to search your exercises and the library.</Text> : null}
      </ScrollView>
    </KeyboardAvoider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.white, paddingHorizontal: v2.space.gutter },
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 32 },
  title: { fontFamily: v2.font.bold, fontSize: 28, lineHeight: 34, letterSpacing: -0.6, color: C.ink, marginTop: 18, marginBottom: 14, paddingBottom: 8, borderBottomWidth: 2, borderBottomColor: C.ink },
  exHead: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 6 },
  setHead: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6 },
  headTxt: { fontFamily: v2.font.medium, fontSize: 11, color: C.muted },
  setRow: { flexDirection: 'row', alignItems: 'center', minHeight: 50, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.hairline },
  colSet: { width: 32 },
  colPrev: { flex: 1 },
  colNum: { width: 64, textAlign: 'center' },
  colTick: { width: 40, alignItems: 'flex-end' },
  // A box reads as "type here"; an empty one shows last time's number in grey.
  box: { width: 60, height: 38, marginHorizontal: 2, borderRadius: 8, backgroundColor: C.surface, textAlign: 'center', fontFamily: v2.font.semibold, fontSize: 16, color: C.ink, padding: 0, fontVariant: ['tabular-nums'] },
  boxDone: { backgroundColor: C.white, borderWidth: 1, borderColor: C.hairline },
  tick: { width: 24, height: 24, borderRadius: 12, borderWidth: 1.5, borderColor: C.placeholder, alignItems: 'center', justifyContent: 'center' },
  tickOn: { backgroundColor: C.ink, borderColor: C.ink },
  tickMark: { color: C.white, fontSize: 13, fontFamily: v2.font.bold, lineHeight: 15 },
  foot: { flexDirection: 'row', alignItems: 'center', gap: 28, paddingTop: 14, backgroundColor: C.white, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.hairline },
  searchField: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 18, borderBottomWidth: 1.5, borderBottomColor: C.ink, paddingBottom: 6 },
  searchInput: { flex: 1, fontFamily: v2.font.semibold, fontSize: 22, color: C.ink, padding: 0 },
  cats: { flexDirection: 'row', gap: 16, marginTop: 14, marginBottom: 6 },
  cat: { fontFamily: v2.font.medium, fontSize: 13, color: C.muted, paddingBottom: 3 },
  catOn: { color: C.ink, borderBottomWidth: 1.5, borderBottomColor: C.ink },
});
