// Anakin (index 0) — home. Two states, one progress value.
//
// Brief (on load): #2c2c2c ground (drawn by the track), the engraving in its
// 440-pt box and the orb at the fingertips — the orb IS the mark. Content is
// bottom-anchored: eyebrow → Anakin's one-sentence read → "Checked N things"
// → today's session row → the input, 112 pt above the tab bar. No suggestions.
//
// Chat (input focused or turns exist): the ground fades to white (850 ms),
// the art lifts away, the orb flies into the header and becomes the logo, the
// brief collapses to nothing, the thread takes the page — suggestions only
// while it is empty — and the input sits on the keyboard. Blur with an empty
// thread returns to brief after 250 ms; so does the header mark, anywhere.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, StyleSheet, Keyboard } from 'react-native';
import Animated, { useAnimatedStyle, interpolateColor, useAnimatedKeyboard, FadeIn, FadeOut } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { receiptSummary, type Turn } from '@axiom/agent-ui-core';
import { v2, T } from '../theme';
import { Enter } from '../primitives/Enter';
import { ReceiptList, Caret } from '../primitives/Receipt';
import { Ask } from '../primitives/Ask';
import { headerClearance } from '../shell/Header';
import { useShell } from '../shell/ShellContext';
import { useBrief, useInvalidate } from '../data';
import { useThread } from '../chat/useThread';
import { TurnCard } from '../chat/Cards';
import { Orb } from '../home/Orb';
import { MarkdownText } from '../../components/ui/MarkdownText';
import { useAuth } from '../../context/AuthContext';
import { coachApi } from '../../lib/api';
import { haptics } from '../haptics';
import { phaseWeek, sessionTitle, sessionCaption } from '../format';

const C = v2.color;
/** The read is plain text; the model occasionally leaks markdown into it. */
const plain = (t: string) => t.replace(/[*_`#>]+/g, '').replace(/\s+/g, ' ').trim();
let askSeq = 0;

export function HomePage() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const shell = useShell();
  const p = shell.progress;
  const { user } = useAuth();
  const brief = useBrief();
  const invalidate = useInvalidate();
  const thread = useThread();
  const chat = shell.mode === 'chat';
  const [text, setText] = useState('');
  const [focus, setFocus] = useState(false);
  const [briefOpen, setBriefOpen] = useState(false);
  const [askDone, setAskDone] = useState(false);
  const askAppended = useRef(false);
  const inputRef = useRef<TextInput>(null);
  const scrollRef = useRef<ScrollView>(null);
  const blurTimer = useRef<any>(null);

  // Shell → home: "Something hurts" from the session, suggestions from other pages.
  useEffect(() => {
    shell.registerAsk((m) => { void thread.send(m); });
    if (shell.pendingAsk.current) { const m = shell.pendingAsk.current; shell.pendingAsk.current = null; void thread.send(m); }
  }, [shell, thread.send]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void thread.hydrate(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const t = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 60); return () => clearTimeout(t); }, [thread.state.turns]);

  // ── Everything below interpolates from the one progress value ───────────
  const briefBlock = useAnimatedStyle(() => ({ opacity: 1 - p.value, maxHeight: 640 * (1 - p.value) }));
  const readStyle = useAnimatedStyle(() => ({ color: interpolateColor(p.value, [0, 1], [C.darkInk, C.muted]), fontSize: 27 - 12 * p.value, lineHeight: 34 - 12 * p.value }));
  const eyebrowStyle = useAnimatedStyle(() => ({ color: interpolateColor(p.value, [0, 1], [C.darkMuted, C.muted]) }));
  const receiptsLine = useAnimatedStyle(() => ({ opacity: 1 - p.value, maxHeight: 160 * (1 - p.value) }));
  const rowLine = useAnimatedStyle(() => ({ borderColor: interpolateColor(p.value, [0, 1], [C.darkHairline, C.hairline]) }));
  const rowTitle = useAnimatedStyle(() => ({ color: interpolateColor(p.value, [0, 1], [C.darkInk, C.ink]), fontSize: 17 - 2 * p.value }));
  const rowCaption = useAnimatedStyle(() => ({ opacity: 1 - p.value, maxHeight: 40 * (1 - p.value) }));
  const threadStyle = useAnimatedStyle(() => ({ opacity: p.value, flex: p.value > 0.02 ? 1 : 0 }));
  const kb = useAnimatedKeyboard();
  const bottomInset = insets.bottom;
  const focusSV = focus;
  const inputWrap = useAnimatedStyle(() => {
    const onKeyboard = Math.max(0, kb.height.value - bottomInset);
    const briefBottom = v2.space.tabBarClearance + bottomInset;
    const chatBottom = onKeyboard > 0 ? onKeyboard + 12 : 12 + bottomInset;
    return {
      marginBottom: briefBottom + (chatBottom - briefBottom) * p.value,
      height: 52 + 8 * p.value,
      borderTopColor: interpolateColor(p.value, [0, 1], [C.darkInputLine, focusSV ? C.ink : C.hairline]),
    };
  }, [focusSV, bottomInset]);
  const inputText = useAnimatedStyle(() => ({ color: interpolateColor(p.value, [0, 1], [C.darkInk, C.ink]) }));

  const loaded = !!brief.data;
  const isDay0 = loaded && !!(user as any)?.coachOnboardingDone && !brief.data?.session && !brief.data?.weekNumber;
  const sentence = loaded ? plain(brief.data!.sentence) : (brief.isError ? 'Tell me what you\'re working toward.' : '');
  const summary = useMemo(() => {
    const n = brief.data?.receipts?.length ?? 0;
    if (!n) return '';
    const verbs = [...new Set(brief.data!.receipts.map((r) => r.verb.toLowerCase()))].join(', ');
    return `Checked ${n} thing${n === 1 ? '' : 's'} · ${verbs}`;
  }, [brief.data]);
  const suggestions = brief.data?.suggestions ?? ["I can't train Thursday. Move it?", 'How\'s my bench?', 'Log lunch'];
  const session = brief.data?.session;
  const eyebrow = isDay0 ? 'Day 0' : loaded ? (phaseWeek(brief.data?.phaseName, brief.data?.weekNumber) || 'Anakin') : 'Anakin';
  const ask = !askDone ? brief.data?.ask ?? null : null;

  const enterChat = () => {
    if (chat) return;
    shell.setMode('chat');
    // A wellness Ask Anakin raised today opens the thread as an agent turn (question · reason · rows).
    if (ask && !askAppended.current) {
      askAppended.current = true;
      thread.dispatch({ type: 'append_agent', turn: { id: `ask${Date.now().toString(36)}${askSeq++}`, kind: 'agent', text: '', receipts: [{ id: 'r-ask', verb: 'Checked', text: 'Wellness — no check-in today' }], done: true, ask } });
    }
  };
  const toBrief = () => { Keyboard.dismiss(); shell.setMode('brief'); };
  const send = async (m?: string) => {
    const msg = (m ?? text).trim(); if (!msg) return;
    enterChat(); setText('');
    await thread.send(msg);
  };
  const answerAsk = (turn: Turn, o: string) => {
    const hours = /Under/.test(o) ? 5 : /6–7/.test(o) ? 6.5 : 7.5;
    thread.dispatch({ type: 'resolve', agentId: turn.id, resolution: `Logged — Wellness · sleep ${o.toLowerCase()}` });
    setAskDone(true);
    void coachApi.postCheckin({ sleepHours: hours, energy: hours < 6 ? 2 : hours < 7 ? 3 : 4, mood: hours < 6 ? 2 : 3, stress: hours < 6 ? 4 : 2 } as any).catch(() => {}).then(() => invalidate.afterSchedule());
    void thread.send(`I slept ${o.toLowerCase()} last night. Does today change?`);
  };
  const onBlur = () => {
    setFocus(false);
    clearTimeout(blurTimer.current);
    blurTimer.current = setTimeout(() => { if (thread.state.turns.length === 0 && !text.trim()) shell.setMode('brief'); }, 250);
  };
  useEffect(() => () => clearTimeout(blurTimer.current), []);
  const busy = thread.state.busy;
  const emptyThread = thread.state.turns.length === 0;

  return (
    <View style={styles.flex}>
      <Orb mode={chat ? 'chat' : 'brief'} progress={p} working={busy} focused={shell.index === 0} />

      <View style={[styles.flex, { paddingTop: headerClearance(insets.top), paddingHorizontal: v2.space.gutter }]}>
        {/* Spacer: the brief sits at the bottom, clear of the orb (whose bottom edge is ≈510). */}
        {!chat ? <View style={{ flex: 1 }} /> : null}

        {/* Brief — collapses to nothing as progress → 1. */}
        <Animated.View style={[{ overflow: 'hidden' }, briefBlock]} pointerEvents={chat ? 'none' : 'auto'}>
          <Enter exit={false}>
            <Animated.Text style={[T.eyebrow, eyebrowStyle]}>{eyebrow}</Animated.Text>
            <Animated.Text style={[styles.read, readStyle]} numberOfLines={3}>{sentence || ' '}</Animated.Text>
          </Enter>
          {summary ? (
            <Animated.View style={[{ overflow: 'hidden' }, receiptsLine]}>
              <Enter index={1} exit={false}>
                <Pressable onPress={() => setBriefOpen((o) => !o)} hitSlop={6} style={{ marginTop: 10 }}>
                  <Text style={[T.caption, { color: C.darkMuted }]}>{summary}{briefOpen ? '' : ' →'}</Text>
                </Pressable>
                {briefOpen ? <View style={{ marginTop: 10 }}><ReceiptList items={brief.data!.receipts} tone="dark" /></View> : null}
              </Enter>
            </Animated.View>
          ) : null}
          {session ? (
            <Enter index={2} exit={false}>
              <Pressable onPress={session.isLogged ? undefined : () => { haptics.select(); router.push('/(v2)/session' as any); }} accessibilityRole="button">
                <Animated.View style={[styles.sessionRow, rowLine]}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Animated.Text style={[styles.rowTitle, rowTitle]} numberOfLines={1}>
                      {session.isToday ? '' : 'Tomorrow · '}{sessionTitle(session.name)}{session.minutes ? ` · ${session.minutes} min` : ''}
                    </Animated.Text>
                    {session.focus ? (
                      <Animated.View style={[{ overflow: 'hidden' }, rowCaption]}>
                        <Text style={[T.caption, { color: C.darkMuted, marginTop: 4 }]} numberOfLines={1}>{sessionCaption(session.focus)}</Text>
                      </Animated.View>
                    ) : null}
                  </View>
                  <Text style={[T.row, { color: session.isLogged ? C.darkMuted : C.placeholder }]}>{session.isLogged ? 'Done' : '→'}</Text>
                </Animated.View>
              </Pressable>
            </Enter>
          ) : null}
        </Animated.View>

        {/* Thread — suggestions only while it is empty; they fade out on the first send. */}
        <Animated.View style={[threadStyle, { overflow: 'hidden' }]} pointerEvents={chat ? 'auto' : 'none'}>
          <ScrollView ref={scrollRef} style={styles.flex} contentContainerStyle={{ paddingTop: 12, paddingBottom: 72, gap: 44 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            {emptyThread ? (
              <Animated.View exiting={FadeOut.duration(220)} style={{ gap: 16 }}>
                {suggestions.slice(0, 3).map((l, i) => (
                  <Animated.View key={l} entering={FadeIn.delay(120 + 90 * i).duration(v2.motion.enter)}>
                    <Pressable onPress={() => void send(l)} hitSlop={4} accessibilityRole="button">
                      <Text style={styles.suggestion}>{l}</Text>
                    </Pressable>
                  </Animated.View>
                ))}
              </Animated.View>
            ) : null}
            {thread.state.turns.map((t) => (
              <TurnView key={t.id} turn={t}
                toggle={() => thread.dispatch({ type: 'toggle', id: t.id })}
                patch={(pch) => thread.dispatch({ type: 'card_state', agentId: t.id, patch: pch })}
                resolve={(line) => thread.dispatch({ type: 'resolve', agentId: t.id, resolution: line })}
                ask={(m) => { setText(m); inputRef.current?.focus(); }}
                onAsk={(o) => answerAsk(t, o)} />
            ))}
            {thread.state.error ? <Text style={T.caption}>{thread.state.error}</Text> : null}
          </ScrollView>
        </Animated.View>

        {/* Input: one hairline, "Ask Anakin", the send arrow — crimson when there's text. */}
        <Animated.View style={[styles.inputWrap, inputWrap]}>
          <AnimatedTextInput
            ref={inputRef}
            value={text}
            onChangeText={setText}
            onFocus={() => { setFocus(true); enterChat(); setBriefOpen(false); }}
            onBlur={onBlur}
            onSubmitEditing={() => void send()}
            placeholder="Ask Anakin"
            placeholderTextColor={C.placeholder}
            style={[styles.input, inputText]}
            returnKeyType="send"
            blurOnSubmit={false}
            cursorColor={C.crimson}
            selectionColor={C.crimson}
            accessibilityLabel="Ask Anakin"
          />
          <Pressable onPress={() => void send()} hitSlop={10} accessibilityLabel="Send" disabled={!text.trim() || busy}>
            <Text style={[T.rowStrong, { color: text.trim() && !busy ? C.crimson : C.placeholder, fontSize: 20 }]}>↑</Text>
          </Pressable>
        </Animated.View>
      </View>
      {chat ? <Pressable onPress={toBrief} style={{ position: 'absolute', top: insets.top + 12, left: v2.space.gutter, width: 32, height: 32 }} accessibilityLabel="Back to brief" /> : null}
    </View>
  );
}

const AnimatedTextInput = Animated.createAnimatedComponent(TextInput);

function TurnView({ turn, toggle, patch, resolve, ask, onAsk }: { turn: Turn; toggle: () => void; patch: (p: Record<string, any>) => void; resolve: (l: string) => void; ask: (m: string) => void; onAsk: (o: string) => void }) {
  if (turn.kind === 'user') {
    return <Enter exit={false}><Text style={[T.body, { color: C.ink, textAlign: 'right', alignSelf: 'flex-end', maxWidth: '86%' }]}>{turn.text}</Text></Enter>;
  }
  const streaming = !turn.done;
  const live = streaming && turn.receipts.length && !turn.text ? turn.receipts.length - 1 : -1;
  const summary = receiptSummary(turn);
  const showList = turn.open || (streaming && !turn.text);
  return (
    <Enter exit={false}>
      <View>
        {turn.unprompted ? <Text style={[T.eyebrow, { marginBottom: 8 }]}>While you were away</Text> : null}
        {summary ? (
          <Pressable onPress={toggle} hitSlop={6} disabled={streaming && !turn.text}>
            <Text style={T.caption}>{summary}{turn.done && turn.receipts.length && !turn.open ? ' →' : ''}</Text>
          </Pressable>
        ) : null}
        {showList && turn.receipts.length ? <View style={{ marginTop: 8 }}><ReceiptList items={turn.receipts} liveIndex={live} animate={streaming} /></View> : null}
        {turn.ask && !turn.resolution ? (
          <View style={{ marginTop: 12 }}>
            <Ask question={turn.ask.question} reason={turn.ask.reason} options={turn.ask.options} size="read" onPick={(o) => onAsk(o)} />
          </View>
        ) : null}
        {turn.text ? (
          <View style={{ marginTop: summary ? 10 : 0, flexDirection: 'row', alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <View style={{ flex: 1 }}><MarkdownText text={turn.text} style={[T.body, { fontSize: 16, lineHeight: 25 }]} /></View>
            {streaming ? <Caret /> : null}
          </View>
        ) : null}
        {turn.done ? <TurnCard turn={turn} patch={patch} resolve={resolve} ask={ask} /> : null}
        {turn.resolution ? <View style={{ marginTop: 12 }}><Text style={[T.caption, { color: /^(Adjusted|Logged)/.test(turn.resolution) ? C.crimson : C.muted }]}>{turn.resolution}</Text></View> : null}
      </View>
    </Enter>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  read: { fontFamily: v2.font.semibold, letterSpacing: -0.54, marginTop: 10 },
  sessionRow: { flexDirection: 'row', alignItems: 'center', gap: 16, marginTop: 22, paddingVertical: 15, borderTopWidth: 1, borderBottomWidth: 1, minHeight: 56 },
  rowTitle: { fontFamily: v2.font.medium, lineHeight: 22 },
  suggestion: { fontFamily: v2.font.medium, fontSize: 20, lineHeight: 26, color: C.muted, letterSpacing: -0.2 },
  inputWrap: { flexDirection: 'row', alignItems: 'center', gap: 12, borderTopWidth: 1 },
  input: { flex: 1, fontFamily: v2.font.regular, fontSize: 17, padding: 0 },
});
