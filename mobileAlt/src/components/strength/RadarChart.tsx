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

  // One SharedValue per axis. Hooks are unrolled (not via map/Array.from)
  // so React 19 + Reanimated 4 see a stable hook order. Eight is the upper
  // bound — the handoff caps at six. Worklet references each by name to
  // avoid an array dereference inside the worklet thread, which Reanimated
  // 4 sometimes refuses to capture cleanly.
  const v0 = useSharedValue(0);
  const v1 = useSharedValue(0);
  const v2 = useSharedValue(0);
  const v3 = useSharedValue(0);
  const v4 = useSharedValue(0);
  const v5 = useSharedValue(0);
  const v6 = useSharedValue(0);
  const v7 = useSharedValue(0);

  // Pre-computed angle/scale constants captured by the worklet closure. The
  // worklet captures only primitives + the SharedValue refs, never the axes
  // array (which would force a new closure on every render).
  const a0x = Math.cos(ang(0)) * r; const a0y = Math.sin(ang(0)) * r;
  const a1x = Math.cos(ang(1)) * r; const a1y = Math.sin(ang(1)) * r;
  const a2x = Math.cos(ang(2)) * r; const a2y = Math.sin(ang(2)) * r;
  const a3x = Math.cos(ang(3)) * r; const a3y = Math.sin(ang(3)) * r;
  const a4x = Math.cos(ang(4)) * r; const a4y = Math.sin(ang(4)) * r;
  const a5x = Math.cos(ang(5)) * r; const a5y = Math.sin(ang(5)) * r;
  const a6x = N > 6 ? Math.cos(ang(6)) * r : 0; const a6y = N > 6 ? Math.sin(ang(6)) * r : 0;
  const a7x = N > 7 ? Math.cos(ang(7)) * r : 0; const a7y = N > 7 ? Math.sin(ang(7)) * r : 0;

  useEffect(() => {
    const targets = [
      axes[0]?.current ?? 0, axes[1]?.current ?? 0,
      axes[2]?.current ?? 0, axes[3]?.current ?? 0,
      axes[4]?.current ?? 0, axes[5]?.current ?? 0,
      axes[6]?.current ?? 0, axes[7]?.current ?? 0,
    ];
    const svs = [v0, v1, v2, v3, v4, v5, v6, v7];
    svs.forEach((sv, i) => {
      const target = targets[i];
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

  // Derived path: recomputed in worklet whenever any value changes. References
  // each SharedValue directly — no JS array dereferencing, no closure over
  // mutable refs. Cheaper to capture and immune to GC reordering.
  const pathD = useDerivedValue(() => {
    'worklet';
    const seg = (active: boolean, x: number, y: number, ax: number, ay: number, sv: number, prefix: 'M' | 'L') => {
      if (!active) return '';
      const px = x + ax * (sv / 100);
      const py = y + ay * (sv / 100);
      return `${prefix}${px.toFixed(1)} ${py.toFixed(1)} `;
    };
    let d = '';
    d += seg(N > 0, cx, cy, a0x, a0y, v0.value, 'M');
    d += seg(N > 1, cx, cy, a1x, a1y, v1.value, 'L');
    d += seg(N > 2, cx, cy, a2x, a2y, v2.value, 'L');
    d += seg(N > 3, cx, cy, a3x, a3y, v3.value, 'L');
    d += seg(N > 4, cx, cy, a4x, a4y, v4.value, 'L');
    d += seg(N > 5, cx, cy, a5x, a5y, v5.value, 'L');
    d += seg(N > 6, cx, cy, a6x, a6y, v6.value, 'L');
    d += seg(N > 7, cx, cy, a7x, a7y, v7.value, 'L');
    return d + 'Z';
  });

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
