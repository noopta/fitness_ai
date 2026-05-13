import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue, useAnimatedStyle, withRepeat, withSequence, withTiming, Easing,
  cancelAnimation,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { colors, fontSize, fontWeight, spacing } from '../../constants/theme';

// Cycle through a few motivational micro-copies during refresh so a slow
// upstream PubMed fetch (5-12s) feels intentional rather than stuck.
const MESSAGES = [
  'Curling fresh research…',
  'Loading new gains…',
  'Lifting the latest insights…',
  'Warming up your feed…',
  'Pumping new content…',
];

interface Props {
  /** Drives the animation. Pass through your refreshing state directly. */
  visible: boolean;
}

/**
 * Pull-to-refresh overlay that replaces the boring native spinner with a
 * pumping dumbbell + rotating motivational copy. Renders ABOVE the scroll
 * content (absolute, top of feed) and only when `visible` is true.
 *
 * Why a custom overlay instead of replacing RefreshControl: iOS uses native
 * UIRefreshControl which is essentially uncustomizable. Layering this on top
 * gives us a branded animation across both platforms with one component.
 */
export function FunRefreshIndicator({ visible }: Props) {
  // The indicator was clipping at the top because it positioned at top: spacing.md
  // inside an absolutely-positioned wrapper, which ignored the safe area inset on
  // notched devices and pushed the pill behind the status bar / dynamic island.
  // We now offset below the top inset.
  const insets = useSafeAreaInsets();
  const scale = useSharedValue(1);
  const rotate = useSharedValue(0);
  const [msgIdx, setMsgIdx] = useState(0);

  useEffect(() => {
    if (!visible) {
      cancelAnimation(scale);
      cancelAnimation(rotate);
      scale.value = 1;
      rotate.value = 0;
      return;
    }
    // Pump (scale up/down) — like a curl rep.
    scale.value = withRepeat(
      withSequence(
        withTiming(1.18, { duration: 380, easing: Easing.out(Easing.quad) }),
        withTiming(1.0, { duration: 380, easing: Easing.in(Easing.quad) }),
      ),
      -1,
      false,
    );
    // Subtle wiggle — a few degrees each direction.
    rotate.value = withRepeat(
      withSequence(
        withTiming(-8, { duration: 380, easing: Easing.inOut(Easing.quad) }),
        withTiming(8, { duration: 380, easing: Easing.inOut(Easing.quad) }),
      ),
      -1,
      true,
    );
  }, [visible, scale, rotate]);

  // Cycle the message every ~1.6s while the indicator is up.
  useEffect(() => {
    if (!visible) return;
    setMsgIdx(Math.floor(Math.random() * MESSAGES.length));
    const id = setInterval(() => setMsgIdx(i => (i + 1) % MESSAGES.length), 1600);
    return () => clearInterval(id);
  }, [visible]);

  const iconStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }, { rotate: `${rotate.value}deg` }],
  }));

  if (!visible) return null;

  return (
    <View
      pointerEvents="none"
      style={[styles.container, { top: insets.top + spacing.sm }]}
    >
      <View style={styles.pill}>
        <Animated.View style={iconStyle}>
          <Ionicons name="barbell" size={22} color={colors.primary} />
        </Animated.View>
        <Text style={styles.text}>{MESSAGES[msgIdx]}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    // `top` is set dynamically using safe-area insets in the component above.
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 10,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    borderRadius: 999,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  text: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    color: colors.foreground,
  },
});
