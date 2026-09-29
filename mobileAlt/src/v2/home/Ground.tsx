// Home ground (review #4 §1, layers 1–2): the art's own tone continued across
// the screen so the image never ends in a visible step.
//   1. Radial base centred at (62 %, 22 %), radius 120 % × 70 % (an ellipse),
//      stops #262626 0 % → #232323 45 % → #1b1b1b 100 %.
//   2. Grain: fractal noise, white, 7 % opacity, screen blend, baseFrequency .9,
//      2 octaves — continues the engraving's static so there's no texture edge.
// Static: drawn once. The track fades it with the brief → chat progress.

import React from 'react';
import { StyleSheet, useWindowDimensions } from 'react-native';
import { Canvas, Rect, Group, RadialGradient, FractalNoise } from '@shopify/react-native-skia';

export function HomeGround() {
  const { width: W, height: H } = useWindowDimensions();
  const c = { x: W * 0.62, y: H * 0.22 };
  const rx = W * 1.2, ry = H * 0.7;
  return (
    <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
      <Rect x={0} y={0} width={W} height={H}>
        {/* Elliptical: a circle of radius rx, squashed to ry about the centre. */}
        <RadialGradient c={c} r={rx} colors={['#262626', '#232323', '#1b1b1b']} positions={[0, 0.45, 1]} origin={c} transform={[{ scaleY: ry / rx }]} />
      </Rect>
      <Group opacity={0.07} blendMode="screen">
        <Rect x={0} y={0} width={W} height={H}>
          <FractalNoise freqX={0.9} freqY={0.9} octaves={2} tileWidth={160} tileHeight={160} />
        </Rect>
      </Group>
    </Canvas>
  );
}
