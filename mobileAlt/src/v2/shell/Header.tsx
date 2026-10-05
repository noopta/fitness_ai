// The shell header: the petal mark top-left (28pt), the page title beside it,
// cross-fading at the swipe midpoint. Tapping the mark goes home from
// anywhere. The mark tints crimson and pulses while Anakin works.

import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { v2, T } from '../theme';
import { Mark } from '../primitives/Mark';
import { useShell } from './ShellContext';

interface Props {
  title: string;
  titleOpacity: SharedValue<number>;
  /** 0 while the orb is the mark (home brief), 1 once it has landed or off home. */
  markOpacity?: SharedValue<number>;
  dark?: boolean;
  /** Right-side caption (e.g. "Base · wk 3", "Working"). */
  caption?: string | null;
  /** Right-side actions for the current page; fades with the title at the swipe midpoint. */
  right?: React.ReactNode;
}

export const HEADER_HEIGHT = 44;
/** Total clearance a page needs above its content: safe-area top + 12 + the bar. */
export const headerClearance = (insetTop: number) => insetTop + 12 + HEADER_HEIGHT;

export function Header({ title, titleOpacity, markOpacity, dark, caption, right }: Props) {
  const insets = useSafeAreaInsets();
  const shell = useShell();
  const t = useAnimatedStyle(() => ({ opacity: titleOpacity.value }));
  const m = useAnimatedStyle(() => ({ opacity: markOpacity ? markOpacity.value : 1 }));
  const isHome = shell.index === 0;
  const showTitle = !isHome;
  return (
    <View style={[styles.wrap, { paddingTop: insets.top + 12, backgroundColor: isHome ? 'transparent' : v2.color.white }]} pointerEvents="box-none">
      <View style={styles.row} pointerEvents="box-none">
        <Pressable onPress={shell.goHome} hitSlop={10} accessibilityLabel="Anakin — home" accessibilityRole="button" style={styles.markWrap}>
          <Animated.View style={m}><Mark working={shell.busy} tone="ink" /></Animated.View>
        </Pressable>
        {showTitle ? (
          <Animated.Text style={[T.captionStrong, { color: dark ? v2.color.darkMuted : v2.color.muted }, t]}>{title}</Animated.Text>
        ) : null}
        <View style={{ flex: 1 }} />
        {caption ? <Text style={[T.caption, { color: dark ? v2.color.darkMuted : v2.color.muted }]}>{caption}</Text> : null}
        {right && !isHome ? <Animated.View style={t}>{right}</Animated.View> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', top: 0, left: 0, right: 0, paddingHorizontal: v2.space.gutter },
  row: { height: HEADER_HEIGHT, flexDirection: 'row', alignItems: 'center', gap: 12 },
  markWrap: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center', marginLeft: -2 },
});
