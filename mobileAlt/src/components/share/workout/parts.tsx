// Small primitives shared across the card templates. Each takes the card's
// scaler `p` (ref px → frame px) so everything scales as one unit.

import React from 'react';
import { View, Text, TextStyle, ViewStyle, StyleProp, StyleSheet } from 'react-native';
import { BlurView } from 'expo-blur';
import Svg, { Path, Defs, RadialGradient, LinearGradient, Stop, Rect } from 'react-native-svg';
import { typeScale } from './tokens';

interface PProp { p: (n: number) => number }

/** UPPERCASE micro-label — 700 / +0.14em tracking (spec type scale). */
export function Eyebrow({
  p, color, size = typeScale.eyebrow, children, style,
}: PProp & { color: string; size?: number; children: React.ReactNode; style?: StyleProp<TextStyle> }) {
  return (
    <Text
      style={[
        {
          color,
          fontSize: p(size),
          fontWeight: '700',
          letterSpacing: p(size) * 0.14,
          textTransform: 'uppercase',
        },
        style,
      ]}
      numberOfLines={1}
    >
      {children}
    </Text>
  );
}

/** The Axiom "A" chevron in a rounded-square tile + wordmark. */
export function BrandLockup({
  p, mark, wordmark, tileBg, tileBorder,
}: PProp & { mark: string; wordmark: string; tileBg: string; tileBorder?: string }) {
  const side = p(34);
  const icon = side * 0.5;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: p(8) }}>
      <View
        style={{
          width: side, height: side, borderRadius: side * 0.26,
          backgroundColor: tileBg, alignItems: 'center', justifyContent: 'center',
          borderWidth: tileBorder ? p(1) : 0, borderColor: tileBorder ?? 'transparent',
        }}
      >
        <Svg width={icon} height={icon} viewBox="0 0 24 24" fill="none">
          <Path d="M12 2L2 22H7L12 12L17 22H22L12 2Z" fill={mark} />
        </Svg>
      </View>
      <Text style={{ color: wordmark, fontSize: p(18), fontWeight: '700', letterSpacing: -p(0.4) }}>
        Axiom
      </Text>
    </View>
  );
}

/** A big tabular number with a unit + optional success delta (PR head). */
export function BigNumber({
  p, value, size, color, unit, unitColor, delta, deltaColor,
}: PProp & {
  value: string; size: number; color: string;
  unit?: string; unitColor?: string; delta?: string; deltaColor?: string;
}) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end' }}>
      <Text
        style={{
          color, fontSize: p(size), fontWeight: '700',
          letterSpacing: -p(size) * 0.04, fontVariant: ['tabular-nums'],
          lineHeight: p(size) * 1.02,
        }}
      >
        {value}
      </Text>
      {unit ? (
        <Text
          style={{
            color: unitColor ?? color, fontSize: p(26), fontWeight: '700',
            marginLeft: p(6), marginBottom: p(size) * 0.08,
          }}
        >
          {unit}
        </Text>
      ) : null}
      {delta ? (
        <Text
          style={{
            color: deltaColor ?? color, fontSize: p(22), fontWeight: '700',
            marginLeft: p(8), marginBottom: p(size) * 0.10, fontVariant: ['tabular-nums'],
          }}
        >
          {delta}
        </Text>
      ) : null}
    </View>
  );
}

/** Barely-visible top-right corner radial highlight (~10%) for the Hero surface. */
export function CornerGlow({ width, height, tint, id = 'cornerGlow' }: { width: number; height: number; tint: string; id?: string }) {
  return (
    <Svg style={StyleSheet.absoluteFill} width={width} height={height} pointerEvents="none">
      <Defs>
        <RadialGradient id={id} cx="100%" cy="0%" r="65%">
          <Stop offset="0" stopColor={tint} stopOpacity={0.1} />
          <Stop offset="1" stopColor={tint} stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Rect x="0" y="0" width={width} height={height} fill={`url(#${id})`} />
    </Svg>
  );
}

/** Vertical gradient scrim over a photo for text legibility. */
export function VerticalScrim({
  id, width, height, stops,
}: {
  id: string; width: number; height: number;
  stops: Array<{ offset: number; color: string; opacity: number }>;
}) {
  return (
    <Svg style={StyleSheet.absoluteFill} width={width} height={height} pointerEvents="none">
      <Defs>
        <LinearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          {stops.map((s, i) => (
            <Stop key={i} offset={s.offset} stopColor={s.color} stopOpacity={s.opacity} />
          ))}
        </LinearGradient>
      </Defs>
      <Rect x="0" y="0" width={width} height={height} fill={`url(#${id})`} />
    </Svg>
  );
}

/**
 * Frosted-glass panel. On screen it uses a live BlurView; at capture (`flat`)
 * it renders a deterministic solid fill instead, because view-shot can't
 * reliably rasterize the live blur across devices (spec §8).
 */
export function GlassPanel({
  fill, blur = 18, radius, borderWidth, borderColor, flat, style, children,
}: {
  fill: string; blur?: number; radius: number; borderWidth: number; borderColor: string;
  flat?: boolean; style?: StyleProp<ViewStyle>; children?: React.ReactNode;
}) {
  const frame = { borderRadius: radius, overflow: 'hidden' as const, borderWidth, borderColor };
  if (flat) {
    return <View style={[style, frame, { backgroundColor: fill }]}>{children}</View>;
  }
  return (
    <View style={[style, frame]}>
      <BlurView intensity={Math.round(blur * 2.4)} tint="dark" style={StyleSheet.absoluteFill} />
      <View style={[StyleSheet.absoluteFill, { backgroundColor: fill }]} />
      {children}
    </View>
  );
}

/** "⚡ PR" pill for the glass chip / photo cards. */
export function PRPill({ p, bg, fg }: PProp & { bg: string; fg: string }) {
  return (
    <View
      style={{
        flexDirection: 'row', alignItems: 'center', gap: p(4),
        backgroundColor: bg, borderRadius: p(999),
        paddingHorizontal: p(10), paddingVertical: p(5),
      }}
    >
      <Svg width={p(12)} height={p(12)} viewBox="0 0 24 24" fill="none">
        <Path d="M13 2L4 14h6l-1 8 9-12h-6l1-8z" fill={fg} />
      </Svg>
      <Text style={{ color: fg, fontSize: p(11), fontWeight: '700', letterSpacing: p(11) * 0.1 }}>PR</Text>
    </View>
  );
}
