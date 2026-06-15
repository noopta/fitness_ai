import React from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { DitherImage } from './dither/DitherImage';
import {
  WASHES, SCHEMES, s, TYPE, type WashName, type SchemeName, type GrainName,
} from './theme';

interface PosterProps {
  wash: WashName;
  scheme?: SchemeName;
  photo?: ReturnType<typeof require>;     // require('./assets/photos/foo.jpg')
  grain?: GrainName;
  lx?: number;                             // light-source x, 0..1
  ly?: number;                             // light-source y, 0..1
  scrim?: number;                          // bottom scrim alpha, 0..1
  kicker?: string;                         // top-left brand label
  step?: string;                            // top-right "01 / 07"
  slug?: string;                            // top-right slug (overrides step)
  reducedMotion?: boolean;
  children: React.ReactNode;
}

/**
 * Per spec §08. Z-order bottom→top:
 *   1. deep fill (wash.deep) — instant before Skia decodes
 *   2. DitherImage — full-bleed
 *   3. accent bloom — radial at (lx,ly), screen blend, ~0.5 layer opacity
 *   4. legibility scrim — vertical gradient for headline contrast
 *   5. corner vignette — inset shadow (4-edge gradient approximation)
 *   6. top chrome — logo chip + kicker + step|slug
 *   7. content block — absolutely positioned, ≥ home-indicator inset
 *
 * Notes
 * - The bloom + corner vignette are approximated with positioned gradient
 *   views (RN has no native screen-blend or inset-shadow). On Dark scheme
 *   over a dithered photo they read identically; on Light they're subtler.
 * - lx/ly are not yet wired to the bloom position; bloom centers on the
 *   light source if (lx, ly) are passed (default 0.5, 0.4).
 */
export function Poster({
  wash, scheme = 'Dark', photo, grain = 'Fine',
  lx = 0.5, ly = 0.4, scrim = 0.78,
  kicker, step, slug,
  reducedMotion,
  children,
}: PosterProps) {
  const insets = useSafeAreaInsets();
  const contentBottom = Math.max(insets.bottom + s(24), s(96));

  const w = WASHES[wash];
  const accent = w.accent;
  const deep = w.deep;
  const chromeTop = Math.max(insets.top + s(8), s(60));
  const chromeText = SCHEMES[scheme].fg;

  return (
    <View style={[styles.root, { backgroundColor: deep }]}>
      {/* Layer 2 — DitherImage (or pure deep fill if no photo) */}
      {photo ? (
        <View style={StyleSheet.absoluteFill}>
          <DitherImage source={photo} wash={wash} scheme={scheme} grain={grain} reducedMotion={reducedMotion} />
        </View>
      ) : null}

      {/* Layer 3 — accent bloom (radial-ish; approximation with a positioned
         soft-edge circle. screen blend isn't available in RN but on Dark
         dithered art it reads the same.) */}
      <View
        pointerEvents="none"
        style={[
          styles.bloom,
          {
            left:   `${(lx * 100) - 23}%`,
            top:    `${(ly * 100) - 18}%`,
            width:  '46%',
            height: '36%',
            backgroundColor: accent,
            opacity: 0.16,
          },
        ]}
      />

      {/* Layer 4 — legibility scrim (vertical, biases the lower 60% so the
         content block always lifts off the image) */}
      <LinearGradient
        pointerEvents="none"
        colors={[
          `${deep}52`,            // 0%   ~0.32 alpha
          'transparent',          // 24%
          'transparent',          // 40%
          `${deep}${alphaHex(scrim)}`,  // 74%
          `${deep}fa`,            // 100% ~0.98 alpha
        ]}
        locations={[0, 0.24, 0.4, 0.74, 1]}
        style={StyleSheet.absoluteFill}
      />

      {/* Layer 5 — corner vignette (4-edge gradients approximating an inner
         shadow) */}
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        <LinearGradient
          colors={[`${deep}e6`, 'transparent']}
          start={{ x: 0, y: 0 }} end={{ x: 0, y: 0.3 }}
          style={StyleSheet.absoluteFill}
        />
        <LinearGradient
          colors={['transparent', `${deep}e6`]}
          start={{ x: 0, y: 0.7 }} end={{ x: 0, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
      </View>

      {/* Layer 6 — top chrome */}
      <View style={[styles.chrome, { top: chromeTop }]}>
        <View style={styles.chromeLeft}>
          <View style={styles.logoChip}>
            <Text style={styles.logoLetter}>A</Text>
          </View>
          {kicker ? <Text style={[styles.kicker, { color: chromeText }]}>{kicker}</Text> : null}
        </View>
        <Text style={[styles.stepLabel, { color: 'rgba(255,255,255,0.62)' }]}>
          {slug ?? step ?? ''}
        </Text>
      </View>

      {/* Layer 7 — content slot, anchored to the bottom */}
      <View style={[styles.content, { bottom: contentBottom }]}>
        {children}
      </View>
    </View>
  );
}

function alphaHex(a: number): string {
  // 0..1 → 00..ff for hex color suffix
  const clamped = Math.max(0, Math.min(1, a));
  return Math.round(clamped * 255).toString(16).padStart(2, '0');
}

const styles = StyleSheet.create({
  root: { flex: 1, overflow: 'hidden' },
  bloom: {
    position: 'absolute',
    borderRadius: 9999,
  },
  chrome: {
    position: 'absolute',
    left: s(26), right: s(26),
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  chromeLeft: { flexDirection: 'row', alignItems: 'center', gap: s(8) },
  logoChip: {
    width: s(19), height: s(19), borderRadius: 5,
    backgroundColor: '#fff',
    alignItems: 'center', justifyContent: 'center',
  },
  logoLetter: { color: '#09090b', fontSize: 12, fontWeight: '900' as const, lineHeight: 14 },
  kicker: { fontSize: 14.5, fontWeight: '700' as const },
  stepLabel: {
    fontFamily: Platform.select({ ios: TYPE.mono, default: 'monospace' }),
    fontSize: TYPE.chrome, fontWeight: '600' as const, letterSpacing: 0.5,
  },
  content: {
    position: 'absolute',
    left: s(26), right: s(26),
  },
});
