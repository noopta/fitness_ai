// 3.1 · Hero — A1b (light) / A1c (dark) · 9:16 · no photo.
// A single template with a Light/Dark theme prop (NOT two screens). Brand lockup
// + "Session logged" eyebrow up top; the PR-led body block is bottom-anchored.
// The centered Light/Dark toggle is share-sheet chrome, rendered by the sheet
// over the preview — it is NOT part of this card (excluded from capture).

import React from 'react';
import { View } from 'react-native';
import { ShareableWorkout, ShareTheme } from '../types';
import { cardColors } from '../tokens';
import { BrandLockup, Eyebrow, CornerGlow } from '../parts';
import { HeroBody } from '../HeroBody';

interface Props {
  p: (n: number) => number;
  width: number;
  height: number;
  data: ShareableWorkout;
  theme: ShareTheme;
}

export function HeroCard({ p, width, height, data, theme }: Props) {
  const dark = theme === 'dark';
  const surface = dark ? cardColors.darkSurface : cardColors.background;
  const ink = dark ? '#ffffff' : cardColors.ink;
  const muted = dark ? cardColors.onDarkMuted : cardColors.mutedText;
  const success = dark ? cardColors.successOnDark : cardColors.successInk;
  const hairline = dark ? cardColors.glassHairline : cardColors.border;

  return (
    <View style={{ width, height, backgroundColor: surface, padding: p(34), justifyContent: 'space-between', overflow: 'hidden' }}>
      <CornerGlow id={`heroGlow-${Math.round(width)}-${theme}`} width={width} height={height} tint={dark ? '#ffffff' : '#000000'} />

      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <BrandLockup
          p={p}
          mark={dark ? cardColors.ink : '#ffffff'}
          tileBg={dark ? '#ffffff' : cardColors.ink}
          wordmark={ink}
        />
        <Eyebrow p={p} color={muted}>Session logged</Eyebrow>
      </View>

      <HeroBody p={p} data={data} ink={ink} muted={muted} success={success} hairline={hairline} maxExercises={3} />
    </View>
  );
}
