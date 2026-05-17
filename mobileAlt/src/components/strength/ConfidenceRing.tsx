import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import Animated, {
  useSharedValue, useAnimatedProps, useDerivedValue, withTiming, runOnJS,
  Easing, useReducedMotion,
} from 'react-native-reanimated';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

interface Props {
  /** Model completeness, 0-1. */
  value: number;
  /** Outer dimension in px. Handoff default 56. */
  size?: number;
  /** Ring stroke width. Handoff default 3.5. */
  stroke?: number;
  /** Progress arc + text color. Default white (for the dark tier hero). */
  color?: string;
  /** Unfilled track color. */
  trackColor?: string;
  /** Micro-label under the number. Default "READ". Pass '' to hide. */
  label?: string;
}

/**
 * ConfidenceRing — circular completeness gauge for the Athlete Model's
 * `confidence` score. The ring's stroke-dash fills 0 → value on mount; the
 * integer percentage inside counts up in lockstep. Reusable: embedded in
 * the tier hero (white-on-dark) and standalone in the new-user state.
 *
 * Per the design handoff §6 / §11. Honors reduced motion (snaps to final).
 */
export function ConfidenceRing({
  value,
  size = 56,
  stroke = 3.5,
  color = '#FFFFFF',
  trackColor = 'rgba(255,255,255,0.18)',
  label = 'READ',
}: Props) {
  const reducedMotion = useReducedMotion();
  const r = (size - stroke) / 2;
  const cir = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));

  const progress = useSharedValue(0);
  const [displayPct, setDisplayPct] = useState(0);

  useEffect(() => {
    if (reducedMotion) {
      progress.value = clamped;
      setDisplayPct(Math.round(clamped * 100));
      return;
    }
    progress.value = 0;
    setDisplayPct(0);
    progress.value = withTiming(clamped, {
      duration: 600,
      easing: Easing.bezier(0.16, 1, 0.3, 1),
    });
  }, [clamped, reducedMotion, progress]);

  // Count the number up in step with the ring fill. Integer ticks only —
  // no JS churn per sub-pixel frame.
  useDerivedValue(() => {
    'worklet';
    runOnJS(setDisplayPct)(Math.round(progress.value * 100));
    return progress.value;
  });

  const animatedProps = useAnimatedProps(() => ({
    strokeDasharray: `${cir * progress.value} ${cir}`,
  }));

  return (
    <View
      style={{ width: size, height: size }}
      accessibilityRole="progressbar"
      accessibilityValue={{ now: Math.round(clamped * 100), max: 100 }}
      accessibilityLabel={`Read confidence — ${Math.round(clamped * 100)} percent`}
    >
      <Svg width={size} height={size}>
        {/* Track */}
        <Circle
          cx={size / 2} cy={size / 2} r={r}
          fill="none" stroke={trackColor} strokeWidth={stroke}
        />
        {/* Progress arc — starts at 12 o'clock, fills clockwise */}
        <AnimatedCircle
          cx={size / 2} cy={size / 2} r={r}
          fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round"
          animatedProps={animatedProps}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      <View style={[StyleSheet.absoluteFill, styles.center]} pointerEvents="none">
        <Text
          allowFontScaling={false}
          style={{ color, fontSize: size * 0.30, fontWeight: '800', fontVariant: ['tabular-nums'], lineHeight: size * 0.34 }}
        >
          {displayPct}
        </Text>
        {label ? (
          <Text
            allowFontScaling={false}
            style={{ color, fontSize: Math.max(7, size * 0.12), fontWeight: '700', letterSpacing: 1, opacity: 0.55 }}
          >
            {label}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
});
