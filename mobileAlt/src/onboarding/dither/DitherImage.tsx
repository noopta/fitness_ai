import React, { useEffect } from 'react';
import { Image, useWindowDimensions, View } from 'react-native';
import {
  Canvas, Fill, Shader, Skia, useImage, ImageShader, rect,
} from '@shopify/react-native-skia';
import Animated, {
  useSharedValue, useDerivedValue, useAnimatedStyle, withTiming, Easing,
} from 'react-native-reanimated';
import { WASHES, pickInks, GRAIN, type WashName, type SchemeName, type GrainName } from '../theme';
import { DITHER_SKSL } from './dither.sksl';
import { BAYER8_NORM } from './bayer';
import { getCachedPhoto } from './photoCache';

// Compile the dither shader once at module load. IMPORTANT: never throw here —
// a module-load throw takes down the entire app on launch (this WAS the SDK-55
// launch crash: Skia 2.4's SkSL compiler rejects dynamic array indexing —
// `bayer[by*8+bx]` — so DITHER_SKSL fails to compile, the throw propagated up
// through OnboardingPager → app/_layout.tsx, _layout lost its default export,
// AuthProvider never mounted, and the whole tree crashed). If the shader can't
// compile, `effect` stays null and the component falls back to the plain photo.
let effect: ReturnType<typeof Skia.RuntimeEffect.Make> | null = null;
try {
  effect = Skia.RuntimeEffect.Make(DITHER_SKSL);
} catch (e) {
  console.warn('[DitherImage] dither shader failed to compile — falling back to plain image:', e);
}

export interface DitherImageProps {
  source: ReturnType<typeof require>;     // require('./assets/photos/foo.jpg')
  wash: WashName;
  scheme: SchemeName;
  grain?: GrainName;
  vignette?: 0 | 1;
  reducedMotion?: boolean;                // if true, show instantly (no fade-in)
}

/**
 * Renders the source image as a Bayer-8 ordered dither in the wash's duotone.
 * Grain is fixed-fine; the image is preloaded (photoCache) and fades in over
 * ~220ms so the scene paints smoothly and immediately. (The old coarse→fine
 * "develop" of the grain cell read as a choppy load and was replaced.)
 */
export function DitherImage({
  source, wash, scheme, grain = 'Fine', vignette = 1, reducedMotion = false,
}: DitherImageProps) {
  // Prefer the preloaded (already-decoded) image so the scene paints complete on
  // its first frame — no deep-wash + bloom flash before the photo appears. Falls
  // back to an async decode if preload hasn't run/finished for this source.
  const loaded = useImage(source);
  const img = getCachedPhoto(source as unknown as number) ?? loaded;

  const { width: W, height: H } = useWindowDimensions();
  // Skia's Fill shader receives fragcoords in LOGICAL points (the canvas's RN
  // coordinate space), not device pixels — so the grain cell and the resolution
  // uniform must be in points too. The earlier *dpr (the spec assumed a pixel-
  // space fragcoord) made the grain ~2× too coarse AND sampled only the left
  // ~half of each photo, which read as "too zoomed in".
  const targetCell = GRAIN[grain];

  // Smooth, fast fade-in instead of the old coarse→fine "develop" of the grain
  // cell, which re-resolved the whole dither on screen and read as a choppy load.
  // The grain now stays fixed-fine; only opacity animates.
  const fade = useSharedValue(reducedMotion ? 1 : 0);
  useEffect(() => {
    if (reducedMotion || !img) return;
    fade.value = withTiming(1, { duration: 220, easing: Easing.out(Easing.quad) });
  }, [reducedMotion, img]);
  const fadeStyle = useAnimatedStyle(() => ({ opacity: fade.value }));

  const { darkInk, lightInk } = pickInks(wash, scheme);

  // Uniforms as a derived value (Skia reads it on the UI thread). The grain cell
  // is fixed now (fade handles the entrance), but keeping the derived value lets
  // the shader pick up resolution/ink changes without re-creating the object.
  const uniforms = useDerivedValue(() => ({
    res: [W, H],
    cell: targetCell,
    darkInk,
    lightInk,
    vignette,
    bayer: BAYER8_NORM,
  }), [W, H, targetCell, darkInk, lightInk, vignette]);

  // If the dither shader didn't compile on this Skia version, render the source
  // photo plainly so onboarding still works. Aesthetic-only degradation — no
  // dither texture, but no crash. (Restore the effect by fixing DITHER_SKSL to
  // avoid dynamic array indexing for Skia 2.4+.)
  if (!effect) {
    return <Image source={source} style={{ flex: 1, width: '100%', height: '100%' }} resizeMode="cover" />;
  }

  // If the image hasn't decoded yet, paint the deep wash. This is the instant
  // fallback the spec calls out — no flash of background, no loading spinner.
  if (!img) {
    return <View style={{ flex: 1, backgroundColor: WASHES[wash].deep }} />;
  }

  // Cover-fit the source image into the screen rect. Let ImageShader do the
  // cover fit via fit="cover" + rect ONLY — do NOT also pass a fitbox transform,
  // or cover gets applied twice and the photo is zoomed in / distorted.
  const dst = rect(0, 0, W, H);

  return (
    <Animated.View style={[{ flex: 1 }, fadeStyle]}>
      <Canvas style={{ flex: 1 }}>
        <Fill>
          <Shader source={effect} uniforms={uniforms}>
            <ImageShader image={img} tx="clamp" ty="clamp" fit="cover" rect={dst} />
          </Shader>
        </Fill>
      </Canvas>
    </Animated.View>
  );
}
