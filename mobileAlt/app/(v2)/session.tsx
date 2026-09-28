// Active workout — a pushed full-screen page: overview → set → rest → done.
//
// Steps cross-fade (exit −14/300ms, enter +18/480–560ms). ← Back pauses;
// returning resumes. Four 2pt progress bars, one per exercise. The load at
// 88pt; −step / +step text buttons; a crimson hairline for sets done; the cue;
// rate rows; "Something hurts" / "Swap this lift" hand off to chat. Rest: the
// countdown at 96pt, a draining crimson hairline, the last receipt (with a
// one-tap revert), Up next, Add 30 s / I'm ready, auto-advance. Done: stats
// rows and write receipts; "Back to Anakin" streams a summary turn.

import React, { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Alert, AppState } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { initialWorkout, workoutReducer, defaultRules, elapsedSec, mmss, exerciseProgress, summarize, toWorkoutLogBody, type PlanExercise, type WorkoutState } from '@axiom/agent-ui-core';
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
import { trackScreen } from '../../src/lib/analytics';

function parseReps(r: any): number | string { const n = typeof r === 'number' ? r : parseInt(String(r ?? ''), 10); return Number.isFinite(n) && n > 0 ? n : String(r ?? 8); }

export default function SessionScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const shell = useShellOptional();
  const today = useToday();
  const invalidate = useInvalidate();
  const { unit, fromKg, toKg } = useUnits();
  const rules = useMemo(() => defaultRules(unit === 'kg' ? 'kg' : 'lbs'), [unit]);
  const session = today.data?.session ?? today.data?.todaySession ?? today.data?.today ?? null;
  const [plan, setPlan] = useState<PlanExercise[] | null>(null);
  const [state, dispatch] = useReducer(workoutReducer, undefined, () => initialWorkout([]));
  const [now, setNow] = useState(Date.now());
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const advRef = useRef(false);

  useEffect(() => { trackScreen('v2.session'); }, []);

  // Build the plan: load from the last logged set of each exercise, rest from the rep range, cue from the program's notes.
  useEffect(() => {
    if (plan || !session) return;
    const ex: any[] = session.exercises ?? [];
    (async () => {
      const out: PlanExercise[] = await Promise.all(ex.map(async (e) => {
        let load: number | null = null;
        try { const last: any = await v2Api.lastExercise(e.name); const kg = last?.weightKg ?? last?.last?.weightKg ?? null; if (kg) load = Math.round(fromKg(kg) / rules.step) * rules.step; } catch { /* no history */ }
        const reps = parseReps(e.reps);
        return { name: e.name, sets: Math.max(1, Number(e.sets) || 3), reps, load: e.bodyweight ? null : load, rest: Number(e.restSeconds) || rules.restForReps(reps), cue: e.notes || e.cue || null };
      }));
      setPlan(out);
    })();
  }, [session, plan, fromKg, rules]);

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
  const progress = exerciseProgress(state, P);

  const back = () => {
    if (state.step === 'overview' || state.step === 'done') return router.back();
    dispatch({ type: 'pause', now: Date.now() });
    Alert.alert('Pause the session?', 'Your sets are kept. Come back to resume.', [
      { text: 'Resume', style: 'cancel', onPress: () => dispatch({ type: 'resume', now: Date.now() }) },
      { text: 'Leave', style: 'destructive', onPress: () => router.back() },
    ]);
  };
  const rate = (rating: 'easy' | 'hard' | 'miss') => { haptics.select(); setTimeout(() => dispatch({ type: 'rate', rating, now: Date.now(), plan: P, rules }), 300); };
  const handOff = (m: string) => { shell?.ask(m); router.back(); };
  const finish = async () => {
    if (saving) return;
    setSaving(true);
    const sum = summarize(state, P, Date.now());
    const title = session?.name ?? session?.day ?? 'Session';
    try {
      const body = toWorkoutLogBody(state, P, title, new Date().toISOString().slice(0, 10), Date.now());
      await workoutsApi.logWorkout({ date: body.date, title: body.title, exercises: body.exercises.map((e) => ({ name: e.name, sets: e.sets, reps: e.reps, weightKg: e.weight ? toKg(e.weight) : null, rpe: e.rpe ?? null, notes: e.notes ?? null, bodyweight: !e.weight })), duration: body.duration } as any);
      await invalidate.afterWorkout();
      setSaved(`${title} · ${sum.sets} sets · ${sum.minutes} min`);
      haptics.success();
    } catch (e: any) { Alert.alert('Couldn\'t save the session', e?.message ?? 'Try again.'); setSaving(false); return; }
    setSaving(false);
    const summaryMsg = `I just finished ${title}: ${sum.sets} of ${sum.totalSets} sets, ${sum.minutes} min, top set ${sum.topSet}${state.nextWeek.length ? `, and ${state.nextWeek.map((n) => `${P[n.ex]?.name} felt easy on the last set`).join('; ')}` : ''}. What changes for next time?`;
    shell?.ask(summaryMsg);
    router.back();
  };

  const eyebrowTone = { color: v2.color.muted };
  return (
    <View style={[styles.root, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 24 }]}>
      <StatusBar style="dark" />
      <View style={styles.top}>
        <Pressable onPress={back} hitSlop={10}><Text style={[T.body, { color: v2.color.muted }]}>← Back</Text></Pressable>
        <Text style={[T.caption, T.num]}>{state.step === 'overview' ? (today.data?.phaseName ? `${today.data.phaseName} · wk ${today.data.weekNumber ?? ''}` : 'Today') : mmss(elapsedSec(state, now))}</Text>
      </View>
      {state.step !== 'overview' && state.step !== 'done' ? (
        <View style={styles.bars}>
          {P.map((_, i) => <View key={i} style={{ flex: 1 }}><ProgressHairline fraction={progress[i]} crimson={false} /></View>)}
        </View>
      ) : null}

      <View style={styles.body}>
        {!session && !today.isLoading ? (
          <View>
            <Text style={T.headlineSm}>Nothing scheduled today.</Text>
            <Text style={[T.bodyMuted, { marginTop: 12 }]}>Rest, or ask Anakin to pull a session forward.</Text>
            <TextAction primary onPress={() => handOff("Can I train today? Pull a session forward.")} style={{ marginTop: 20 }}>Ask Anakin</TextAction>
          </View>
        ) : null}
        {session && !plan ? <Text style={T.caption}>Setting the loads…</Text> : null}

        {plan && state.step === 'overview' ? (
          <Animated.View key="ov" entering={FadeIn.duration(480)} exiting={FadeOut.duration(260)}>
            <Enter exit={false}><Text style={[T.eyebrow, eyebrowTone]}>Today</Text><Text style={[T.headline, { marginTop: 10 }]}>{session.name ?? session.day}{session.minutes ? ` · ${session.minutes} min` : ''}</Text></Enter>
            {session.focus ? <Enter index={1} exit={false}><Text style={[T.bodyMuted, { marginTop: 12 }]}>{session.focus}</Text></Enter> : null}
            <View style={{ marginTop: 28 }}>
              {P.map((e, i) => <Enter key={e.name} index={i + 2} exit={false}><Row name={e.name} value={`${e.sets} × ${e.reps}${e.load ? ` · ${e.load}` : ''}`} last={i === P.length - 1} /></Enter>)}
            </View>
            <Enter index={P.length + 2} exit={false}><TextAction primary onPress={() => { haptics.light(); dispatch({ type: 'begin', now: Date.now() }); }} style={{ marginTop: 28 }}>Begin</TextAction></Enter>
          </Animated.View>
        ) : null}

        {plan && cur && state.step === 'set' ? (
          <Animated.View key={`set-${state.ex}-${state.set}`} entering={FadeIn.duration(520)} exiting={FadeOut.duration(280)}>
            <Text style={[T.eyebrow, eyebrowTone]}>{cur.name} · set {state.set + 1} of {cur.sets}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', marginTop: 14 }}>
              <Text style={T.display}>{load ?? 'BW'}</Text>
              {load != null ? <Text style={[T.read, { color: v2.color.muted, marginLeft: 8 }]}>{unit}</Text> : null}
              <Text style={[T.read, { color: v2.color.muted, marginLeft: 14 }]}>× {cur.reps}</Text>
            </View>
            {load != null ? (
              <View style={{ flexDirection: 'row', gap: 28, marginTop: 8 }}>
                <TextAction arrow={false} muted size={15} onPress={() => dispatch({ type: 'adjust_load', delta: -rules.step })}>− {rules.step} {unit}</TextAction>
                <TextAction arrow={false} muted size={15} onPress={() => dispatch({ type: 'adjust_load', delta: rules.step })}>+ {rules.step} {unit}</TextAction>
              </View>
            ) : null}
            <View style={{ marginTop: 22 }}><ProgressHairline fraction={state.set / cur.sets} /></View>
            {cur.cue ? <Text style={[T.bodyMuted, { marginTop: 18 }]}>{cur.cue}</Text> : null}
            <View style={{ marginTop: 26 }}>
              <Row name="Done — easy" onPress={() => rate('easy')} arrow />
              <Row name="Done — hard" onPress={() => rate('hard')} arrow />
              <Row name="Missed a rep" onPress={() => rate('miss')} arrow last />
            </View>
            <View style={{ flexDirection: 'row', gap: 24, marginTop: 24 }}>
              <TextAction muted size={14} arrow={false} onPress={() => handOff(`Something hurts on ${cur.name.toLowerCase()} — what should I do?`)}>Something hurts</TextAction>
              <TextAction muted size={14} arrow={false} onPress={() => handOff(`Swap ${cur.name.toLowerCase()} for something easier on me today`)}>Swap this lift</TextAction>
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
              <Row name={`${P[state.ex]?.name}${state.set ? ` · set ${state.set + 1}` : ''}`} value={P[state.ex]?.load != null && state.loads[state.ex] != null ? `${state.loads[state.ex]} × ${P[state.ex].reps}` : `${P[state.ex]?.reps} reps`} last />
            </View>
            <View style={{ marginTop: 20 }}>
              <Row name="Add 30 s" onPress={() => dispatch({ type: 'rest_add', seconds: 30 })} arrow />
              <Row name="I'm ready" onPress={() => { if (advRef.current) return; advRef.current = true; dispatch({ type: 'rest_skip' }); setTimeout(() => { advRef.current = false; }, 400); }} emphasis arrow last />
            </View>
          </Animated.View>
        ) : null}

        {plan && state.step === 'done' ? (
          <Animated.View key="done" entering={FadeIn.duration(520)}>
            <DoneView state={state} plan={P} now={now} title={session?.name ?? session?.day ?? 'Session'} unit={unit} saved={saved} saving={saving} onFinish={() => void finish()} />
          </Animated.View>
        ) : null}
      </View>
    </View>
  );
}

function DoneView({ state, plan, now, title, unit, saved, saving, onFinish }: { state: WorkoutState; plan: PlanExercise[]; now: number; title: string; unit: string; saved: string | null; saving: boolean; onFinish: () => void }) {
  const s = summarize(state, plan, now);
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
      <Enter index={7} exit={false}><TextAction primary onPress={onFinish} loading={saving} style={{ marginTop: 28 }}>Back to Anakin</TextAction></Enter>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: v2.color.white, paddingHorizontal: v2.space.gutter },
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 32 },
  bars: { flexDirection: 'row', gap: 6, marginTop: 12 },
  body: { flex: 1, marginTop: 28 },
});
