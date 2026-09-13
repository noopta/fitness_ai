import React from 'react';
import { Image, View, StyleSheet } from 'react-native';

interface AxiomLogoProps {
  size?: number;
  /** If true, renders the dark mark on a white tile (for use on dark backgrounds) */
  inverted?: boolean;
}

/**
 * The Axiom logomark (the layered-petal mark from the app icon) inside a
 * rounded-square tile. Both variants are derived from assets/icon.png by the
 * brand asset script, so this stays in lock-step with the App Store icon.
 * Default: white mark on the icon's near-black ground.
 * Inverted: black mark on white with a hairline border.
 */
export function AxiomLogo({ size = 44, inverted = false }: AxiomLogoProps) {
  const borderRadius = size * 0.22;
  const markSize = size * 0.62;
  return (
    <View
      style={[
        styles.container,
        {
          width: size,
          height: size,
          borderRadius,
          backgroundColor: inverted ? '#FFFFFF' : '#09090b',
          borderColor: inverted ? '#E5E7EB' : 'transparent',
          borderWidth: inverted ? 1 : 0,
        },
      ]}
    >
      <Image
        source={inverted
          ? require('../../../assets/axiom-logo-light-transparent.png')
          : require('../../../assets/axiom-logo-dark-transparent.png')}
        style={{ width: markSize, height: markSize }}
        resizeMode="contain"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
});
