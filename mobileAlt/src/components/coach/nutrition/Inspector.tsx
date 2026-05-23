// Inspector — the dark card pinned below the sticky header. Switches between
// WeightInspector (default) and MacroInspector when a macro ring is tapped.
// Spec: handoff §02, §06–08.
//
// Animation: when mode swaps, cross-fade the old content out and the new
// content in while tweening the card's height. Reduced-motion users get an
// instant swap. The mode prop alone drives this — parent doesn't manage
// animation state.

import React, { useEffect, useState } from 'react';
import { View, StyleSheet, LayoutAnimation, Platform, UIManager } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  Easing,
  useReducedMotion,
  runOnJS,
} from 'react-native-reanimated';
import { colors } from '../../../constants/theme';

// LayoutAnimation needs an explicit opt-in on Android.
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

interface Props {
  mode: 'weight' | 'macro';
  weight: React.ReactNode;
  macro: React.ReactNode;
}

const EASE = Easing.bezier(0.16, 1, 0.3, 1);

export function Inspector({ mode, weight, macro }: Props) {
  const reducedMotion = useReducedMotion();
  const [renderedMode, setRenderedMode] = useState(mode);
  const opacity = useSharedValue(1);

  // Swap content with a fast cross-fade + height tween. The height tween is
  // implicit via LayoutAnimation: as the rendered child changes, the parent's
  // measured height changes. LayoutAnimation animates that change.
  useEffect(() => {
    if (mode === renderedMode) return;
    if (reducedMotion) {
      setRenderedMode(mode);
      return;
    }
    LayoutAnimation.configureNext({
      duration: 220,
      update: { type: 'easeInEaseOut' },
    });
    opacity.value = withTiming(0, { duration: 100, easing: EASE }, (finished) => {
      if (!finished) return;
      runOnJS(setRenderedMode)(mode);
      opacity.value = withTiming(1, { duration: 120, easing: EASE });
    });
  }, [mode, renderedMode, reducedMotion]);

  const fadeStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <View style={styles.card}>
      <Animated.View style={fadeStyle}>
        {renderedMode === 'weight' ? weight : macro}
      </Animated.View>
    </View>
  );
}
const styles = StyleSheet.create({
  card: {
    backgroundColor: '#09090b',
    borderRadius: 12,
    marginHorizontal: 14,
    marginTop: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
});
