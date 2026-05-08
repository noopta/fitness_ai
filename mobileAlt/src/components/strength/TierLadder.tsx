import React, { useEffect } from 'react';
import { View, ViewStyle } from 'react-native';
import Animated, {
  useSharedValue, useAnimatedStyle, withDelay, withTiming, Easing, useReducedMotion,
} from 'react-native-reanimated';

interface Props {
  /** 1..6 — index of the current tier. 0 = none yet (empty state). */
  tierIndex: number;
  /** Total tiers. Defaults to 6 per the handoff. */
  total?: number;
  /** Override segment color. Defaults to white (works on the dark hero card). */
  fillColor?: string;
  /** Background of unfilled segments. */
  trackColor?: string;
}

/**
 * Six-segment "ladder" that visualizes which tier you're on. Each filled
 * segment scales 0 → 1 on the X axis (transformOrigin: left), staggered
 * by index. Honors useReducedMotion (snaps to final state in 80ms).
 */
export function TierLadder({
  tierIndex,
  total = 6,
  fillColor = '#FFFFFF',
  trackColor = 'rgba(255,255,255,0.16)',
}: Props) {
  const reducedMotion = useReducedMotion();
  // One shared value per segment. We always create `total` of them; the rules
  // of hooks are happy because `total` is stable across renders.
  const fills = Array.from({ length: total }, () => useSharedValue(0));

  useEffect(() => {
    fills.forEach((sv, i) => {
      const target = i < tierIndex ? 1 : 0;
      if (reducedMotion) {
        sv.value = withTiming(target, { duration: 80 });
        return;
      }
      sv.value = withDelay(
        i * 60,
        withTiming(target, {
          duration: 240,
          easing: Easing.bezier(0.2, 0.7, 0.3, 1),
        })
      );
    });
  // fills is stable; don't include it.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tierIndex, total, reducedMotion]);

  return (
    <View
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 1, max: total, now: Math.max(1, tierIndex) }}
      style={styles.row}
    >
      {fills.map((sv, i) => (
        <Segment key={i} sv={sv} fillColor={fillColor} trackColor={trackColor} />
      ))}
    </View>
  );
}

function Segment({
  sv,
  fillColor,
  trackColor,
}: {
  sv: { value: number };
  fillColor: string;
  trackColor: string;
}) {
  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scaleX: sv.value }],
  }));
  return (
    <View style={[styles.segment, { backgroundColor: trackColor }]}>
      <Animated.View
        style={[
          styles.fill,
          { backgroundColor: fillColor, transformOrigin: 'left' as any },
          animStyle,
        ]}
      />
    </View>
  );
}

const styles = {
  row: { flexDirection: 'row' as const, gap: 4 },
  segment: { flex: 1, height: 6, borderRadius: 999, overflow: 'hidden' as const } as ViewStyle,
  fill: { width: '100%' as const, height: '100%' as const },
};
