import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { colors, fontSize, fontWeight } from '../constants/theme';

interface Props {
  score: number; // 40-95
  size?: number;
}

export function EfficiencyGauge({ score, size = 160 }: Props) {
  const cx = size / 2;
  const cy = size * 0.6;
  const r = size * 0.38;
  const strokeWidth = size * 0.08;

  // Normalise score into 0-1 within the 40-95 range
  const pct = Math.min(Math.max((score - 40) / 55, 0), 1);
  // The arc goes from left (π) sweeping clockwise to right (0), total sweep = π
  const sweepAngle = Math.PI * pct;

  // Background arc: full semicircle from left to right
  const bgPath = `M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`;

  // Foreground arc end-point
  const endX = cx + r * Math.cos(Math.PI - sweepAngle);
  const endY = cy - r * Math.sin(sweepAngle);
  // largeArcFlag is 1 when sweep > 90° (π/2)
  const largeArcFlag = sweepAngle > Math.PI / 2 ? 1 : 0;
  const fgPath =
    sweepAngle > 0.01
      ? `M ${cx - r} ${cy} A ${r} ${r} 0 ${largeArcFlag} 1 ${endX} ${endY}`
      : null;

  const getColor = (): string => {
    if (score >= 80) return colors.success;
    if (score >= 65) return colors.primary;
    if (score >= 50) return colors.warning;
    return colors.destructive;
  };

  const getLabel = (): string => {
    if (score >= 80) return 'Excellent';
    if (score >= 65) return 'Good';
    if (score >= 50) return 'Fair';
    return 'Needs Work';
  };

  const svgHeight = size * 0.7;

  return (
    <View style={styles.container}>
      <Svg width={size} height={svgHeight}>
        {/* Background track */}
        <Path
          d={bgPath}
          fill="none"
          stroke={colors.muted}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
        />
        {/* Filled progress arc */}
        {fgPath ? (
          <Path
            d={fgPath}
            fill="none"
            stroke={getColor()}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
          />
        ) : null}
      </Svg>
      <View style={styles.scoreContainer}>
        <Text style={[styles.score, { color: getColor() }]}>{score}</Text>
        <Text style={styles.label}>{getLabel()}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: 'center' },
  scoreContainer: {
    alignItems: 'center',
    marginTop: -16,
  },
  score: {
    fontSize: 36,
    fontWeight: fontWeight.bold,
  },
  label: {
    fontSize: fontSize.sm,
    color: colors.mutedForeground,
    marginTop: 2,
  },
});
