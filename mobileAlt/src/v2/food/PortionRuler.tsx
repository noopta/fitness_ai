// The Portion sheet's ruler (handoff Nov 2026). Ticks are drawn once per unit and
// the whole strip moves with translateX, so nothing re-renders while dragging; the
// value reaches JS at ~30 Hz for the totals.
//
// The strip is split into SVG chunks because one SVG 3,600 pt wide is a very large
// bitmap at 3×. Chunk edges fall between majors, so no label is ever cut. Landmarks
// are plain Text on top, because they can be wider than the gap to an edge.
//
// Everything inside a gesture callback is inlined: a plain function called there
// aborts the app natively in release (Reanimated).

import React, { useEffect, useMemo, useRef } from 'react';
import { View, Text, StyleSheet, type AccessibilityActionEvent } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withTiming, cancelAnimation, runOnJS, useReducedMotion } from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Svg, { Line, Text as SvgText, Defs, LinearGradient, Stop, Rect } from 'react-native-svg';
import { rulerTicks, type RulerConfig, type RulerTick } from '@axiom/agent-ui-core';
import { v2 } from '../theme';
import { haptics } from '../haptics';

const C = v2.color;
const HEIGHT = 64;
const STRIP_TOP = 6;
const STRIP_H = HEIGHT - STRIP_TOP;
const TICK = '#d4d4d8';
const SETTLE_MS = 220;
const REPORT_MS = 33;
const HAPTIC_GAP_MS = 30;
const FLING = 0.12;

function chunksOf(c: RulerConfig) {
  const ticks = rulerTicks(c);
  const L = c.chunkMajors * c.major * c.px;
  const groups = new Map<number, RulerTick[]>();
  for (const t of ticks) {
    const i = Math.floor((t.x + L / 2) / L);
    const g = groups.get(i);
    if (g) g.push(t); else groups.set(i, [t]);
  }
  return [...groups.entries()].map(([i, items]) => ({ i, left: i * L - L / 2, width: L, items }));
}

const Strip = React.memo(function Strip({ config }: { config: RulerConfig }) {
  const chunks = useMemo(() => chunksOf(config), [config]);
  return (
    <>
      {chunks.map((ch) => (
        <Svg key={ch.i} width={ch.width} height={STRIP_H} style={{ position: 'absolute', left: ch.left, top: 0 }}>
          {ch.items.map((t) => {
            const x = t.x - ch.left;
            return (
              <React.Fragment key={t.x}>
                <Line x1={x} x2={x} y1={t.kind === 'major' ? 0 : t.kind === 'mid' ? 6 : 12} y2={26} stroke={t.kind === 'major' ? C.ink : TICK} strokeWidth={1} />
                {t.label ? <SvgText x={x} y={44} textAnchor="middle" fontSize={11} fontFamily={v2.font.regular} fill={C.muted}>{t.label}</SvgText> : null}
              </React.Fragment>
            );
          })}
        </Svg>
      ))}
    </>
  );
});

/** The edge fade: white over the white sheet reads the same as a mask and costs no offscreen pass. */
const Fade = React.memo(function Fade() {
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Svg width="100%" height="100%">
        <Defs>
          <LinearGradient id="fade" x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0" stopColor={C.white} stopOpacity={1} />
            <Stop offset="0.18" stopColor={C.white} stopOpacity={0} />
            <Stop offset="0.82" stopColor={C.white} stopOpacity={0} />
            <Stop offset="1" stopColor={C.white} stopOpacity={1} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#fade)" />
      </Svg>
    </View>
  );
});

export function PortionRuler({ config, value, marks, onChange, a11yValue }: {
  config: RulerConfig;
  /** In the current unit. */
  value: number;
  marks: { label: string; x: number }[];
  onChange: (value: number) => void;
  a11yValue: string;
}) {
  const { step, px, max, minor, major } = config;
  const reduced = useReducedMotion();
  const x = useSharedValue(value);
  const start = useSharedValue(value);
  const dragging = useSharedValue(false);
  const width = useSharedValue(0);
  const sent = useSharedValue(value);
  const sentAt = useSharedValue(0);

  // A quick pick, typing or Undo moved the value: ease there. A drag's own echo stays put.
  useEffect(() => {
    if (dragging.value || Math.abs(value - x.value) < step / 2) return;
    x.value = reduced ? value : withTiming(value, { duration: SETTLE_MS, easing: v2.motion.easeEnter });
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps

  const lastValue = useRef(value);
  const lastHaptic = useRef(0);
  const markValues = useMemo(() => marks.map((m) => m.x / px), [marks, px]);
  const report = (v: number) => {
    const prev = lastValue.current;
    lastValue.current = v;
    if (Math.floor((prev + 1e-6) / minor) !== Math.floor((v + 1e-6) / minor)) {
      const lo = Math.min(prev, v), hi = Math.max(prev, v);
      const passed = Math.floor((prev + 1e-6) / major) !== Math.floor((v + 1e-6) / major) || markValues.some((m) => m > lo && m <= hi);
      const now = Date.now();
      if (passed) { haptics.light(); lastHaptic.current = now; }
      else if (now - lastHaptic.current >= HAPTIC_GAP_MS) { haptics.select(); lastHaptic.current = now; }
    }
    onChange(v);
  };
  const settle = (v: number) => {
    x.value = reduced ? v : withTiming(v, { duration: SETTLE_MS, easing: v2.motion.easeEnter });
    report(v);
  };

  const pan = useMemo(() => Gesture.Pan()
    .activeOffsetX([-8, 8])
    .failOffsetY([-14, 14])
    .onStart(() => {
      cancelAnimation(x);
      start.value = x.value;
      dragging.value = true;
    })
    .onUpdate((e) => {
      const raw = start.value - e.translationX / px;
      const snapped = Math.round(Math.max(0, Math.min(max, Math.round(raw / step) * step)) * 100) / 100;
      x.value = snapped;
      const t = Date.now();
      if (snapped !== sent.value && t - sentAt.value >= REPORT_MS) {
        sent.value = snapped;
        sentAt.value = t;
        runOnJS(report)(snapped);
      }
    })
    .onEnd((e) => {
      const flung = x.value - (e.velocityX * FLING) / px;
      const target = Math.round(Math.max(0, Math.min(max, Math.round(flung / step) * step)) * 100) / 100;
      sent.value = target;
      runOnJS(settle)(target);
    })
    .onFinalize(() => {
      dragging.value = false;
    }), [px, max, step]); // eslint-disable-line react-hooks/exhaustive-deps

  const stripStyle = useAnimatedStyle(() => ({ transform: [{ translateX: width.value / 2 - x.value * px }] }));

  const nudge = (dir: 1 | -1) => {
    const by = config.key === 'g' ? 10 : step;
    const v = Math.round(Math.max(0, Math.min(max, value + dir * by)) * 100) / 100;
    haptics.select();
    settle(v);
  };
  const onA11y = (e: AccessibilityActionEvent) => {
    if (e.nativeEvent.actionName === 'increment') nudge(1);
    if (e.nativeEvent.actionName === 'decrement') nudge(-1);
  };

  return (
    <GestureDetector gesture={pan}>
      <View style={styles.wrap} collapsable={false}
        onLayout={(e) => { width.value = e.nativeEvent.layout.width; }}
        accessible accessibilityRole="adjustable" accessibilityLabel="Amount" accessibilityValue={{ text: a11yValue }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]} onAccessibilityAction={onA11y}>
        <Animated.View style={[styles.strip, stripStyle]}>
          <Strip config={config} />
          {marks.map((m) => <Text key={m.label} style={[styles.mark, { left: m.x - MARK_W / 2 }]} numberOfLines={1}>{m.label.toUpperCase()}</Text>)}
        </Animated.View>
        <Fade />
        <View style={styles.indicator} pointerEvents="none" />
      </View>
    </GestureDetector>
  );
}

const MARK_W = 120;

const styles = StyleSheet.create({
  wrap: { height: HEIGHT, overflow: 'hidden' },
  strip: { position: 'absolute', left: 0, top: STRIP_TOP, height: STRIP_H, width: 1 },
  mark: { position: 'absolute', top: 46, width: MARK_W, textAlign: 'center', fontFamily: v2.font.semibold, fontSize: 10, lineHeight: 12, letterSpacing: 0.6, color: C.placeholder },
  indicator: { position: 'absolute', left: '50%', top: 0, width: 2, height: 34, marginLeft: -1, borderRadius: 1, backgroundColor: C.ink },
});
