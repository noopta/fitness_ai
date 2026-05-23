// Floating action dock — 4 buttons (Describe / Snap / Voice / Manual) above
// the bottom tab bar. Spec: handoff §06.
//
// Slot four is "Manual" entry — direct macro entry that skips the LLM
// parser. Replaced the v1 "Suggest" slot because suggested meals were
// noisy in user testing and people who already knew their numbers wanted
// a fast typed-entry path. Keyboard avoidance is handled at the screen
// level — when an inspector input is focused the dock hides via a hidden
// prop.

import React, { useEffect } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  Easing,
  useReducedMotion,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { fontWeight } from '../../../constants/theme';

export type DockAction = 'describe' | 'snap' | 'voice' | 'manual';

interface Props {
  onAction: (action: DockAction) => void;
  /** When true, the dock is animated out (e.g. keyboard is open). */
  hidden?: boolean;
}

function DockButton({
  label, icon, primary, onPress,
}: {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  primary?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.btn,
        primary ? styles.btnPrimary : styles.btnGhost,
        primary && { flex: 1.4 },
        pressed && primary && { transform: [{ scale: 0.98 }] },
      ]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Ionicons name={icon} size={14} color={primary ? '#09090b' : '#ffffff'} />
      <Text style={[styles.btnLabel, { color: primary ? '#09090b' : '#ffffff' }]}>
        {label}
      </Text>
    </Pressable>
  );
}

/** Approx dock height; used to compute the off-screen translation. */
const DOCK_HEIGHT = 58;

export function ActionDock({ onAction, hidden }: Props) {
  const reduced = useReducedMotion();
  // Translate the whole dock off-screen by 90% of its height when `hidden`
  // (e.g. timeline scrolled down past 240pt, or the keyboard is up). Spec §06
  // calls for an 80% peek when scroll-driven; we go a touch further so the
  // dock fully leaves the safe-area without grazing the tab bar.
  const tY = useSharedValue(0);
  useEffect(() => {
    const target = hidden ? DOCK_HEIGHT * 0.9 + 14 /* + the dock's bottom margin */ : 0;
    tY.value = reduced
      ? target
      : withTiming(target, { duration: 200, easing: Easing.bezier(0.25, 0.1, 0.25, 1) });
  }, [hidden, reduced]);

  const style = useAnimatedStyle(() => ({ transform: [{ translateY: tY.value }] }));

  return (
    <Animated.View style={[styles.dock, style]} pointerEvents={hidden ? 'none' : 'box-none'}>
      <View style={styles.bar}>
        <DockButton label="Describe" icon="sparkles-outline" primary onPress={() => onAction('describe')} />
        <DockButton label="Snap"     icon="camera-outline"            onPress={() => onAction('snap')} />
        <DockButton label="Voice"    icon="mic-outline"               onPress={() => onAction('voice')} />
        <DockButton label="Manual"   icon="create-outline"            onPress={() => onAction('manual')} />
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  dock: {
    position: 'absolute',
    left: 14, right: 14, bottom: 14,
  },
  bar: {
    backgroundColor: '#09090b',
    borderRadius: 16,
    padding: 6,
    flexDirection: 'row',
    gap: 4,
    // Per-platform shadows in the wider app are managed in theme; inline here
    // because no other dark surface gets this elevation.
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.4,
    shadowRadius: 22,
    elevation: 12,
  },
  btn: {
    flex: 1,
    height: 46,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 6,
  },
  btnPrimary: { backgroundColor: '#ffffff' },
  btnGhost:   { backgroundColor: 'transparent' },
  btnLabel: {
    fontSize: 11,
    fontWeight: fontWeight.bold,
    letterSpacing: -0.1,
  },
});
