// Frosted icon-only tab bar: a 300×56 pill, 28pt from the bottom, five 22pt
// stroke icons, no labels, no badges. A crimson pill behind the active icon
// slides fractionally with the finger. The only blur in the app.

import React from 'react';
import { View, Pressable, StyleSheet, Platform } from 'react-native';
import { BlurView } from 'expo-blur';
import Svg, { Path } from 'react-native-svg';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';
import { v2 } from '../theme';
import { PAGE_COUNT, pillOffset } from '@axiom/agent-ui-core';
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
}

export function TabBar({ position, active, onSelect, dark, hidden }: Props) {
  const pill = useAnimatedStyle(() => ({ transform: [{ translateX: pillOffset(position.value, INNER) }] }));
  const bar = useAnimatedStyle(() => ({ transform: [{ translateY: hidden ? hidden.value * 140 : 0 }] }));
  const ground = dark ? v2.color.tabBarDark : v2.color.tabBarLight;
  const border = dark ? 'rgba(255,255,255,.1)' : v2.color.hairline;
  return (
    <Animated.View style={[styles.wrap, bar]} pointerEvents="box-none">
      <View style={[styles.bar, { borderColor: border, backgroundColor: Platform.OS === 'ios' ? 'transparent' : ground }, v2.shadow.tabBar]}>
        {Platform.OS === 'ios' ? (
          <BlurView intensity={20} tint={dark ? 'dark' : 'light'} style={[StyleSheet.absoluteFill, { borderRadius: v2.radius.pill, backgroundColor: ground }]} />
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
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, bottom: v2.tabBar.bottom, alignItems: 'center' },
  bar: { width: v2.tabBar.width, height: v2.tabBar.height, borderRadius: v2.radius.pill, borderWidth: 1, overflow: 'hidden', justifyContent: 'center' },
  pill: { position: 'absolute', left: 4, top: 4, width: SLOT, height: v2.tabBar.height - 8, borderRadius: v2.radius.pill, backgroundColor: v2.color.crimson },
  icons: { flexDirection: 'row', paddingHorizontal: 4 },
  slot: { width: SLOT, height: v2.tabBar.height - 2, alignItems: 'center', justifyContent: 'center' },
});
