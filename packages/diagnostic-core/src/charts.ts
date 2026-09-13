import type { RadarIndices } from './types';
import { liftFamily } from './lifts';

// Chart geometry shared by react-native-svg and inline web SVG, so both
// platforms draw the same polygon and arc paths (§9 "Charts").

export interface RadarAxis {
  key: keyof RadarIndices;
  label: string;
  value: number | null;
  /** Spoke end (100%) and the value vertex, in the chart's own coordinates. */
  end: { x: number; y: number };
  labelAt: { x: number; y: number; anchor: 'start' | 'middle' | 'end' };
  point: { x: number; y: number } | null;
}

export interface RadarGeometry {
  size: number;
  center: number;
  axes: RadarAxis[];
  /** Norm ring (index 100) as a closed path. */
  ringPath: string;
  /** Polygon through the measured vertices; null with fewer than 3 measured axes. */
  valuePath: string | null;
}

const AXES: Record<string, { key: keyof RadarIndices; label: string }[]> = {
  press: [
    { key: 'triceps_index', label: 'Triceps' },
    { key: 'shoulder_index', label: 'Shoulders' },
    { key: 'back_tension_index', label: 'Upper back' },
  ],
  lower: [
    { key: 'quad_index', label: 'Quads' },
    { key: 'posterior_index', label: 'Posterior' },
    { key: 'back_tension_index', label: 'Upper back' },
  ],
};

/** Index 100 = at the norm midpoint; values are capped at 130 for display. */
export function radarGeometry(lift: string, indices: RadarIndices, size = 200): RadarGeometry {
  const family = liftFamily(lift);
  const axisDefs = AXES[family === 'press' ? 'press' : 'lower'];
  const center = size / 2;
  const radius = size * 0.34;
  const scale = (v: number) => (Math.min(v, 130) / 130) * radius;
  const at = (i: number, r: number) => {
    const angle = -Math.PI / 2 + (i * 2 * Math.PI) / axisDefs.length;
    return { x: round(center + r * Math.cos(angle)), y: round(center + r * Math.sin(angle)) };
  };

  const axes: RadarAxis[] = axisDefs.map((a, i) => {
    const value = indices[a.key] ?? null;
    const end = at(i, scale(130));
    const l = at(i, scale(130) + 16);
    const anchor = Math.abs(l.x - center) < 2 ? 'middle' : l.x > center ? 'start' : 'end';
    return { key: a.key, label: a.label, value, end, labelAt: { ...l, anchor }, point: value == null ? null : at(i, scale(value)) };
  });

  const ring = axisDefs.map((_, i) => at(i, scale(100)));
  const measured = axes.filter((a) => a.point);
  return {
    size,
    center,
    axes,
    ringPath: closedPath(ring),
    valuePath: measured.length >= 3 ? closedPath(measured.map((a) => a.point!)) : null,
  };
}

export interface ArcGeometry {
  trackPath: string;
  valuePath: string;
  /** 0–1 along the arc. */
  fraction: number;
}

/** Efficiency gauge: a 180° arc over the engine's 40–95 range. */
export function efficiencyArc(score: number, size = 160, stroke = 10): ArcGeometry {
  const fraction = Math.max(0, Math.min(1, (score - 40) / 55));
  const r = (size - stroke) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const point = (t: number) => {
    const angle = Math.PI + t * Math.PI;
    return { x: round(cx + r * Math.cos(angle)), y: round(cy + r * Math.sin(angle)) };
  };
  const start = point(0);
  const end = point(1);
  const v = point(fraction);
  return {
    trackPath: `M ${start.x} ${start.y} A ${r} ${r} 0 0 1 ${end.x} ${end.y}`,
    valuePath: fraction === 0 ? '' : `M ${start.x} ${start.y} A ${r} ${r} 0 0 1 ${v.x} ${v.y}`,
    fraction,
  };
}

function closedPath(points: { x: number; y: number }[]): string {
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ') + ' Z';
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
