// Anakin (index 0) — home, to RN_QA_REVIEW_03 §B, §D, §E.
//
// Brief: #2c2c2c ground (drawn by the track), the art and the orb (Orb.tsx),
// then bottom-anchored content — receipts summary → read → session row
// (`Begin →`) → input, 112 pt above the tab bar. No eyebrow, no suggestions.
//
// Chat: one shared progress value drives everything on the UI thread —
// spacer flexGrow 1 → 0, receipts summary height → 0, the read scales
// 27 → 15 pt by transform (never fontSize) and recolours, the session row
// tightens (17 → 15, padding 20 → 10, caption collapses), the input grows
// 52 → 60 and its margin 112 → 40, the thread fills with opacity 0 → 1.
// Suggestions live in the empty thread. The composer rides the keyboard at
// 12 pt. Blur with an empty thread and no text returns to brief after 250 ms.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, StyleSheet, Keyboard, useWindowDimensions, type LayoutChangeEvent } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, interpolate, interpolateColor, useAnimatedKeyboard, FadeIn, FadeOut, Extrapolation } from 'react-native-reanimated';
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
import { coachApi } from '../../lib/api';
import { haptics } from '../haptics';
import { sessionTitle, sessionCaption } from '../format';

const C = v2.color;
const plain = (t: string) => t.replace(/[*_`#>]+/g, '').replace(/\s+/g, ' ').trim();
let askSeq = 0;
const AnimatedTextInput = Animated.createAnimatedComponent(TextInput);

export function HomePage() {
  const insets = useSafeAreaInsets();
  const { width: SW } = useWindowDimensions();
  const s = SW / 402;
  const router = useRouter();
  const shell = useShell();
  const p = shell.progress;
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
  // Measured once (§D.2): the receipts line and the session caption collapse from their own heights.
  const summaryH = useSharedValue(0);
  const captionH = useSharedValue(0);

  useEffect(() => {
    shell.registerAsk((m) => { void thread.send(m); });
    if (shell.pendingAsk.current) { const m = shell.pendingAsk.current; shell.pendingAsk.current = null; void thread.send(m); }
  }, [shell, thread.send]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void thread.hydrate(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const t = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 60); return () => clearTimeout(t); }, [thread.state.turns, focus]);

  // ── Everything below runs from the one progress value, on the UI thread (§D) ──
  const spacer = useAnimatedStyle(() => ({ flexGrow: 1 - p.value }));
  const summaryStyle = useAnimatedStyle(() => ({ height: summaryH.value ? summaryH.value * (1 - p.value) : undefined, opacity: interpolate(p.value, [0, 0.55], [1, 0], Extrapolation.CLAMP), marginBottom: 14 * (1 - p.value) }));
  const readStyle = useAnimatedStyle(() => ({
    color: interpolateColor(p.value, [0, 1], [C.darkInk, C.muted]),
    transform: [{ scale: interpolate(p.value, [0, 1], [1, 15 / 27]) }],
  }));
  const readBox = useAnimatedStyle(() => ({ marginBottom: 22 * (1 - p.value) }));
  const rowStyle = useAnimatedStyle(() => ({ paddingVertical: 20 - 10 * p.value, borderColor: interpolateColor(p.value, [0, 1], [C.darkHairline, C.hairline]) }));
  const rowName = useAnimatedStyle(() => ({ color: interpolateColor(p.value, [0, 1], [C.darkInk, C.ink]), transform: [{ scale: interpolate(p.value, [0, 1], [1, 15 / 17]) }] }));
  const captionStyle = useAnimatedStyle(() => ({ height: captionH.value ? captionH.value * (1 - p.value) : undefined, opacity: 1 - p.value }));
  const beginStyle = useAnimatedStyle(() => ({ color: interpolateColor(p.value, [0, 1], [C.darkInk, C.ink]) }));
  const threadStyle = useAnimatedStyle(() => ({ flexGrow: p.value, opacity: p.value, flexBasis: 0 }));
  const kb = useAnimatedKeyboard();
  const bottomInset = insets.bottom;
  const inputWrap = useAnimatedStyle(() => ({
    height: 52 + 8 * p.value,
    marginBottom: 112 + (40 - 112) * p.value,
    borderTopColor: interpolateColor(p.value, [0, 1], [C.darkInputLine, focus ? C.ink : C.hairline]),
    transform: [{ translateY: -Math.max(0, kb.height.value - bottomInset) * p.value }],
  }), [focus, bottomInset]);
  const threadPad = useAnimatedStyle(() => ({ height: 72 + Math.max(0, kb.height.value - bottomInset) }));
  const inputText = useAnimatedStyle(() => ({ color: interpolateColor(p.value, [0, 1], [C.darkInk, C.ink]) }));

  const loaded = !!brief.data;
  const sentence = loaded ? plain(brief.data!.sentence) : (brief.isError ? 'Tell me what you\'re working toward.' : '');
  const summary = useMemo(() => {
    const n = brief.data?.receipts?.length ?? 0;
    if (!n) return '';
    const verbs = [...new Set(brief.data!.receipts.map((r) => r.verb.toLowerCase()))].join(', ');
    return `Checked ${n} thing${n === 1 ? '' : 's'} · ${verbs}`;
  }, [brief.data]);
  const suggestions = brief.data?.suggestions ?? ["I can't train Thursday. Move it?", 'How\'s my bench?', 'Log lunch'];
  const session = brief.data?.session;
  const ask = !askDone ? brief.data?.ask ?? null : null;

  const enterChat = () => {
    if (chat) return;
    shell.setMode('chat');
    if (ask && !askAppended.current) {
      askAppended.current = true;
      thread.dispatch({ type: 'append_agent', turn: { id: `ask${Date.now().toString(36)}${askSeq++}`, kind: 'agent', text: '', receipts: [{ id: 'r-ask', verb: 'Checked', text: 'Wellness — no check-in today' }], done: true, ask } });
    }
  };
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
  const onSummaryLayout = (e: LayoutChangeEvent) => { if (!summaryH.value) summaryH.value = e.nativeEvent.layout.height; };
  const onCaptionLayout = (e: LayoutChangeEvent) => { if (!captionH.value) captionH.value = e.nativeEvent.layout.height; };

  return (
    <View style={styles.flex}>
      <Orb mode={chat ? 'chat' : 'brief'} progress={p} working={busy} focused={shell.index === 0} />

      <View style={[styles.flex, { paddingTop: headerClearance(insets.top), paddingHorizontal: v2.space.gutter }]}>
        {/* Top spacer: pushes the brief to the bottom; collapses in chat. */}
        <Animated.View style={spacer} />

        {/* Receipts summary → tap to expand (§B2.1). Tapping also enters chat per §D. */}
        {summary ? (
          <Animated.View style={[{ overflow: 'hidden' }, summaryStyle]} onLayout={onSummaryLayout}>
            <Pressable onPress={() => { if (!chat) setBriefOpen((o) => !o); }} hitSlop={6}>
              <Text style={[T.caption, { color: C.darkMuted }]} numberOfLines={1}>{summary}{briefOpen ? '' : ' →'}</Text>
            </Pressable>
            {briefOpen ? <View style={{ marginTop: 10 }}><ReceiptList items={brief.data!.receipts} tone="dark" /></View> : null}
          </Animated.View>
        ) : null}

        {/* The read: 27 / 600 / −0.02em / 1.22 in brief; scales to 15 and recolours in chat. */}
        <Animated.View style={readBox}>
          <Animated.Text style={[styles.read, { transformOrigin: 'left top' } as any, readStyle]} numberOfLines={3}>{sentence || ' '}</Animated.Text>
        </Animated.View>

        {/* Session row: name · minutes, caption, `Begin →`. Opens the workout. */}
        {session ? (
          <Pressable onPress={session.isLogged ? undefined : () => { haptics.select(); router.push('/(v2)/session' as any); }} accessibilityRole="button">
            <Animated.View style={[styles.sessionRow, rowStyle]}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Animated.Text style={[styles.rowName, { transformOrigin: 'left center' } as any, rowName]} numberOfLines={1}>
                  {session.isToday ? '' : 'Tomorrow · '}{sessionTitle(session.name)}{session.minutes ? ` · ${session.minutes} min` : ''}
                </Animated.Text>
                {session.focus ? (
                  <Animated.View style={[{ overflow: 'hidden' }, captionStyle]} onLayout={onCaptionLayout}>
                    <Text style={[T.caption, { color: C.darkMuted, marginTop: 4 }]} numberOfLines={1}>{sessionCaption(session.focus)}</Text>
                  </Animated.View>
                ) : null}
              </View>
              <Animated.Text style={[styles.begin, beginStyle]}>{session.isLogged ? 'Done' : 'Begin →'}</Animated.Text>
            </Animated.View>
          </Pressable>
        ) : null}

        {/* Thread: fills in chat; suggestions only while empty; 44 between turns; bottom padding grows with the keyboard. */}
        <Animated.View style={[threadStyle, { overflow: 'hidden' }]} pointerEvents={chat ? 'auto' : 'none'}>
          <Animated.ScrollView ref={scrollRef as any} style={styles.flex} contentContainerStyle={{ flexGrow: 1, justifyContent: 'flex-end', paddingTop: 24, gap: 44 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive">
            {emptyThread ? (
              <Animated.View exiting={FadeOut.duration(220)} style={{ gap: 16 }}>
                {suggestions.slice(0, 3).map((l, i) => (
                  <Animated.View key={l} entering={FadeIn.delay(120 + 90 * i).duration(500)}>
                    <Pressable onPress={() => void send(l)} hitSlop={4} accessibilityRole="button"><Text style={styles.suggestion}>{l}</Text></Pressable>
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
            <Animated.View style={threadPad} />
          </Animated.ScrollView>
        </Animated.View>

        {/* Composer: one hairline, "Ask Anakin", ↑ (crimson with text, unless busy). Rides the keyboard at 12 pt. */}
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
            <Text style={[styles.send, { color: text.trim() && !busy ? C.crimson : C.placeholder }]}>↑</Text>
          </Pressable>
        </Animated.View>
      </View>
    </View>
  );
}

function TurnView({ turn, toggle, patch, resolve, ask, onAsk }: { turn: Turn; toggle: () => void; patch: (p: Record<string, any>) => void; resolve: (l: string) => void; ask: (m: string) => void; onAsk: (o: string) => void }) {
  if (turn.kind === 'user') {
    return <Enter exit={false}><Text style={[styles.userTurn]}>{turn.text}</Text></Enter>;
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
        {turn.ask && !turn.resolution ? <View style={{ marginTop: 12 }}><Ask question={turn.ask.question} reason={turn.ask.reason} options={turn.ask.options} size="read" onPick={(o) => onAsk(o)} /></View> : null}
        {turn.text ? (
          <View style={{ marginTop: summary ? 10 : 0, flexDirection: 'row', alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <View style={{ flex: 1 }}><MarkdownText text={turn.text} style={styles.agentText} /></View>
            {streaming ? <Caret /> : null}
          </View>
        ) : null}
        {turn.done ? <TurnCard turn={turn} patch={patch} resolve={resolve} ask={ask} /> : null}
        {turn.resolution ? <View style={{ marginTop: 12 }}><Text style={[T.caption, { color: /^(Adjusted|Logged)/.test(turn.resolution) ? C.crimson : C.muted }]}>{turn.resolution}</Text></View> : null}
      </View>
    </Enter>
  );
}

export function dismissKeyboard() { Keyboard.dismiss(); }

const styles = StyleSheet.create({
  flex: { flex: 1 },
  read: { fontFamily: v2.font.semibold, fontSize: 27, lineHeight: 33, letterSpacing: -0.54 },
  sessionRow: { flexDirection: 'row', alignItems: 'center', gap: 16, borderTopWidth: 1, borderBottomWidth: 1 },
  rowName: { fontFamily: v2.font.semibold, fontSize: 17, lineHeight: 22 },
  begin: { fontFamily: v2.font.semibold, fontSize: 15, lineHeight: 20 },
  suggestion: { fontFamily: v2.font.medium, fontSize: 20, lineHeight: 26, color: C.muted, letterSpacing: -0.3 },
  inputWrap: { flexDirection: 'row', alignItems: 'center', gap: 12, borderTopWidth: 1 },
  input: { flex: 1, fontFamily: v2.font.regular, fontSize: 17, padding: 0 },
  send: { fontFamily: v2.font.semibold, fontSize: 17, lineHeight: 22 },
  userTurn: { fontFamily: v2.font.regular, fontSize: 17, lineHeight: 25, color: C.ink, textAlign: 'right', alignSelf: 'flex-end', maxWidth: '86%' },
  agentText: { fontFamily: v2.font.regular, fontSize: 17, lineHeight: 25.5, color: C.ink },
});
