// Program onboarding — one continuous surface, the goal never leaves it.
//
// goal → working (receipts stream) → gaps ("I read N sources. I need N
// things from you.") → ask (one question, its reason, ≤4 rows, dots) →
// pre-filled ("I have 9 of 20 already. Check these.") → health asks →
// red flag (paused, clinician handoff) → consent → plan → first home.
//
// Content comes from the backend (real RAG sources, the profile's own gaps);
// this screen owns sequencing via the reducer in @axiom/agent-ui-core.

import React, { useEffect, useReducer, useRef, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Switch, Linking, Alert } from 'react-native';
import { Pressable } from '../../src/v2/primitives/Pressable';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import Animated, { useSharedValue, useAnimatedStyle, withTiming } from 'react-native-reanimated';
import { onboardingReducer, initialOnboarding, askDots, type Question } from '@axiom/agent-ui-core';
import { v2, T } from '../../src/v2/theme';
import { Mark } from '../../src/v2/primitives/Mark';
import { GoalInput } from '../../src/v2/primitives/GoalInput';
import { Ask, Dots } from '../../src/v2/primitives/Ask';
import { Row } from '../../src/v2/primitives/Row';
import { Enter } from '../../src/v2/primitives/Enter';
import { TextAction } from '../../src/v2/primitives/TextAction';
import { Receipt, ReceiptList } from '../../src/v2/primitives/Receipt';
import { apiFetch, LONG_TIMEOUT_MS } from '../../src/lib/api';
import { useAuth } from '../../src/context/AuthContext';
import { useInvalidate } from '../../src/v2/data';
import { KeyboardAvoider } from '../../src/components/ui/KeyboardAvoider';
import { haptics } from '../../src/v2/haptics';
import { trackScreen } from '../../src/lib/analytics';

const SUGGESTIONS = ['Pull a 350 lb deadlift', 'Fix my lower back', 'Rehab a ruptured Achilles'];

export default function OnboardingScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { refreshUser, user } = useAuth();
  const invalidate = useInvalidate();
  const [s, dispatch] = useReducer(onboardingReducer, undefined, initialOnboarding);
  const [busy, setBusy] = useState(false);
  const [live, setLive] = useState(-1);
  const [chipsOp, setChipsOp] = useState(1);
  const gapsRef = useRef<any>(null);
  const timers = useRef<any[]>([]);
  const later = (fn: () => void, ms: number) => { timers.current.push(setTimeout(fn, ms)); };
  useEffect(() => { trackScreen('v2.onboarding'); return () => timers.current.forEach(clearTimeout); }, []);

  const small = s.screen !== 'goal' && s.screen !== 'working';
  const p = useSharedValue(0);
  useEffect(() => { p.value = withTiming(s.screen === 'goal' ? 0 : 1, { duration: 600, easing: v2.motion.easeEnter }); }, [s.screen, p]);
  const line = useSharedValue(24);
  useEffect(() => { line.value = withTiming(s.screen === 'working' ? 320 : 24, { duration: 1400, easing: v2.motion.easeEnter }); }, [s.screen, line]);
  const lineStyle = useAnimatedStyle(() => ({ width: line.value }));

  // ── Working: fetch gaps, stream the ledger, then the gaps screen ────────
  const start = async () => {
    if (!s.goal.trim() || busy) return;
    haptics.light();
    dispatch({ type: 'start' });
    setBusy(true);
    try {
      const g: any = await apiFetch('/coach/onboarding/gaps', { method: 'POST', body: JSON.stringify({ goal: s.goal.trim() }), timeoutMs: LONG_TIMEOUT_MS });
      gapsRef.current = g;
      const ledger: { verb: any; text: string }[] = g.ledger ?? [];
      ledger.forEach((l, i) => later(() => { dispatch({ type: 'ledger', line: l }); setLive(i); }, 500 + i * 900));
      later(() => {
        setLive(-1);
        dispatch({ type: 'gaps', sources: g.sources ?? 1, questions: g.questions ?? [], prefilled: g.prefilled ?? [], health: g.health ?? [], consent: g.consent ?? [] });
      }, 500 + ledger.length * 900 + 700);
    } catch (e: any) {
      dispatch({ type: 'fail', error: e?.message ?? 'Couldn\'t read that. Try again.' });
      later(() => dispatch({ type: 'restart' }), 1800);
    }
    setBusy(false);
  };
  const pickSuggestion = (t: string) => { setChipsOp(0); later(() => dispatch({ type: 'type_goal', goal: t }), 200); later(() => void startWith(t), 800); };
  const startWith = async (goal: string) => { dispatch({ type: 'type_goal', goal }); later(() => void start(), 0); };

  // ── Build ──────────────────────────────────────────────────────────────
  const build = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const consent = Object.fromEntries(s.consent.map((c) => [c.key, c.on]));
      const r: any = await apiFetch('/coach/onboarding/build', { method: 'POST', body: JSON.stringify({ goal: s.goal.trim(), answers: s.answers, prefilled: s.prefilled, consent }), timeoutMs: LONG_TIMEOUT_MS });
      if (r.paused) { setBusy(false); return; }
      dispatch({ type: 'plan', phases: r.phases ?? [], nutrition: r.nutrition ?? null, planId: null });
      await refreshUser();
      await invalidate.all();
      haptics.success();
    } catch (e: any) {
      dispatch({ type: 'fail', error: e?.message ?? 'Couldn\'t build the program. Try again.' });
    }
    setBusy(false);
  };
  useEffect(() => { if (s.screen === 'plan' && !s.phases.length && !s.error) void build(); }, [s.screen]); // eslint-disable-line react-hooks/exhaustive-deps

  const begin = () => { haptics.light(); const pro = user?.tier === 'pro' || user?.tier === 'enterprise'; router.replace((pro ? '/(v2)' : '/(v2)/paywall') as any); };
  const status = s.screen === 'working' ? 'Working' : s.screen === 'gaps' ? `${s.sources} source${s.sources === 1 ? '' : 's'} read` : s.screen === 'plan' && s.phases.length ? 'Ready' : s.screen === 'redflag' ? 'Paused' : '';
  const q: Question | undefined = s.screen === 'ask' ? s.questions[s.qi] : s.screen === 'health' ? s.health[s.hi] : undefined;
  const total = s.phases.reduce((a, x) => a + x.weeks, 0);

  return (
    <KeyboardAvoider style={styles.root}>
      <StatusBar style="dark" />
      <View style={[styles.head, { paddingTop: insets.top + 12 }]}>
        <Mark working={s.screen === 'working' || busy} />
        {status ? <Text style={T.caption}>{status}</Text> : null}
        {(s.screen === 'ask' || s.screen === 'health') ? <Dots states={askDots(s)} /> : null}
      </View>

      <ScrollView contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + 48 }]} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        {/* The goal — the headline is the input; it shrinks to a caption as the flow progresses. */}
        <View style={{ marginTop: s.screen === 'goal' ? 96 : 8 }}>
          {s.screen === 'goal' ? (
            <>
              <Enter exit={false}><Text style={[T.caption, { marginBottom: 12 }]}>Anakin</Text></Enter>
              <GoalInput value={s.goal} onChange={(g) => dispatch({ type: 'type_goal', goal: g })} onSubmit={() => void start()} autoFocus />
              <Animated.View style={{ opacity: chipsOp, marginTop: 28, gap: 12 }}>
                {SUGGESTIONS.map((t, i) => <Enter key={t} index={i + 3} exit={false}><Pressable onPress={() => pickSuggestion(t)}><Text style={[T.body, { color: v2.color.placeholder }]}>{t}</Text></Pressable></Enter>)}
              </Animated.View>
              {s.goal.trim() ? <Enter exit={false}><TextAction primary onPress={() => void start()} style={{ marginTop: 32 }}>Go</TextAction></Enter> : null}
            </>
          ) : (
            <>
              <Text style={[small ? T.captionStrong : T.headline, small && { color: v2.color.muted }]}>{s.goal}</Text>
              <Animated.View style={[{ height: 1, backgroundColor: s.screen === 'working' ? v2.color.crimson : v2.color.hairline, marginTop: 12 }, lineStyle]} />
            </>
          )}
        </View>

        {s.screen === 'working' ? (
          <View style={{ marginTop: 28 }}>
            <ReceiptList items={s.ledger} liveIndex={live} />
            {s.error ? <Text style={[T.caption, { marginTop: 16 }]}>{s.error}</Text> : null}
          </View>
        ) : null}

        {s.screen === 'gaps' ? (
          <View style={{ marginTop: 36 }}>
            <Enter exit={false}><Text style={T.headlineSm}>I read {s.sources} source{s.sources === 1 ? '' : 's'}. I need {s.questions.length} thing{s.questions.length === 1 ? '' : 's'} from you.</Text></Enter>
            <View style={{ marginTop: 24 }}>
              {s.questions.map((x, i) => <Enter key={x.key} index={i + 1} exit={false}><Row name={x.short} sub={x.why} last={i === s.questions.length - 1} /></Enter>)}
            </View>
            <Enter index={s.questions.length + 1} exit={false}><TextAction primary onPress={() => { haptics.light(); dispatch({ type: 'begin_ask' }); }} style={{ marginTop: 28 }}>Go</TextAction></Enter>
          </View>
        ) : null}

        {(s.screen === 'ask' || s.screen === 'health') && q ? (
          <View style={{ marginTop: 36 }} key={`${s.screen}-${q.key}`}>
            {s.screen === 'health' ? <Text style={[T.caption, { marginBottom: 10 }]}>health, {s.hi + 1} of {s.health.length}</Text> : null}
            <Ask question={q.label} reason={q.why} options={q.options} onPick={(o) => { later(() => dispatch({ type: s.screen === 'health' ? 'health_answer' : 'answer', answer: o }), 640); }} />
            {q.options.some((o) => /tell Anakin/i.test(o)) ? null : null}
            {s.last ? <View style={{ marginTop: 28 }}><Receipt verb={s.last.verb} text={s.last.text} animate /></View> : null}
          </View>
        ) : null}

        {s.screen === 'prefilled' ? (
          <View style={{ marginTop: 36 }}>
            <Enter exit={false}><Text style={T.headlineSm}>I have {s.prefilled.length} of 20 already. Check these.</Text></Enter>
            <View style={{ marginTop: 24 }}>
              {s.prefilled.map((x, i) => <Enter key={x.key} index={i + 1} exit={false}><Row name={x.label} sub={x.source} value={x.value} last={i === s.prefilled.length - 1} onPress={() => Alert.prompt?.(x.label, `Currently ${x.value}`, (v) => v && dispatch({ type: 'edit_prefilled', key: x.key, value: v }), 'plain-text', x.value)} /></Enter>)}
            </View>
            <Text style={[T.caption, { marginTop: 14 }]}>Tap any row to change it. I'll ask about the other {Math.max(0, 20 - s.prefilled.length - s.questions.length)}.</Text>
            <TextAction primary onPress={() => { haptics.light(); dispatch({ type: 'prefilled_ok' }); }} style={{ marginTop: 24 }}>Looks right</TextAction>
          </View>
        ) : null}

        {s.screen === 'redflag' ? (
          <View style={{ marginTop: 36 }}>
            <Enter exit={false}><Text style={T.eyebrow}>Before we train</Text><Text style={[T.headlineSm, { marginTop: 10 }]}>{s.redFlag?.answer === 'Not yet' ? 'This needs a clinician\'s clearance first.' : 'That needs a clinician first.'}</Text></Enter>
            <Enter index={1} exit={false}><Text style={[T.bodyMuted, { marginTop: 12 }]}>It can mean something a program shouldn't load around. I won't program heavy work over it. A physio or doctor can clear it — usually in one visit.</Text></Enter>
            <View style={{ marginTop: 22 }}><ReceiptList items={[{ verb: 'Noted', text: `${s.redFlag?.answer} — flagged` }, { verb: 'Noted', text: `Your goal and ${Object.keys(s.answers).length} answers, saved` }]} /></View>
            <View style={{ marginTop: 28 }}>
              <Row name="Find a physio near me" onPress={() => { dispatch({ type: 'redflag_choice', choice: 'clinician' }); void Linking.openURL('https://www.google.com/maps/search/physiotherapist+near+me'); }} />
              <Row name="It's been checked — I'm cleared" onPress={() => dispatch({ type: 'redflag_choice', choice: 'cleared' })} />
              <Row name="Start a gentle plan meanwhile" onPress={() => dispatch({ type: 'redflag_choice', choice: 'gentle' })} last />
            </View>
            <Text style={[T.caption, { marginTop: 24 }]}>If you lose bladder control or feel numbness in the groin, go to urgent care now.</Text>
          </View>
        ) : null}

        {s.screen === 'consent' ? (
          <View style={{ marginTop: 36 }}>
            <Enter exit={false}><Text style={T.headlineSm}>What I'll use to build it.</Text><Text style={[T.caption, { marginTop: 10 }]}>Each one makes the plan sharper. Turn any off — I'll ask instead.</Text></Enter>
            <View style={{ marginTop: 24 }}>
              {s.consent.map((c, i) => (
                <Enter key={c.key} index={i + 1} exit={false}>
                  <View style={[styles.consentRow, i === s.consent.length - 1 && { borderBottomWidth: 1, borderBottomColor: v2.color.hairline }]}>
                    <View style={{ flex: 1 }}><Text style={T.row}>{c.label}</Text><Text style={[T.caption, { marginTop: 3 }]}>{c.sub}</Text></View>
                    <Switch value={c.on} onValueChange={() => dispatch({ type: 'toggle_consent', key: c.key })} trackColor={{ true: v2.color.ink, false: v2.color.hairline }} thumbColor={v2.color.white} />
                  </View>
                </Enter>
              ))}
            </View>
            <Text style={[T.caption, { marginTop: 18 }]}>Axiom isn't medical care. By continuing you agree to the <Text style={{ color: v2.color.ink, textDecorationLine: 'underline' }} onPress={() => void Linking.openURL('https://axiomtraining.io/terms')}>Terms</Text> and <Text style={{ color: v2.color.ink, textDecorationLine: 'underline' }} onPress={() => void Linking.openURL('https://axiomtraining.io/privacy')}>Health disclaimer</Text>.</Text>
            <TextAction primary onPress={() => { haptics.light(); dispatch({ type: 'agree' }); }} style={{ marginTop: 26 }}>Agree and build</TextAction>
          </View>
        ) : null}

        {s.screen === 'plan' ? (
          <View style={{ marginTop: 36 }}>
            {!s.phases.length && !s.error ? (
              <View>
                <ReceiptList items={[{ verb: 'Read', text: 'Your answers' }, { verb: 'Searched', text: 'Sources for the goal' }, { verb: 'Checked', text: 'Recovery against the days you have' }]} liveIndex={2} />
                <Text style={[T.caption, { marginTop: 16 }]}>Building — this takes a moment.</Text>
              </View>
            ) : null}
            {s.error ? <View><Text style={T.bodyMuted}>{s.error}</Text><TextAction onPress={() => { dispatch({ type: 'fail', error: '' }); void build(); }} style={{ marginTop: 10 }}>Try again</TextAction></View> : null}
            {s.phases.length ? (
              <>
                <Enter exit={false}><Text style={T.headlineSm}>{total} weeks, {s.phases.length} phases.</Text></Enter>
                <View style={{ marginTop: 24 }}>
                  {s.phases.map((ph, i) => <Enter key={ph.name} index={i + 1} exit={false}><Row name={ph.name} sub={ph.focus || undefined} value={`${ph.weeks} wk`} last={false} /></Enter>)}
                  <Enter index={s.phases.length + 1} exit={false}><Row name="Nutrition" sub={s.nutrition ?? undefined} last /></Enter>
                </View>
                <Enter index={s.phases.length + 2} exit={false}><TextAction primary onPress={begin} style={{ marginTop: 28 }}>Begin Phase 1</TextAction></Enter>
              </>
            ) : null}
          </View>
        ) : null}
      </ScrollView>
      {s.screen !== 'goal' && s.screen !== 'plan' ? <Pressable onPress={() => dispatch({ type: 'restart' })} style={[styles.restart, { bottom: insets.bottom + 16 }]}><Text style={[T.caption, { color: v2.color.placeholder }]}>Start over</Text></Pressable> : null}
    </KeyboardAvoider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: v2.color.white },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: v2.space.gutter, minHeight: 44, gap: 12 },
  body: { paddingHorizontal: v2.space.gutter, paddingTop: 8 },
  consentRow: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingVertical: 14, borderTopWidth: 1, borderTopColor: v2.color.hairline },
  restart: { position: 'absolute', right: v2.space.gutter },
});
