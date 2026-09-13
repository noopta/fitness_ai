import React from 'react';
import { Text, View, StyleSheet, TouchableOpacity, type TextStyle, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, { withTiming } from 'react-native-reanimated';
import { DX, parseRich } from '@axiom/diagnostic-core';

const C = DX.color;

/** Anakin's markup (*em*, **strong**) as nested Text. */
export function RichText({ text, style }: { text: string; style?: StyleProp<TextStyle> }) {
  return (
    <Text style={style}>
      {parseRich(text).map((seg, i) => (
        <Text key={i} style={[seg.em && styles.em, seg.strong && styles.strong]}>
          {seg.text}
        </Text>
      ))}
    </Text>
  );
}

export function Monogram({ size = 32 }: { size?: number }) {
  return (
    <View style={[styles.monogram, { width: size, height: size, borderRadius: size / 2 }]}>
      <Text style={[styles.monogramText, { fontSize: size * 0.44 }]}>A</Text>
    </View>
  );
}

/** 46×46 ink circle, arrow-right 18. Disabled = opacity .35. */
export function SendButton({ onPress, disabled, label = 'Send' }: { onPress: () => void; disabled?: boolean; label?: string }) {
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.8}
      style={[styles.send, disabled && { opacity: DX.send.disabledOpacity }]}
    >
      <Ionicons name="arrow-forward" size={DX.send.icon} color={C.white} />
    </TouchableOpacity>
  );
}

export function Chip({ label, onPress, active, disabled }: { label: string; onPress: () => void; active?: boolean; disabled?: boolean }) {
  return (
    <TouchableOpacity
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.7}
      style={[styles.chip, active && styles.chipActive, disabled && { opacity: DX.send.disabledOpacity }]}
    >
      <Text style={[styles.chipText, active && { color: C.white }]}>{label}</Text>
    </TouchableOpacity>
  );
}

export function InkButton({
  label, onPress, disabled, style, icon, inverse,
}: { label: string; onPress: () => void; disabled?: boolean; style?: StyleProp<ViewStyle>; icon?: keyof typeof Ionicons.glyphMap; inverse?: boolean }) {
  return (
    <TouchableOpacity
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.85}
      style={[styles.inkButton, inverse && { backgroundColor: C.white }, disabled && { opacity: DX.send.disabledOpacity }, style]}
    >
      {icon ? <Ionicons name={icon} size={18} color={inverse ? C.ink : C.white} style={{ marginRight: 6 }} /> : null}
      <Text style={[styles.inkButtonText, inverse && { color: C.ink }]}>{label}</Text>
    </TouchableOpacity>
  );
}

export function OutlineButton({ label, onPress, disabled, style }: { label: string; onPress: () => void; disabled?: boolean; style?: StyleProp<ViewStyle> }) {
  return (
    <TouchableOpacity
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.7}
      style={[styles.outlineButton, disabled && { opacity: DX.send.disabledOpacity }, style]}
    >
      <Text style={styles.outlineButtonText}>{label}</Text>
    </TouchableOpacity>
  );
}

export function QuietButton({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <TouchableOpacity accessibilityRole="button" onPress={onPress} disabled={disabled} hitSlop={10} style={disabled && { opacity: DX.send.disabledOpacity }}>
      <Text style={styles.quiet}>{label}</Text>
    </TouchableOpacity>
  );
}

export function Eyebrow({ children, style }: { children: React.ReactNode; style?: StyleProp<TextStyle> }) {
  return <Text style={[styles.eyebrow, style]}>{children}</Text>;
}

/** Bubble in: 240ms fade + 10px rise. Cards: 300ms. */
export function riseIn(duration: number) {
  return () => {
    'worklet';
    return {
      initialValues: { opacity: 0, transform: [{ translateY: DX.motion.bubbleRise }] },
      animations: {
        opacity: withTiming(1, { duration }),
        transform: [{ translateY: withTiming(0, { duration }) }],
      },
    };
  };
}

export const AnimatedView = Animated.View;

export const styles = StyleSheet.create({
  em: { fontStyle: 'italic' },
  strong: { fontWeight: '700', color: C.ink },
  monogram: { backgroundColor: C.ink, alignItems: 'center', justifyContent: 'center' },
  monogramText: { color: C.white, fontWeight: '700', letterSpacing: -0.3 },
  send: {
    width: DX.send.size,
    height: DX.send.size,
    borderRadius: DX.send.size / 2,
    backgroundColor: C.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chip: {
    paddingVertical: DX.chip.padV,
    paddingHorizontal: DX.chip.padH,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.white,
  },
  chipActive: { backgroundColor: C.ink, borderColor: C.ink },
  chipText: { fontSize: DX.chip.fontSize, fontWeight: '600', color: C.ink },
  inkButton: {
    minHeight: 48,
    borderRadius: 999,
    backgroundColor: C.ink,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    paddingHorizontal: 20,
  },
  inkButtonText: { color: C.white, fontSize: 15, fontWeight: '600' },
  outlineButton: {
    minHeight: 48,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.white,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  outlineButtonText: { color: C.body, fontSize: 15, fontWeight: '600' },
  quiet: { color: C.muted, fontSize: 14, fontWeight: '600', paddingVertical: 6 },
  eyebrow: { fontSize: 10, fontWeight: '600', letterSpacing: 0.8, textTransform: 'uppercase', color: C.muted },
});
