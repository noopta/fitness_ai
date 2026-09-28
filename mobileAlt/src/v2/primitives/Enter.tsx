// Enter / exit motion. Everything enters; nothing pops.
//
// Enter: opacity 0→1, translateY 8→0, 450ms, cubic-bezier(.16,1,.3,1),
// siblings stagger 90ms. Exit: →0, translateY −14, 300ms. Reduce Motion
// drops the translate and keeps a 150ms fade.

import React from 'react';
import Animated, { FadeIn, FadeInDown, FadeOutUp, useReducedMotion, type AnimatedProps } from 'react-native-reanimated';
import type { ViewProps } from 'react-native';
import { v2 } from '../theme';

interface Props extends AnimatedProps<ViewProps> {
  /** Sibling index for stagger. */
  index?: number;
  /** Extra delay in ms, added to the stagger. */
  delay?: number;
  /** Animate out on unmount (default true). */
  exit?: boolean;
  children?: React.ReactNode;
}

export function Enter({ index = 0, delay = 0, exit = true, children, ...rest }: Props) {
  const reduced = useReducedMotion();
  const total = delay + index * v2.motion.stagger;
  const entering = reduced
    ? FadeIn.duration(150).delay(total)
    : FadeInDown.duration(v2.motion.enter).delay(total).easing(v2.motion.easeEnter).withInitialValues({ opacity: 0, transform: [{ translateY: 8 }] });
  const exiting = exit
    ? (reduced ? undefined : FadeOutUp.duration(v2.motion.exit).easing(v2.motion.easeEnter))
    : undefined;
  return (
    <Animated.View entering={entering} exiting={exiting} {...rest}>
      {children}
    </Animated.View>
  );
}
