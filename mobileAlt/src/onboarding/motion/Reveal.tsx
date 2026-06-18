import React, { useEffect } from 'react';
import { AccessibilityInfo } from 'react-native';
import Animated, {
  useSharedValue, useAnimatedStyle, withTiming, withDelay,
} from 'react-native-reanimated';
import { MOTION, DEFAULT_MOTION, type MotionName } from '../theme';

interface Props {
  index?: number;          // stagger position (0 = first)
  motion?: MotionName;
  children: React.ReactNode;
  style?: any;
}

/**
 * Per spec §7.1. Wraps a content element; on mount tweens opacity 0→1,
 * translateY(m.y)→0, scale(m.scale)→1, delayed by index × m.stagger.
 * Replay on scene change is handled by giving the parent scene a `key`
 * tied to the active page index so each entry remounts.
 *
 * Reduce-motion: skips the animation entirely (instant final state).
 */
export function Reveal({ index = 0, motion = DEFAULT_MOTION, children, style }: Props) {
  const m = MOTION[motion];
  const p = useSharedValue(0);

  useEffect(() => {
    // Animate in immediately so content is NEVER stuck invisible. Previously the
    // tween only ran inside AccessibilityInfo.isReduceMotionEnabled().then(),
    // with no .catch — if that promise hung/rejected, opacity stayed 0 and the
    // whole text block vanished. Now we start the reveal up front and only snap
    // to the final state if reduce-motion turns out to be on.
    p.value = withDelay(
      index * m.stagger,
      withTiming(1, { duration: m.dur, easing: m.ease }),
    );
    AccessibilityInfo.isReduceMotionEnabled()
      .then((reduced) => { if (reduced) p.value = 1; })
      .catch(() => {});
  }, [index]);

  const a = useAnimatedStyle(() => ({
    opacity: p.value,
    transform: [
      { translateY: (1 - p.value) * m.y },
      { scale: m.scale + (1 - m.scale) * p.value },
    ],
  }));

  return <Animated.View style={[a, style]}>{children}</Animated.View>;
}
