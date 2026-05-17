import React from 'react';
import Svg, { Circle } from 'react-native-svg';
import type { IntensityZone } from '../../lib/athleteModel';

// Training-mix donut — the share of a muscle's volume across intensity
// zones (strength / hypertrophy / endurance / power). The scientifically
// honest "how is this muscle trained" view. Design handoff §6.

export interface ZoneMeta {
  key: IntensityZone;
  label: string;
  color: string;
}

export const ZONE_META: ZoneMeta[] = [
  { key: 'strength',    label: 'Strength',    color: '#09090B' },
  { key: 'hypertrophy', label: 'Hypertrophy', color: '#52525B' },
  { key: 'endurance',   label: 'Endurance',   color: '#A1A1AA' },
  { key: 'power',       label: 'Power',       color: '#6366F1' },
];

interface Props {
  distribution: Record<IntensityZone, number>; // fractions, ~sum to 1
  size?: number;
  stroke?: number;
}

export function ZoneDonut({ distribution, size = 76, stroke = 13 }: Props) {
  const r = (size - stroke) / 2;
  const cir = 2 * Math.PI * r;

  // Build the arc segments. Each zone is a Circle whose dash covers its
  // fraction of the circumference, offset by the cumulative fraction so
  // far. The whole thing is rotated -90° to start at 12 o'clock.
  let cumulative = 0;
  const segments = ZONE_META.map((z) => {
    const frac = Math.max(0, distribution[z.key] ?? 0);
    const seg = {
      ...z,
      frac,
      dashArray: `${(frac * cir).toFixed(2)} ${cir.toFixed(2)}`,
      dashOffset: -(cumulative * cir),
    };
    cumulative += frac;
    return seg;
  }).filter((s) => s.frac > 0.005);

  // Spoken summary of the mix, e.g. "Training mix: strength 33%, hypertrophy 35%".
  const a11yLabel = 'Training mix: ' + (segments.length
    ? segments.map((s) => `${s.label.toLowerCase()} ${Math.round(s.frac * 100)} percent`).join(', ')
    : 'no data');

  return (
    <Svg
      width={size}
      height={size}
      accessibilityRole="image"
      accessibilityLabel={a11yLabel}
    >
      {/* faint full-circle track behind the segments */}
      <Circle
        cx={size / 2} cy={size / 2} r={r}
        fill="none" stroke="#F4F4F5" strokeWidth={stroke}
      />
      {segments.map((s) => (
        <Circle
          key={s.key}
          cx={size / 2} cy={size / 2} r={r}
          fill="none"
          stroke={s.color}
          strokeWidth={stroke}
          strokeDasharray={s.dashArray}
          strokeDashoffset={s.dashOffset}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      ))}
    </Svg>
  );
}
