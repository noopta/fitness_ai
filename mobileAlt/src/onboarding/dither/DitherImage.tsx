import React from 'react';
import { Image, StyleSheet } from 'react-native';
import type { WashName, SchemeName, GrainName } from '../theme';
import { DITHERED } from '../assets/dithered/manifest';

export interface DitherImageProps {
  source: ReturnType<typeof require>;     // the raw scene photo (require('...png'))
  wash: WashName;
  scheme: SchemeName;
  grain?: GrainName;
  vignette?: 0 | 1;
  reducedMotion?: boolean;
}

/**
 * Renders the PRE-RENDERED dither for a scene photo as a plain <Image>.
 *
 * The duotone Bayer dither used to run live in a Skia <Canvas> + RuntimeEffect
 * per scene. Rebuilding that on every scene change was the source of the
 * transition jank (and a chunk of memory). The dither is fully static, so it's
 * baked offline (scripts/generate-dithered.js) into 2-colour PNGs keyed by the
 * raw photo; here we just look up the baked asset and draw it. Mounting is now
 * a cheap image draw, so transitions stay smooth.
 *
 * wash/scheme/grain/vignette are already baked into the asset and kept only so
 * callers (Poster/scenes) don't need to change. Falls back to the raw photo if a
 * baked asset is missing for this source.
 */
export function DitherImage({ source }: DitherImageProps) {
  const baked = DITHERED[source as unknown as number] ?? source;
  return <Image source={baked} style={StyleSheet.absoluteFill} resizeMode="cover" />;
}
