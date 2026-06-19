// Dispatcher: renders the selected template at a given frame width, scaled as a
// unit. The forwarded ref wraps ONLY the card layers (no chrome) so the capture
// pipeline can rasterize exactly what ships (spec §8).

import React, { forwardRef } from 'react';
import { View, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ShareableWorkout, ShareDraft, ShareTemplate, PHOTO_REQUIRED } from './types';
import { scaler, cardColors } from './tokens';
import { HeroCard } from './cards/HeroCard';
import { ReceiptCard } from './cards/ReceiptCard';
import { HeroPhotoCard } from './cards/HeroPhotoCard';
import { GlassLiftsCard } from './cards/GlassLiftsCard';
import { GlassChipCard } from './cards/GlassChipCard';
import { CropTransform } from './types';

interface Props {
  data: ShareableWorkout;
  draft: ShareDraft;
  frameW: number;
  /** Live photo framing — only the focused on-screen preview enables this. */
  interactive?: boolean;
  onCropChange?: (c: CropTransform) => void;
  /** Capture mode flattens the live glass blur to a deterministic fill. */
  captureMode?: boolean;
}

function PhotoPlaceholder({ p, width, height, square }: { p: (n: number) => number; width: number; height: number; square: boolean }) {
  return (
    <View style={{ width, height, backgroundColor: cardColors.muted, alignItems: 'center', justifyContent: 'center', gap: p(10) }}>
      <Ionicons name="image-outline" size={p(square ? 48 : 56)} color={cardColors.mutedText} />
      <Text style={{ color: cardColors.mutedText, fontSize: p(15), fontWeight: '600' }}>Add a photo</Text>
    </View>
  );
}

export const ShareCard = forwardRef<View, Props>(function ShareCard(
  { data, draft, frameW, interactive, onCropChange, captureMode }, ref,
) {
  const template = draft.template as ShareTemplate;
  const sc = scaler(frameW, template);
  const { p, width, height } = sc;

  let body: React.ReactNode;

  if (PHOTO_REQUIRED[template] && !draft.photo) {
    body = <PhotoPlaceholder p={p} width={width} height={height} square={template === 'glassChip'} />;
  } else {
    switch (template) {
      case 'hero':
        body = <HeroCard p={p} width={width} height={height} data={data} theme={draft.theme} />;
        break;
      case 'receipt':
        body = <ReceiptCard p={p} width={width} height={height} data={data} />;
        break;
      case 'heroPhoto':
        body = (
          <HeroPhotoCard
            p={p} width={width} height={height} data={data} theme={draft.theme}
            uri={draft.photo!.uri} crop={draft.photo!.crop}
            interactive={interactive} onCropChange={onCropChange}
          />
        );
        break;
      case 'glassLifts':
        body = (
          <GlassLiftsCard
            p={p} width={width} height={height} data={data}
            uri={draft.photo!.uri} crop={draft.photo!.crop}
            interactive={interactive} onCropChange={onCropChange} captureMode={captureMode}
          />
        );
        break;
      case 'glassChip':
        body = (
          <GlassChipCard
            p={p} width={width} height={height} data={data}
            uri={draft.photo!.uri} crop={draft.photo!.crop}
            interactive={interactive} onCropChange={onCropChange} captureMode={captureMode}
          />
        );
        break;
    }
  }

  return (
    <View ref={ref} collapsable={false} style={{ width, height }}>
      {body}
    </View>
  );
});
