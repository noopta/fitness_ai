// Train Together — shared primitives, lifted verbatim from the RN
// implementation spec v1.1 (§01). Six components cover ~90% of the feature.
// All numbers are dp; every literal (px, hex, weight) comes from the approved
// prototype. Do not restyle without a spec change.

import React, { useEffect } from 'react';
import {
  View, Text, StyleSheet, Pressable, Modal,
  Animated as RNAnimated, Easing as RNEasing,
  AccessibilityInfo, type ViewStyle, type TextStyle,
} from 'react-native';
import { KeyboardAvoider } from '../ui/KeyboardAvoider';
import Animated, {
  useSharedValue, useAnimatedStyle, withTiming, withDelay, withRepeat,
  withSequence, Easing,
} from 'react-native-reanimated';
import Svg, { Circle, Path } from 'react-native-svg';

// ─── Palette (spec §01 — hex shown for zero ambiguity) ────────────────────────
export const tt = {
  ink: '#09090b',        // foreground / primary
  muted: '#71717a',      // secondary text
  dim: '#a1a1aa',        // disabled text, dashed borders
  hairline: '#e4e4e7',   // ALL solid borders, 1px
  surface: '#f4f4f5',    // muted fills: badges, blocks, segmented track
  warnSoft: '#fef3c7',   // "Schedule changed" pill ONLY
  warnInk: '#b45309',
  white: '#ffffff',
  scrim: 'rgba(0,0,0,0.5)',
  ease: Easing.bezier(0.16, 1, 0.3, 1),
};

// Matched rows, selected cards.
export const shadowSm = {
  shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 20,
  shadowOffset: { width: 0, height: 6 }, elevation: 3,
} as const;

// ─── OverlapMark (handoff §02) ────────────────────────────────────────────────
// viewBox 0 0 44 30, circles r=11 at cx 16/28. Variants: solid (lens filled),
// outline, broken (right circle dasharray "4 3"). The feature's glyph — used
// everywhere an emoji is forbidden (QA: reject if emoji appears in copy).

export function OverlapMark({
  width = 22, height = 15, color = tt.ink, variant = 'outline',
}: { width?: number; height?: number; color?: string; variant?: 'solid' | 'outline' | 'broken' }) {
  const sw = width <= 16 ? 3.2 : width <= 26 ? 3 : 2.4; // thicker at tiny sizes
  // Lens = intersection of the two circles (r 11, centers x=16/28, y=15).
  const lens = 'M22 5.78 A11 11 0 0 1 22 24.22 A11 11 0 0 1 22 5.78 Z';
  return (
    <Svg width={width} height={height} viewBox="0 0 44 30" fill="none">
      {variant === 'solid' && <Path d={lens} fill={color} />}
      <Circle cx={16} cy={15} r={11} stroke={color} strokeWidth={sw} />
      <Circle
        cx={28} cy={15} r={11} stroke={color} strokeWidth={sw}
        strokeDasharray={variant === 'broken' ? '4 3' : undefined}
        opacity={variant === 'broken' ? 0.5 : 1}
      />
    </Svg>
  );
}

// ─── 1 · Avatar ───────────────────────────────────────────────────────────────
// circle; sizes 22 / 28 / 32 / 34; initial = 700 at size*0.38.
// self: bg ink, text #fff · other: bg surface, text ink.
// stack: overlap marginLeft -8, border 2 #fff (2.5 on dark surfaces).

export function TTAvatar({
  name, self = false, size = 28, uri, style,
}: { name?: string | null; self?: boolean; size?: number; uri?: string | null; style?: ViewStyle }) {
  const initial = (name || '?').trim()[0]?.toUpperCase() ?? '?';
  const base: ViewStyle = {
    width: size, height: size, borderRadius: size / 2,
    backgroundColor: self ? tt.ink : tt.surface,
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  };
  if (uri) {
    const { Image } = require('react-native');
    return <View style={[base, style]}><Image source={{ uri }} style={{ width: size, height: size }} /></View>;
  }
  return (
    <View style={[base, style]}>
      <Text style={{ fontSize: size * 0.38, fontWeight: '700', color: self ? tt.white : tt.ink }}>
        {initial}
      </Text>
    </View>
  );
}

export function TTAvatarStack({
  people, size = 22, onDark = false,
}: { people: Array<{ name?: string | null; self?: boolean; uri?: string | null }>; size?: number; onDark?: boolean }) {
  return (
    <View style={{ flexDirection: 'row' }}>
      {people.map((p, i) => (
        <TTAvatar
          key={i} name={p.name} self={p.self} size={size} uri={p.uri}
          style={{
            marginLeft: i === 0 ? 0 : -8,
            borderWidth: onDark ? 2.5 : 2, borderColor: tt.white,
          }}
        />
      ))}
    </View>
  );
}

// ─── 2 · TierBadge ────────────────────────────────────────────────────────────
// pill radius 9999, padding 3×9, font 10/600.
// exact = bg ink, text #fff · strong = border 1 ink, text ink ·
// flex = border 1 DASHED dim, text muted · none = bg surface, text muted.

export type TierName = 'exact' | 'strong' | 'flex' | 'none';

const TIER_LABEL: Record<TierName, string> = {
  exact: 'Exact match', strong: 'Strong match', flex: 'Could join', none: 'No match',
};

export function TierBadge({ tier, scaleUp = false }: { tier: TierName; scaleUp?: boolean }) {
  const box: ViewStyle = {
    borderRadius: 9999,
    paddingVertical: scaleUp ? 4 : 3, paddingHorizontal: scaleUp ? 11 : 9,
    borderWidth: tier === 'strong' || tier === 'flex' ? 1 : 0,
    alignSelf: 'flex-start',
  };
  const text: TextStyle = { fontSize: scaleUp ? 11 : 10, fontWeight: '600' };
  if (tier === 'exact') { box.backgroundColor = tt.ink; text.color = tt.white; }
  else if (tier === 'strong') { box.borderColor = tt.ink; text.color = tt.ink; }
  else if (tier === 'flex') { box.borderColor = tt.dim; box.borderStyle = 'dashed'; text.color = tt.muted; }
  else { box.backgroundColor = tt.surface; text.color = tt.muted; }
  return <View style={box}><Text style={text}>{TIER_LABEL[tier]}</Text></View>;
}

// ─── 3 · SplitBadge ───────────────────────────────────────────────────────────
// "PPL"/"UL": font 9/700, letterSpacing 0.8, color muted, bg surface,
// radius 8, padding 3×7. textOnly variant for inside participant chips.

export function SplitBadge({ label, textOnly = false }: { label?: string | null; textOnly?: boolean }) {
  if (!label) return null;
  const text = (
    <Text style={{ fontSize: 9, fontWeight: '700', letterSpacing: 0.8, color: tt.muted }}>
      {label.toUpperCase()}
    </Text>
  );
  if (textOnly) return text;
  return (
    <View style={{ backgroundColor: tt.surface, borderRadius: 8, paddingVertical: 3, paddingHorizontal: 7 }}>
      {text}
    </View>
  );
}

// ─── 4 · Buttons ──────────────────────────────────────────────────────────────
// Primary: bg ink, radius 14, paddingVertical 15, text #fff 14/600.
// Secondary: bg surface, ink text, same metrics. Ghost: text-only muted
// 12.5/500, paddingVertical 10. Press: activeOpacity 0.82, no scale.

function PressFade({ onPress, disabled, style, children }: {
  onPress?: () => void; disabled?: boolean; style?: ViewStyle | ViewStyle[]; children: React.ReactNode;
}) {
  return (
    <Pressable
      onPress={onPress} disabled={disabled}
      style={({ pressed }) => [style as any, pressed && { opacity: 0.82 }, disabled && { opacity: 0.4 }]}
    >
      {children}
    </Pressable>
  );
}

export function PrimaryButton({ label, onPress, disabled, icon, style }: {
  label: string; onPress?: () => void; disabled?: boolean; icon?: React.ReactNode; style?: ViewStyle;
}) {
  return (
    <PressFade onPress={onPress} disabled={disabled} style={[p.primary, style as any]}>
      {icon}
      <Text style={p.primaryText}>{label}</Text>
    </PressFade>
  );
}

export function SecondaryButton({ label, onPress, disabled, style }: {
  label: string; onPress?: () => void; disabled?: boolean; style?: ViewStyle;
}) {
  return (
    <PressFade onPress={onPress} disabled={disabled} style={[p.secondary, style as any]}>
      <Text style={p.secondaryText}>{label}</Text>
    </PressFade>
  );
}

// Outlined variant (border 1 ink, ink text, primary metrics) — day sheet
// "Manage this pin", pin detail "Leave pin".
export function OutlinedButton({ label, onPress, muted = false, style }: {
  label: string; onPress?: () => void; muted?: boolean; style?: ViewStyle;
}) {
  return (
    <PressFade onPress={onPress} style={[p.outlined, style as any]}>
      <Text style={[p.secondaryText, muted && { color: tt.muted }]}>{label}</Text>
    </PressFade>
  );
}

export function GhostAction({ label, onPress, style }: {
  label: string; onPress?: () => void; style?: ViewStyle;
}) {
  return (
    <PressFade onPress={onPress} style={[p.ghost, style as any]}>
      <Text style={p.ghostText}>{label}</Text>
    </PressFade>
  );
}

// ─── 5 · MicroLabel ───────────────────────────────────────────────────────────
// 10/700, letterSpacing 1.2, UPPERCASE, color muted.

export function MicroLabel({ children, style }: { children: string; style?: TextStyle }) {
  return <Text style={[p.micro, style]}>{children.toUpperCase()}</Text>;
}

// ─── 6 · BottomSheet ──────────────────────────────────────────────────────────
// radius top 24, grabber 36×4 #e4e4e7 centered marginBottom 16, padding
// 10 top / 20 sides / 34 bottom; scrim rgba(0,0,0,0.5).
// enter: translateY 46→0 + fade, 450ms, bezier(0.16,1,0.3,1).
//
// Implemented on CORE RN Animated, not Reanimated: Reanimated animations can
// stall inside a RN <Modal> (new-arch quirk), which left the sheet invisible
// at opacity 0 with a transparent overlay eating every touch — an
// unmissable "app froze" bug. Core Animated timing callbacks always fire.

export function TTSheet({ visible, onClose, children }: {
  visible: boolean; onClose: () => void; children: React.ReactNode;
}) {
  const [mounted, setMounted] = React.useState(visible);
  const prog = React.useRef(new RNAnimated.Value(0)).current;
  const scrim = React.useRef(new RNAnimated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      setMounted(true);
      RNAnimated.parallel([
        RNAnimated.timing(prog, {
          toValue: 1, duration: 450,
          easing: RNEasing.bezier(0.16, 1, 0.3, 1),
          useNativeDriver: true,
        }),
        RNAnimated.timing(scrim, { toValue: 1, duration: 300, useNativeDriver: true }),
      ]).start();
    } else if (mounted) {
      RNAnimated.parallel([
        RNAnimated.timing(prog, { toValue: 0, duration: 260, useNativeDriver: true }),
        RNAnimated.timing(scrim, { toValue: 0, duration: 260, useNativeDriver: true }),
      ]).start(() => setMounted(false));
    }
  }, [visible]);

  if (!mounted) return null;
  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose}>
      {/* The sheet sits in normal flow after a flex:1 spacer, so padding this
          container lifts it clear of the keyboard. A Modal gets its own native
          window and inherits no keyboard avoidance from the screen behind it. */}
      <KeyboardAvoider style={{ flex: 1 }}>
        <RNAnimated.View
          style={[StyleSheet.absoluteFill, { backgroundColor: tt.scrim, opacity: scrim }]}
          pointerEvents="none"
        />
        <Pressable style={{ flex: 1 }} onPress={onClose} accessibilityLabel="Close sheet" />
        <RNAnimated.View
          style={[p.sheet, {
            opacity: prog,
            transform: [{ translateY: prog.interpolate({ inputRange: [0, 1], outputRange: [46, 0] }) }],
          }]}
        >
          <View style={p.grabber} />
          {children}
        </RNAnimated.View>
      </KeyboardAvoider>
    </Modal>
  );
}

// ─── Entry reveal (rows/cards in) ────────────────────────────────────────────
// opacity + translateY 10→0, 400ms, bezier(0.16,1,0.3,1), delay 40ms × index.
// reduceMotion: skip translations, keep fades ≤ 200ms.

export function RowReveal({ index = 0, children, style }: {
  index?: number; children: React.ReactNode; style?: ViewStyle;
}) {
  const prog = useSharedValue(0);
  const [reduce, setReduce] = React.useState(false);
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduce).catch(() => {});
    prog.value = withDelay(index * 40, withTiming(1, { duration: 400, easing: tt.ease }));
  }, [index]);
  const a = useAnimatedStyle(() => ({
    opacity: reduce ? Math.min(1, prog.value * 2) : prog.value,
    transform: [{ translateY: reduce ? 0 : (1 - prog.value) * 10 }],
  }));
  return <Animated.View style={[a, style]}>{children}</Animated.View>;
}

// Awaiting pulse: opacity loop 1→0.45→1 @2s.
export function Pulse({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  const v = useSharedValue(1);
  useEffect(() => {
    v.value = withRepeat(withSequence(
      withTiming(0.45, { duration: 1000 }),
      withTiming(1, { duration: 1000 }),
    ), -1);
  }, []);
  const a = useAnimatedStyle(() => ({ opacity: v.value }));
  return <Animated.View style={[a, style]}>{children}</Animated.View>;
}

const p = StyleSheet.create({
  primary: {
    backgroundColor: tt.ink, borderRadius: 14, paddingVertical: 15,
    alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8,
  },
  primaryText: { color: tt.white, fontSize: 14, fontWeight: '600' },
  secondary: {
    backgroundColor: tt.surface, borderRadius: 14, paddingVertical: 15,
    alignItems: 'center', justifyContent: 'center',
  },
  outlined: {
    borderWidth: 1, borderColor: tt.ink, borderRadius: 14, paddingVertical: 15,
    alignItems: 'center', justifyContent: 'center',
  },
  secondaryText: { color: tt.ink, fontSize: 14, fontWeight: '600' },
  ghost: { paddingVertical: 10, alignItems: 'center' },
  ghostText: { color: tt.muted, fontSize: 12.5, fontWeight: '500' },
  micro: { fontSize: 10, fontWeight: '700', letterSpacing: 1.2, color: tt.muted },
  sheet: {
    backgroundColor: tt.white, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingTop: 10, paddingHorizontal: 20, paddingBottom: 34,
  },
  grabber: {
    width: 36, height: 4, borderRadius: 2, backgroundColor: tt.hairline,
    alignSelf: 'center', marginBottom: 16,
  },
});
