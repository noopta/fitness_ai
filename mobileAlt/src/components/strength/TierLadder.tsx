import React, { useEffect } from 'react';
import { View, ViewStyle } from 'react-native';
import Animated, {
  useSharedValue, useAnimatedStyle, withDelay, withTiming, Easing, useReducedMotion,
  SharedValue,
} from 'react-native-reanimated';

interface Props {
  /** 1..6 — index of the current tier. 0 = none yet (empty state). */
  tierIndex: number;
  /** Total tiers. Defaults to 6. The spec is fixed at 6 — we don't allow
   *  arbitrary counts because the segment hooks below are unrolled. */
  total?: 6;
  /** Override segment color. Defaults to white (works on the dark hero card). */
  fillColor?: string;
  /** Background of unfilled segments. */
  trackColor?: string;
}

/**
 * Six-segment tier ladder. Each filled segment scales 0 → 1 on the X axis
 * (transformOrigin: 0% 50%), staggered by 60ms × index. Honors
 * useReducedMotion (snaps to final state in 80ms).
 *
 * Hooks are unrolled (six explicit useSharedValue calls) rather than
 * Array.from(...).map() to keep React 19 + Reanimated 4 happy — calling
 * hooks inside a loop callback creates ordering risk under strict mode.
 */
export function TierLadder({
  tierIndex,
  total = 6,
  fillColor = '#FFFFFF',
  trackColor = 'rgba(255,255,255,0.16)',
}: Props) {
  const reducedMotion = useReducedMotion();
  const s0 = useSharedValue(0);
  const s1 = useSharedValue(0);
  const s2 = useSharedValue(0);
  const s3 = useSharedValue(0);
  const s4 = useSharedValue(0);
  const s5 = useSharedValue(0);
  const fills: SharedValue<number>[] = [s0, s1, s2, s3, s4, s5];

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
  // fills is stable across renders — six SharedValues bound by hook calls.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tierIndex, reducedMotion]);

  return (
    <View
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 1, max: total, now: Math.max(1, tierIndex) }}
      style={styles.row}
    >
      <Segment sv={s0} fillColor={fillColor} trackColor={trackColor} />
      <Segment sv={s1} fillColor={fillColor} trackColor={trackColor} />
      <Segment sv={s2} fillColor={fillColor} trackColor={trackColor} />
      <Segment sv={s3} fillColor={fillColor} trackColor={trackColor} />
      <Segment sv={s4} fillColor={fillColor} trackColor={trackColor} />
      <Segment sv={s5} fillColor={fillColor} trackColor={trackColor} />
    </View>
  );
}

function Segment({
  sv,
  fillColor,
  trackColor,
}: {
  sv: SharedValue<number>;
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
          // CSS-style transform-origin string — works in RN 0.76+ which
          // accepts the same syntax as the web. Anchors the scaleX at the
          // left edge so the segment fills L→R.
          { backgroundColor: fillColor, transformOrigin: '0% 50%' },
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
