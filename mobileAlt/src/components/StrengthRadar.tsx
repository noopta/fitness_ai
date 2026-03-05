import React from 'react';
import { View, StyleSheet } from 'react-native';
import Svg, { Polygon, Circle, Line, Text as SvgText } from 'react-native-svg';
import { colors } from '../constants/theme';

interface Props {
  data: {
    quad_index?: number;
    posterior_index?: number;
    back_tension_index?: number;
    triceps_index?: number;
    shoulder_index?: number;
  };
  size?: number;
}

export function StrengthRadar({ data, size = 200 }: Props) {
  const labels = ['Quad', 'Posterior', 'Back', 'Triceps', 'Shoulder'];
  const values = [
    data.quad_index ?? 50,
    data.posterior_index ?? 50,
    data.back_tension_index ?? 50,
    data.triceps_index ?? 50,
    data.shoulder_index ?? 50,
  ];

  const center = size / 2;
  const maxRadius = center - 30;
  const numAxes = 5;

  const getPoint = (index: number, value: number) => {
    const angle = (Math.PI * 2 * index) / numAxes - Math.PI / 2;
    const r = (value / 100) * maxRadius;
    return {
      x: center + r * Math.cos(angle),
      y: center + r * Math.sin(angle),
    };
  };

  const rings = [25, 50, 75, 100];

  const dataPoints = values.map((v, i) => getPoint(i, v));
  const dataPolygon = dataPoints.map(p => `${p.x},${p.y}`).join(' ');
  const axisEndPoints = labels.map((_, i) => getPoint(i, 100));

  return (
    <View style={styles.container}>
      <Svg width={size} height={size}>
        {/* Grid rings */}
        {rings.map(r => {
          const pts = labels.map((_, i) => getPoint(i, r));
          const poly = pts.map(p => `${p.x},${p.y}`).join(' ');
          return (
            <Polygon
              key={r}
              points={poly}
              fill="none"
              stroke={colors.border}
              strokeWidth={1}
            />
          );
        })}

        {/* Axis lines */}
        {axisEndPoints.map((pt, i) => (
          <Line
            key={i}
            x1={center}
            y1={center}
            x2={pt.x}
            y2={pt.y}
            stroke={colors.border}
            strokeWidth={1}
          />
        ))}

        {/* Data polygon fill */}
        <Polygon
          points={dataPolygon}
          fill={`${colors.primary}40`}
          stroke={colors.primary}
          strokeWidth={2}
        />

        {/* Data point dots */}
        {dataPoints.map((pt, i) => (
          <Circle key={i} cx={pt.x} cy={pt.y} r={4} fill={colors.primary} />
        ))}

        {/* Axis labels */}
        {axisEndPoints.map((pt, i) => {
          const angle = (Math.PI * 2 * i) / numAxes - Math.PI / 2;
          const labelR = maxRadius + 18;
          const lx = center + labelR * Math.cos(angle);
          const ly = center + labelR * Math.sin(angle);
          return (
            <SvgText
              key={i}
              x={lx}
              y={ly + 4}
              textAnchor="middle"
              fill={colors.mutedForeground}
              fontSize={9}
            >
              {labels[i]}
            </SvgText>
          );
        })}
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: 'center', justifyContent: 'center' },
});
