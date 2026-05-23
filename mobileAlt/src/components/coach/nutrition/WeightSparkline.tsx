// 30-day weight sparkline. Hand-rolled SVG path so the parent doesn't pull in
// react-native-chart-kit / Victory just for a single line. Spec: handoff §11.
//
// - White stroke + 8% white fill below the line (on the dark inspector card).
// - Trailing 3.5pt dot pins the latest reading.
// - When projection is provided (forward forecast point), the *last segment*
//   of the path renders dashed, regardless of trend direction.
//
// Empty / single-point datasets: render just the trailing dot, no path.

import React from 'react';
import Svg, { Path, Circle } from 'react-native-svg';

interface Props {
  data: number[];
  projection?: number;
  width: number;
  height?: number;
  stroke?: string;
  /** Padding above/below the data range, in data units (lb/kg). */
  pad?: number;
}

function buildPath(series: number[], w: number, h: number, pad: number): string {
  if (series.length === 0) return '';
  const min = Math.min(...series) - pad;
  const max = Math.max(...series) + pad;
  const range = max - min || 1;
  const dx = series.length > 1 ? w / (series.length - 1) : 0;
  return series
    .map((v, i) => {
      const x = i * dx;
      const y = h - ((v - min) / range) * h;
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(' ');
}

export function WeightSparkline({
  data,
  projection,
  width,
  height = 36,
  stroke = '#ffffff',
  pad = 0.5,
}: Props) {
  // Trailing-dot only when there's nothing to draw.
  if (data.length === 0 && projection == null) {
    return <Svg width={width} height={height} />;
  }
  if (data.length <= 1 && projection == null) {
    return (
      <Svg width={width} height={height}>
        <Circle cx={width - 4} cy={height / 2} r={3.5} fill={stroke} />
      </Svg>
    );
  }

  const fullSeries = projection != null ? [...data, projection] : data;
  const path = buildPath(fullSeries, width, height, pad);

  // Build the dashed last-segment path independently so we can apply the
  // dasharray without affecting the solid portion.
  let lastSegmentPath = '';
  if (projection != null && data.length > 0) {
    const lastTwo = fullSeries.slice(-2);
    lastSegmentPath = buildPath(lastTwo, width, height, pad)
      // Re-offset the second point: when we re-build a 2-point path it starts
      // at x=0, but we want it at x=width-dx and x=width. We instead recompute
      // by shifting the M coord.
      .replace(/^M[\d.]+,/, `M${(width - (width / (fullSeries.length - 1))).toFixed(2)},`)
      .replace(/L[\d.]+,/, `L${width.toFixed(2)},`);
  }

  // Closed fill path under the line.
  const fill = path + ` L${width.toFixed(2)},${height} L0,${height} Z`;

  // Trailing dot — at the projection point if present, else the last data point.
  const dotIndex = fullSeries.length - 1;
  const min = Math.min(...fullSeries) - pad;
  const max = Math.max(...fullSeries) + pad;
  const range = max - min || 1;
  const dx = fullSeries.length > 1 ? width / (fullSeries.length - 1) : 0;
  const dotX = dotIndex * dx;
  const dotY = height - ((fullSeries[dotIndex] - min) / range) * height;

  return (
    <Svg width={width} height={height}>
      <Path d={fill} fill={stroke} fillOpacity={0.08} />
      {/* Solid portion (everything but the projection segment) */}
      {projection != null && data.length > 1 ? (
        <>
          <Path
            d={buildPath(data, width - (width / (fullSeries.length - 1)), height, pad)}
            stroke={stroke}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
          <Path
            d={lastSegmentPath}
            stroke={stroke}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray="4 4"
            fill="none"
          />
        </>
      ) : (
        <Path
          d={path}
          stroke={stroke}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      )}
      <Circle cx={dotX} cy={dotY} r={3.5} fill={stroke} />
    </Svg>
  );
}
