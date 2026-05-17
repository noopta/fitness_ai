import React from 'react';
import { G, Path } from 'react-native-svg';

// Ghosted front-facing body silhouette, rendered behind the radar polygon
// at low opacity (design handoff §6 — "BodySilhouette behind the polygon at
// opacity 0.08, scaled to fit inside the inner ring"). Returns SVG children
// (a <G>) so it composes inside RadarChart's existing <Svg>.
//
// The path is authored in a 200×300 viewBox; the component scales + centers
// it to a requested fit-height around the radar's center point.

// Front-facing human outline — head, torso, arms, legs. Single closed path.
const BODY_PATH =
  'M100 8 C108 8 116 14 116 26 C116 36 113 42 110 46 ' +
  'C118 48 128 52 134 60 C140 68 144 80 145 96 ' +
  'C146 110 144 124 142 134 C146 138 150 144 152 152 ' +
  'C158 168 162 188 162 210 C162 226 158 240 156 256 ' +
  'C154 268 154 280 154 290 L132 290 ' +
  'C130 280 128 268 126 256 C124 244 122 230 120 218 ' +
  'C118 230 116 240 114 248 L86 248 ' +
  'C84 240 82 230 80 218 C78 230 76 244 74 256 ' +
  'C72 268 70 280 68 290 L46 290 ' +
  'C46 280 46 268 44 256 C42 240 38 226 38 210 ' +
  'C38 188 42 168 48 152 C50 144 54 138 58 134 ' +
  'C56 124 54 110 55 96 C56 80 60 68 66 60 ' +
  'C72 52 82 48 90 46 C87 42 84 36 84 26 ' +
  'C84 14 92 8 100 8 Z';

const VB_W = 200;
const VB_H = 300;

interface Props {
  /** Radar center. */
  cx: number;
  cy: number;
  /** Height the silhouette is scaled to occupy. */
  fitHeight: number;
  opacity?: number;
  color?: string;
}

export function BodySilhouette({ cx, cy, fitHeight, opacity = 0.08, color = '#09090B' }: Props) {
  const scale = fitHeight / VB_H;
  // Center the scaled 200×300 figure on (cx, cy).
  const tx = cx - (VB_W * scale) / 2;
  const ty = cy - (VB_H * scale) / 2;
  return (
    <G transform={`translate(${tx.toFixed(1)} ${ty.toFixed(1)}) scale(${scale.toFixed(4)})`} opacity={opacity}>
      <Path d={BODY_PATH} fill={color} />
    </G>
  );
}
