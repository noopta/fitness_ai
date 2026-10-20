// The typefaces and the mark the shareables draw with. Inter from the bundle
// (the same files useV2Fonts loads), decoded by Skia once per mount.

import { useMemo } from 'react';
import { useTypeface, useImage } from '@shopify/react-native-skia';
import type { Faces } from './skiaShare';

export function useShareAssets(): { faces: Faces; mark: ReturnType<typeof useImage> } | null {
  const w400 = useTypeface(require('@expo-google-fonts/inter/400Regular/Inter_400Regular.ttf'));
  const w500 = useTypeface(require('@expo-google-fonts/inter/500Medium/Inter_500Medium.ttf'));
  const w600 = useTypeface(require('@expo-google-fonts/inter/600SemiBold/Inter_600SemiBold.ttf'));
  const w700 = useTypeface(require('@expo-google-fonts/inter/700Bold/Inter_700Bold.ttf'));
  const w800 = useTypeface(require('@expo-google-fonts/inter/800ExtraBold/Inter_800ExtraBold.ttf'));
  const mark = useImage(require('../../../assets/v2/axiom-mark.png'));
  return useMemo(() => (w400 && w500 && w600 && w700 && w800 ? { faces: { 400: w400, 500: w500, 600: w600, 700: w700, 800: w800 }, mark } : null), [w400, w500, w600, w700, w800, mark]);
}
