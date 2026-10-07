// Text-arrow CTA: `Begin →` / `Keep`. 17/600, no fill.
//
// `primary` renders crimson — the one primary action on a screen. `Keep`
// (declines) are plain ink. `solid` is the one solid black button allowed in
// onboarding (the paywall's "Start free week").

import React from 'react';
import { Text, StyleSheet, View, ActivityIndicator, type StyleProp, type ViewStyle } from 'react-native';
import { Pressable } from './Pressable';
import { v2, T } from '../theme';
import { haptics } from '../haptics';

interface Props {
  children: React.ReactNode;
  primary?: boolean;
  muted?: boolean;
  size?: number;
  onPress?: () => void;
  disabled?: boolean;
  arrow?: boolean;
  tone?: 'light' | 'dark';
  style?: StyleProp<ViewStyle>;
  /** The solid pill. Only once per flow. */
  solid?: boolean;
  loading?: boolean;
  testID?: string;
}

export function TextAction({ children, primary, muted, size = 17, onPress, disabled, arrow = true, tone = 'light', style, solid, loading, testID }: Props) {
  const color = solid
    ? v2.color.white
    : primary ? v2.color.crimson
    : muted ? (tone === 'dark' ? v2.color.darkMuted : v2.color.muted)
    : tone === 'dark' ? v2.color.darkInk : v2.color.ink;
  const label = typeof children === 'string' && arrow && !solid && !/[→↑]$/.test(children.trim()) ? `${children} →` : children;
  return (
    <Pressable
      onPress={() => { if (disabled || loading) return; haptics.light(); onPress?.(); }}
      disabled={disabled}
      accessibilityRole="button"
      testID={testID}
      style={({ pressed }) => [solid ? styles.solid : styles.text, { opacity: disabled ? 0.35 : pressed ? 0.6 : 1 }, style]}
    >
      {loading ? <ActivityIndicator color={color} /> : (
        <Text style={[{ fontFamily: v2.font.semibold, fontSize: size, lineHeight: size * 1.3, color }]}>{label}</Text>
      )}
    </Pressable>
  );
}

/** Two text actions side by side: Apply → / Keep. */
export function ActionPair({ primaryLabel, onPrimary, secondaryLabel = 'Keep', onSecondary, tone }: { primaryLabel: string; onPrimary: () => void; secondaryLabel?: string; onSecondary?: () => void; tone?: 'light' | 'dark' }) {
  return (
    <View style={styles.pair}>
      <TextAction primary onPress={onPrimary} tone={tone}>{primaryLabel}</TextAction>
      {onSecondary ? <TextAction muted arrow={false} onPress={onSecondary} tone={tone}>{secondaryLabel}</TextAction> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  text: { alignSelf: 'flex-start', paddingVertical: 6 },
  solid: { height: 56, borderRadius: v2.radius.pill, backgroundColor: v2.color.ink, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28 },
  pair: { flexDirection: 'row', alignItems: 'center', gap: 24, marginTop: 12 },
});
