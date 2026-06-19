// 3.3 · Hero + photo — A1d · 9:16 · with photo.
// Top ~44% is the cropped photo with a top-down gradient for legibility; brand
// (white) + "Session logged" eyebrow overlaid at top. The data panel covers the
// bottom ~60% with rounded top corners and an upward shadow; its surface follows
// the Light/Dark toggle. Content is the same PR-led block as the Hero.
// The toggle (pinned top-right of the panel) is chrome, rendered by the sheet.

import React from 'react';
import { View } from 'react-native';
import { ShareableWorkout, ShareTheme, CropTransform } from '../types';
import { cardColors, panelShadow } from '../tokens';
import { BrandLockup, Eyebrow, VerticalScrim } from '../parts';
import { HeroBody } from '../HeroBody';
import { PhotoWindow } from '../PhotoWindow';

interface Props {
  p: (n: number) => number;
  width: number;
  height: number;
  data: ShareableWorkout;
  theme: ShareTheme;
  uri: string;
  crop: CropTransform;
  interactive?: boolean;
  onCropChange?: (c: CropTransform) => void;
}

export function HeroPhotoCard({ p, width, height, data, theme, uri, crop, interactive, onCropChange }: Props) {
  const dark = theme === 'dark';
  const photoH = height * 0.46;
  const panelH = height * 0.60;
  const panelPad = p(30);

  const surface = dark ? cardColors.darkSurface : cardColors.background;
  const ink = dark ? '#ffffff' : cardColors.ink;
  const muted = dark ? cardColors.onDarkMuted : cardColors.mutedText;
  const success = dark ? cardColors.successOnDark : cardColors.successInk;
  const hairline = dark ? cardColors.glassHairline : cardColors.border;

  return (
    <View style={{ width, height, backgroundColor: surface, overflow: 'hidden' }}>
      {/* Photo header — crop band */}
      <PhotoWindow
        uri={uri}
        crop={crop}
        width={width}
        height={photoH}
        interactive={interactive}
        onCropChange={onCropChange}
      >
        <VerticalScrim
          id={`a1dScrim-${Math.round(width)}`}
          width={width}
          height={photoH}
          stops={[
            { offset: 0, color: '#09090b', opacity: 0.5 },
            { offset: 0.34, color: '#09090b', opacity: 0 },
          ]}
        />
        <View style={{ position: 'absolute', top: p(30), left: panelPad, right: panelPad, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <BrandLockup p={p} mark={cardColors.ink} tileBg="#ffffff" wordmark="#ffffff" />
          <Eyebrow p={p} color={cardColors.onDarkMuted}>Session logged</Eyebrow>
        </View>
      </PhotoWindow>

      {/* Data panel */}
      <View
        style={{
          position: 'absolute', left: 0, right: 0, bottom: 0, height: panelH,
          backgroundColor: surface, borderTopLeftRadius: p(22), borderTopRightRadius: p(22),
          paddingHorizontal: panelPad, paddingTop: p(30), paddingBottom: panelPad,
          ...panelShadow(p),
        }}
      >
        <HeroBody p={p} data={data} ink={ink} muted={muted} success={success} hairline={hairline} maxExercises={3} />
      </View>
    </View>
  );
}
