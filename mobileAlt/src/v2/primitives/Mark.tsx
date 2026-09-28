// Anakin's presence mark — the petal. Ink at rest, crimson and pulsing
// (opacity 1→.25→1, 1.6s) while working. Never in a circle, never the old "A".

import React, { useEffect } from 'react';
import { Image, type ImageStyle, type StyleProp } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withRepeat, withTiming, withSequence, Easing, cancelAnimation, useReducedMotion } from 'react-native-reanimated';
import { v2 } from '../theme';

const MARK = require('../../../assets/v2/axiom-mark.png');

interface Props {
  working?: boolean;
  size?: number;
  /** Ink on light surfaces (default); 'light' renders the mark white for dark grounds. */
  tone?: 'ink' | 'light' | 'muted';
  style?: StyleProp<ImageStyle>;
}

export function Mark({ working = false, size = 28, tone = 'ink', style }: Props) {
  const op = useSharedValue(1);
  const reduced = useReducedMotion();
  useEffect(() => {
    if (working && !reduced) {
      op.value = withRepeat(withSequence(
        withTiming(0.25, { duration: v2.motion.pulse / 2, easing: Easing.inOut(Easing.ease) }),
        withTiming(1, { duration: v2.motion.pulse / 2, easing: Easing.inOut(Easing.ease) }),
      ), -1, false);
    } else {
      cancelAnimation(op);
      op.value = withTiming(1, { duration: 200 });
    }
  }, [working, reduced, op]);
  const anim = useAnimatedStyle(() => ({ opacity: op.value }));
  const tint = working ? v2.color.crimson : tone === 'light' ? v2.color.darkInk : tone === 'muted' ? v2.color.muted : v2.color.ink;
  return (
    <Animated.View style={anim}>
      <Image source={MARK} style={[{ width: size, height: size, tintColor: tint }, style]} resizeMode="contain" accessibilityLabel="Anakin" />
    </Animated.View>
  );
}
