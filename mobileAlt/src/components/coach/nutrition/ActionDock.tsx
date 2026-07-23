// Floating action dock — 4 buttons (Describe / Snap / Voice / Manual) above
// the bottom tab bar. Spec: handoff §06.
//
// Slot four is "Manual" entry — direct macro entry that skips the LLM
// parser. Replaced the v1 "Suggest" slot because suggested meals were
// noisy in user testing and people who already knew their numbers wanted
// a fast typed-entry path. Keyboard avoidance is handled at the screen
// level — when an inspector input is focused the dock hides via a hidden
// prop.

import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  useDerivedValue,
  withTiming,
  Easing,
  useReducedMotion,
  runOnJS,
  type SharedValue,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { fontWeight } from '../../../constants/theme';

export type DockAction = 'describe' | 'snap' | 'voice' | 'manual' | 'barcode' | 'order' | 'recipe';

interface Props {
  onAction: (action: DockAction) => void;
  /** When true, the dock is animated out (e.g. keyboard is open). */
  hidden?: boolean;
  /** Scroll-driven hide (0 show / 1 hide), written by DayTimeline's
   *  UI-thread scroll handler — never round-trips through JS state. */
  scrollHide?: SharedValue<number>;
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

export function ActionDock({ onAction, hidden, scrollHide }: Props) {
  const reduced = useReducedMotion();
  // Two-level island: the main row keeps the four everyday actions; "More"
  // swaps the island's contents in place (cross-fade) for the secondary
  // actions (Order / Voice) with a back chevron. Six buttons in one row
  // wrapped labels onto two lines — user feedback 2026-07-22.
  const [page, setPage] = useState<'main' | 'more'>('main');
  const pageFade = useSharedValue(1);

  const switchPage = (next: 'main' | 'more') => {
    if (reduced) { setPage(next); return; }
    pageFade.value = withTiming(0, { duration: 90 }, () => {
      runOnJS(setPage)(next);
      pageFade.value = withTiming(1, { duration: 160, easing: Easing.bezier(0.16, 1, 0.3, 1) });
    });
  };

  // Keyboard-driven hide still arrives as a prop; scroll-driven hide arrives
  // as a shared value written on the UI thread. Mixing them in a derived
  // value keeps the slide fully off the JS thread — the old
  // scrollEvent→setState→effect chain visibly stuttered in dev builds.
  const OFFSCREEN = DOCK_HEIGHT * 0.9 + 14; // + the dock's bottom margin
  const keyboardHidden = useSharedValue(hidden ? 1 : 0);
  useEffect(() => {
    keyboardHidden.value = hidden ? 1 : 0;
    // Reset to the main row whenever the dock hides — reappearing on the
    // "More" page would be disorienting.
    if (hidden) setPage('main');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hidden]);

  const progress = useDerivedValue(() => {
    const target = Math.max(keyboardHidden.value, scrollHide?.value ?? 0);
    return reduced
      ? target
      : withTiming(target, { duration: 200, easing: Easing.bezier(0.25, 0.1, 0.25, 1) });
  }, [reduced]);

  const style = useAnimatedStyle(() => ({
    transform: [{ translateY: progress.value * OFFSCREEN }],
  }));
  const fadeStyle = useAnimatedStyle(() => ({ opacity: pageFade.value }));

  // Fire the action, then snap the island back to the main row so it's
  // ready for the next open.
  const act = (a: DockAction) => { setPage('main'); onAction(a); };

  return (
    <Animated.View style={[styles.dock, style]} pointerEvents={hidden ? 'none' : 'box-none'}>
      <Animated.View style={[styles.bar, fadeStyle]}>
        {page === 'main' ? (
          <>
            <DockButton label="Describe" icon="sparkles-outline" onPress={() => act('describe')} />
            <DockButton label="Snap"     icon="camera-outline"  onPress={() => act('snap')} />
            <DockButton label="Scan"     icon="barcode-outline" onPress={() => act('barcode')} />
            <DockButton label="Manual"   icon="create-outline"  onPress={() => act('manual')} />
            <DockButton label="More"     icon="ellipsis-horizontal" onPress={() => switchPage('more')} />
          </>
        ) : (
          <>
            <Pressable
              onPress={() => switchPage('main')}
              style={styles.backBtn}
              accessibilityRole="button"
              accessibilityLabel="Back to main logging options"
            >
              <Ionicons name="chevron-back" size={16} color="#ffffff" />
            </Pressable>
            <DockButton label="Order · receipt" icon="receipt-outline" onPress={() => act('order')} />
            <DockButton label="Voice"           icon="mic-outline"     onPress={() => act('voice')} />
            <DockButton label="Recipe"          icon="book-outline"    onPress={() => act('recipe')} />
          </>
        )}
      </Animated.View>
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
    // Bumped from padding:6 / gap:4 to give each tile breathing room — at
    // five dock items the icons were sitting right at the bar's edge and
    // looked cramped per user feedback.
    paddingHorizontal: 10,
    paddingVertical: 8,
    flexDirection: 'row',
    gap: 6,
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
  backBtn: {
    width: 44, height: 46, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  btnGhost:   { backgroundColor: 'transparent' },
  btnLabel: {
    fontSize: 11,
    fontWeight: fontWeight.bold,
    letterSpacing: -0.1,
  },
});
