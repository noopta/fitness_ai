import React, { useMemo } from 'react';
import Svg, { Polyline, Circle } from 'react-native-svg';

interface Props {
  /** Series oldest→newest. < 2 points renders a flat line. */
  values: number[];
  width?: number;
  height?: number;
  color?: string;
  /** Emphasize the terminal point with a filled dot. */
  endDot?: boolean;
}

/**
 * Tiny inline sparkline for insight cards — draws the literal shape of a
 * lift's e1RM history (flat for a stall, rising for a win). Static; the
 * card's mount animation carries the motion.
 */
export function MiniSparkline({
  values, width = 66, height = 24, color = '#71717A', endDot = true,
}: Props) {
  const geo = useMemo(() => {
    if (!values || values.length < 2) {
      const mid = height / 2;
      return { points: `0,${mid} ${width},${mid}`, end: { x: width, y: mid } };
    }
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;
    const stepX = width / (values.length - 1);
    const pts = values.map((v, i) => {
      const x = i * stepX;
      const y = height - ((v - min) / range) * (height - 6) - 3;
      return { x, y };
    });
    return {
      points: pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' '),
      end: pts[pts.length - 1],
    };
  }, [values, width, height]);

  return (
    <Svg width={width} height={height}>
      <Polyline
        points={geo.points}
        fill="none"
        stroke={color}
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {endDot && <Circle cx={geo.end.x} cy={geo.end.y} r={3} fill={color} />}
    </Svg>
  );
}
