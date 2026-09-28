// Anakin (index 0) — home. Two states.
//
// Brief (on load): white page; the engraving and the orb (Skia, `Orb.tsx`)
// at the top; below the art, Anakin's one-sentence read, "Checked N things",
// today's session row, three suggestion lines, the input. Anakin speaks
// first. A wellness Ask, when Anakin raises one, is the last suggestion line
// and opens chat as an Ask turn — never content stacked into the brief.
//
// Chat (on focus or a suggestion): the art lifts away and the orb shrinks
// into the header mark; the brief collapses completely; the thread takes the
// page; the input sits on the keyboard; the tab bar drops away. The header
// mark returns to the brief.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, StyleSheet, Keyboard, useWindowDimensions } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withTiming, useReducedMotion, useAnimatedKeyboard } from 'react-native-reanimated';
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
import { phaseWeek, sessionName } from '../format';

const D = v2.motion;
const FRAME_W = 402;
/** The read is plain text; the model occasionally leaks markdown into it. */
const plain = (t: string) => t.replace(/[*_`#>]+/g, '').replace(/\s+/g, ' ').trim();

let askSeq = 0;

export function HomePage() {
  const insets = useSafeAreaInsets();
  const { width: SW } = useWindowDimensions();
  const s = SW / FRAME_W;
  const router = useRouter();
  const shell = useShell();
  const { user } = useAuth();
  const brief = useBrief();
  const invalidate = useInvalidate();
  const thread = useThread();
  const reduced = useReducedMotion();
  const chat = shell.mode === 'chat';
  const [text, setText] = useState('');
  const [briefOpen, setBriefOpen] = useState(false);
  const [askDone, setAskDone] = useState(false);
  const inputRef = useRef<TextInput>(null);
  const scrollRef = useRef<ScrollView>(null);

  // Shell → home: "Something hurts" from the session, suggestions from other pages.
  useEffect(() => {
    shell.registerAsk((m) => { void thread.send(m); });
    if (shell.pendingAsk.current) { const m = shell.pendingAsk.current; shell.pendingAsk.current = null; void thread.send(m); }
  }, [shell, thread.send]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { void thread.hydrate(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const t = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 60); return () => clearTimeout(t); }, [thread.state.turns]);

  // The transition: one progress value drives the brief's collapse and the thread's rise.
  const p = useSharedValue(0);
  useEffect(() => { p.value = withTiming(chat ? 1 : 0, { duration: reduced ? 150 : 750, easing: D.easeEnter }); }, [chat, p, reduced]);
  const briefStyle = useAnimatedStyle(() => ({ opacity: 1 - p.value, maxHeight: 900 * (1 - p.value), transform: [{ translateY: -24 * p.value }] }));
  const threadStyle = useAnimatedStyle(() => ({ opacity: p.value, flex: p.value > 0.02 ? 1 : 0 }));
  // The input sits on the keyboard (12 pt) in chat; above the tab bar in brief.
  const kb = useAnimatedKeyboard();
  const bottomInset = insets.bottom;
  const inputWrapStyle = useAnimatedStyle(() => {
    const onKeyboard = Math.max(0, kb.height.value - bottomInset);
    const briefBottom = v2.space.tabBarClearance - 20 + bottomInset;
    const chatBottom = onKeyboard > 0 ? onKeyboard + 12 : 12 + bottomInset;
    return { marginBottom: briefBottom + (chatBottom - briefBottom) * p.value };
  });

  const loaded = !!brief.data;
  const isDay0 = loaded && !!(user as any)?.coachOnboardingDone && !brief.data?.session && !brief.data?.weekNumber;
  const sentence = loaded ? plain(brief.data!.sentence) : (brief.isError ? 'Tell me what you\'re working toward.' : '');
  const summary = useMemo(() => {
    const n = brief.data?.receipts?.length ?? 0;
    if (!n) return '';
    const verbs = [...new Set(brief.data!.receipts.map((r) => r.verb.toLowerCase()))].join(', ');
    return `Checked ${n} thing${n === 1 ? '' : 's'} · ${verbs}`;
  }, [brief.data]);
  const ask = !askDone ? brief.data?.ask ?? null : null;
  const base = brief.data?.suggestions ?? ["I can't train Thursday. Move it?", 'How\'s my bench?', 'Log lunch'];
  const suggestions: { label: string; kind: 'send' | 'ask' }[] = ask
    ? [...base.slice(0, 2).map((l) => ({ label: l, kind: 'send' as const })), { label: ask.question, kind: 'ask' as const }]
    : base.slice(0, 3).map((l) => ({ label: l, kind: 'send' as const }));
  const session = brief.data?.session;
  const eyebrow = isDay0 ? 'Day 0' : loaded ? (phaseWeek(brief.data?.phaseName, brief.data?.weekNumber) || 'Anakin') : 'Anakin';

  const enterChat = () => { if (!chat) shell.setMode('chat'); };
  const send = async (m?: string) => {
    const msg = (m ?? text).trim(); if (!msg) return;
    enterChat(); setText('');
    await thread.send(msg);
  };
  // The wellness Ask opens chat as an agent turn: question, reason, rows.
  const openAsk = () => {
    if (!ask) return;
    haptics.select();
    enterChat();
    thread.dispatch({ type: 'append_agent', turn: { id: `ask${Date.now().toString(36)}${askSeq++}`, kind: 'agent', text: '', receipts: [{ id: 'r-ask', verb: 'Checked', text: 'Wellness — no check-in today' }], done: true, ask } });
  };
  const answerAsk = (turn: Turn, o: string) => {
    const hours = /Under/.test(o) ? 5 : /6–7/.test(o) ? 6.5 : 7.5;
    thread.dispatch({ type: 'resolve', agentId: turn.id, resolution: `Logged — Wellness · sleep ${o.toLowerCase()}` });
    setAskDone(true);
    void coachApi.postCheckin({ sleepHours: hours, energy: hours < 6 ? 2 : hours < 7 ? 3 : 4, mood: hours < 6 ? 2 : 3, stress: hours < 6 ? 4 : 2 } as any).catch(() => {}).then(() => invalidate.afterSchedule());
    void thread.send(`I slept ${o.toLowerCase()} last night. Does today change?`);
  };
  const busy = thread.state.busy;
  const artBottom = (-30 + 440) * s;

  return (
    <View style={styles.flex}>
      <Orb mode={chat ? 'chat' : 'brief'} working={busy} focused={shell.index === 0} />

      <View style={[styles.flex, { paddingTop: headerClearance(insets.top), paddingHorizontal: v2.space.gutter }]}>
        {/* Brief: anchored low, never under the input; scrolls only if it must. */}
        <Animated.View style={[styles.flex, { overflow: 'hidden' }, briefStyle]} pointerEvents={chat ? 'none' : 'auto'}>
          <ScrollView style={styles.flex} contentContainerStyle={{ flexGrow: 1, justifyContent: 'flex-end', paddingTop: Math.max(0, artBottom + 110 * s - headerClearance(insets.top)), paddingBottom: 18 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            <Enter exit={false}>
              <Text style={T.eyebrow}>{eyebrow}</Text>
              <Text style={[T.read, { marginTop: 10 }]} numberOfLines={3}>{sentence || ' '}</Text>
            </Enter>
            {summary ? (
              <Enter index={1} exit={false}>
                <Pressable onPress={() => setBriefOpen((o) => !o)} hitSlop={6} style={{ marginTop: 10 }}>
                  <Text style={T.caption}>{summary}{briefOpen ? '' : ' →'}</Text>
                </Pressable>
                {briefOpen ? <View style={{ marginTop: 10 }}><ReceiptList items={brief.data!.receipts} /></View> : null}
              </Enter>
            ) : null}
            {session ? (
              <Enter index={2} exit={false}>
                <Pressable onPress={session.isLogged ? undefined : () => { haptics.select(); router.push('/(v2)/session' as any); }} style={styles.sessionRow} accessibilityRole="button">
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
                      <Text style={[T.rowStrong, { flexShrink: 1 }]} numberOfLines={1}>{session.isToday ? '' : 'Tomorrow · '}{sessionName(session.name)}</Text>
                      {session.minutes ? <Text style={[T.rowStrong, { color: v2.color.muted, flexShrink: 0 }]} numberOfLines={1}>· {session.minutes} min</Text> : null}
                    </View>
                    {session.focus || session.exerciseCount ? <Text style={[T.caption, { marginTop: 3 }]} numberOfLines={1}>{session.focus ?? `${session.exerciseCount} exercises`}</Text> : null}
                  </View>
                  <Text style={[T.row, { color: session.isLogged ? v2.color.muted : v2.color.placeholder }]}>{session.isLogged ? 'Done' : '→'}</Text>
                </Pressable>
              </Enter>
            ) : null}
            <View style={{ marginTop: 22, gap: 10 }}>
              {suggestions.map((sg, i) => (
                <Enter key={sg.label} index={3 + i} exit={false}>
                  <Pressable onPress={() => (sg.kind === 'ask' ? openAsk() : void send(sg.label))} hitSlop={4} accessibilityRole="button">
                    <Text style={[T.body, { color: v2.color.muted }]} numberOfLines={1}>{sg.label}</Text>
                  </Pressable>
                </Enter>
              ))}
            </View>
          </ScrollView>
        </Animated.View>

        {/* Thread */}
        <Animated.View style={[threadStyle, { overflow: 'hidden' }]}>
          <ScrollView ref={scrollRef} style={styles.flex} contentContainerStyle={{ paddingTop: 8, paddingBottom: 72, gap: 44 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            {thread.state.turns.length === 0 ? (
              <View style={{ gap: 12 }}>
                {base.slice(0, 3).map((l) => <Pressable key={l} onPress={() => void send(l)}><Text style={[T.body, { color: v2.color.placeholder }]}>{l}</Text></Pressable>)}
              </View>
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

        {/* Input: a single 1 px hairline, "Ask Anakin", the send arrow — crimson when there's text. */}
        <Animated.View style={[styles.inputWrap, { height: chat ? 60 : 52 }, inputWrapStyle]}>
          <TextInput
            ref={inputRef}
            value={text}
            onChangeText={setText}
            onFocus={() => { enterChat(); setBriefOpen(false); }}
            onSubmitEditing={() => void send()}
            placeholder="Ask Anakin"
            placeholderTextColor={v2.color.placeholder}
            style={styles.input}
            returnKeyType="send"
            blurOnSubmit={false}
            cursorColor={v2.color.crimson}
            selectionColor={v2.color.crimson}
            accessibilityLabel="Ask Anakin"
          />
          <Pressable onPress={() => void send()} hitSlop={10} accessibilityLabel="Send" disabled={!text.trim() || busy}>
            <Text style={[T.rowStrong, { color: text.trim() && !busy ? v2.color.crimson : v2.color.placeholder, fontSize: 20 }]}>↑</Text>
          </Pressable>
        </Animated.View>
      </View>
    </View>
  );
}

function TurnView({ turn, toggle, patch, resolve, ask, onAsk }: { turn: Turn; toggle: () => void; patch: (p: Record<string, any>) => void; resolve: (l: string) => void; ask: (m: string) => void; onAsk: (o: string) => void }) {
  if (turn.kind === 'user') {
    return <Enter exit={false}><Text style={[T.body, { color: v2.color.ink, textAlign: 'right', alignSelf: 'flex-end', maxWidth: '86%' }]}>{turn.text}</Text></Enter>;
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
        {turn.resolution ? <View style={{ marginTop: 12 }}><Text style={[T.caption, { color: /^(Adjusted|Logged)/.test(turn.resolution) ? v2.color.crimson : v2.color.muted }]}>{turn.resolution}</Text></View> : null}
      </View>
    </Enter>
  );
}

export function dismissKeyboard() { Keyboard.dismiss(); }

const styles = StyleSheet.create({
  flex: { flex: 1 },
  sessionRow: { flexDirection: 'row', alignItems: 'center', gap: 16, marginTop: 22, paddingVertical: 15, borderTopWidth: 1, borderBottomWidth: 1, borderColor: v2.color.hairline, minHeight: 56 },
  inputWrap: { flexDirection: 'row', alignItems: 'center', gap: 12, borderTopWidth: 1, borderTopColor: v2.color.hairline },
  input: { flex: 1, fontFamily: v2.font.regular, fontSize: 17, padding: 0, color: v2.color.ink },
});
