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
//
// Brief → chat is two beats, not one: the tap starts the morph at once and the
// keyboard is asked for as it lands (KEYBOARD_AT). Bringing the keyboard up is
// work on the UI thread — the same thread that runs the morph — so asking for
// both on the tap made the morph stutter. In brief the composer is therefore a
// button over a non-editable input; in chat it is the input.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, StyleSheet, Keyboard, Platform, Dimensions, useWindowDimensions, type LayoutChangeEvent, type NativeSyntheticEvent, type NativeScrollEvent } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, interpolate, interpolateColor, FadeIn, FadeInDown, FadeOut, Extrapolation, withRepeat, withSequence, withTiming, Easing } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { useKeyboardController, useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller';
import * as ScreenCapture from 'expo-screen-capture';
import { receiptSummary, composerMode, latestAgentCards, allCards, type Turn, type Card } from '@axiom/agent-ui-core';
import { CardView, CardSkeleton } from '../chat/card/CardView';
import { CardHandlersProvider, type CardHandlers, type EditSession } from '../chat/card/context';
import { useCardActions } from '../chat/useCardActions';
import { v2Api } from '../api';
import { v2, T } from '../theme';
import { Enter } from '../primitives/Enter';
import { ReceiptList, Caret } from '../primitives/Receipt';
import { Ask } from '../primitives/Ask';
import { headerClearance } from '../shell/Header';
import { useShell } from '../shell/ShellContext';
import { useBrief, useInvalidate } from '../data';
import { useThread, type Thread } from '../chat/useThread';
import { TurnCard } from '../chat/Cards';
import { Orb } from '../home/Orb';
import { HomeVideo } from '../home/HomeVideo';
import { MarkdownText } from '../../components/ui/MarkdownText';
import { coachApi } from '../../lib/api';
import { haptics } from '../haptics';
import { sessionTitle, sessionCaption } from '../format';

const C = v2.color;
const plain = (t: string) => t.replace(/[*_`#>]+/g, '').replace(/\s+/g, ' ').trim();
let askSeq = 0;
// Review #5 §1.5: pieces settle in on open — opacity 0→1, translateY 8→0, 500 ms, staggered.
const settle = (delay: number) => FadeInDown.duration(500).delay(delay).easing(v2.motion.easeEnter).withInitialValues({ opacity: 0, transform: [{ translateY: 8 }] });
const READ_LINE = 33; // the read's line height — its slot is reserved so a new read never moves the layout
const AnimatedTextInput = Animated.createAnimatedComponent(TextInput);
/** When the keyboard is asked for after the tap: the morph is ~96 % of the way there and slowing. */
const KEYBOARD_AT = Math.round(v2.motion.briefChat * 0.8);

export function HomePage() {
  const insets = useSafeAreaInsets();
  const { width: SW, height: SH } = useWindowDimensions();
  // Short screens (iPhone SE): the video's orb sits ≈ 405 pt down, so the bottom-anchored
  // brief gets two lines of read instead of three to stay clear of it (video spec §7).
  const readLines = SH < 740 ? 2 : 3;
  const READ_SLOT = READ_LINE * readLines;
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
  // "While you were away · N" (spec §9): Anakin-initiated turns since the user last spoke, folded once at open.
  const [away, setAway] = useState<{ start: number; end: number; count: number } | null>(null);
  const [awayOpen, setAwayOpen] = useState(false);
  useEffect(() => { void thread.hydrate().then(setAway); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Scroll: the thread stays pinned to its end unless the user drags it up
  //    more than 120 pt (then "↓ New"). Opening chat grows the viewport over
  //    850 ms and the keyboard grows the bottom pad — neither changes content
  //    size, so pinning re-runs on viewport, content and keyboard changes alike.
  const scrollY = useRef(0);
  const fromBottom = useRef(0);
  const pinned = useRef(true);
  const dragging = useRef(false);
  const [showNew, setShowNew] = useState(false);
  const pin = useCallback((animated = true) => {
    pinned.current = true;
    setShowNew(false);
    scrollRef.current?.scrollToEnd({ animated });
  }, []);
  const followIfPinned = useCallback(() => { if (pinned.current) scrollRef.current?.scrollToEnd({ animated: false }); }, []);
  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    scrollY.current = contentOffset.y;
    fromBottom.current = contentSize.height - (contentOffset.y + layoutMeasurement.height);
    // Only the user's own drag un-pins; programmatic scrolls never do.
    if (dragging.current) pinned.current = fromBottom.current < 120;
    if (pinned.current && showNew) setShowNew(false);
  };
  const onDragEnd = () => { dragging.current = false; pinned.current = fromBottom.current < 120; };
  const toEnd = useCallback(() => pin(true), [pin]);
  // New turns: follow if pinned, otherwise offer "↓ New".
  useEffect(() => {
    const t = setTimeout(() => { if (pinned.current) scrollRef.current?.scrollToEnd({ animated: true }); else setShowNew(true); }, 60);
    return () => clearTimeout(t);
  }, [thread.state.turns]);
  // Every open of the chat (and every composer focus) lands on the latest message.
  useEffect(() => { if (chat || focus) { const t = setTimeout(() => pin(false), 30); return () => clearTimeout(t); } }, [chat, focus, pin]);
  useEffect(() => {
    const sub = Keyboard.addListener('keyboardDidShow', () => followIfPinned());
    return () => sub.remove();
  }, [followIfPinned]);

  // ── Keyboard: keyboard-controller runs only while this screen is showing (the
  //    classic app and the Fuel page keep their own KeyboardAvoider) ──
  const kc = useKeyboardController();
  const [screenFocused, setScreenFocused] = useState(true);
  useFocusEffect(useCallback(() => { setScreenFocused(true); return () => setScreenFocused(false); }, []));
  const kbOn = screenFocused && shell.index === 0;
  useEffect(() => { kc.setEnabled(kbOn); }, [kbOn]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reveal (§7.1.3): the node's bottom sits 16 pt above the composer / Save bar once the keyboard is up.
  const pendingReveal = useRef<View | null>(null);
  const doReveal = useCallback((kbH: number) => {
    const node = pendingReveal.current;
    pendingReveal.current = null;
    node?.measureInWindow((_x, y, _w, h) => {
      const limit = Dimensions.get('window').height - kbH - 60 - 16;
      const over = y + h - limit;
      if (over > 0) scrollRef.current?.scrollTo({ y: scrollY.current + over, animated: true });
    });
  }, []);
  useEffect(() => {
    const sub = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', (e) => { if (pendingReveal.current) doReveal(e.endCoordinates.height); });
    return () => sub.remove();
  }, [doReveal]);
  const reveal = useCallback((node: View | null) => {
    pendingReveal.current = node;
    const m = Keyboard.metrics();
    if (Keyboard.isVisible() && m) doReveal(m.height);
  }, [doReveal]);

  // ── Cards ──
  const actions = useCardActions(thread);
  const [editing, setEditing] = useState<EditSession | null>(null);
  const [typedFocus, setTypedFocus] = useState(false);
  const [draftEdit, setDraftEdit] = useState<string | null>(null);
  const [answering, setAnswering] = useState(false);
  const cmode = composerMode(latestAgentCards(thread.state), draftEdit);
  const findCard = (id: string): Card | undefined => allCards(thread.stateRef.current).find((c) => c.id === id);
  const editDraft = useCallback((c: Card) => { setDraftEdit(c.id); setText(c.draft?.body ?? ''); inputRef.current?.focus(); }, []);
  const handlers = useMemo<CardHandlers>(() => ({
    act: (c, a, x) => (c.pattern === 'draft' && a.id === 'edit' ? Promise.resolve(editDraft(c)) : actions.act(c, a, x)),
    undo: actions.undo, edit: actions.edit, toggle: actions.toggle, answer: actions.answer,
    open: (c, r) => actions.open(c, r),
    typeInstead: () => { setAnswering(true); inputRef.current?.focus(); },
    editDraft,
    say: (m) => { pin(); void thread.send(m); },
    reveal, scrollToLatest: toEnd, setTypedFocus,
    editing,
    beginEdit: (x) => setEditing({ ...x, value: x.value ?? x.initial }),
    setEditValue: (v) => setEditing((e) => (e ? { ...e, value: v } : e)),
    endEdit: () => setEditing(null),
  }), [actions, editDraft, reveal, toEnd, editing, thread.send, pin]); // eslint-disable-line react-hooks/exhaustive-deps
  const saveEdit = () => {
    const e = editing; if (!e) return;
    setEditing(null); Keyboard.dismiss();
    const card = findCard(e.cardId);
    if (card && e.value.trim() && e.value.trim() !== e.initial) void actions.edit(card, e.field, e.value.trim());
  };

  // Private cards (§6.7): blur the app-switcher snapshot (iOS) / secure the window (Android) while one is in the thread.
  const hasPrivate = allCards(thread.state).some((c) => c.private);
  useEffect(() => {
    if (!hasPrivate) return;
    if (Platform.OS === 'ios') void ScreenCapture.enableAppSwitcherProtectionAsync(0.9).catch(() => {});
    else void ScreenCapture.preventScreenCaptureAsync('private-cards').catch(() => {});
    return () => {
      if (Platform.OS === 'ios') void ScreenCapture.disableAppSwitcherProtectionAsync().catch(() => {});
      else void ScreenCapture.allowScreenCaptureAsync('private-cards').catch(() => {});
    };
  }, [hasPrivate]);

  // ── Everything below runs from the one progress value, on the UI thread (§D) ──
  const spacer = useAnimatedStyle(() => ({ flexGrow: 1 - p.value }));
  const summaryStyle = useAnimatedStyle(() => ({ height: summaryH.value ? summaryH.value * (1 - p.value) : undefined, opacity: interpolate(p.value, [0, 0.55], [1, 0], Extrapolation.CLAMP), marginBottom: 14 * (1 - p.value) }));
  const readStyle = useAnimatedStyle(() => ({
    color: interpolateColor(p.value, [0, 1], [C.darkInk, C.muted]),
    transform: [{ scale: interpolate(p.value, [0, 1], [1, 15 / 27]) }],
  }));
  const readBox = useAnimatedStyle(() => ({ marginBottom: 22 * (1 - p.value), minHeight: READ_SLOT * (1 - p.value) }));
  const rowStyle = useAnimatedStyle(() => ({ paddingVertical: 20 - 10 * p.value, borderColor: interpolateColor(p.value, [0, 1], [C.darkHairline, C.hairline]) }));
  const rowName = useAnimatedStyle(() => ({ color: interpolateColor(p.value, [0, 1], [C.darkInk, C.ink]), transform: [{ scale: interpolate(p.value, [0, 1], [1, 15 / 17]) }] }));
  const captionStyle = useAnimatedStyle(() => ({ height: captionH.value ? captionH.value * (1 - p.value) : undefined, opacity: 1 - p.value }));
  const beginStyle = useAnimatedStyle(() => ({ color: interpolateColor(p.value, [0, 1], [C.darkInk, C.ink]) }));
  const threadStyle = useAnimatedStyle(() => ({ flexGrow: p.value, opacity: p.value, flexBasis: 0 }));
  // keyboard-controller's height is negative while the keyboard is up.
  const { height: kbHeight } = useReanimatedKeyboardAnimation();
  const bottomInset = insets.bottom;
  const inputWrap = useAnimatedStyle(() => ({
    height: 52 + 8 * p.value,
    marginBottom: 112 + (40 - 112) * p.value,
    borderTopColor: interpolateColor(p.value, [0, 1], [C.darkInputLine, focus ? C.ink : C.hairline]),
    backgroundColor: interpolateColor(p.value, [0, 1], ['rgba(255,255,255,0)', 'rgba(255,255,255,1)']),
    transform: [{ translateY: -Math.max(0, -kbHeight.value - bottomInset) * p.value }],
  }), [focus, bottomInset]);
  const threadPad = useAnimatedStyle(() => ({ height: 72 + Math.max(0, -kbHeight.value - bottomInset) }));
  const inputText = useAnimatedStyle(() => ({ color: interpolateColor(p.value, [0, 1], [C.darkInk, C.ink]) }));

  const loaded = !!brief.data;
  const sentence = loaded ? plain(brief.data!.sentence) : (brief.isError ? 'Tell me what you\'re working toward.' : '');
  // A changed read cross-fades (old out 200 ms, new in 500 ms); the first one just settles with the rest.
  const prevRead = useRef<string | null>(null);
  const swapRead = prevRead.current !== null && prevRead.current !== sentence;
  useEffect(() => { prevRead.current = sentence; }, [sentence]);
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
  // Tap on the composer in brief: morph first, keyboard as it lands.
  const chatRef = useRef(chat);
  chatRef.current = chat;
  const focusTimer = useRef<any>(null);
  const openChat = () => {
    enterChat(); setBriefOpen(false);
    clearTimeout(focusTimer.current);
    focusTimer.current = setTimeout(() => { if (chatRef.current) inputRef.current?.focus(); }, KEYBOARD_AT);
  };
  useEffect(() => { if (!chat) clearTimeout(focusTimer.current); }, [chat]);
  useEffect(() => () => clearTimeout(focusTimer.current), []);
  const send = async (m?: string) => {
    const msg = (m ?? text).trim(); if (!msg) return;
    enterChat(); setText('');
    // While a card waits, the composer answers or rewrites it instead (§7.2).
    if (!m && cmode.kind === 'draft') {
      setDraftEdit(null);
      const card = findCard(cmode.cardId);
      try { const r = await v2Api.cardDraft(cmode.cardId, msg); thread.dispatch({ type: 'card_set', card: r.card }); }
      catch (e: any) { if (card) thread.dispatch({ type: 'card_set', card: { ...card, note: e?.message ?? 'Couldn’t update the draft — try again' } }); }
      return;
    }
    if (!m && cmode.kind === 'ask') {
      setAnswering(false);
      const card = findCard(cmode.cardId);
      if (card) { await actions.answer(card, { text: msg }).catch(() => {}); return; }
    }
    pin();
    await thread.send(msg);
  };
  const answerAsk = (turn: Turn, o: string) => {
    const hours = /Under/.test(o) ? 5 : /6–7/.test(o) ? 6.5 : 7.5;
    thread.dispatch({ type: 'resolve', agentId: turn.id, resolution: `Logged — Wellness · sleep ${o.toLowerCase()}` });
    setAskDone(true);
    void coachApi.postCheckin({ sleepHours: hours, energy: hours < 6 ? 2 : hours < 7 ? 3 : 4, mood: hours < 6 ? 2 : 3, stress: hours < 6 ? 4 : 2 } as any).catch(() => {}).then(() => invalidate.afterSchedule());
    void thread.send(`I slept ${o.toLowerCase()} last night. Does today change?`);
  };
  // Stable handlers so a turn re-renders only when the turn itself changes —
  // not on every keystroke, streamed token or mode change.
  const answerAskRef = useRef(answerAsk);
  answerAskRef.current = answerAsk;
  const onAskPick = useCallback((turn: Turn, o: string) => answerAskRef.current(turn, o), []);
  const askInComposer = useCallback((m: string) => { setText(m); inputRef.current?.focus(); }, []);
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
      <HomeVideo mode={chat ? 'chat' : 'brief'} homeVisible={screenFocused && shell.index === 0} />
      <Orb mode={chat ? 'chat' : 'brief'} progress={p} working={busy} focused={screenFocused && shell.index === 0} />

      <View style={[styles.flex, { paddingTop: headerClearance(insets.top), paddingHorizontal: v2.space.gutter }]}>
        {/* Top spacer: pushes the brief to the bottom; collapses in chat. */}
        <Animated.View style={spacer} />

        {/* Receipts summary → tap to expand (§B2.1). Tapping also enters chat per §D. */}
        {summary ? (
          <Animated.View entering={settle(150)}>
          <Animated.View style={[{ overflow: 'hidden' }, summaryStyle]} onLayout={onSummaryLayout}>
            <Pressable onPress={() => { if (!chat) setBriefOpen((o) => !o); }} hitSlop={6}>
              <Text style={[T.caption, { color: C.darkMuted }]} numberOfLines={1}>{summary}{briefOpen ? '' : ' →'}</Text>
            </Pressable>
            {briefOpen ? <View style={{ marginTop: 10 }}><ReceiptList items={brief.data!.receipts} tone="dark" /></View> : null}
          </Animated.View>
          </Animated.View>
        ) : null}

        {/* The read: 27 / 600 / −0.02em / 1.22 in brief; scales to 15 and recolours in chat. */}
        <Animated.View entering={settle(240)}>
          <Animated.View style={readBox}>
            {sentence ? (
              <Animated.Text key={sentence} entering={swapRead ? settle(0) : undefined} exiting={FadeOut.duration(200)} style={[styles.read, { transformOrigin: 'left top' } as any, readStyle]} numberOfLines={readLines}>{sentence}</Animated.Text>
            ) : (
              <Checking />
            )}
          </Animated.View>
        </Animated.View>

        {/* Session row: name · minutes, caption, `Begin →`. Opens the workout. */}
        {session ? (
          <Animated.View entering={settle(330)}>
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
          </Animated.View>
        ) : null}

        {/* Thread: fills in chat; suggestions only while empty; 44 between turns; bottom padding grows with the keyboard. */}
        <Animated.View style={[threadStyle, { overflow: 'hidden' }]} pointerEvents={chat ? 'auto' : 'none'}>
          <Animated.ScrollView ref={scrollRef as any} style={styles.flex} contentContainerStyle={{ flexGrow: 1, justifyContent: 'flex-end', paddingTop: 24, gap: 44 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" onScroll={onScroll} scrollEventThrottle={32}
            onScrollBeginDrag={() => { dragging.current = true; }} onScrollEndDrag={onDragEnd} onMomentumScrollEnd={onDragEnd}
            onContentSizeChange={followIfPinned} onLayout={followIfPinned}>
            {emptyThread ? (
              <Animated.View exiting={FadeOut.duration(220)} style={{ gap: 16 }}>
                {suggestions.slice(0, 3).map((l, i) => (
                  <Animated.View key={l} entering={FadeIn.delay(120 + 90 * i).duration(500)}>
                    <Pressable onPress={() => void send(l)} hitSlop={4} accessibilityRole="button"><Text style={styles.suggestion}>{l}</Text></Pressable>
                  </Animated.View>
                ))}
              </Animated.View>
            ) : null}
            <CardHandlersProvider value={handlers}>
            {thread.state.turns.map((t, i) => {
              if (away && !awayOpen && i >= away.start && i < away.end) {
                return i === away.start ? <AwayRow key="away" count={away.count} onPress={() => setAwayOpen(true)} /> : null;
              }
              return (
              <TurnView key={t.id} turn={t} dispatch={thread.dispatch} ask={askInComposer} onAsk={onAskPick} />
              );
            })}
            </CardHandlersProvider>
            {thread.state.error ? <Text style={T.caption}>{thread.state.error}</Text> : null}
            <Animated.View style={threadPad} />
          </Animated.ScrollView>
          {showNew && chat ? (
            <Animated.View entering={FadeIn.duration(200)} exiting={FadeOut.duration(200)} style={styles.newPillWrap} pointerEvents="box-none">
              <Pressable onPress={toEnd} style={styles.newPill} accessibilityRole="button" accessibilityLabel="Scroll to new messages">
                <Text style={[T.captionStrong, { color: C.ink }]}>↓ New</Text>
              </Pressable>
            </Animated.View>
          ) : null}
        </Animated.View>

        {/* Composer: one hairline, "Ask Anakin", ↑ (crimson with text, unless busy). Rides the keyboard at 12 pt. */}
        <Animated.View entering={settle(420)} style={typedFocus ? { opacity: 0 } : undefined} pointerEvents={typedFocus ? 'none' : 'auto'}>
        {draftEdit && cmode.kind === 'draft' ? (
          <View style={styles.editingRow}>
            <Text style={T.caption} numberOfLines={1}>Editing draft to {cmode.to} · </Text>
            <Pressable onPress={() => { setDraftEdit(null); setText(''); }} hitSlop={10}><Text style={[T.caption, { color: C.ink }]}>Cancel</Text></Pressable>
          </View>
        ) : null}
        {editing ? (
          <Animated.View style={[styles.inputWrap, styles.saveBar, inputWrap]}>
            <Pressable onPress={() => { setEditing(null); Keyboard.dismiss(); }} hitSlop={12} accessibilityRole="button"><Text style={[T.body, { color: C.muted }]}>Cancel</Text></Pressable>
            <Pressable onPress={saveEdit} hitSlop={12} accessibilityRole="button"><Text style={[T.body, { color: C.crimson, fontFamily: v2.font.semibold }]}>Save</Text></Pressable>
          </Animated.View>
        ) : (
        <Animated.View style={[styles.inputWrap, inputWrap]}>
          <AnimatedTextInput
            ref={inputRef}
            value={text}
            onChangeText={setText}
            // Brief: the row below takes the tap (morph first, keyboard after).
            editable={chat}
            onFocus={() => { setFocus(true); enterChat(); setBriefOpen(false); }}
            onBlur={() => { setAnswering(false); onBlur(); }}
            onSubmitEditing={() => void send()}
            placeholder={cmode.kind === 'ask' && answering ? 'Type your answer' : cmode.placeholder}
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
          {chat ? null : <Pressable style={StyleSheet.absoluteFill} onPress={openChat} accessibilityRole="button" accessibilityLabel="Ask Anakin" />}
        </Animated.View>
        )}
        </Animated.View>
      </View>
    </View>
  );
}

const TurnView = React.memo(function TurnView({ turn, dispatch, ask, onAsk }: { turn: Turn; dispatch: Thread['dispatch']; ask: (m: string) => void; onAsk: (turn: Turn, o: string) => void }) {
  const toggle = () => dispatch({ type: 'toggle', id: turn.id });
  const patch = (pch: Record<string, any>) => dispatch({ type: 'card_state', agentId: turn.id, patch: pch });
  const resolve = (line: string) => dispatch({ type: 'resolve', agentId: turn.id, resolution: line });
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
        {summary ? (
          <Pressable onPress={toggle} hitSlop={6} disabled={streaming && !turn.text}>
            <Text style={T.caption}>{summary}{turn.done && turn.receipts.length && !turn.open ? ' →' : ''}</Text>
          </Pressable>
        ) : null}
        {showList && turn.receipts.length ? <View style={{ marginTop: 8 }}><ReceiptList items={turn.receipts} liveIndex={live} animate={streaming} /></View> : null}
        {turn.ask && !turn.resolution ? <View style={{ marginTop: 12 }}><Ask question={turn.ask.question} reason={turn.ask.reason} options={turn.ask.options} size="read" onPick={(o) => onAsk(turn, o)} /></View> : null}
        {turn.text ? (
          <View style={{ marginTop: summary ? 10 : 0, flexDirection: 'row', alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <View style={{ flex: 1 }}><MarkdownText text={turn.text} style={styles.agentText} /></View>
            {streaming ? <Caret /> : null}
          </View>
        ) : null}
        {turn.cards?.length ? (
          <View style={{ marginTop: 18, gap: 28 }}>
            {turn.cards.map((c, i) => <Enter key={c.id} index={i} exit={false}><CardView card={c} /></Enter>)}
          </View>
        ) : turn.done ? <TurnCard turn={turn} patch={patch} resolve={resolve} ask={ask} /> : <PendingCard turn={turn} />}
        {turn.resolution ? <View style={{ marginTop: 12 }}><Text style={[T.caption, { color: /^(Adjusted|Logged)/.test(turn.resolution) ? C.crimson : C.muted }]}>{turn.resolution}</Text></View> : null}
      </View>
    </Enter>
  );
});

export function dismissKeyboard() { Keyboard.dismiss(); }

/** "While you were away · 3" — one collapsed row; tapping expands the cards in order. */
function AwayRow({ count, onPress }: { count: number; onPress: () => void }) {
  return (
    <Enter exit={false}>
      <Pressable onPress={onPress} style={styles.awayRow} accessibilityRole="button" accessibilityLabel={`While you were away, ${count} items. Show them`}>
        <Text style={[T.rowStrong, { fontSize: 15, flex: 1 }]}>While you were away · {count}</Text>
        <Text style={[T.rowStrong, { fontSize: 15, color: C.muted }]}>↓</Text>
      </Pressable>
    </Enter>
  );
}

/** Skeleton in the card slot while a tool runs longer than 400 ms (§6.4) — never for fast results. */
function PendingCard({ turn }: { turn: Turn }) {
  const [show, setShow] = useState(false);
  const running = !turn.done && turn.receipts.length > 0 && !turn.text;
  useEffect(() => {
    if (!running) { setShow(false); return; }
    const t = setTimeout(() => setShow(true), 400);
    return () => clearTimeout(t);
  }, [running, turn.receipts.length]);
  if (!running || !show) return null;
  return <Animated.View entering={FadeIn.duration(150)} exiting={FadeOut.duration(150)} style={{ marginTop: 18 }}><CardSkeleton /></Animated.View>;
}

/** First launch with nothing cached (review #5 §1.4): the read slot says so, pulsing 1 → .25 → 1 over 1.6 s — never a blank area. */
function Checking() {
  const o = useSharedValue(1);
  useEffect(() => {
    o.value = withRepeat(withSequence(withTiming(0.25, { duration: 800, easing: Easing.inOut(Easing.ease) }), withTiming(1, { duration: 800, easing: Easing.inOut(Easing.ease) })), -1, false);
  }, [o]);
  const st = useAnimatedStyle(() => ({ opacity: o.value }));
  return <Animated.Text exiting={FadeOut.duration(200)} style={[styles.read, { color: C.darkMuted }, st]}>Checking your day…</Animated.Text>;
}

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
  awayRow: { flexDirection: 'row', alignItems: 'center', minHeight: 48, borderTopWidth: 1, borderBottomWidth: 1, borderColor: C.hairline },
  saveBar: { justifyContent: 'space-between' },
  editingRow: { height: 32, flexDirection: 'row', alignItems: 'center' },
  newPillWrap: { position: 'absolute', left: 0, right: 0, bottom: 84, alignItems: 'center' },
  newPill: { paddingHorizontal: 14, height: 32, borderRadius: 16, justifyContent: 'center', backgroundColor: C.white, borderWidth: 1, borderColor: C.hairline },
});
