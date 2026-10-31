// Active workout — a pushed full-screen page: overview → set → rest → done.
//
// Steps cross-fade (exit −14/300ms, enter +18/480–560ms). ← Back pauses;
// returning resumes. Four 2pt progress bars, one per exercise. The load at
// 88pt; −step / +step text buttons; a crimson hairline for sets done; the cue;
// rate rows; "Something hurts" / "Swap this lift" hand off to chat. Rest: the
// countdown at 96pt, a draining crimson hairline, the last receipt (with a
// one-tap revert), Up next, Add 30 s / I'm ready, auto-advance. Done: stats
// rows and write receipts; "Back to Anakin" streams a summary turn.
//
// Nothing done is lost. The session saves itself the moment it reaches Done
// (not only on "Back to Anakin"). A session in progress is kept on the phone
// as a draft after every set, so Leave, "Something hurts" and "Swap this lift"
// can all come back to it; opening the session the same day picks it up where
// it stopped. Leaving with sets done offers to save what's there. Each set is
// saved as its own entry, linked to the planned day so progression can read it.

import React, { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { View, Text, StyleSheet, Alert, AppState, ScrollView } from 'react-native';
import { Pressable } from '../../src/v2/primitives/Pressable';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { initialWorkout, workoutReducer, defaultRules, elapsedSec, mmss, exerciseProgress, summarize, toWorkoutLogBody, hasProgress, resumableDraft, loadKind, swapExercise, type LoadKind, type Rating, type PlanExercise, type WorkoutState, type WorkoutDraft } from '@axiom/agent-ui-core';
import { todayStr } from '../../src/lib/localDate';
import { v2, T } from '../../src/v2/theme';
import { Row, Eyebrow } from '../../src/v2/primitives/Row';
import { Enter } from '../../src/v2/primitives/Enter';
import { TextAction } from '../../src/v2/primitives/TextAction';
import { Receipt, ReceiptList } from '../../src/v2/primitives/Receipt';
import { ProgressHairline } from '../../src/v2/charts';
import { useToday, useInvalidate } from '../../src/v2/data';
import { useShellOptional } from '../../src/v2/shell/ShellContext';
import { useUnits } from '../../src/context/UnitsContext';
import { workoutsApi } from '../../src/lib/api';
import { v2Api } from '../../src/v2/api';
import { haptics } from '../../src/v2/haptics';
import { Mark } from '../../src/v2/primitives/Mark';
import { NumberSheet } from '../../src/v2/primitives/NumberSheet';
import { exName, sessionTitle, sessionDescriptor, estimateMinutes, phaseShort } from '../../src/v2/format';
import { trackScreen } from '../../src/lib/analytics';
import { useProScreen } from '../../src/v2/shell/proGate';
import { takeSessionSeed } from '../../src/v2/sessionSeed';
import { ShareWorkoutSheet, type WorkoutShare } from '../../src/v2/share/ShareWorkoutSheet';
import type { ProgressMoment } from '@axiom/agent-ui-core';
import { MomentPrompt, useOpenMoment } from '../../src/v2/moments/MomentPrompt';
import { claimMoments } from '../../src/v2/moments/store';
import { SwapSheet } from '../../src/v2/swap/SwapSheet';
import { proactiveApi } from '../../src/v2/api';
import { getTodaySwaps, setTodaySwap, swappedName } from '../../src/v2/todaySwaps';
import { useAuth } from '../../src/context/AuthContext';
import { track } from '../../src/v2/track';

const DRAFT_KEY = 'v2.sessionDraft.v1';
const loadDraft = async (): Promise<unknown> => { try { const raw = await AsyncStorage.getItem(DRAFT_KEY); return raw ? JSON.parse(raw) : null; } catch { return null; } };
const writeDraft = (d: WorkoutDraft) => { void AsyncStorage.setItem(DRAFT_KEY, JSON.stringify(d)).catch(() => {}); };
const clearDraft = () => { void AsyncStorage.removeItem(DRAFT_KEY).catch(() => {}); };

function parseReps(r: any): number | string { const n = typeof r === 'number' ? r : parseInt(String(r ?? ''), 10); return Number.isFinite(n) && n > 0 ? n : String(r ?? 8); }

function SessionScreenInner() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const shell = useShellOptional();
  const today = useToday();
  const invalidate = useInvalidate();
  const { unit, fromKg, toKg } = useUnits();
  const rules = useMemo(() => defaultRules(unit === 'kg' ? 'kg' : 'lbs'), [unit]);
  // A guided freestyle session (T-05) arrives as a seed; otherwise it's today's program day.
  const [seed] = useState(() => takeSessionSeed());
  const session = seed ?? today.data?.session ?? today.data?.todaySession ?? today.data?.today ?? null;
  const [plan, setPlan] = useState<PlanExercise[] | null>(null);
  const [state, dispatch] = useReducer(workoutReducer, undefined, () => initialWorkout([]));
  const [now, setNow] = useState(Date.now());
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  // What the session earned (spec "Progress Moments"): shown on the Done screen itself.
  const [moment, setMoment] = useState<ProgressMoment | null>(null);
  const advRef = useRef(false);
  const title: string = session?.name ?? session?.day ?? 'Session';
  // Checked once before the plan is built: a same-day draft with sets in it wins.
  const [draftChecked, setDraftChecked] = useState(false);
  const [resumed, setResumed] = useState(false);

  useEffect(() => { trackScreen('v2.session'); track('session_started', { freestyle: !!seed }); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    void loadDraft().then((raw) => {
      const d = resumableDraft(raw, todayStr(), Date.now());
      if (d) {
        setPlan(d.plan);
        // Restored paused (the time away isn't session time), then running again from now.
        dispatch({ type: 'restore', state: d.state, now: d.savedAt });
        dispatch({ type: 'resume', now: Date.now() });
        setResumed(true);
      }
      setDraftChecked(true);
    });
  }, []);

  // Keep the session on the phone after every change once a set is done — until it's saved.
  useEffect(() => {
    if (!plan || saved || !hasProgress(state)) return;
    writeDraft({ v: 1, date: todayStr(), title, plan, state, savedAt: Date.now() });
  }, [state, plan, saved, title]);

  // Build the plan: load from the last logged set of each exercise, rest from the rep range, cue from the program's notes.
  useEffect(() => {
    if (plan || !session || !draftChecked) return;
    const ex: any[] = session.exercises ?? [];
    (async () => {
      // "Just today" swaps chosen on the Today page (Oct 2026).
      const swaps = await getTodaySwaps();
      const out: PlanExercise[] = await Promise.all(ex.map(async (e) => {
        let load: number | null = null;
        const name = swappedName(swaps, exName(e));
        // /workouts/exercise/:name/last → { target: { targetWeightKg }, exposures: [{ top: { weightKg } }] }.
        // The progression target wins; otherwise repeat the last top set.
        try { const last: any = await v2Api.lastExercise(name); const kg = last?.target?.targetWeightKg ?? last?.exposures?.[0]?.top?.weightKg ?? null; if (kg) load = Math.round(fromKg(kg) / rules.step) * rules.step; } catch { /* no history */ }
        const reps = parseReps(e.reps);
        const kind = loadKind(name, e.bodyweight);
        return { name, sets: Math.max(1, Number(e.sets) || 3), reps, load: kind === 'bodyweight' ? null : load, rest: Number(e.restSeconds) || rules.restForReps(reps), cue: e.notes || e.cue || e.intensity || null, kind };
      }));
      setPlan(out);
      dispatch({ type: 'load_plan', plan: out });
    })();
  }, [session, plan, fromKg, rules, draftChecked]);

  // The clock.
  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(iv);
  }, []);
  useEffect(() => {
    if (state.step === 'rest' && now >= state.restEnd && !advRef.current) {
      advRef.current = true;
      dispatch({ type: 'rest_elapsed' });
      haptics.light();
      setTimeout(() => { advRef.current = false; }, 400);
    }
  }, [now, state.step, state.restEnd]);
  // Background: pause the clock; foreground: resume.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (st) => { if (st === 'active') dispatch({ type: 'resume', now: Date.now() }); else dispatch({ type: 'pause', now: Date.now() }); });
    return () => sub.remove();
  }, []);

  const P = plan ?? [];
  const cur = P[state.ex];
  const load = state.loads[state.ex];
  // What they're about to do (editable) — and whether the lift is bodyweight, where weight means added weight.
  const repsNow = state.reps?.[state.ex] ?? cur?.reps;
  // Bodyweight comes from the lift, not from a missing weight: a new user has no
  // history, and "no weight yet" used to show bench press as BW and save it so
  // (Oct 2026). A lift that takes a weight asks for it before the set counts;
  // 'either' (lunges, step-ups) asks which. Old drafts without `kind` keep the old rule.
  const kind: LoadKind = cur?.kind ?? (cur && !cur.load ? 'bodyweight' : 'weighted');
  const bodyweight = !!cur && kind === 'bodyweight';
  const needsWeight = !!cur && !bodyweight && load == null;
  const [editing, setEditing] = useState<null | 'load' | 'reps'>(null);
  // A rating tapped before the weight was known: it counts once the weight (or "bodyweight") is in.
  const [pendingRate, setPendingRate] = useState<Rating | null>(null);
  // Swaps that keep the job (flag swapV2): the sheet ranks, they pick, only the name and load change.
  const swapV2 = useAuth().getFeatures().swapV2;
  const proactiveOn = useAuth().getFeatures().proactive;
  const [swapping, setSwapping] = useState(false);
  const [flagged, setFlagged] = useState<string | null>(null);
  const sessionDay: string | null = seed ? null : sessionTitle(session?.name ?? session?.day ?? '').split(/[·—–/]/)[0].trim() || null;
  const swapTo = async (to: string) => {
    const idx = state.ex;
    const from = P[idx]?.name;
    if (!from) return;
    let load: number | null = null;
    // Their last top set of the new lift; none = the session asks for the weight before the set counts.
    try { const last: any = await v2Api.lastExercise(to); const kg = last?.target?.targetWeightKg ?? last?.exposures?.[0]?.top?.weightKg ?? null; if (kg) load = Math.round(fromKg(kg) / rules.step) * rules.step; } catch { /* no history */ }
    track('session_swap_applied', { had_weight: load != null });
    const r = swapExercise(P, state, idx, { name: to, load, kind: loadKind(to) });
    setPlan(r.plan);
    dispatch({ type: 'apply_swap', state: r.state });
    void setTodaySwap(from, to);
  };
  const setKind = (k: LoadKind) => setPlan((p) => (p ? p.map((x, i) => (i === state.ex ? { ...x, kind: k } : x)) : p));
  const progress = exerciseProgress(state, P);

  const back = () => {
    if (state.step === 'overview' || state.step === 'done') return router.back();
    dispatch({ type: 'pause', now: Date.now() });
    if (!hasProgress(state)) {
      Alert.alert('Leave the session?', 'Nothing is logged yet.', [
        { text: 'Stay', style: 'cancel', onPress: () => dispatch({ type: 'resume', now: Date.now() }) },
        { text: 'Leave', style: 'destructive', onPress: () => router.back() },
      ]);
      return;
    }
    Alert.alert('Pause the session?', 'Your sets stay on this phone for today — open the session again to pick up where you stopped.', [
      { text: 'Resume', style: 'cancel', onPress: () => dispatch({ type: 'resume', now: Date.now() }) },
      { text: 'Save what I did', onPress: () => void save({ thenAsk: true }) },
      { text: 'Leave for now', onPress: () => router.back() },
    ]);
  };
  const rate = (rating: Rating) => {
    haptics.select();
    if (needsWeight) { setPendingRate(rating); setEditing('load'); return; }
    setTimeout(() => dispatch({ type: 'rate', rating, now: Date.now(), plan: P, rules }), 300);
  };
  const finishPending = () => {
    const r = pendingRate;
    setPendingRate(null);
    if (r) setTimeout(() => dispatch({ type: 'rate', rating: r, now: Date.now(), plan: P, rules }), 300);
  };
  // The draft is already on the phone; handing off to chat keeps it for when they come back.
  const handOff = (m: string) => { dispatch({ type: 'pause', now: Date.now() }); shell?.ask(m); router.back(); };
  const summaryMsg = () => {
    const sum = summarize(state, P, Date.now());
    return `I just finished ${title}: ${sum.sets} of ${sum.totalSets} sets, ${sum.minutes} min, top set ${sum.topSet}${state.nextWeek.length ? `, and ${state.nextWeek.map((n) => `${P[n.ex]?.name} felt easy on the last set`).join('; ')}` : ''}. What changes for next time?`;
  };
  // Saves what's been done (all of it at Done, or part of it from Leave). Linked to today's planned day.
  const save = async (opts: { thenAsk: boolean }): Promise<boolean> => {
    if (saving) return false;
    if (saved) { if (opts.thenAsk) { shell?.ask(summaryMsg()); router.back(); } return true; }
    setSaving(true);
    const sum = summarize(state, P, Date.now());
    try {
      const body = toWorkoutLogBody(state, P, title, todayStr(), Date.now());
      const kg = (w: number | null | undefined) => (w ? toKg(w) : null);
      const res: any = await workoutsApi.logWorkout({
        date: body.date, title: body.title, duration: body.duration,
        // A freestyle seed is ad hoc — never scored against a program day.
        programDayRef: seed ? null : today.data?.programDayRef ?? null,
        exercises: body.exercises.map((e) => ({
          name: e.name, sets: e.sets, reps: e.reps, weightKg: kg(e.weight), rpe: e.rpe ?? null, notes: e.notes ?? null, bodyweight: (P.find((p) => p.name === e.name)?.kind ?? (e.weight ? 'weighted' : 'bodyweight')) === 'bodyweight',
          setEntries: e.setEntries.map((x) => ({ weightKg: kg(x.weight), reps: x.reps, rpe: x.rpe })),
        })),
      } as any);
      track('session_finished', { sets_done: sum.sets, sets_total: sum.totalSets, minutes: sum.minutes, freestyle: !!seed });
      clearDraft();
      if (res?.moment) setMoment(res.moment);
      await invalidate.afterWorkout();
      setSaved(`${title} · ${sum.sets} sets · ${sum.minutes} min`);
      haptics.success();
    } catch (e: any) {
      Alert.alert('Couldn\'t save the session', `${e?.message ?? 'Try again.'} Your sets are still on this phone.`);
      setSaving(false);
      return false;
    }
    setSaving(false);
    if (opts.thenAsk) { shell?.ask(summaryMsg()); router.back(); }
    return true;
  };
  // On the Done screen the moment shows inline, so the shell's prompt sheet stays quiet.
  // (Leave → "Save what I did" goes back to the shell first, which then raises it.)
  useEffect(() => (state.step === 'done' ? claimMoments() : undefined), [state.step]);
  // Reaching Done saves at once — "Back to Anakin" only asks the summary.
  const autoSaved = useRef(false);
  useEffect(() => {
    if (state.step !== 'done' || !plan || autoSaved.current) return;
    autoSaved.current = true;
    void save({ thenAsk: false });
  }, [state.step, plan]); // eslint-disable-line react-hooks/exhaustive-deps
  const finish = () => void save({ thenAsk: true });

  const eyebrowTone = { color: v2.color.muted };
  const overview = state.step === 'overview';
  const rawName: string | null = session?.name ?? session?.day ?? session?.dayName ?? null;
  const minutes = session?.minutes ?? estimateMinutes(P.length);
  const phase = phaseShort(today.data?.phaseName);
  const week = today.data?.weekNumber ?? null;
  const descriptor = (sessionDescriptor(rawName, session?.focus ?? session?.dayFocus) || '').split(/(?<=[.!?])\s+/)[0];
  return (
    <View style={[styles.root, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 24 }]}>
      <StatusBar style="dark" />
      <View style={styles.top}>
        <Pressable onPress={back} hitSlop={10}><Text style={overview ? styles.backOv : [T.body, { color: v2.color.muted }]}>← Back</Text></Pressable>
        <Text style={[T.caption, T.num, { color: v2.color.muted, fontSize: 13 }]}>{overview ? (phase ? `${phase}${week ? ` · wk ${week}` : ''}` : 'Today') : mmss(elapsedSec(state, now))}</Text>
      </View>
      {state.step !== 'overview' && state.step !== 'done' ? (
        <View style={styles.bars}>
          {P.map((_, i) => <View key={i} style={{ flex: 1 }}><ProgressHairline fraction={progress[i]} crimson={false} /></View>)}
        </View>
      ) : null}

      <View style={styles.body}>
        {!session && !plan && !today.isLoading ? (
          <View>
            <Text style={T.headlineSm}>Nothing scheduled today.</Text>
            <Text style={[T.bodyMuted, { marginTop: 12 }]}>Rest, or ask Anakin to pull a session forward.</Text>
            <TextAction primary onPress={() => handOff("Can I train today? Pull a session forward.")} style={{ marginTop: 20 }}>Ask Anakin</TextAction>
          </View>
        ) : null}
        {session && !plan ? <Text style={T.caption}>Setting the loads…</Text> : null}
        {resumed && state.step !== 'done' ? <Text style={[T.caption, { marginBottom: 12 }]}>Picked up where you stopped — {state.log.length} set{state.log.length === 1 ? '' : 's'} kept.</Text> : null}

        {plan && state.step === 'overview' ? (
          // Review #4: content sits low-middle — flex 1 above, flex 1.2 below, Begin at the bottom.
          <Animated.View key="ov" entering={FadeIn.duration(480)} exiting={FadeOut.duration(260)} style={{ flex: 1 }}>
            <View style={{ flex: 1 }} />
            <Text style={styles.ovEyebrow}>{['Today', phase && week ? `${phase}, week ${week}` : phase].filter(Boolean).join(' · ').toUpperCase()}</Text>
            <Text style={styles.ovTitle}>{sessionTitle(rawName)}{minutes ? ` · ${minutes} min` : ''}</Text>
            {descriptor ? (
              <View style={styles.ovLine}>
                <Mark size={18} style={{ marginTop: 2 }} />
                <Text style={styles.ovLineText}>{descriptor}</Text>
              </View>
            ) : null}
            <View style={{ marginTop: 36 }}>
              {P.map((e, i) => (
                <Animated.View key={`${e.name}-${i}`} entering={FadeIn.delay(200 + 80 * i).duration(420)} style={[styles.ovRow, i === P.length - 1 && styles.ovRowLast]}>
                  <Text style={styles.ovName} numberOfLines={1}>{e.name}</Text>
                  <Text style={styles.ovValue}>{`${e.sets} × ${e.reps}${e.load != null ? ` · ${e.load}` : ''}`}</Text>
                </Animated.View>
              ))}
            </View>
            <View style={{ flex: 1.2 }} />
            <Pressable onPress={() => { haptics.light(); dispatch({ type: 'begin', now: Date.now() }); }} hitSlop={12} accessibilityRole="button" style={{ alignSelf: 'flex-start' }}>
              <Text style={styles.ovBegin}>Begin →</Text>
            </Pressable>
          </Animated.View>
        ) : null}

        {plan && cur && state.step === 'set' ? (
          <Animated.View key={`set-${state.ex}-${state.set}`} entering={FadeIn.duration(520)} exiting={FadeOut.duration(280)}>
            <Text style={[T.eyebrow, eyebrowTone]}>{cur.name} · set {state.set + 1} of {cur.sets}</Text>
            {/* Tap the weight or the reps to type what you actually did (Oct 2026 feedback: couldn't log heavier dips or extra reps). */}
            <View style={{ flexDirection: 'row', alignItems: 'baseline', marginTop: 14 }}>
              <Pressable style={{ flexShrink: 1 }} onPress={() => { haptics.select(); setEditing('load'); }} hitSlop={8} accessibilityRole="button" accessibilityLabel={needsWeight ? 'Weight not set. Tap to enter it.' : `Weight: ${load ? `${bodyweight ? 'bodyweight plus ' : ''}${load} ${unit}` : 'bodyweight'}. Tap to change.`}>
                <View style={{ flexDirection: 'row', alignItems: 'baseline', flexShrink: 1 }}>
                  <Text style={[T.display, { flexShrink: 1 }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.5}>{load != null ? `${bodyweight ? '+' : ''}${load}` : needsWeight ? '—' : 'BW'}</Text>
                  {load != null ? <Text style={[T.read, { color: v2.color.muted, marginLeft: 8 }]}>{unit}</Text> : null}
                </View>
              </Pressable>
              <Pressable onPress={() => { haptics.select(); setEditing('reps'); }} hitSlop={10} accessibilityRole="button" accessibilityLabel={`${repsNow} reps. Tap to change.`}>
                <Text style={[T.read, { color: v2.color.muted, marginLeft: 14, textDecorationLine: 'underline', textDecorationStyle: 'dotted' }]}>× {repsNow}</Text>
              </Pressable>
            </View>
            {bodyweight && load != null ? <Text style={[T.caption, { marginTop: 4 }]}>Bodyweight + {load} {unit}</Text> : null}
            {needsWeight ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: 22, rowGap: 6, marginTop: 6 }}>
                <TextAction size={15} onPress={() => { haptics.select(); setEditing('load'); }}>{kind === 'either' ? 'Add weight' : 'Enter the weight'}</TextAction>
                {kind === 'either' ? <TextAction muted arrow={false} size={15} onPress={() => { haptics.select(); setKind('bodyweight'); }}>Bodyweight</TextAction> : null}
              </View>
            ) : null}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: 22, rowGap: 6, marginTop: 8 }}>
              {load != null ? <TextAction arrow={false} muted size={15} onPress={() => dispatch({ type: 'adjust_load', delta: -rules.step })}>− {rules.step} {unit}</TextAction> : null}
              <TextAction arrow={false} muted size={15} onPress={() => dispatch({ type: 'adjust_load', delta: rules.step })}>+ {rules.step} {unit}{bodyweight && load == null ? ' added' : ''}</TextAction>
              <TextAction arrow={false} muted size={15} onPress={() => dispatch({ type: 'adjust_reps', delta: -1, base: repsNow })}>− rep</TextAction>
              <TextAction arrow={false} muted size={15} onPress={() => dispatch({ type: 'adjust_reps', delta: 1, base: repsNow })}>+ rep</TextAction>
            </View>
            <View style={{ marginTop: 22 }}><ProgressHairline fraction={state.set / cur.sets} /></View>
            {cur.cue ? <Text style={[T.bodyMuted, { marginTop: 18 }]}>{cur.cue}</Text> : null}
            <View style={{ marginTop: 26 }}>
              <Row name="Done — easy" onPress={() => rate('easy')} arrow />
              <Row name="Done — hard" onPress={() => rate('hard')} arrow />
              <Row name="Missed a rep" onPress={() => rate('miss')} arrow last />
            </View>
            {flagged ? <Text style={[T.caption, { marginTop: 16, color: v2.color.crimson }]}>{flagged}</Text> : null}
            <View style={{ flexDirection: 'row', gap: 24, marginTop: 24 }}>
              <TextAction muted size={14} arrow={false} onPress={() => handOff(`Something hurts on ${cur.name.toLowerCase()} — what should I do?`)}>Something hurts</TextAction>
              {proactiveOn ? <TextAction muted size={14} arrow={false} onPress={() => { haptics.select(); void proactiveApi.flag({ exercise: cur.name, setIndex: state.set }).then((r) => { setFlagged(`Flagged · ${cur.name} · set ${state.set + 1}${r.threadId ? ' · noted on the thread' : ''}`); }).catch(() => setFlagged('Couldn’t flag that')); }}>Flag it</TextAction> : null}
              <TextAction muted size={14} arrow={false} onPress={() => (swapV2 ? setSwapping(true) : handOff(`Swap ${cur.name.toLowerCase()} for something easier on me today`))}>Swap this lift</TextAction>
            </View>
          </Animated.View>
        ) : null}

        {plan && state.step === 'rest' ? (
          <Animated.View key={`rest-${state.ex}-${state.set}`} entering={FadeIn.duration(520)} exiting={FadeOut.duration(280)}>
            <Text style={[T.eyebrow, eyebrowTone]}>Rest</Text>
            <Text style={[T.display, { fontSize: 96, lineHeight: 96, marginTop: 10 }]}>{mmss((state.restEnd - now) / 1000)}</Text>
            <View style={{ marginTop: 16 }}><ProgressHairline fraction={state.restDur ? Math.max(0, (state.restEnd - now) / (state.restDur * 1000)) : 0} /></View>
            {state.lastReceipt ? (
              <View style={{ marginTop: 22, flexDirection: 'row', alignItems: 'center', gap: 16 }}>
                <View style={{ flex: 1 }}><Receipt verb={state.lastReceipt.verb} text={state.lastReceipt.text} animate={false} /></View>
                {state.lastReceipt.revert ? <TextAction muted size={13} arrow={false} onPress={() => dispatch({ type: 'revert_last' })}>Keep {state.lastReceipt.revert.load}</TextAction> : null}
              </View>
            ) : null}
            <View style={{ marginTop: 26 }}>
              <Eyebrow>Up next</Eyebrow>
              <Row name={`${P[state.ex]?.name}${state.set ? ` · set ${state.set + 1}` : ''}`} value={state.loads[state.ex] != null ? `${P[state.ex]?.load ? '' : 'BW +'}${state.loads[state.ex]} × ${state.reps?.[state.ex] ?? P[state.ex]?.reps}` : `${state.reps?.[state.ex] ?? P[state.ex]?.reps} reps`} last />
            </View>
            <View style={{ marginTop: 20 }}>
              <Row name="Add 30 s" onPress={() => dispatch({ type: 'rest_add', seconds: 30 })} arrow />
              <Row name="I'm ready" onPress={() => { if (advRef.current) return; advRef.current = true; dispatch({ type: 'rest_skip' }); setTimeout(() => { advRef.current = false; }, 400); }} emphasis arrow last />
            </View>
          </Animated.View>
        ) : null}

        {plan && state.step === 'done' ? (
          <Animated.View key="done" entering={FadeIn.duration(520)} style={{ flex: 1 }}>
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 12 }}>
              <DoneView state={state} plan={P} now={now} title={title} unit={unit} saved={saved} saving={saving} onFinish={finish} toKg={toKg} moment={moment} />
            </ScrollView>
          </Animated.View>
        ) : null}
      </View>
      {/* Weight and reps, typed — rides the keyboard (NumberSheet), rendered once over the whole screen. */}
      <NumberSheet visible={editing === 'load'} title={bodyweight ? `Added weight (${unit})` : `${cur?.name ?? 'Weight'} (${unit})`}
        sub={bodyweight ? 'On top of bodyweight. 0 for bodyweight only.' : needsWeight ? 'What’s on the bar (or in your hands) for this set. It saves with the set.' : 'What’s on the bar for this set.'}
        current={load != null ? String(load) : bodyweight ? '0' : ''} unit={unit} decimal min={bodyweight ? 0 : 0.5} max={unit === 'kg' ? 700 : 1500}
        secondary={bodyweight ? undefined : { label: 'It’s bodyweight', onPress: () => { setKind('bodyweight'); setEditing(null); finishPending(); } }}
        onSubmit={(n) => { if (kind === 'either') setKind('weighted'); dispatch({ type: 'set_load', load: n }); setEditing(null); finishPending(); }}
        onClose={() => { setEditing(null); setPendingRate(null); }} />
      <NumberSheet visible={editing === 'reps'} title="Reps" sub="How many you did — or will do — this set."
        current={String(parseInt(String(repsNow), 10) || '')} min={1} max={100}
        onSubmit={(n) => { dispatch({ type: 'set_reps', reps: n }); setEditing(null); }} onClose={() => setEditing(null)} />
      {swapV2 && cur ? (
        <SwapSheet visible={swapping} onClose={() => setSwapping(false)} name={cur.name}
          slot={{ sets: cur.sets, reps: cur.reps, notes: cur.cue, index: state.ex, session: P.map((p) => p.name) }}
          day={sessionDay} everyAlsoToday onToday={swapTo}
          onAsk={(m) => { dispatch({ type: 'pause', now: Date.now() }); shell?.prefill(m); router.back(); }} />
      ) : null}
    </View>
  );
}

function DoneView({ state, plan, now, title, unit, saved, saving, onFinish, toKg, moment }: { state: WorkoutState; plan: PlanExercise[]; now: number; title: string; unit: string; saved: string | null; saving: boolean; onFinish: () => void; toKg: (w: number) => number; moment: ProgressMoment | null }) {
  const s = summarize(state, plan, now);
  const openMoment = useOpenMoment();
  // S-04: share it — optional, one tap to skip. Post to Friends attaches this workout.
  const [sharing, setSharing] = useState(false);
  const share: WorkoutShare = useMemo(() => {
    const body = toWorkoutLogBody(state, plan, title, todayStr(), now);
    return {
      title: sessionTitle(title), durationMin: s.minutes || null,
      exercises: body.exercises.map((e) => ({ name: e.name, sets: e.sets, reps: String(e.reps), weightKg: e.weight ? toKg(e.weight) : null })),
      top: s.topSet && s.topSet !== '—' ? s.topSet : null, sets: s.sets, volume: s.volume ? `${s.volume.toLocaleString()} ${unit}` : null,
    };
  }, [state, plan, title]); // eslint-disable-line react-hooks/exhaustive-deps
  const line = s.hardShare > 0.5 ? 'A heavy day. I\'ll hold next week\'s loads and read the next session against it.' : 'Clean session. The loads that moved well go up next week — the rest hold.';
  const receipts = [
    { verb: 'Logged' as const, text: saved ?? `${title} · ${s.sets} sets · ${s.minutes} min` },
    ...state.receipts.filter((r) => r.verb !== 'Logged').map((r) => ({ verb: r.verb, text: r.text })),
  ];
  return (
    <View>
      <Enter exit={false}><Text style={[T.eyebrow, { color: v2.color.muted }]}>Done</Text><Text style={[T.headline, { marginTop: 10 }]}>{title}, done.</Text></Enter>
      <Enter index={1} exit={false}><Text style={[T.bodyMuted, { marginTop: 12 }]}>{line}</Text></Enter>
      <View style={{ marginTop: 26 }}>
        {[['Duration', `${s.minutes} min`], ['Sets', `${s.sets} of ${s.totalSets}`], ['Top set', s.topSet], ['Volume', `${s.volume.toLocaleString()} ${unit}`]].map(([k, v], i) => <Enter key={k} index={i + 2} exit={false}><Row name={k} value={v} last={i === 3} /></Enter>)}
      </View>
      <View style={{ marginTop: 24 }}><ReceiptList items={receipts} /></View>
      {/* The congratulation and the share cards, once the save comes back with them. */}
      {moment ? (
        <Enter index={0} exit={false}>
          <View style={{ marginTop: 28, paddingTop: 20, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: v2.color.hairline }}>
            <MomentPrompt moment={moment} onShare={() => openMoment(moment)} compact />
          </View>
        </Enter>
      ) : null}
      <Enter index={7} exit={false}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 28, marginTop: 28 }}>
          <TextAction primary={!moment} muted={!!moment} onPress={onFinish} loading={saving}>Back to Anakin</TextAction>
          {saved && !moment ? <TextAction muted arrow={false} size={15} onPress={() => setSharing(true)}>Share it</TextAction> : null}
        </View>
      </Enter>
      <ShareWorkoutSheet visible={sharing} onClose={() => setSharing(false)} workout={share} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: v2.color.white, paddingHorizontal: v2.space.gutter },
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 32 },
  bars: { flexDirection: 'row', gap: 6, marginTop: 12 },
  body: { flex: 1, marginTop: 28 },
  // Overview (review #4). The session page is always light — every colour explicit.
  backOv: { fontFamily: v2.font.semibold, fontSize: 15, color: v2.color.ink },
  ovEyebrow: { fontFamily: v2.font.bold, fontSize: 11, letterSpacing: 11 * 0.12, color: v2.color.muted },
  ovTitle: { fontFamily: v2.font.bold, fontSize: 34, letterSpacing: -0.68, lineHeight: 37.4, color: v2.color.ink, marginTop: 10, fontVariant: ['tabular-nums'] },
  ovLine: { flexDirection: 'row', gap: 10, marginTop: 20, alignItems: 'flex-start' },
  ovLineText: { flex: 1, fontFamily: v2.font.regular, fontSize: 15, lineHeight: 15 * 1.55, color: v2.color.muted },
  ovRow: { height: 56, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 16, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: v2.color.hairline },
  ovRowLast: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: v2.color.hairline },
  ovName: { flex: 1, fontFamily: v2.font.medium, fontSize: 17, color: v2.color.ink },
  ovValue: { fontFamily: v2.font.regular, fontSize: 15, color: v2.color.muted, fontVariant: ['tabular-nums'] },
  ovBegin: { fontFamily: v2.font.semibold, fontSize: 17, color: v2.color.crimson },
});

// Pro-only under the direct-entry paywall: free users get the paywall instead.
export default function SessionScreen() {
  const gated = useProScreen();
  return gated ? null : <SessionScreenInner />;
}
