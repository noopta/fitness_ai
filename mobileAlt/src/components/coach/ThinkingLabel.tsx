// Cycling "Anakin is thinking" labels + a 3-dot pulse animation, in the
// spirit of Claude Code's status line. Keeps the chat feeling alive while
// the agent loop runs (tool calls, reasoning, reply). Fitness-themed so
// the copy matches the brand voice.

import React, { useEffect, useRef, useState } from 'react';
import { Animated, View, StyleSheet } from 'react-native';
import { colors } from '../../constants/theme';

const LABELS = [
  'Reracking your thoughts…',
  'Spotting your set…',
  'Counting reps…',
  'Loading the bar…',
  'Reading your form…',
  'Programming a response…',
  'Cuing the lift…',
  'Stretching context…',
  'Warming up Anakin…',
  'Looking over your week…',
  'Plate-loading some advice…',
  'Pulling your numbers…',
  'Locking in the cue…',
  'Drilling down…',
  'Anakin is benching ideas…',
  'Adjusting the brace…',
  'Cleaning up the bar path…',
];

/**
 * Cycles a fitness-themed thinking label every ~2.4s while `active` is true.
 * Resets to the first label whenever a new send begins so consecutive turns
 * don't pick up mid-rotation.
 */
export function useThinkingLabel(active: boolean): string {
  const [idx, setIdx] = useState(0);
  // Anchor on transitions from inactive → active so we always start fresh.
  const wasActive = useRef(false);
  useEffect(() => {
    if (active && !wasActive.current) {
      setIdx(() => Math.floor(Math.random() * LABELS.length));
    }
    wasActive.current = active;
  }, [active]);

  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => {
      setIdx((i) => (i + 1) % LABELS.length);
    }, 2400);
    return () => clearInterval(t);
  }, [active]);

  return LABELS[idx] ?? LABELS[0];
}

/** Three little pulse dots. Pure built-in Animated — no Reanimated dep. */
export function ThinkingDots() {
  const a = useRef(new Animated.Value(0)).current;
  const b = useRef(new Animated.Value(0)).current;
  const c = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const pulse = (v: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(v, { toValue: 1, duration: 380, useNativeDriver: true }),
          Animated.timing(v, { toValue: 0, duration: 380, useNativeDriver: true }),
          Animated.delay(640 - delay),
        ]),
      );
    const anims = [pulse(a, 0), pulse(b, 160), pulse(c, 320)];
    anims.forEach((x) => x.start());
    return () => anims.forEach((x) => x.stop());
  }, [a, b, c]);

  return (
    <View style={styles.row}>
      {[a, b, c].map((v, i) => (
        <Animated.View
          key={i}
          style={[
            styles.dot,
            {
              opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] }),
              transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1] }) }],
            },
          ]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 4, marginRight: 8 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.mutedForeground },
});
