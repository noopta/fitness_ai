// Card visuals (CHAT_CARDS_RN_SPEC §4): Hero, Sparkline, Bars, WeekTiles,
// Media, Skeleton, CapturePlaceholder.
//
// Content animates in ONCE per card (§3): the line draws, bars grow, the hero
// counts up. `animatedOnce` remembers which cards already played so a
// re-render, a scroll-recycle or a card_set never replays it.

import React, { useEffect, useState } from 'react';
import { View, Text, Image, StyleSheet, type LayoutChangeEvent } from 'react-native';
import { Pressable } from '../../primitives/Pressable';
import Svg, { Path, Line, Circle } from 'react-native-svg';
import Animated, { useSharedValue, useAnimatedProps, useAnimatedStyle, withTiming, withDelay, withRepeat, withSequence, useReducedMotion, Easing } from 'react-native-reanimated';
import type { Card } from '@axiom/agent-ui-core';
import { K, S } from './tokens';
import { v2 } from '../../theme';
import { haptics } from '../../haptics';

const animatedOnce = new Set<string>();
/** True the first time a given card + part asks; false ever after. */
export function firstPlay(cardId: string, part: string): boolean {
  const k = `${cardId}:${part}`;
  if (animatedOnce.has(k)) return false;
  animatedOnce.add(k);
  return true;
}

// ── Hero ────────────────────────────────────────────────────────────────────
export function Hero({ cardId, hero }: { cardId: string; hero: NonNullable<Card['hero']> }) {
  const reduced = useReducedMotion();
  const m = /^(-?[\d,]*\.?\d+)(.*)$/.exec(hero.value);
  const target = m ? Number(m[1].replace(/,/g, '')) : NaN;
  const decimals = m && m[1].includes('.') ? m[1].split('.')[1].length : 0;
  const [shown, setShown] = useState(() => (Number.isFinite(target) && !reduced && firstPlay(cardId, 'hero') ? 0 : target));
  useEffect(() => {
    if (!Number.isFinite(target) || shown === target) return;
    const start = Date.now();
    let raf = 0;
    const tick = () => {
      const t = Math.min(1, (Date.now() - start) / 600);
      const e = 1 - Math.pow(1 - t, 3);
      setShown(target * e);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target]); // eslint-disable-line react-hooks/exhaustive-deps
  const text = Number.isFinite(target)
    ? `${shown.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}${m![2]}`
    : hero.value;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap' }} accessible accessibilityLabel={`${hero.value}${hero.unit ? ` ${hero.unit}` : ''}${hero.delta ? `, ${hero.delta}` : ''}`}>
      <Text style={S.heroValue}>{text}</Text>
      {hero.unit ? <Text style={[S.heroUnit, { marginLeft: 8 }]}>{hero.unit}</Text> : null}
      {hero.delta ? <Text style={[S.heroDelta, { marginLeft: 6 }]}>{hero.delta}</Text> : null}
    </View>
  );
}

// ── Sparkline ───────────────────────────────────────────────────────────────
const APath = Animated.createAnimatedComponent(Path);
export function Sparkline({ cardId, data }: { cardId: string; data: number[] }) {
  const [w, setW] = useState(0);
  const H = 60, PAD = 6, R = 3.5;
  const reduced = useReducedMotion();
  const play = React.useRef<boolean | null>(null);
  if (play.current === null) play.current = !reduced && firstPlay(cardId, 'line');
  const progress = useSharedValue(play.current ? 0 : 1);
  const pts = data.filter((n) => Number.isFinite(n));
  const min = Math.min(...pts), max = Math.max(...pts);
  const span = max - min || 1;
  const xy = pts.map((v, i) => [R + (pts.length === 1 ? 0 : (i / (pts.length - 1)) * (w - 2 * R)), PAD + (1 - (v - min) / span) * (H - PAD - R - 1)] as const);
  const d = xy.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const len = xy.reduce((s, [x, y], i) => (i ? s + Math.hypot(x - xy[i - 1][0], y - xy[i - 1][1]) : 0), 0) || 1;
  useEffect(() => { if (w && play.current) progress.value = withTiming(1, { duration: 700, easing: Easing.out(Easing.cubic) }); }, [w, progress]);
  const props = useAnimatedProps(() => ({ strokeDashoffset: len * (1 - progress.value) }));
  const dot = useAnimatedProps(() => ({ opacity: progress.value > 0.98 ? 1 : 0 }));
  const last = xy[xy.length - 1];
  return (
    <View style={{ height: H }} onLayout={(e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width)} accessibilityLabel={`Trend from ${pts[0]} to ${pts[pts.length - 1]}`}>
      {w > 0 && pts.length > 0 ? (
        <Svg width={w} height={H}>
          <Line x1={0} x2={w} y1={H - 0.5} y2={H - 0.5} stroke={K.hairline} strokeWidth={1} />
          <APath d={d} stroke={K.ink} strokeWidth={2} fill="none" strokeLinejoin="round" strokeLinecap="round" strokeDasharray={`${len} ${len}`} animatedProps={props} />
          {last ? <AnimatedDot x={last[0]} y={last[1]} r={R} style={dot} /> : null}
        </Svg>
      ) : null}
    </View>
  );
}
const ACircle = Animated.createAnimatedComponent(Circle);
function AnimatedDot({ x, y, r, style }: { x: number; y: number; r: number; style: any }) {
  // `style` is animated props (opacity), not a view style.
  return <ACircle cx={x} cy={y} r={r} fill={K.ink} animatedProps={style} />;
}

// ── Bars ────────────────────────────────────────────────────────────────────
export function Bars({ cardId, bars }: { cardId: string; bars: NonNullable<Card['bars']> }) {
  const reduced = useReducedMotion();
  const play = React.useRef<boolean | null>(null);
  if (play.current === null) play.current = !reduced && firstPlay(cardId, 'bars');
  const max = Math.max(1, ...bars.v);
  return (
    <View>
      <View style={st.bars}>
        {bars.v.map((v, i) => <Bar key={i} frac={v / max} delay={i * 30} play={!!play.current} color={i === bars.hi ? K.crimson : i === bars.dim ? K.dim : K.ink} />)}
      </View>
      {bars.labels?.length ? (
        <View style={{ flexDirection: 'row', gap: 6, marginTop: 6 }}>
          {bars.labels.map((l, i) => <Text key={i} style={[S.tileName, { flex: 1, textAlign: 'center', color: K.faint }]} numberOfLines={1}>{l}</Text>)}
        </View>
      ) : null}
    </View>
  );
}
function Bar({ frac, delay, play, color }: { frac: number; delay: number; play: boolean; color: string }) {
  const h = useSharedValue(play ? 0 : frac);
  useEffect(() => { if (play) h.value = withDelay(delay, withTiming(frac, { duration: 500, easing: Easing.out(Easing.cubic) })); else h.value = frac; }, [frac]); // eslint-disable-line react-hooks/exhaustive-deps
  const style = useAnimatedStyle(() => ({ height: `${Math.max(2, h.value * 100)}%` as any }));
  return <View style={{ flex: 1, height: '100%', justifyContent: 'flex-end' }}><Animated.View style={[{ backgroundColor: color, borderTopLeftRadius: 3, borderTopRightRadius: 3 }, style]} /></View>;
}

// ── WeekTiles (tap one, tap another → swap) ─────────────────────────────────
export function WeekTiles({ tiles, onSwap, disabled }: { tiles: NonNullable<Card['tiles']>; onSwap?: (a: number, b: number) => void; disabled?: boolean }) {
  const [sel, setSel] = useState<number | null>(null);
  const tap = (i: number) => {
    if (disabled || !onSwap || tiles[i].s === 'done') return;
    haptics.select();
    if (sel === null) return setSel(i);
    if (sel === i) return setSel(null);
    const a = sel; setSel(null); onSwap(a, i);
  };
  return (
    <View style={{ flexDirection: 'row', gap: 6 }}>
      {tiles.map((t, i) => {
        const fill = t.s === 'done' ? K.ink : t.s === 'rest' ? K.restFill : '#fff';
        const border = t.s === 'today' ? K.crimson : t.s === 'moved' || sel === i ? K.ink : t.s === 'rest' ? K.surface : K.hairline;
        const color = t.s === 'done' ? '#fff' : t.s === 'rest' ? K.faint : K.ink;
        return (
          <Pressable key={`${t.d}-${i}`} onPress={() => tap(i)} style={[st.tile, { backgroundColor: fill, borderColor: border, borderWidth: sel === i ? 2 : 1 }]}
            accessibilityRole="button" accessibilityLabel={`${t.d}${t.n ? `, ${t.n}` : ''}, ${t.s}`} accessibilityState={{ selected: sel === i }}>
            <Text style={[S.tileDay, { color }]}>{t.d}</Text>
            {t.n ? <Text style={[S.tileName, { color, marginTop: 4 }]} numberOfLines={2}>{t.n}</Text> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

// ── Media ───────────────────────────────────────────────────────────────────
export function Media({ media, onPress }: { media: NonNullable<Card['media']>; onPress?: () => void }) {
  const avatar = media.kind === 'avatar';
  const box = avatar ? { width: 96, height: 96, borderRadius: 48 } : { height: 96, borderRadius: 16 };
  return (
    <Pressable onPress={onPress} disabled={!onPress} style={[st.media, box]} accessibilityRole={media.kind === 'video' ? 'button' : 'image'} accessibilityLabel={media.caption ?? media.kind}>
      {media.uri ? <Image source={{ uri: media.uri }} style={[StyleSheet.absoluteFill, box]} resizeMode="cover" /> : null}
      {media.kind === 'video' ? <Text style={st.play}>▶</Text> : null}
      {media.caption ? <Text style={[S.caption, st.mediaCap]}>{media.caption}</Text> : null}
    </Pressable>
  );
}

// ── Skeleton / CapturePlaceholder (pulse) ───────────────────────────────────
function usePulse(from: number, to: number, ms: number) {
  const o = useSharedValue(to);
  useEffect(() => {
    o.value = withRepeat(withSequence(withTiming(from, { duration: ms / 2 }), withTiming(to, { duration: ms / 2 })), -1, false);
  }, [o, from, to, ms]);
  return useAnimatedStyle(() => ({ opacity: o.value }));
}

export function Skeleton({ rows = 2 }: { rows?: number }) {
  const pulse = usePulse(0.5, 1, 1400);
  const widths = [160, 120, 190];
  return (
    <Animated.View style={[{ gap: 14 }, pulse]} accessibilityLabel="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <View key={i} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <View style={[st.skel, { width: widths[i % 3] }]} />
          <View style={[st.skel, { width: 56 }]} />
        </View>
      ))}
    </Animated.View>
  );
}

export function CapturePlaceholder() {
  const pulse = usePulse(0.25, 1, v2.motion.pulse);
  return (
    <View style={st.capture}>
      <Animated.Image source={require('../../../../assets/v2/axiom-mark.png')} style={[{ width: 26, height: 26, tintColor: '#fff' }, pulse]} resizeMode="contain" />
    </View>
  );
}

const st = StyleSheet.create({
  bars: { height: 64, flexDirection: 'row', gap: 6, alignItems: 'flex-end', borderBottomWidth: 1, borderBottomColor: K.hairline },
  tile: { flex: 1, height: 64, borderRadius: 12, paddingVertical: 8, paddingHorizontal: 6 },
  media: { backgroundColor: K.surface, overflow: 'hidden', justifyContent: 'flex-end', alignItems: 'flex-start' },
  mediaCap: { position: 'absolute', left: 12, bottom: 10 },
  play: { position: 'absolute', alignSelf: 'center', top: 36, fontSize: 20, color: K.ink },
  skel: { height: 12, borderRadius: 6, backgroundColor: K.surface },
  capture: { height: 132, borderRadius: 20, backgroundColor: K.captureFill, alignItems: 'center', justifyContent: 'center' },
});
