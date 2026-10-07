// Frosted icon-only tab bar: a 300×56 pill, 28pt from the bottom, five 22pt
// stroke icons, no labels, no badges. A crimson pill behind the active icon
// slides fractionally with the finger. The only blur in the app.

import React from 'react';
import { View, StyleSheet, Platform } from 'react-native';
import { Pressable } from './Pressable';
import { BlurView } from 'expo-blur';
import Svg, { Path } from 'react-native-svg';
import Animated, { useAnimatedStyle, interpolateColor, type SharedValue } from 'react-native-reanimated';
import { v2 } from '../theme';
import { PAGE_COUNT } from '@axiom/agent-ui-core';
import { haptics } from '../haptics';

/** Lucide-style 24-unit paths from the prototype's TABS. */
export const TAB_ICONS: { name: string; d: string }[] = [
  { name: 'Anakin', d: 'M21 12a8 8 0 0 1-8 8H8l-4 3v-3.5A8 8 0 1 1 21 12z' },
  { name: 'Training', d: 'M4 6h16M4 12h16M4 18h10' },
  { name: 'Fuel', d: 'M12 3v18M5 8c0 4 3 7 7 7s7-3 7-7' },
  { name: 'Feed', d: 'M16 18a4 4 0 0 0-8 0M12 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM20 18a3 3 0 0 0-3-3M4 18a3 3 0 0 1 3-3' },
  { name: 'You', d: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0' },
];

const INNER = v2.tabBar.width - 8; // 292 — five slots of 58.4
const SLOT = INNER / PAGE_COUNT;
const PILL_W = 52, PILL_H = 40;

interface Props {
  /** Fractional position 0..4 (shared value so the pill follows the finger on the UI thread). */
  position: SharedValue<number>;
  /** Nearest page for icon colouring. */
  active: number;
  onSelect: (index: number) => void;
  /** Dark ground (home brief). */
  dark?: boolean;
  /** Slide the bar out (chat). */
  hidden?: SharedValue<number>;
  /** 1 = dark frosted (home brief), 0 = white frosted. */
  darkness?: SharedValue<number>;
}

export function TabBar({ position, active, onSelect, dark, hidden, darkness }: Props) {
  // Inline: this runs on the UI thread, and only worklets may be called there.
  // Mirrors pillOffset() in @axiom/agent-ui-core/track (tested).
  const pill = useAnimatedStyle(() => {
    const p = Math.max(0, Math.min(PAGE_COUNT - 1, position.value));
    return { transform: [{ translateX: p * SLOT + (SLOT - PILL_W) / 2 }] };
  });
  const bar = useAnimatedStyle(() => ({ transform: [{ translateY: hidden ? hidden.value * 140 : 0 }] }));
  const frost = useAnimatedStyle(() => {
    const d = darkness ? darkness.value : (dark ? 1 : 0);
    return {
      backgroundColor: interpolateColor(d, [0, 1], [v2.color.tabBarLight, v2.color.tabBarDark]),
      borderColor: interpolateColor(d, [0, 1], [v2.color.hairline, 'rgba(255,255,255,.1)']),
    };
  });
  return (
    <Animated.View style={[styles.wrap, bar]} pointerEvents="box-none">
      <Animated.View style={[styles.bar, v2.shadow.tabBar, frost]}>
        {Platform.OS === 'ios' ? (
          <BlurView intensity={20} tint={dark ? 'dark' : 'light'} style={[StyleSheet.absoluteFill, { borderRadius: v2.radius.pill }]} />
        ) : null}
        <Animated.View style={[styles.pill, pill]} />
        <View style={styles.icons}>
          {TAB_ICONS.map((t, i) => {
            const color = i === active ? v2.color.white : dark ? v2.color.darkMuted : v2.color.muted;
            return (
              <Pressable key={t.name} onPress={() => { haptics.select(); onSelect(i); }} style={styles.slot} accessibilityRole="tab" accessibilityLabel={t.name} accessibilityState={{ selected: i === active }} hitSlop={6}>
                <Svg width={v2.tabBar.icon} height={v2.tabBar.icon} viewBox="0 0 24 24" fill="none">
                  <Path d={t.d} stroke={color} strokeWidth={v2.tabBar.stroke} strokeLinecap="round" strokeLinejoin="round" />
                </Svg>
              </Pressable>
            );
          })}
        </View>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, bottom: v2.tabBar.bottom, alignItems: 'center' },
  bar: { width: v2.tabBar.width, height: v2.tabBar.height, borderRadius: v2.radius.pill, borderWidth: 1, overflow: 'hidden', justifyContent: 'center' },
  pill: { position: 'absolute', left: 4, top: (v2.tabBar.height - PILL_H) / 2 - 1, width: PILL_W, height: PILL_H, borderRadius: v2.radius.pill, backgroundColor: v2.color.crimson },
  icons: { flexDirection: 'row', paddingHorizontal: 4 },
  slot: { width: SLOT, height: v2.tabBar.height - 2, alignItems: 'center', justifyContent: 'center' },
});
