import React, { useEffect, useMemo } from 'react';
import Svg, { Path } from 'react-native-svg';
import Animated, {
  useSharedValue, useAnimatedProps, withTiming, withDelay, Easing, useReducedMotion,
} from 'react-native-reanimated';

const AnimatedPath = Animated.createAnimatedComponent(Path);

interface Props {
  values: number[];
  width?: number;
  height?: number;
  stroke?: string;
  /** Stagger this sparkline behind earlier rows. Pass row index. */
  rowIndex?: number;
}

/**
 * Single-line sparkline with a left-to-right stroke draw on mount.
 * Uses strokeDasharray = pathLength + animated dashoffset to fake the draw —
 * cheap, hits 60fps, and doesn't require Skia.
 *
 * If the values array has fewer than 2 points we render a single dot instead
 * (per the handoff edge case spec — "One lift logged → sparkline shows a
 * single dot, no line").
 */
export function Sparkline({ values, width = 60, height = 20, stroke = '#09090B', rowIndex = 0 }: Props) {
  const reducedMotion = useReducedMotion();

  const { d, pathLength, hasLine } = useMemo(() => {
    if (!values || values.length < 2) {
      return { d: '', pathLength: 0, hasLine: false };
    }
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;
    const stepX = width / (values.length - 1);
    const pts = values.map((v, i) => [i * stepX, height - ((v - min) / range) * height] as const);
    const path = pts
      .map((p, i) => (i === 0 ? `M${p[0].toFixed(1)} ${p[1].toFixed(1)}` : `L${p[0].toFixed(1)} ${p[1].toFixed(1)}`))
      .join(' ');
    // Approximate length — sum of segment distances. Good enough for stroke
    // dash math; dasharray rounding doesn't matter visually.
    let len = 0;
    for (let i = 1; i < pts.length; i++) {
      const dx = pts[i][0] - pts[i - 1][0];
      const dy = pts[i][1] - pts[i - 1][1];
      len += Math.sqrt(dx * dx + dy * dy);
    }
    return { d: path, pathLength: Math.ceil(len) + 2, hasLine: true };
  }, [values, width, height]);

  const dashOffset = useSharedValue(pathLength);

  useEffect(() => {
    if (!hasLine) return;
    if (reducedMotion) {
      dashOffset.value = 0;
      return;
    }
    dashOffset.value = pathLength;
    dashOffset.value = withDelay(
      rowIndex * 80,
      withTiming(0, { duration: 600, easing: Easing.out(Easing.cubic) })
    );
  }, [pathLength, rowIndex, hasLine, reducedMotion, dashOffset]);

  const animatedProps = useAnimatedProps(() => ({
    strokeDashoffset: dashOffset.value,
  }));

  if (!hasLine) {
    // Fallback: single dot at horizontal center
    return (
      <Svg width={width} height={height}>
        <Path
          d={`M${width / 2} ${height / 2} l0 0`}
          stroke={stroke}
          strokeWidth={3}
          strokeLinecap="round"
        />
      </Svg>
    );
  }

  return (
    <Svg width={width} height={height}>
      <AnimatedPath
        d={d}
        fill="none"
        stroke={stroke}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray={`${pathLength} ${pathLength}`}
        animatedProps={animatedProps}
      />
    </Svg>
  );
}
