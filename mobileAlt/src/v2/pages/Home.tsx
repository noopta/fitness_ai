// Anakin (index 0) — home. Two states.
//
// Brief (on load): the artwork and orb on a dark ground, Anakin's one-sentence
// read, "Checked N things · read, pulled" (tap to expand the receipts),
// today's session row, three suggestions, the input. Anakin speaks first.
//
// Chat (on focus or a suggestion): the artwork lifts away, the page turns
// white, the orb shrinks into the header mark, the brief collapses to a
// caption, the thread takes over, the tab bar drops away. Tap the caption or
// the header mark to return.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, StyleSheet, Keyboard } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withTiming, useReducedMotion } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { receiptSummary, type Turn } from '@axiom/agent-ui-core';
import { v2, T } from '../theme';
import { Enter } from '../primitives/Enter';
import { ReceiptList, Caret } from '../primitives/Receipt';
import { Row } from '../primitives/Row';
import { TextAction } from '../primitives/TextAction';
import { Ask } from '../primitives/Ask';
import { HEADER_HEIGHT } from '../shell/Header';
import { useShell } from '../shell/ShellContext';
import { useBrief } from '../data';
import { useThread } from '../chat/useThread';
import { TurnCard } from '../chat/Cards';
import { Artwork } from '../home/Artwork';
import { KeyboardAvoider } from '../../components/ui/KeyboardAvoider';
import { useAuth } from '../../context/AuthContext';
import { coachApi } from '../../lib/api';
import { haptics } from '../haptics';

const D = v2.motion;

export function HomePage() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const shell = useShell();
  const { user } = useAuth();
  const brief = useBrief();
  const thread = useThread();
  const reduced = useReducedMotion();
  const chat = shell.mode === 'chat';
  const [text, setText] = useState('');
  const [briefOpen, setBriefOpen] = useState(false);
  const [focus, setFocus] = useState(false);
  const inputRef = useRef<TextInput>(null);
  const scrollRef = useRef<ScrollView>(null);

  // Shell → home: "Something hurts" from the session, suggestions from other pages.
  useEffect(() => {
    shell.registerAsk((m) => { void thread.send(m); });
    if (shell.pendingAsk.current) { const m = shell.pendingAsk.current; shell.pendingAsk.current = null; void thread.send(m); }
  }, [shell, thread.send]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { void thread.hydrate(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { scrollRef.current?.scrollToEnd({ animated: true }); }, [thread.state.turns]);

  // The transition: one progress value drives everything.
  const p = useSharedValue(0);
  useEffect(() => { p.value = withTiming(chat ? 1 : 0, { duration: reduced ? 150 : 700, easing: D.easeEnter }); }, [chat, p, reduced]);
  const artStyle = useAnimatedStyle(() => ({ opacity: 1 - p.value, transform: [{ translateY: -70 * p.value }, { scale: 1 + 0.06 * p.value }] }));
  const briefBlock = useAnimatedStyle(() => ({ opacity: 1 - p.value, maxHeight: 400 * (1 - p.value), transform: [{ translateY: -24 * p.value }] }));
  const threadStyle = useAnimatedStyle(() => ({ opacity: p.value, flex: p.value > 0.02 ? 1 : 0 }));

  const dark = !chat;
  const ink = dark ? v2.color.darkInk : v2.color.ink;
  const mutedC = dark ? v2.color.darkMuted : v2.color.muted;
  const isDay0 = !!(user as any)?.coachOnboardingDone && !brief.data?.session && !brief.data?.weekNumber;
  const sentence = brief.data?.sentence ?? (brief.isLoading ? '' : 'Tell me what you\'re working toward.');
  const summary = useMemo(() => {
    const n = brief.data?.receipts?.length ?? 0;
    if (!n) return '';
    const verbs = [...new Set(brief.data!.receipts.map((r) => r.verb.toLowerCase()))].join(', ');
    return `Checked ${n} thing${n === 1 ? '' : 's'} · ${verbs}`;
  }, [brief.data]);
  const suggestions = brief.data?.suggestions ?? ["I can't train Thursday. Move it?", 'How\'s my bench?', 'Log lunch'];
  const session = brief.data?.session;

  const enterChat = () => { if (!chat) shell.setMode('chat'); };
  const toBrief = () => { Keyboard.dismiss(); shell.setMode('brief'); setFocus(false); };
  const send = async (m?: string) => {
    const msg = (m ?? text).trim(); if (!msg) return;
    enterChat(); setText('');
    await thread.send(msg);
  };
  const busy = thread.state.busy;

  return (
    <KeyboardAvoider style={styles.flex}>
      <View style={[styles.flex, { paddingTop: insets.top + 12 + HEADER_HEIGHT }]}>
        {/* Artwork + orb — rendered only while visible so it never costs a frame in chat. */}
        <Animated.View pointerEvents="none" style={[styles.art, artStyle]}>
          <Artwork visible={!chat && shell.index === 0} working={busy} />
        </Animated.View>

        <View style={[styles.flex, { paddingHorizontal: v2.space.gutter }]}>
          <View style={{ flex: 1 }} />

          {/* Brief block: eyebrow, sentence, receipts summary, session row, suggestions. */}
          <Animated.View style={[briefBlock, { overflow: 'hidden' }]} pointerEvents={chat ? 'none' : 'auto'}>
            <Enter exit={false}>
              <Text style={[T.eyebrow, { color: mutedC }]}>{isDay0 ? 'Day 0' : brief.data?.phaseName && brief.data?.weekNumber ? `${brief.data.phaseName} · wk ${brief.data.weekNumber}` : 'Anakin'}</Text>
              <Text style={[T.read, { color: ink, marginTop: 10 }]}>{sentence || ' '}</Text>
            </Enter>
            {summary ? (
              <Enter index={1} exit={false}>
                <Pressable onPress={() => setBriefOpen((o) => !o)} hitSlop={6} style={{ marginTop: 10 }}>
                  <Text style={[T.caption, { color: mutedC }]}>{summary}{briefOpen ? '' : ' →'}</Text>
                </Pressable>
                {briefOpen ? <View style={{ marginTop: 10 }}><ReceiptList items={brief.data!.receipts} tone="dark" /></View> : null}
              </Enter>
            ) : null}
            {session ? (
              <Enter index={2} exit={false}>
                <View style={{ marginTop: 22 }}>
                  <Row tone="dark" name={`${session.isToday ? '' : 'Tomorrow · '}${session.name}${session.minutes ? ` · ${session.minutes} min` : ''}`} sub={session.focus ?? (session.exerciseCount ? `${session.exerciseCount} exercises` : undefined)} value={session.isLogged ? 'Done' : undefined} arrow={!session.isLogged} last
                    onPress={session.isLogged ? undefined : () => router.push('/(v2)/session' as any)} />
                </View>
              </Enter>
            ) : null}
            <View style={{ marginTop: 22, gap: 10 }}>
              {suggestions.slice(0, 3).map((s, i) => (
                <Enter key={s} index={3 + i} exit={false}>
                  <Pressable onPress={() => void send(s)} hitSlop={4}><Text style={[T.body, { color: mutedC }]}>{s}</Text></Pressable>
                </Enter>
              ))}
            </View>
          </Animated.View>

          {/* Chat caption (tap to return) + thread. */}
          {chat ? (
            <Pressable onPress={toBrief} style={{ paddingTop: 6 }} hitSlop={6}>
              <Text style={[T.caption, { color: v2.color.muted }]} numberOfLines={1}>{sentence || 'Anakin'} · back to brief</Text>
            </Pressable>
          ) : null}
          <Animated.View style={[threadStyle, { overflow: 'hidden' }]}>
            <ScrollView ref={scrollRef} style={styles.flex} contentContainerStyle={{ paddingTop: 18, paddingBottom: 72, gap: 44 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              {thread.state.turns.length === 0 ? (
                <View style={{ gap: 12 }}>
                  {suggestions.slice(0, 3).map((s) => <Pressable key={s} onPress={() => void send(s)}><Text style={[T.body, { color: v2.color.placeholder }]}>{s}</Text></Pressable>)}
                </View>
              ) : null}
              {thread.state.turns.map((t) => (
                <TurnView key={t.id} turn={t}
                  toggle={() => thread.dispatch({ type: 'toggle', id: t.id })}
                  patch={(pch) => thread.dispatch({ type: 'card_state', agentId: t.id, patch: pch })}
                  resolve={(line) => thread.dispatch({ type: 'resolve', agentId: t.id, resolution: line })}
                  ask={(m) => { setText(m); inputRef.current?.focus(); }} />
              ))}
              {thread.state.error ? <Text style={T.caption}>{thread.state.error}</Text> : null}
            </ScrollView>
          </Animated.View>

          {/* Input: a single top hairline, "Ask Anakin", send arrow. */}
          <View style={[styles.inputWrap, { borderTopColor: chat ? (focus ? v2.color.ink : v2.color.hairline) : v2.color.darkHairline, height: chat ? 60 : 52, marginBottom: (chat ? 12 : v2.space.tabBarClearance - 20) + insets.bottom }]}>
            <TextInput
              ref={inputRef}
              value={text}
              onChangeText={setText}
              onFocus={() => { setFocus(true); enterChat(); setBriefOpen(false); }}
              onBlur={() => setFocus(false)}
              onSubmitEditing={() => void send()}
              placeholder="Ask Anakin"
              placeholderTextColor={dark ? v2.color.darkMuted : v2.color.placeholder}
              style={[styles.input, { color: ink }]}
              returnKeyType="send"
              blurOnSubmit={false}
              cursorColor={v2.color.crimson}
              selectionColor={v2.color.crimson}
              accessibilityLabel="Ask Anakin"
            />
            <Pressable onPress={() => void send()} hitSlop={10} accessibilityLabel="Send" disabled={!text.trim() || busy}>
              <Text style={[T.rowStrong, { color: text.trim() && !busy ? v2.color.crimson : dark ? v2.color.darkMuted : v2.color.placeholder, fontSize: 20 }]}>↑</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </KeyboardAvoider>
  );
}

function TurnView({ turn, toggle, patch, resolve, ask }: { turn: Turn; toggle: () => void; patch: (p: Record<string, any>) => void; resolve: (l: string) => void; ask: (m: string) => void }) {
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
            <Text style={[T.caption, { color: v2.color.muted }]}>{summary}{turn.done && turn.receipts.length && !turn.open ? ' →' : ''}</Text>
          </Pressable>
        ) : null}
        {showList && turn.receipts.length ? <View style={{ marginTop: 8 }}><ReceiptList items={turn.receipts} liveIndex={live} animate={streaming} /></View> : null}
        {turn.text ? (
          <Text style={[T.body, { marginTop: summary ? 10 : 0, fontSize: 16, lineHeight: 25 }]}>{turn.text}{streaming ? <Caret /> : null}</Text>
        ) : null}
        {turn.done ? <TurnCard turn={turn} patch={patch} resolve={resolve} ask={ask} /> : null}
        {turn.resolution ? <View style={{ marginTop: 12 }}><Text style={[T.caption, { color: /^Adjusted/.test(turn.resolution) ? v2.color.crimson : v2.color.muted }]}>{turn.resolution}</Text></View> : null}
      </View>
    </Enter>
  );
}

/** A wellness Ask Anakin raises inline (used by the session's "Something hurts" and the brief on low sleep). */
export function InlineAsk({ question, reason, options, onPick }: { question: string; reason: string; options: string[]; onPick: (o: string) => void }) {
  return <Ask question={question} reason={reason} options={options} onPick={(o) => { haptics.select(); onPick(o); }} size="read" />;
}

export async function logWellness(sleepHours: number, energy: number) {
  try { await coachApi.postCheckin({ sleepHours, energy, mood: energy, stress: 6 - energy } as any); } catch { /* optional */ }
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  art: { position: 'absolute', left: -30, top: -30, width: 440, height: 440 },
  inputWrap: { flexDirection: 'row', alignItems: 'center', gap: 12, borderTopWidth: 1 },
  input: { flex: 1, fontFamily: v2.font.regular, fontSize: 17, padding: 0 },
});
