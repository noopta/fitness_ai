// The horizontal track — five full-screen pages, one gesture.
//
// Swipe anywhere to move between pages; the pill follows the finger; the
// header title cross-fades at the midpoint; rubber-band at the ends; tap the
// bar to jump. 520ms cubic-bezier(.2,.9,.25,1). Vertical scroll inside a page
// wins when the movement is vertical (activeOffsetX ±12 / failOffsetY ±8).
// Constraint honoured by construction: no page owns a horizontal gesture.
//
// The math lives in @axiom/agent-ui-core/track (tested); the worklets below
// mirror it so the gesture runs on the UI thread.

import React, { useCallback, useEffect, useState } from 'react';
import { View, StyleSheet, useWindowDimensions, StatusBar as RNStatusBar, Keyboard } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useSharedValue, useAnimatedStyle, useDerivedValue, withTiming, runOnJS, useAnimatedReaction, interpolate, Extrapolation } from 'react-native-reanimated';
import { StatusBar } from 'expo-status-bar';
import { PAGE_COUNT, TABS } from '@axiom/agent-ui-core';
import { v2 } from '../theme';
import { TabBar } from '../primitives/TabBar';
import { Header } from './Header';
import { useShell } from './ShellContext';

interface Props {
  pages: React.ReactNode[];
}

export function Track({ pages }: Props) {
  const { width: W } = useWindowDimensions();
  const shell = useShell();
  const { mode } = shell;
  const index = useSharedValue(0);
  const drag = useSharedValue(0);
  const startT = useSharedValue(0);
  const chat = useSharedValue(0);
  const [nearest, setNearest] = useState(0);
  const kb = useSharedValue(0);
  useEffect(() => {
    const a = Keyboard.addListener('keyboardWillShow', () => { kb.value = withTiming(1, { duration: 200 }); });
    const b = Keyboard.addListener('keyboardDidShow', () => { kb.value = withTiming(1, { duration: 120 }); });
    const c = Keyboard.addListener('keyboardWillHide', () => { kb.value = withTiming(0, { duration: 200 }); });
    const d = Keyboard.addListener('keyboardDidHide', () => { kb.value = withTiming(0, { duration: 120 }); });
    return () => { a.remove(); b.remove(); c.remove(); d.remove(); };
  }, [kb]);

  useEffect(() => { chat.value = withTiming(mode === 'chat' ? 1 : 0, { duration: 650, easing: v2.motion.easeEnter }); }, [mode, chat]);

  // Fractional position 0..4 (index minus drag/width).
  const pos = useDerivedValue(() => (W > 0 ? index.value - drag.value / W : index.value));

  const settle = useCallback((i: number) => { shell.setIndex(i); setNearest(i); }, [shell]);

  useAnimatedReaction(() => Math.round(pos.value), (n, prev) => { if (n !== prev) runOnJS(setNearest)(Math.max(0, Math.min(PAGE_COUNT - 1, n))); }, [pos]);

  const goTo = useCallback((i: number) => {
    const target = Math.max(0, Math.min(PAGE_COUNT - 1, i));
    index.value = withTiming(target, { duration: v2.motion.track, easing: v2.motion.easeTrack });
    drag.value = withTiming(0, { duration: v2.motion.track, easing: v2.motion.easeTrack });
    settle(target);
  }, [index, drag, settle]);
  useEffect(() => { shell.registerGoTo(goTo); }, [goTo, shell]);

  const pan = Gesture.Pan()
    .activeOffsetX([-12, 12])
    .failOffsetY([-8, 8])
    .onBegin(() => { startT.value = Date.now(); })
    .onUpdate((e) => {
      'worklet';
      const i = Math.round(index.value);
      const dx = e.translationX;
      // rubber-band at the ends (×0.3), clamp to one page
      const c = (i === 0 && dx > 0) || (i === PAGE_COUNT - 1 && dx < 0) ? dx * 0.3 : dx;
      drag.value = Math.max(-W, Math.min(W, c));
    })
    .onEnd(() => {
      'worklet';
      const i = Math.round(index.value);
      const d = drag.value;
      const dt = Date.now() - startT.value;
      const fast = Math.abs(d) > 30 && dt < 260;
      let next = i;
      if (d < -W * 0.28 || (fast && d < 0)) next = Math.min(PAGE_COUNT - 1, i + 1);
      if (d > W * 0.28 || (fast && d > 0)) next = Math.max(0, i - 1);
      index.value = withTiming(next, { duration: v2.motion.track, easing: v2.motion.easeTrack });
      drag.value = withTiming(0, { duration: v2.motion.track, easing: v2.motion.easeTrack });
      runOnJS(settle)(next);
    });

  const track = useAnimatedStyle(() => ({ transform: [{ translateX: -index.value * W + drag.value }] }));
  const title = TABS[nearest];
  const titleOpacity = useDerivedValue(() => {
    const n = Math.round(pos.value);
    return Math.max(0, 1 - Math.min(1, Math.abs(pos.value - n) * 2.2));
  });
  // Tab bar drops out (translateY 140) while chatting on page 0, and whenever the keyboard is up.
  const barHidden = useDerivedValue(() => Math.max(kb.value, chat.value * interpolate(pos.value, [0, 1], [1, 0], Extrapolation.CLAMP)));

  return (
    <View style={styles.root}>
      <StatusBar style="dark" />
      <GestureDetector gesture={pan}>
        <Animated.View style={styles.root}>
          <View style={[StyleSheet.absoluteFill, { backgroundColor: v2.color.white }]} />
          <Animated.View style={[styles.track, { width: W * PAGE_COUNT }, track]}>
            {pages.map((p, i) => (
              <View key={TABS[i]} style={{ width: W, flex: 1 }} accessibilityLabel={`${TABS[i]} page`}>
                {p}
              </View>
            ))}
          </Animated.View>
          <Header title={title} titleOpacity={titleOpacity} />
          <TabBar position={pos} active={nearest} onSelect={goTo} hidden={barHidden} />
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: v2.color.white },
  track: { flex: 1, flexDirection: 'row' },
});

export const statusBarHeight = RNStatusBar.currentHeight ?? 0;
