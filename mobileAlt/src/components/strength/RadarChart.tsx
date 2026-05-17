import React, { useEffect, useMemo, useRef, useState } from 'react';
import Svg, {
  Polygon, Line, Path, Circle, Text as SvgText, G, Rect,
  Defs, RadialGradient, Stop,
} from 'react-native-svg';
import Animated, {
  useSharedValue, useAnimatedProps, useDerivedValue, withTiming,
  withDelay, Easing, useReducedMotion,
} from 'react-native-reanimated';

const AnimatedPath = Animated.createAnimatedComponent(Path);
const AnimatedG = Animated.createAnimatedComponent(G);

export interface RadarAxis {
  axis: string;       // display label (e.g., "Push", "Pull", "Squat", "Lats")
  current: number;    // 0..100
  target: number;     // 0..100
}

interface Props {
  axes: RadarAxis[];
  /** Outer SVG dimension. Renders at 310 per the handoff. */
  size?: number;
  /** Set false to skip the dashed target polygon (e.g., when target == current). */
  showTarget?: boolean;
  /** Tap handler invoked with the axis label when an axis is tapped. */
  onAxisPress?: (axisName: string) => void;
  /** Long-press handler — power-user shortcut to open the drill sheet at any level. */
  onAxisLongPress?: (axisName: string) => void;
}

/**
 * Animated radar chart with drill-down support.
 *
 * Renders four reference rings, axis spokes, a dashed target polygon, and an
 * animated current polygon that morphs whenever `axes` changes. Supports
 * axis-count changes between renders (level-1 overview ↔ level-2 muscle
 * sub-radar) via a two-phase collapse-then-expand morph so a 6-axis view
 * can transition cleanly into a 5- or 4-axis sub-view without geometry pops.
 *
 * Visual polish: radial-gradient fill inside the polygon, soft outer glow,
 * label cross-fade on level transitions, em-dash placeholder for axes with
 * no data.
 *
 * Accessibility: single image-role group with a labelled summary, plus
 * per-axis button-role hit areas with their own labels.
 */
export function RadarChart({
  axes, size = 310, showTarget = true, onAxisPress, onAxisLongPress,
}: Props) {
  const reducedMotion = useReducedMotion();
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 52; // room for the tappable axis-label chips

  // Track the previous N so axis-count changes (level transitions) trigger
  // a two-phase morph: collapse to center, then expand into the new shape.
  // Same-count changes (e.g., refreshed data) just retarget directly.
  const prevNRef = useRef(axes.length);

  // Cross-fade opacity for axis labels. Drops to 0 mid-morph on level
  // transitions, then back to 1 once the new labels are settled.
  const labelOpacity = useSharedValue(1);

  // We keep the "render axes" lagging the prop by a frame during axis-count
  // transitions — geometry constants below depend on N, so swapping the
  // render N at the same time as starting the collapse would jolt the
  // polygon visually. The lag is invisible (~80 ms) because we cross-fade
  // labels and animate values toward 0 during it.
  const [renderAxes, setRenderAxes] = useState(axes);

  const N = renderAxes.length;
  const ang = (i: number) => -Math.PI / 2 + (i * 2 * Math.PI) / N;

  const ringLevels = [0.25, 0.5, 0.75, 1.0];

  // Static geometry — derived from `renderAxes` (the lagged version) so the
  // rings/spokes/labels stay in sync with the values being animated.
  const geo = useMemo(() => {
    const ringPoints = ringLevels.map((lv) =>
      renderAxes
        .map((_, i) => {
          const x = cx + Math.cos(ang(i)) * r * lv;
          const y = cy + Math.sin(ang(i)) * r * lv;
          return `${x.toFixed(1)},${y.toFixed(1)}`;
        })
        .join(' '),
    );
    const spokes = renderAxes.map((_, i) => {
      const x = cx + Math.cos(ang(i)) * r;
      const y = cy + Math.sin(ang(i)) * r;
      return { x1: cx, y1: cy, x2: x, y2: y };
    });
    const targetPoints = renderAxes
      .map((a, i) => {
        const x = cx + Math.cos(ang(i)) * r * (a.target / 100);
        const y = cy + Math.sin(ang(i)) * r * (a.target / 100);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
    const labels = renderAxes.map((_, i) => {
      const lx = cx + Math.cos(ang(i)) * (r + 24);
      const ly = cy + Math.sin(ang(i)) * (r + 24);
      return { lx, ly };
    });
    const dotsCurrent = renderAxes.map((a, i) => {
      const x = cx + Math.cos(ang(i)) * r * (a.current / 100);
      const y = cy + Math.sin(ang(i)) * r * (a.current / 100);
      return { x, y, lagging: a.current < a.target - 10 };
    });
    return { ringPoints, spokes, targetPoints, labels, dotsCurrent };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renderAxes, cx, cy, r]);

  // Eight unrolled SharedValues + angle constants — Reanimated 4 captures
  // closures more tightly than v3, so direct named references inside the
  // worklet are more reliable than array indexing.
  const v0 = useSharedValue(0); const v1 = useSharedValue(0);
  const v2 = useSharedValue(0); const v3 = useSharedValue(0);
  const v4 = useSharedValue(0); const v5 = useSharedValue(0);
  const v6 = useSharedValue(0); const v7 = useSharedValue(0);

  const a0x = N > 0 ? Math.cos(ang(0)) * r : 0; const a0y = N > 0 ? Math.sin(ang(0)) * r : 0;
  const a1x = N > 1 ? Math.cos(ang(1)) * r : 0; const a1y = N > 1 ? Math.sin(ang(1)) * r : 0;
  const a2x = N > 2 ? Math.cos(ang(2)) * r : 0; const a2y = N > 2 ? Math.sin(ang(2)) * r : 0;
  const a3x = N > 3 ? Math.cos(ang(3)) * r : 0; const a3y = N > 3 ? Math.sin(ang(3)) * r : 0;
  const a4x = N > 4 ? Math.cos(ang(4)) * r : 0; const a4y = N > 4 ? Math.sin(ang(4)) * r : 0;
  const a5x = N > 5 ? Math.cos(ang(5)) * r : 0; const a5y = N > 5 ? Math.sin(ang(5)) * r : 0;
  const a6x = N > 6 ? Math.cos(ang(6)) * r : 0; const a6y = N > 6 ? Math.sin(ang(6)) * r : 0;
  const a7x = N > 7 ? Math.cos(ang(7)) * r : 0; const a7y = N > 7 ? Math.sin(ang(7)) * r : 0;

  useEffect(() => {
    const svs = [v0, v1, v2, v3, v4, v5, v6, v7];
    const sameCount = axes.length === prevNRef.current;

    if (sameCount) {
      // Direct morph — retarget each value, geometry stays put.
      const targets = svs.map((_, i) => axes[i]?.current ?? 0);
      const dur = reducedMotion ? 80 : 520;
      const ease = reducedMotion ? Easing.linear : Easing.bezier(0.16, 1, 0.3, 1);
      svs.forEach((sv, i) => { sv.value = withTiming(targets[i], { duration: dur, easing: ease }); });
      // Labels can stay visible — same axes.
      return;
    }

    // Two-phase morph for level transitions:
    //   1. Collapse all values to center over ~80 ms while labels fade out.
    //   2. Swap renderAxes to the new shape (the only render frame where
    //      N changes; values are at 0 so the polygon is a single point —
    //      no visible geometry jolt).
    //   3. Expand into the new values over ~520 ms while labels fade back in.
    const collapseDur = reducedMotion ? 40 : 90;
    const expandDur = reducedMotion ? 80 : 520;

    svs.forEach((sv) => { sv.value = withTiming(0, { duration: collapseDur }); });
    labelOpacity.value = withTiming(0, { duration: collapseDur });

    const swapTimer = setTimeout(() => {
      setRenderAxes(axes);
      prevNRef.current = axes.length;
      // Schedule the expand on the next paint so renderAxes has propagated
      // through React's commit phase before we start animating values.
      requestAnimationFrame(() => {
        const targets = svs.map((_, i) => axes[i]?.current ?? 0);
        svs.forEach((sv, i) => {
          sv.value = withTiming(targets[i], {
            duration: expandDur,
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          });
        });
        labelOpacity.value = withDelay(120, withTiming(1, { duration: 220 }));
      });
    }, collapseDur + 20);

    return () => clearTimeout(swapTimer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [axes, reducedMotion]);

  // Derived path: recomputed in worklet whenever any value changes.
  const pathD = useDerivedValue(() => {
    'worklet';
    const seg = (
      active: boolean, x: number, y: number, ax: number, ay: number,
      sv: number, prefix: 'M' | 'L',
    ) => {
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
  // Slightly softer second stroke behind the main one — fakes an outer glow
  // without needing an SVG filter (filters are slow on Android <13).
  const animatedGlowProps = useAnimatedProps(() => ({ d: pathD.value }));
  const animatedLabelsProps = useAnimatedProps(() => ({ opacity: labelOpacity.value }));

  // Build accessibility label.
  const a11yLabel =
    'Strength balance: ' +
    renderAxes
      .map((a) => `${a.axis.toLowerCase()} ${Math.round(a.current)} of ${Math.round(a.target)} target`)
      .join(', ');

  return (
    <Svg
      width={size}
      height={size}
      accessibilityLabel={a11yLabel}
      accessibilityRole="image"
    >
      {/* Gradient + glow definitions */}
      <Defs>
        <RadialGradient id="polyFill" cx="50%" cy="50%" r="55%">
          <Stop offset="0%" stopColor="#09090B" stopOpacity={0.20} />
          <Stop offset="60%" stopColor="#09090B" stopOpacity={0.10} />
          <Stop offset="100%" stopColor="#09090B" stopOpacity={0.04} />
        </RadialGradient>
      </Defs>

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
        <Line key={i} x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} stroke="#E4E4E7" strokeWidth={1} />
      ))}

      {/* Target polygon (dashed halo) */}
      {showTarget && (
        <Polygon
          points={geo.targetPoints}
          fill="none"
          stroke="#71717A"
          strokeWidth={1.25}
          strokeDasharray="4 3"
        />
      )}

      {/* Outer glow — same animated path stroked wider, semi-transparent */}
      <AnimatedPath
        animatedProps={animatedGlowProps}
        fill="none"
        stroke="#09090B"
        strokeOpacity={0.10}
        strokeWidth={6}
        strokeLinejoin="round"
      />

      {/* Current polygon — gradient-filled, crisp stroke */}
      <AnimatedPath
        animatedProps={animatedProps}
        fill="url(#polyFill)"
        stroke="#09090B"
        strokeWidth={1.85}
        strokeLinejoin="round"
      />

      {/* Vertex dots — drawn at final value (worklet animates the polygon, dots stay put) */}
      {geo.dotsCurrent.map((d, i) => (
        <Circle
          key={i}
          cx={d.x}
          cy={d.y}
          r={d.lagging ? 4 : 3.5}
          fill={d.lagging ? '#DC2626' : '#09090B'}
          stroke="#FFFFFF"
          strokeWidth={1.5}
        />
      ))}

      {/* Axis labels + numeric readout. Wrapped in an AnimatedG that fades
          during level transitions so old labels disappear before new ones
          appear — avoids the jarring "wrong text in wrong place" mid-morph. */}
      <AnimatedG animatedProps={animatedLabelsProps}>
        {renderAxes.map((a, i) => {
          const { lx, ly } = geo.labels[i];
          const lagging = a.current < a.target - 10;
          const handlePress = onAxisPress ? () => onAxisPress(a.axis) : undefined;
          const handleLong = onAxisLongPress ? () => onAxisLongPress(a.axis) : undefined;
          return (
            <G
              key={`${a.axis}-${i}`}
              onPress={handlePress}
              onLongPress={handleLong}
              accessibilityRole={handlePress ? 'button' : undefined}
              accessibilityLabel={`${a.axis} axis, ${Math.round(a.current)} of ${Math.round(a.target)} target`}
            >
              {/* Visible chip behind each interactive axis label — makes it
                  obvious the movement is tappable (a user scrolling past
                  shouldn't have to read the hint to know). Drawn as a light
                  rounded surface with a hairline border; doubles as the
                  44pt-ish hit target. Non-interactive radars skip it. */}
              {handlePress && (
                <Rect
                  x={lx - 27}
                  y={ly - 17}
                  width={54}
                  height={32}
                  rx={8}
                  fill="#F4F4F5"
                  stroke="#E4E4E7"
                  strokeWidth={1}
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
      </AnimatedG>
    </Svg>
  );
}
