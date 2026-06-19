// Layout system & tokens for the share cards (Shareable Workout Log spec §5).
//
// Each card is authored against a fixed REFERENCE FRAME (story 460×818 / square
// 540×540) and scaled uniformly to whatever width it's told to fill — preview
// width on screen, or the 1080px export raster at capture. Every px value in a
// card multiplies through `scaler(frameW).p(refPx)`, so type never re-tunes per
// device: the whole card scales as one.

import { Platform } from 'react-native';
import { ShareTemplate } from './types';

export const REF = {
  story: { w: 460, h: 818 },   // 9:16 — Hero, A1d, B5, Receipt
  square: { w: 540, h: 540 },  // 1:1  — B3
} as const;

export const EXPORT_WIDTH = 1080; // story → 1080×1920, square → 1080×1080

export function refFor(template: ShareTemplate): { w: number; h: number } {
  return template === 'glassChip' ? REF.square : REF.story;
}

/** Color tokens — map to theme.ts where one exists; the rest are card-only. */
export const cardColors = {
  ink: '#09090b',             // colors.foreground
  background: '#ffffff',      // colors.background
  muted: '#f4f4f5',           // colors.muted
  mutedText: '#71717a',       // colors.mutedForeground
  border: '#e4e4e7',          // colors.border
  successInk: '#15803d',      // PR on light
  successOnDark: '#4ade80',   // PR on dark / glass
  onDarkMuted: 'rgba(255,255,255,0.55)',
  glassFill: 'rgba(9,9,11,0.5)',
  glassFillStrong: 'rgba(9,9,11,0.55)',
  glassHairline: 'rgba(255,255,255,0.16)',
  darkSurface: '#09090b',
} as const;

// Type scale in reference px (spec §5 "Type — Inter Variable").
export const typeScale = {
  prHero: 82,        // 700 / -0.04em / tabular
  prHeroGlass: 58,
  titleHero: 52,     // 700 / -0.035em
  sectionNum: 28,    // 700 / -0.03em / tabular
  liftName: 24,      // 600 / -0.02em
  body: 15,          // 500
  exerciseName: 13,  // 500
  exerciseSet: 12,   // 600
  eyebrow: 11,       // 700 / +0.14em / UPPERCASE
} as const;

export const monoFont = Platform.select({ ios: 'Courier', android: 'monospace', default: 'monospace' });

/** A scaler bound to the width a card is rendering at. */
export function scaler(frameW: number, template: ShareTemplate) {
  const ref = refFor(template);
  const s = frameW / ref.w;
  return {
    s,
    width: frameW,
    height: frameW * (ref.h / ref.w),
    /** ref px → on-frame px */
    p: (n: number) => n * s,
  };
}

export type Scaler = ReturnType<typeof scaler>;

// Long-throw, near-zero-Y shadow used by panels (spec §5).
export function panelShadow(p: (n: number) => number) {
  return {
    shadowColor: '#000',
    shadowOpacity: 0.45,
    shadowRadius: p(44),
    shadowOffset: { width: 0, height: p(-16) },
    elevation: 12,
  };
}
