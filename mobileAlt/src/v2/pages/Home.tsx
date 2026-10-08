// Anakin (index 0) — home. Layout to RN_QA_REVIEW_03 §B; motion to the
// Dreamcore spec (2 Oct), "lag-free brief → chat".
//
// Brief: the Dreamcore video (HomeVideo) under bottom-anchored white content —
// read → session row (`Begin →`) → composer, 112 pt above
// the tab bar. The read starts below the video's orb.
//
// Chat: a white thread with the day's read as one 15 pt line on top, the
// session row under it, and the composer 40 pt from the bottom.
//
// Both are mounted from the start, as separate layers, and the morph between
// them is one shared value (the shell's `p`) read on the UI thread. Only
// opacity, transforms and colours animate — nothing changes size, so there is
// no layout pass, no re-measuring of the thread and no scroll-to-end during
// it. Opening changes no React tree beyond `pointerEvents`:
//   brief block   fades out by p = .45 and lifts 40 pt (it is not resized)
//   chat line     a separate 15 pt line that fades in over p .5 → 1
//   chat body     row + thread: opacity p, 24 pt rise
//   composer      one place: drops 72 pt as the tab bar leaves; hairline,
//                 ground and text recolour; rides the keyboard by transform
// The keyboard is asked for once the open has landed, not on the tap: bringing it up is work
// on the UI thread, the thread that runs the morph. A tapped suggestion opens
// chat and sends without the keyboard. Closing dismisses the keyboard first.
//
// The thread's scroll view is laid out once at its chat size; on iOS it rides
// the keyboard by transform with a matching top inset, on Android its bottom
// pad grows. Each morph's frame times are reported (`v2_morph_perf`).

import { todayStr } from '../../lib/localDate';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TextInput, ScrollView, StyleSheet, Keyboard, Platform, Dimensions, useWindowDimensions, type NativeSyntheticEvent, type NativeScrollEvent } from 'react-native';
import { Pressable } from '../primitives/Pressable';
import Animated, { useSharedValue, useAnimatedStyle, useAnimatedReaction, useFrameCallback, runOnJS, interpolate, interpolateColor, FadeIn, FadeInDown, FadeOut, Extrapolation, withRepeat, withSequence, withTiming, Easing, type SharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { useKeyboardController, useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller';
import * as ScreenCapture from 'expo-screen-capture';
import { composerMode, latestAgentCards, allCards, signedLayout, type Turn, type Card } from '@axiom/agent-ui-core';
import { threadBus } from '../chat/captureBus';
import { LinearGradient } from 'expo-linear-gradient';
import { CardHandlersProvider, type CardHandlers, type EditSession } from '../chat/card/context';
import { useCardActions } from '../chat/useCardActions';
import { v2Api } from '../api';
import { v2, T } from '../theme';
import { Enter } from '../primitives/Enter';
import { headerClearance } from '../shell/Header';
import { useShell } from '../shell/ShellContext';
import { useRequirePro } from '../shell/proGate';
import { useBrief, useInvalidate } from '../data';
import { useThread } from '../chat/useThread';
import { SignedTurn, TURN_GAP } from '../chat/SignedTurn';
import { Orb } from '../home/Orb';
import { HomeVideo, useHomePlayer } from '../home/HomeVideo';
import { coachApi } from '../../lib/api';
import { posthog } from '../../lib/analytics';
import { haptics } from '../haptics';
import { sessionTitle, sessionCaption } from '../format';
import { usePausedDiagnostic } from './pushed/analyze';

const C = v2.color;
const plain = (t: string) => t.replace(/[*_`#>]+/g, '').replace(/\s+/g, ' ').trim();
let askSeq = 0;
// Review #5 §1.5: pieces settle in on open — opacity 0→1, translateY 8→0, 500 ms, staggered.
const settle = (delay: number) => FadeInDown.duration(500).delay(delay).easing(v2.motion.easeEnter).withInitialValues({ opacity: 0, transform: [{ translateY: 8 }] });
const READ_LINE = 33; // the read's line height — its slot is reserved so a new read never moves the layout
const AnimatedTextInput = Animated.createAnimatedComponent(TextInput);
/**
 * The keyboard is asked for once the open has landed. The spec says p ≥ .6,
 * but the phone's own frame reports (v2_morph_perf, 3 Oct) showed every open
 * with 2–3 frames of 50–120 ms while every close — no keyboard — stayed
 * smooth: bringing the keyboard up stalls the UI thread that runs the morph.
 */
const KEYBOARD_AT_P = 1;
/** The composer: one height in both states, 112 pt up in brief (above the tab bar), 40 pt in chat. */
const COMPOSER_H = 56;
const BRIEF_BOTTOM = 112;
const CHAT_BOTTOM = 40;
const IOS = Platform.OS === 'ios';
/** In chat the composer sits CHAT_BOTTOM from the screen edge; with the keyboard up, 12 pt above it. This much of the keyboard is absorbed before anything moves. */
const KB_FREE = CHAT_BOTTOM - 12;

/**
 * Frame times of each brief ↔ chat morph, measured on the UI thread and
 * reported when it lands. Idle cost is one comparison per frame.
 */
function useMorphProbe(p: SharedValue<number>, context: () => Record<string, unknown>) {
  const n = useSharedValue(0);
  const total = useSharedValue(0);
  const worst = useSharedValue(0);
  const over20 = useSharedValue(0);
  const over34 = useSharedValue(0);
  const over50 = useSharedValue(0);
  const from = useSharedValue(0);
  // Where the slow frames fall: progress at each frame over 34 ms (first 8), so a hitch can be placed — tap, mid-flight, keyboard.
  const slowAt = useSharedValue<number[]>([]);
  const report = useCallback((to: 'chat' | 'brief', frames: number, ms: number, max: number, a: number, b: number, c: number, at: number[]) => {
    try {
      posthog.capture('v2_morph_perf', {
        to, frames, duration_ms: Math.round(ms), avg_ms: Math.round((ms / Math.max(1, frames)) * 10) / 10, max_ms: Math.round(max),
        over_20ms: a, over_34ms: b, over_50ms: c, slow_at_p: at.map((x) => Math.round(x * 100) / 100), keyboard_at_p: KEYBOARD_AT_P,
        platform: Platform.OS, ...context(),
      });
    } catch { /* analytics must never break home */ }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useFrameCallback((info) => {
    'worklet';
    const v = p.value;
    if (v > 0 && v < 1) {
      if (n.value === 0) from.value = v;
      const dt = info.timeSincePreviousFrame ?? 16;
      // The first frame's interval includes the idle time before the tap; skip it.
      if (n.value > 0) {
        total.value += dt;
        if (dt > worst.value) worst.value = dt;
        if (dt > 20) over20.value += 1;
        if (dt > 34) { over34.value += 1; if (slowAt.value.length < 8) slowAt.value = [...slowAt.value, v]; }
        if (dt > 50) over50.value += 1;
      }
      n.value += 1;
    } else if (n.value > 0) {
      if (n.value > 5) runOnJS(report)(v >= 1 ? 'chat' : 'brief', n.value - 1, total.value, worst.value, over20.value, over34.value, over50.value, slowAt.value);
      n.value = 0; total.value = 0; worst.value = 0; over20.value = 0; over34.value = 0; over50.value = 0; slowAt.value = [];
    }
  }, true);
}

export function HomePage() {
  const insets = useSafeAreaInsets();
  const { width: SW, height: SH } = useWindowDimensions();
  // Short screens (iPhone SE): the video's orb sits ≈ 405 pt down, so the bottom-anchored
  // brief gets two lines of read instead of three to stay clear of it (video spec §7).
  const readLines = SH < 740 ? 2 : 3;
  const READ_SLOT = READ_LINE * readLines;
  const router = useRouter();
  const shell = useShell();
  const p = shell.progress;
  const brief = useBrief();
  const invalidate = useInvalidate();
  const thread = useThread();
  const requirePro = useRequirePro();
  const chat = shell.mode === 'chat';
  const [text, setText] = useState('');
  const [focus, setFocus] = useState(false);
  const [askDone, setAskDone] = useState(false);
  const askAppended = useRef(false);
  const inputRef = useRef<TextInput>(null);
  const scrollRef = useRef<ScrollView>(null);
  const blurTimer = useRef<any>(null);

  useEffect(() => {
    shell.registerAsk((m) => { void thread.send(m); });
    if (shell.pendingAsk.current) { const m = shell.pendingAsk.current; shell.pendingAsk.current = null; void thread.send(m); }
  }, [shell, thread.send]); // eslint-disable-line react-hooks/exhaustive-deps
  // "While you were away · N" (spec §9): Anakin-initiated turns since the user last spoke, folded once at open.
  const [away, setAway] = useState<{ start: number; end: number; count: number } | null>(null);
  const [awayOpen, setAwayOpen] = useState(false);
  useEffect(() => { void thread.hydrate().then(setAway); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // Suggestions reach chat (feedback 8 Oct): pending ones chat hasn't shown yet arrive as Anakin's turn. At most every 10 min.
  const surfacedAt = useRef(0);
  const surface = useCallback(() => {
    if (Date.now() - surfacedAt.current < 10 * 60_000) return;
    surfacedAt.current = Date.now();
    void v2Api.surfaceAdaptations().then((r) => { if (r?.posted) void thread.hydrate().then(setAway); }).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { surface(); }, [surface]);
  useEffect(() => threadBus.on(() => { void thread.hydrate(); }), []); // eslint-disable-line react-hooks/exhaustive-deps

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

  // keyboard-controller's height is negative while the keyboard is up.
  const { height: kbHeight } = useReanimatedKeyboardAnimation();
  const bottomInset = insets.bottom;

  // Reveal (§7.1.3): the node's bottom sits 16 pt above the composer / Save bar once the keyboard is up.
  const pendingReveal = useRef<View | null>(null);
  const doReveal = useCallback((kbH: number) => {
    const node = pendingReveal.current;
    pendingReveal.current = null;
    node?.measureInWindow((_x, y, _w, h) => {
      const limit = Dimensions.get('window').height - kbH - COMPOSER_H - 16;
      let over = y + h - limit;
      if (IOS) {
        // The thread itself rises with the keyboard; count only the part of that rise still to come,
        // and never ask for more scroll than there is content.
        const lift = Math.max(0, kbH - KB_FREE);
        const applied = Math.max(0, -kbHeight.value - KB_FREE);
        over = Math.min(over - Math.max(0, lift - applied), Math.max(0, fromBottom.current));
      }
      if (over > 0) scrollRef.current?.scrollTo({ y: scrollY.current + over, animated: true });
    });
  }, [bottomInset, kbHeight]);
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
    say: (m) => { if (requirePro() === false) return; pin(); void thread.send(m); },
    reveal, scrollToLatest: toEnd, setTypedFocus,
    editing,
    beginEdit: (x) => setEditing({ ...x, value: x.value ?? x.initial }),
    setEditValue: (v) => setEditing((e) => (e ? { ...e, value: v } : e)),
    endEdit: () => setEditing(null),
  }), [actions, editDraft, reveal, toEnd, editing, thread.send, pin, requirePro]); // eslint-disable-line react-hooks/exhaustive-deps
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

  // ── Everything below runs from the one progress value, on the UI thread. Opacity, transforms, colours — nothing else. ──
  const briefLayer = useAnimatedStyle(() => ({
    opacity: interpolate(p.value, [0, 0.45], [1, 0], Extrapolation.CLAMP),
    transform: [{ translateY: -40 * p.value }],
  }));
  const chatLine = useAnimatedStyle(() => ({ opacity: interpolate(p.value, [0.5, 1], [0, 1], Extrapolation.CLAMP) }));
  // The white chat ground (spec §2.2): a full-screen #fff under the chat, opacity p. Without it the
  // chat's white pieces (the header fade, the composer) sat on a half-faded video as solid blocks.
  const whiteGround = useAnimatedStyle(() => ({ opacity: p.value }));
  // The header fade and the composer's white come in last, once the ground under them is nearly white.
  const topFadeIn = useAnimatedStyle(() => ({ opacity: interpolate(p.value, [0.8, 1], [0, 1], Extrapolation.CLAMP) }));
  const chatBody = useAnimatedStyle(() => ({ opacity: p.value, transform: [{ translateY: 24 * (1 - p.value) }] }));
  // The hairline goes ink while the composer is focused, over 150 ms.
  const focusP = useSharedValue(0);
  useEffect(() => { focusP.value = withTiming(focus ? 1 : 0, { duration: 150 }); }, [focus]); // eslint-disable-line react-hooks/exhaustive-deps
  const inputWrap = useAnimatedStyle(() => ({
    borderTopColor: interpolateColor(p.value, [0, 1], [C.darkInputLine, interpolateColor(focusP.value, [0, 1], [C.hairline, C.ink]) as string]),
    backgroundColor: interpolateColor(p.value, [0, 0.6, 1], ['rgba(255,255,255,0)', 'rgba(255,255,255,0)', 'rgba(255,255,255,1)']),
  }));
  // Down 72 pt to its chat place as the tab bar leaves, then up with the keyboard.
  const composerMove = useAnimatedStyle(() => ({
    transform: [{ translateY: (BRIEF_BOTTOM - CHAT_BOTTOM) * p.value - Math.max(0, -kbHeight.value - KB_FREE) * p.value }],
  }));
  // iOS: the thread rides the keyboard by transform — no layout, no change of content size, nothing for JS to re-pin.
  // Android keeps the growing pad (it has no contentInset to keep the top of the thread reachable).
  // After the last turn: 24 pt, then the composer (signed-turns spec §2).
  const threadPad = useAnimatedStyle(() => ({ height: 24 + (IOS ? 0 : Math.max(0, -kbHeight.value - KB_FREE)) }));
  const threadLift = useAnimatedStyle(() => ({ transform: [{ translateY: IOS ? -Math.max(0, -kbHeight.value - KB_FREE) : 0 }] }));
  // What the lift pushes under the top edge stays reachable by scrolling.
  const [kbLift, setKbLift] = useState(0);
  useEffect(() => {
    if (!IOS) return;
    const a = Keyboard.addListener('keyboardDidShow', (e) => setKbLift(Math.max(0, e.endCoordinates.height - KB_FREE)));
    const b = Keyboard.addListener('keyboardDidHide', () => setKbLift(0));
    return () => { a.remove(); b.remove(); };
  }, []);
  const inputText = useAnimatedStyle(() => ({ color: interpolateColor(p.value, [0, 1], [C.darkInk, C.ink]) }));

  const loaded = !!brief.data;
  // The session row pushes Today (H-01) — its exercises, recovery and the Swap / Life happened / Check in actions; Begin is there.
  const openSession = useCallback(() => { haptics.select(); router.push({ pathname: '/(v2)/p/[key]', params: { key: 'today' } } as any); }, [router]);
  const sentence = loaded ? plain(brief.data!.sentence) : (brief.isError ? 'Tell me what you\'re working toward.' : '');
  // A changed read cross-fades (old out 200 ms, new in 500 ms); the first one just settles with the rest.
  const prevRead = useRef<string | null>(null);
  const swapRead = prevRead.current !== null && prevRead.current !== sentence;
  useEffect(() => { prevRead.current = sentence; }, [sentence]);
  const suggestions = brief.data?.suggestions ?? ["I can't train Thursday. Move it?", 'How\'s my bench?', 'Log lunch'];
  const session = brief.data?.session;
  const ask = !askDone ? brief.data?.ask ?? null : null;

  // T-15: a diagnostic left part-way shows Continue → on Home.
  const paused = usePausedDiagnostic();
  const openPaused = useCallback(() => { if (!paused.data) return; haptics.select(); router.push({ pathname: '/(v2)/diagnose', params: { sessionId: paused.data.id } } as any); }, [paused.data, router]);
  const homePlayer = useHomePlayer();
  const enterChat = () => {
    if (chat) return;
    surface();
    tapAt.current = Date.now();
    // Free the decoder for the morph — the video is fading out anyway (spec §2.5).
    try { homePlayer?.pause(); } catch { /* released */ }
    shell.setMode('chat');
    if (ask && !askAppended.current) {
      askAppended.current = true;
      thread.dispatch({ type: 'append_agent', turn: { id: `ask${Date.now().toString(36)}${askSeq++}`, kind: 'agent', text: '', receipts: [{ id: 'r-ask', verb: 'Checked', text: 'Wellness — no check-in today' }], done: true, ask } });
    }
  };
  // Tap on the composer in brief: the morph starts now, the keyboard once it lands.
  const wantKeyboard = useSharedValue(0);
  const focusInput = useCallback(() => { inputRef.current?.focus(); }, []);
  useAnimatedReaction(
    () => wantKeyboard.value === 1 && p.value >= KEYBOARD_AT_P,
    (go) => { if (go) { wantKeyboard.value = 0; runOnJS(focusInput)(); } },
    [focusInput],
  );
  const openChat = () => {
    wantKeyboard.value = 1;
    enterChat();
  };
  useEffect(() => { if (!chat) wantKeyboard.value = 0; }, [chat]); // eslint-disable-line react-hooks/exhaustive-deps
  const send = async (m?: string) => {
    const msg = (m ?? text).trim(); if (!msg) return;
    // Chat is Pro under the direct-entry paywall; the draft stays in the composer.
    if (requirePro() === false) { Keyboard.dismiss(); return; }
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
    if (requirePro() === false) return;
    const hours = /Under/.test(o) ? 5 : /6–7/.test(o) ? 6.5 : 7.5;
    thread.dispatch({ type: 'resolve', agentId: turn.id, resolution: `Logged — Wellness · sleep ${o.toLowerCase()}` });
    setAskDone(true);
    // Sleep alone — the answer given. Energy, mood and stress are never guessed from it (handoff H-04).
    void coachApi.postAnsweredCheckin({ date: todayStr(), sleepHours: hours }).catch(() => {}).then(() => invalidate.afterSchedule());
    void thread.send(`I slept ${o.toLowerCase()} last night. Does today change?`);
  };
  // Stable handlers so a turn re-renders only when the turn itself changes —
  // not on every keystroke, streamed token or mode change.
  const answerAskRef = useRef(answerAsk);
  answerAskRef.current = answerAsk;
  const onAskPick = useCallback((turn: Turn, o: string) => answerAskRef.current(turn, o), []);
  const askInComposer = useCallback((m: string) => { setText(m); inputRef.current?.focus(); }, []);
  useEffect(() => { shell.registerPrefill(askInComposer); }, [shell, askInComposer]);
  const onBlur = () => {
    setFocus(false);
    clearTimeout(blurTimer.current);
    blurTimer.current = setTimeout(() => { if (thread.state.turns.length === 0 && !text.trim()) shell.setMode('brief'); }, 250);
  };
  useEffect(() => () => clearTimeout(blurTimer.current), []);
  const busy = thread.state.busy;
  // Who signs what, where the time stamps go (signed-turns spec §4).
  const slots = useMemo(() => signedLayout(thread.state.turns, Date.now()), [thread.state.turns]);
  const emptyThread = thread.state.turns.length === 0;

  // Tap → first committed chat render, on the JS thread; reported with the frame times.
  const tapAt = useRef(0);
  const jsRenderMs = useRef(0);
  useEffect(() => { if (tapAt.current) { jsRenderMs.current = Date.now() - tapAt.current; tapAt.current = 0; } }, [chat]);
  const turnCount = useRef(0);
  turnCount.current = thread.state.turns.length;
  useMorphProbe(p, () => ({ js_render_ms: jsRenderMs.current, turns: turnCount.current, layered: true }));

  const editingDraft = !!draftEdit && cmode.kind === 'draft';
  const top = headerClearance(insets.top);

  return (
    <View style={styles.flex}>
      <HomeVideo mode={chat ? 'chat' : 'brief'} progress={p} homeVisible={screenFocused && shell.index === 0} />
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: C.white }, whiteGround]} />
      <Orb mode={chat ? 'chat' : 'brief'} progress={p} working={busy} focused={screenFocused && shell.index === 0} />

      {/* Brief: bottom-anchored over the video, just above the composer. Fades and lifts away; never resized. */}
      <Animated.View style={[styles.briefLayer, { bottom: BRIEF_BOTTOM + COMPOSER_H }, briefLayer]} pointerEvents={chat ? 'none' : 'box-none'}>
        <BriefBlock
          sentence={sentence} swapRead={swapRead} readLines={readLines} readSlot={READ_SLOT} session={session} onBegin={openSession}
          paused={paused.data ? String(paused.data.lift ?? '').split('_').map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') : null} onContinue={openPaused} />
      </Animated.View>

      {/* Chat: laid out once at its final size under the header, above the composer's chat place. */}
      <View style={[styles.chatLayer, { top, bottom: CHAT_BOTTOM + COMPOSER_H }]} pointerEvents={chat ? 'box-none' : 'none'}>
        <Animated.View style={chatLine}>
          {sentence ? <Text style={styles.chatRead} numberOfLines={3}>{sentence}</Text> : null}
        </Animated.View>
        <Animated.View style={[styles.flex, chatBody]}>
          {session ? <ChatSessionRow session={session} onBegin={openSession} /> : null}
          <View style={[styles.flex, { overflow: 'hidden' }]}>
            <Animated.ScrollView ref={scrollRef as any} style={[styles.flex, threadLift]}
              contentInset={IOS ? { top: kbLift } : undefined}
              contentContainerStyle={{ flexGrow: 1, justifyContent: 'flex-end', paddingTop: 24 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" onScroll={onScroll} scrollEventThrottle={32}
              onScrollBeginDrag={() => { dragging.current = true; }} onScrollEndDrag={onDragEnd} onMomentumScrollEnd={onDragEnd}
              onContentSizeChange={followIfPinned} onLayout={followIfPinned}>
              {emptyThread ? (
                <Animated.View exiting={FadeOut.duration(220)} style={{ gap: 16 }}>
                  {suggestions.slice(0, 3).map((l) => (
                    <Pressable key={l} onPress={() => void send(l)} hitSlop={4} accessibilityRole="button"><Text style={styles.suggestion}>{l}</Text></Pressable>
                  ))}
                </Animated.View>
              ) : null}
              <CardHandlersProvider value={handlers}>
              {thread.state.turns.map((t, i) => {
                if (away && !awayOpen && i >= away.start && i < away.end) {
                  return i === away.start ? <View key="away" style={{ marginTop: i === 0 ? 0 : TURN_GAP }}><AwayRow count={away.count} onPress={() => setAwayOpen(true)} /></View> : null;
                }
                const sl = slots[i];
                return <SignedTurn key={t.id} turn={t} first={i === 0} stamp={sl?.stamp ?? null} showLabel={sl?.showLabel ?? true} showSignature={sl?.showSignature ?? true} grouped={sl?.grouped ?? false}
                  dispatch={thread.dispatch} ask={askInComposer} onAsk={onAskPick} />;
              })}
              </CardHandlersProvider>
              {thread.state.error ? (
                <View style={{ marginTop: TURN_GAP, gap: 10 }}>
                  <Text style={T.caption}>{thread.state.error}</Text>
                  {thread.failure ? (
                    <View style={{ flexDirection: 'row', gap: 24 }}>
                      {thread.failure.limit
                        ? <Pressable onPress={() => router.push({ pathname: '/(v2)/paywall', params: { gate: '1' } } as any)} hitSlop={8} accessibilityRole="button"><Text style={[T.captionStrong, { color: C.crimson }]}>Go Pro →</Text></Pressable>
                        : <Pressable onPress={thread.retry} hitSlop={8} accessibilityRole="button"><Text style={[T.captionStrong, { color: C.crimson }]}>Try again</Text></Pressable>}
                    </View>
                  ) : null}
                </View>
              ) : null}
              <Animated.View style={threadPad} />
            </Animated.ScrollView>
            {/* The thread fades out under the header rather than being cut by it. */}
            <Animated.View pointerEvents="none" style={[styles.topFade, topFadeIn]}>
              <LinearGradient colors={['#ffffff', 'rgba(255,255,255,0)']} style={StyleSheet.absoluteFill} />
            </Animated.View>
            {showNew && chat ? (
              <Animated.View entering={FadeIn.duration(200)} exiting={FadeOut.duration(200)} style={styles.newPillWrap} pointerEvents="box-none">
                <Pressable onPress={toEnd} style={styles.newPill} accessibilityRole="button" accessibilityLabel="Scroll to new messages">
                  <Text style={[T.captionStrong, { color: C.ink }]}>↓ New</Text>
                </Pressable>
              </Animated.View>
            ) : null}
          </View>
        </Animated.View>
      </View>

      {/* Composer: one hairline, "Ask Anakin", ↑ (crimson with text, unless busy). One place; moves by transform only. */}
      <Animated.View style={[styles.composer, { bottom: BRIEF_BOTTOM }, composerMove, typedFocus ? { opacity: 0 } : null]} pointerEvents={typedFocus ? 'none' : 'box-none'}>
      {/* The entrance lives on its own view so it never competes with the composer's moving transform. */}
      <Animated.View entering={settle(420)}>
        {editingDraft ? (
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
            // Brief: the row below takes the tap (morph first, keyboard once it lands).
            editable={chat}
            onFocus={() => { setFocus(true); enterChat(); }}
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
      </Animated.View>
    </View>
  );
}

type BriefSession = NonNullable<ReturnType<typeof useBrief>['data']>['session'];

/** The brief's own content. Memoised: opening chat doesn't re-render it — it only fades. */
const BriefBlock = React.memo(function BriefBlock({ sentence, swapRead, readLines, readSlot, session, onBegin, paused, onContinue }: {
  sentence: string; swapRead: boolean;
  readLines: number; readSlot: number; session: BriefSession | null | undefined; onBegin: () => void;
  /** A paused diagnostic's lift name, or null. */
  paused?: string | null; onContinue?: () => void;
}) {
  return (
    <>
      {/* The receipts summary line ("Checked N things") was dropped 6 Oct: low-contrast and read as tool calls. */}

      {/* The read: 27 / 600 / −0.02em / 1.22. Its slot is reserved so a new read never moves the layout. */}
      <Animated.View entering={settle(240)} style={{ marginBottom: 22, minHeight: readSlot }}>
        {sentence ? (
          <Animated.Text key={sentence} entering={swapRead ? settle(0) : undefined} exiting={FadeOut.duration(200)} style={[styles.read, { color: C.darkInk }]} numberOfLines={readLines}>{sentence}</Animated.Text>
        ) : (
          <Checking />
        )}
      </Animated.View>

      {paused ? (
        <Animated.View entering={settle(300)}>
          <Pressable onPress={onContinue} accessibilityRole="button" accessibilityLabel={`${paused} diagnostic, paused. Continue`}>
            <View style={[styles.sessionRow, { paddingVertical: 12, borderColor: C.darkHairline, borderBottomWidth: 0 }]}>
              <Text style={[T.caption, { color: C.darkMuted, flex: 1 }]} numberOfLines={1}>{paused} diagnostic · paused</Text>
              <Text style={[styles.begin, { color: C.darkInk, fontSize: 14 }]}>Continue →</Text>
            </View>
          </Pressable>
        </Animated.View>
      ) : null}
      {/* Session row: name · minutes, caption, `Begin →`. Opens the workout. */}
      {session ? (
        <Animated.View entering={settle(330)}>
          <Pressable onPress={session.isLogged ? undefined : onBegin} accessibilityRole="button">
            <View style={[styles.sessionRow, { paddingVertical: 20, borderColor: C.darkHairline }]}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[styles.rowName, { color: C.darkInk }]} numberOfLines={1}>{sessionLabel(session)}</Text>
                {session.focus ? <Text style={[T.caption, { color: C.darkMuted, marginTop: 4 }]} numberOfLines={1}>{sessionCaption(session.focus)}</Text> : null}
              </View>
              <Text style={[styles.begin, { color: C.darkInk }]}>{session.isLogged ? 'Done' : 'Begin →'}</Text>
            </View>
          </Pressable>
        </Animated.View>
      ) : null}
    </>
  );
});

/** The session row as it sits in chat: 15 pt, tight, light hairlines. Pre-mounted; it fades in with the thread. */
const ChatSessionRow = React.memo(function ChatSessionRow({ session, onBegin }: { session: NonNullable<BriefSession>; onBegin: () => void }) {
  return (
    <Pressable onPress={session.isLogged ? undefined : onBegin} accessibilityRole="button" style={{ marginTop: 14 }}>
      <View style={[styles.sessionRow, { paddingVertical: 10, borderColor: C.hairline }]}>
        <Text style={[styles.rowName, { fontSize: 15, lineHeight: 20, color: C.ink, flex: 1 }]} numberOfLines={1}>{sessionLabel(session)}</Text>
        <Text style={[styles.begin, { color: C.ink }]}>{session.isLogged ? 'Done' : 'Begin →'}</Text>
      </View>
    </Pressable>
  );
});

function sessionLabel(session: NonNullable<BriefSession>): string {
  return `${session.isToday ? '' : 'Tomorrow · '}${sessionTitle(session.name)}${session.minutes ? ` · ${session.minutes} min` : ''}`;
}

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
  briefLayer: { position: 'absolute', left: v2.space.gutter, right: v2.space.gutter },
  chatLayer: { position: 'absolute', left: v2.space.gutter, right: v2.space.gutter },
  chatRead: { fontFamily: v2.font.semibold, fontSize: 15, lineHeight: 20, color: C.muted },
  composer: { position: 'absolute', left: v2.space.gutter, right: v2.space.gutter },
  read: { fontFamily: v2.font.semibold, fontSize: 27, lineHeight: 33, letterSpacing: -0.54 },
  sessionRow: { flexDirection: 'row', alignItems: 'center', gap: 16, borderTopWidth: 1, borderBottomWidth: 1 },
  rowName: { fontFamily: v2.font.semibold, fontSize: 17, lineHeight: 22 },
  begin: { fontFamily: v2.font.semibold, fontSize: 15, lineHeight: 20 },
  suggestion: { fontFamily: v2.font.medium, fontSize: 20, lineHeight: 26, color: C.muted, letterSpacing: -0.3 },
  inputWrap: { height: COMPOSER_H, flexDirection: 'row', alignItems: 'center', gap: 12, borderTopWidth: 1 },
  input: { flex: 1, fontFamily: v2.font.regular, fontSize: 17, padding: 0 },
  send: { fontFamily: v2.font.semibold, fontSize: 17, lineHeight: 22 },
  topFade: { position: 'absolute', left: 0, right: 0, top: 0, height: 56 },
  awayRow: { flexDirection: 'row', alignItems: 'center', minHeight: 48, borderTopWidth: 1, borderBottomWidth: 1, borderColor: C.hairline },
  saveBar: { justifyContent: 'space-between' },
  editingRow: { position: 'absolute', left: 0, right: 0, bottom: COMPOSER_H, height: 32, flexDirection: 'row', alignItems: 'center', backgroundColor: C.white },
  newPillWrap: { position: 'absolute', left: 0, right: 0, bottom: 84, alignItems: 'center' },
  newPill: { paddingHorizontal: 14, height: 32, borderRadius: 16, justifyContent: 'center', backgroundColor: C.white, borderWidth: 1, borderColor: C.hairline },
});
