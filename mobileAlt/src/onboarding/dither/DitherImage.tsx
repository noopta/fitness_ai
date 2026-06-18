import React, { useEffect } from 'react';
import { Image, PixelRatio, useWindowDimensions, View } from 'react-native';
import {
  Canvas, Fill, Shader, Skia, useImage, ImageShader, fitbox, rect,
} from '@shopify/react-native-skia';
import { useSharedValue, withTiming, Easing } from 'react-native-reanimated';
import { WASHES, pickInks, GRAIN, type WashName, type SchemeName, type GrainName } from '../theme';
import { DITHER_SKSL } from './dither.sksl';
import { BAYER8_NORM } from './bayer';

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
  reducedMotion?: boolean;                // if true, skip the develop animation
}

/**
 * Renders the source image as a Bayer-8 ordered dither in the wash's duotone.
 * On mount the "develop" animation tweens the cell uniform from grain×7 down
 * to grain over 780ms easeOutExpo — the stipple resolves from coarse blocks
 * into fine grain. Replaces the web prototype's blur-clear entrance.
 */
export function DitherImage({
  source, wash, scheme, grain = 'Fine', vignette = 1, reducedMotion = false,
}: DitherImageProps) {
  const img = useImage(source);
  const { width: W, height: H } = useWindowDimensions();
  const dpr = PixelRatio.get();
  const targetCell = GRAIN[grain] * dpr;

  // Animated cell size. Start at 7× target (coarse) and resolve to target.
  const cell = useSharedValue(reducedMotion ? targetCell : targetCell * 7);
  useEffect(() => {
    if (reducedMotion) {
      cell.value = targetCell;
      return;
    }
    cell.value = withTiming(targetCell, {
      duration: 780,
      easing: Easing.bezier(0.16, 1, 0.3, 1),  // approximates easeOutExpo
    });
  }, [reducedMotion, targetCell]);

  const { darkInk, lightInk } = pickInks(wash, scheme);

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

  // Cover-fit the source image into the screen rect.
  const src = rect(0, 0, img.width(), img.height());
  const dst = rect(0, 0, W * dpr, H * dpr);
  const m = fitbox('cover', src, dst);

  return (
    <Canvas style={{ flex: 1 }}>
      <Fill>
        <Shader
          source={effect}
          uniforms={{
            res: [W * dpr, H * dpr],
            cell: cell as unknown as number,
            darkInk: darkInk as unknown as number[],
            lightInk: lightInk as unknown as number[],
            vignette,
            bayer: BAYER8_NORM,
          }}
        >
          <ImageShader image={img} tx="clamp" ty="clamp" fit="cover" rect={dst} transform={m} />
        </Shader>
      </Fill>
    </Canvas>
  );
}
