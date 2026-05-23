// Macro ring — the most-used unit on the Nutrition tab.
// Renders four times in the StickyHeader row (38pt) and once inside the
// MacroInspector when a macro is selected (56pt). Spec: handoff §06.
//
// Doctrine: shows the *used grams* as the inner numeral, never a percentage.
// Stroke is the macro accent; numeral colour is the on-surface foreground
// (foreground on light, white on dark) — never the macro colour, because
// the macro blues/oranges fail WCAG-AA on white at 14pt.

import React, { useEffect } from 'react';
import { Pressable, View, Text, StyleSheet } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import Animated, {
  useSharedValue,
  useAnimatedProps,
  withTiming,
  Easing,
  useReducedMotion,
} from 'react-native-reanimated';
import { colors, fontWeight } from '../../../constants/theme';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

export type MacroKey = 'protein' | 'carbs' | 'fat' | 'fiber';

export const MACRO_COLOR: Record<MacroKey, string> = {
  protein: colors.macro.protein,
  carbs:   colors.macro.carbs,
  fat:     colors.macro.fat,
  fiber:   colors.macro.fiber,
};

export const MACRO_LABEL: Record<MacroKey, string> = {
  protein: 'Protein',
  carbs:   'Carbs',
  fat:     'Fat',
  fiber:   'Fiber',
};

export interface MacroState {
  key: MacroKey;
  used: number;       // grams consumed
  target: number | null; // grams target; null = no target set
}

interface Props {
  macro: MacroState;
  /** Outer SVG side length. 38 for the row, 56 for the inspector. */
  size?: number;
  stroke?: number;
  /** When true, draw a subtle inner disc + outline (selected appearance). */
  selected?: boolean;
  /** Dark background — switches track colour + on-dark numeral. */
  onDark?: boolean;
  onPress?: () => void;
}

export function MacroRing({
  macro,
  size = 38,
  stroke = 3.2,
  selected = false,
  onDark = false,
  onPress,
}: Props) {
  const reducedMotion = useReducedMotion();

  const r = (size - stroke) / 2;
  const cir = 2 * Math.PI * r;
  const target = macro.target && macro.target > 0
    ? Math.min(macro.used / macro.target, 1)
    : 0;

  const pct = useSharedValue(0);
  useEffect(() => {
    pct.value = reducedMotion
      ? target
      : withTiming(target, { duration: 520, easing: Easing.bezier(0.16, 1, 0.3, 1) });
  }, [target, reducedMotion]);

  const animatedProps = useAnimatedProps(() => ({
    strokeDasharray: [cir * pct.value, cir] as unknown as string,
  }));

  // Track colour shifts on the dark inspector so the unfilled portion of the
  // ring is visible. Foreground numeral switches the same way.
  const trackColor = onDark ? 'rgba(255,255,255,0.12)' : colors.border;
  const numeralColor = onDark ? '#ffffff' : colors.foreground;
  const subtitleColor = onDark ? 'rgba(255,255,255,0.55)' : colors.mutedForeground;

  // The ring rotates -90deg so 0% starts at 12 o'clock instead of 3.
  const center = size / 2;

  const Body = (
    <View
      style={[
        styles.tile,
        { width: size, height: size },
        selected && !onDark && styles.tileSelected,
      ]}
    >
      <Svg width={size} height={size}>
        <Circle
          cx={center}
          cy={center}
          r={r}
          stroke={trackColor}
          strokeWidth={stroke}
          fill="none"
        />
        <AnimatedCircle
          cx={center}
          cy={center}
          r={r}
          stroke={MACRO_COLOR[macro.key]}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          // Rotate so 0% is at top of ring.
          transform={`rotate(-90 ${center} ${center})`}
          animatedProps={animatedProps as any}
        />
      </Svg>
      <View style={[StyleSheet.absoluteFill, styles.tileInner]}>
        <Text
          style={[styles.numeral, { color: numeralColor, fontSize: size >= 56 ? 14 : 9 }]}
          allowFontScaling={false}
          numberOfLines={1}
        >
          {Math.round(macro.used)}
        </Text>
        <Text
          style={[styles.unitLabel, { color: subtitleColor, fontSize: size >= 56 ? 8 : 7 }]}
          allowFontScaling={false}
          numberOfLines={1}
        >
          {macro.key === 'protein' ? 'P'
            : macro.key === 'carbs' ? 'C'
            : macro.key === 'fat'   ? 'F'
            : 'F'}
        </Text>
      </View>
    </View>
  );

  if (!onPress) return Body;

  return (
    <Pressable
      hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={
        macro.target
          ? `${MACRO_LABEL[macro.key]}, ${Math.round(macro.used)} of ${Math.round(macro.target)} grams`
          : `${MACRO_LABEL[macro.key]}, ${Math.round(macro.used)} grams logged, no target set`
      }
      accessibilityState={{ selected }}
    >
      {Body}
    </Pressable>
  );
}
const styles = StyleSheet.create({
  tile: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
  },
  tileSelected: {
    backgroundColor: colors.muted,
    borderWidth: 1,
    borderColor: colors.border,
  },
  tileInner: { alignItems: 'center', justifyContent: 'center' },
  numeral: {
    fontWeight: fontWeight.bold,
    lineHeight: 12,
    letterSpacing: -0.4,
    fontVariant: ['tabular-nums'],
  },
  unitLabel: {
    fontWeight: fontWeight.bold,
    letterSpacing: 0.4,
    marginTop: 1,
  },
});
