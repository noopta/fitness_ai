import React from 'react';
import { Text, TextStyle } from 'react-native';
import { colors } from '../../constants/theme';

interface Props {
  /** Numeric delta. null → renders an em-dash placeholder per the handoff. */
  value: number | null;
  suffix?: string;
  size?: number;
  /** When true, positive deltas use the muted color (used inside dark cards). */
  invert?: boolean;
  style?: TextStyle;
}

/**
 * Monospace +/- delta. Color codes positive-green / negative-red. null → em-dash.
 */
export function DeltaTag({ value, suffix = ' lb', size = 11, invert = false, style }: Props) {
  if (value == null) {
    return (
      <Text
        accessibilityLabel="No delta available"
        style={[
          {
            fontSize: size,
            fontWeight: '700',
            fontFamily: 'Menlo',
            color: colors.mutedForeground,
            fontVariant: ['tabular-nums'],
          },
          style,
        ]}
      >
        —
      </Text>
    );
  }

  const positive = value > 0;
  const zero = value === 0;
  const color = zero
    ? colors.mutedForeground
    : positive
      ? invert ? colors.mutedForeground : '#15803D'
      : '#DC2626';
  const sign = positive ? '+' : '';
  const a11y = zero
    ? 'no change'
    : positive
      ? `up ${Math.abs(value)}${suffix}`
      : `down ${Math.abs(value)}${suffix}, declining`;

  return (
    <Text
      accessibilityLabel={a11y}
      style={[
        {
          fontSize: size,
          fontWeight: '700',
          fontFamily: 'Menlo',
          color,
          fontVariant: ['tabular-nums'],
        },
        style,
      ]}
    >
      {sign}{value}{suffix}
    </Text>
  );
}
