import React from 'react';
import { View, StyleSheet } from 'react-native';
import Svg, { Path } from 'react-native-svg';

interface AxiomLogoProps {
  size?: number;
  /** If true, renders black mark on white bg (for use on dark backgrounds) */
  inverted?: boolean;
}

/**
 * The Axiom "A" chevron logomark inside a rounded-square container.
 * Default: white mark on black background.
 * Inverted: black mark on white background with border.
 */
export function AxiomLogo({ size = 44, inverted = false }: AxiomLogoProps) {
  const iconSize = size * 0.5;
  const borderRadius = size * 0.22;
  const markColor = inverted ? '#000000' : '#FFFFFF';
  const bgColor = inverted ? '#FFFFFF' : '#000000';
  const borderColor = inverted ? '#E5E7EB' : 'transparent';

  return (
    <View
      style={[
        styles.container,
        {
          width: size,
          height: size,
          borderRadius,
          backgroundColor: bgColor,
          borderColor,
          borderWidth: inverted ? 1 : 0,
        },
      ]}
    >
      <Svg
        width={iconSize}
        height={iconSize}
        viewBox="0 0 24 24"
        fill="none"
      >
        <Path
          d="M12 2L2 22H7L12 12L17 22H22L12 2Z"
          fill={markColor}
        />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
