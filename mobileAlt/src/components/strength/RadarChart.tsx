import React, { useEffect, useMemo } from 'react';
import Svg, { Polygon, Line, Path, Circle, Text as SvgText, G, Rect } from 'react-native-svg';
import Animated, {
  useSharedValue, useAnimatedProps, useDerivedValue, withTiming, Easing,
  useReducedMotion,
} from 'react-native-reanimated';

const AnimatedPath = Animated.createAnimatedComponent(Path);

export interface RadarAxis {
  axis: string;       // display label (e.g., "Push", "Pull", "Squat")
  current: number;    // 0..100
  target: number;     // 0..100
}

interface Props {
  axes: RadarAxis[];
  /** Outer SVG dimension. Renders at 310 per the handoff. */
  size?: number;
  /** Set false to skip the dashed target polygon (e.g. when target == current). */
  showTarget?: boolean;
  /** Tap handler invoked with the axis label string when an axis is tapped. */
  onAxisPress?: (axisName: string) => void;
}

/**
 * Six-axis radar (handoff spec — minimum 3 axes required to show; below that
 * the caller should render a horizontal bar list instead and not mount this).
 * Renders four reference rings, axis spokes, dashed target polygon, and an
 * animated current polygon that morphs from center → real values on mount.
 *
 * Animation is one Reanimated SharedValue per axis, recomputed into a path
 * inside useDerivedValue so the morph is interpolated, not stepped.
 */
export function RadarChart({ axes, size = 310, showTarget = true, onAxisPress }: Props) {
  const reducedMotion = useReducedMotion();
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 44; // room for axis labels

  const N = axes.length;
  const ang = (i: number) => -Math.PI / 2 + (i * 2 * Math.PI) / N;

  const ringLevels = [0.25, 0.5, 0.75, 1.0];

  // Precomputed static geometry — rings, spokes, target polygon, label coords.
  // Stable across renders unless axes change.
  const geo = useMemo(() => {
    const ringPoints = ringLevels.map(lv =>
      axes
        .map((_, i) => {
          const x = cx + Math.cos(ang(i)) * r * lv;
          const y = cy + Math.sin(ang(i)) * r * lv;
          return `${x.toFixed(1)},${y.toFixed(1)}`;
        })
        .join(' ')
    );
    const spokes = axes.map((_, i) => {
      const x = cx + Math.cos(ang(i)) * r;
      const y = cy + Math.sin(ang(i)) * r;
      return { x1: cx, y1: cy, x2: x, y2: y };
    });
    const targetPoints = axes
      .map((a, i) => {
        const x = cx + Math.cos(ang(i)) * r * (a.target / 100);
        const y = cy + Math.sin(ang(i)) * r * (a.target / 100);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
    const labels = axes.map((a, i) => {
      const lx = cx + Math.cos(ang(i)) * (r + 30);
      const ly = cy + Math.sin(ang(i)) * (r + 30);
      return { lx, ly };
    });
    const dotsCurrent = axes.map((a, i) => {
      const x = cx + Math.cos(ang(i)) * r * (a.current / 100);
      const y = cy + Math.sin(ang(i)) * r * (a.current / 100);
      return { x, y, lagging: a.current < a.target };
    });
    return { ringPoints, spokes, targetPoints, labels, dotsCurrent };
  }, [axes, cx, cy, r]);

  // One SharedValue per axis. We always create the max we'll ever need (8 is
  // a safe upper bound — handoff spec is 6) so the hook count is stable.
  const v0 = useSharedValue(0); const v1 = useSharedValue(0);
  const v2 = useSharedValue(0); const v3 = useSharedValue(0);
  const v4 = useSharedValue(0); const v5 = useSharedValue(0);
  const v6 = useSharedValue(0); const v7 = useSharedValue(0);
  const values = [v0, v1, v2, v3, v4, v5, v6, v7];

  useEffect(() => {
    axes.forEach((a, i) => {
      const sv = values[i];
      if (!sv) return;
      const target = a.current;
      if (reducedMotion) {
        sv.value = withTiming(target, { duration: 80 });
      } else {
        sv.value = withTiming(target, {
          duration: 520,
          easing: Easing.bezier(0.16, 1, 0.3, 1),
        });
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [axes, reducedMotion]);

  // Derived path: recomputed in worklet whenever any value changes.
  const pathD = useDerivedValue(() => {
    'worklet';
    const parts: string[] = [];
    for (let i = 0; i < N; i++) {
      const sv = values[i];
      const v = sv ? sv.value : 0;
      const x = cx + Math.cos(ang(i)) * r * (v / 100);
      const y = cy + Math.sin(ang(i)) * r * (v / 100);
      parts.push(`${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`);
    }
    return parts.join(' ') + ' Z';
  // values[] is stable across renders.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [N, cx, cy, r]);

  const animatedProps = useAnimatedProps(() => ({ d: pathD.value }));

  // Build accessibility label: "Movement balance: push 78 of 80 target, pull 62 of 80 …"
  const a11yLabel =
    'Movement balance: ' +
    axes
      .map(a => `${a.axis.toLowerCase()} ${Math.round(a.current)} of ${Math.round(a.target)} target`)
      .join(', ');

  return (
    <Svg
      width={size}
      height={size}
      accessibilityLabel={a11yLabel}
      accessibilityRole="image"
    >
      {/* Reference rings */}
      {geo.ringPoints.map((points, i) => (
        <Polygon
          key={i}
          points={points}
          fill="none"
          stroke={i === ringLevels.length - 1 ? '#D4D4D8' : '#E4E4E7'}
          strokeWidth={1}
        />
      ))}
      {/* Spokes */}
      {geo.spokes.map((s, i) => (
        <Line
          key={i}
          x1={s.x1}
          y1={s.y1}
          x2={s.x2}
          y2={s.y2}
          stroke="#E4E4E7"
          strokeWidth={1}
        />
      ))}
      {/* Target (dashed) */}
      {showTarget && (
        <Polygon
          points={geo.targetPoints}
          fill="none"
          stroke="#71717A"
          strokeWidth={1.25}
          strokeDasharray="4 3"
        />
      )}
      {/* Current (animated) */}
      <AnimatedPath
        animatedProps={animatedProps}
        fill="rgba(9,9,11,0.08)"
        stroke="#09090B"
        strokeWidth={1.75}
        strokeLinejoin="round"
      />
      {/* Vertex dots — drawn at the FINAL value, not animated. The polygon
          morph carries the visual interest; dots staying at the target spot
          would reveal the morph as fake, so we draw them on the actual peak. */}
      {geo.dotsCurrent.map((d, i) => (
        <Circle key={i} cx={d.x} cy={d.y} r={3.5} fill="#09090B" stroke="#FFFFFF" strokeWidth={1.5} />
      ))}
      {/* Axis labels + numeric readout. Each axis is wrapped in a <G onPress>
          with an invisible 12pt-padded hit-rect (handoff: "Hit slop 12pt
          around each label"). Tapping calls onAxisPress with the axis name. */}
      {axes.map((a, i) => {
        const { lx, ly } = geo.labels[i];
        const lagging = a.current < a.target;
        const handlePress = onAxisPress ? () => onAxisPress(a.axis) : undefined;
        return (
          <G
            key={a.axis}
            onPress={handlePress}
            accessibilityRole={handlePress ? 'button' : undefined}
            accessibilityLabel={`${a.axis} axis, ${Math.round(a.current)} of ${Math.round(a.target)} target`}
          >
            {/* Invisible hit area — extends 12pt around the visual label group */}
            {handlePress && (
              <Rect
                x={lx - 28}
                y={ly - 18}
                width={56}
                height={32}
                fill="transparent"
              />
            )}
            <SvgText
              x={lx}
              y={ly - 4}
              textAnchor="middle"
              fontSize={11}
              fontWeight="700"
              fill="#09090B"
              letterSpacing={0.4}
            >
              {a.axis.toUpperCase()}
            </SvgText>
            <SvgText
              x={lx}
              y={ly + 8}
              textAnchor="middle"
              fontSize={9.5}
              fontFamily="Menlo"
              fill={lagging ? '#DC2626' : '#71717A'}
            >
              {Math.round(a.current)}
            </SvgText>
          </G>
        );
      })}
    </Svg>
  );
}
