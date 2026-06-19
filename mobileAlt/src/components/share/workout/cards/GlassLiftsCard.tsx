// 3.4 · Glass — PR + lifts — B5 · 9:16 · with photo.
// Full-bleed photo with a bottom scrim (+ slight top darken). A frosted glass
// panel is pinned to the bottom (inset 26px) with white text: PR-led head (or a
// total-volume fallback), then "The lifts" → top 4 exercises. Theme-fixed.

import React from 'react';
import { View, Text } from 'react-native';
import { ShareableWorkout, CropTransform } from '../types';
import { cardColors } from '../tokens';
import { BrandLockup, Eyebrow, VerticalScrim, GlassPanel } from '../parts';
import { PhotoWindow } from '../PhotoWindow';
import { formatVolume, formatDuration, joinCaption } from '../format';

interface Props {
  p: (n: number) => number;
  width: number;
  height: number;
  data: ShareableWorkout;
  uri: string;
  crop: CropTransform;
  interactive?: boolean;
  onCropChange?: (c: CropTransform) => void;
  captureMode?: boolean;
}

export function GlassLiftsCard({ p, width, height, data, uri, crop, interactive, onCropChange, captureMode }: Props) {
  const inset = p(26);
  const panelPad = p(24);
  const white = '#ffffff';
  const muted = cardColors.onDarkMuted;
  const success = cardColors.successOnDark;
  const { pr } = data;
  const lifts = data.exercises.slice(0, 4);

  return (
    <View style={{ width, height, backgroundColor: '#000', overflow: 'hidden' }}>
      <PhotoWindow uri={uri} crop={crop} width={width} height={height} interactive={interactive} onCropChange={onCropChange}>
        {/* slight top darken + heavy bottom scrim (≈165°) */}
        <VerticalScrim
          id={`b5Scrim-${Math.round(width)}`}
          width={width}
          height={height}
          stops={[
            { offset: 0, color: '#09090b', opacity: 0.28 },
            { offset: 0.4, color: '#09090b', opacity: 0 },
            { offset: 0.62, color: '#09090b', opacity: 0 },
            { offset: 1, color: '#09090b', opacity: 0.88 },
          ]}
        />
        <View style={{ position: 'absolute', top: p(30), left: inset, right: inset, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <BrandLockup p={p} mark={cardColors.ink} tileBg="#ffffff" wordmark={white} />
          <Eyebrow p={p} color={muted}>Session logged</Eyebrow>
        </View>
      </PhotoWindow>

      <GlassPanel
        flat={captureMode}
        fill={cardColors.glassFill}
        blur={18}
        radius={p(22)}
        borderWidth={p(1)}
        borderColor={cardColors.glassHairline}
        style={{ position: 'absolute', left: inset, right: inset, bottom: inset, padding: panelPad }}
      >
        {/* Head */}
        {pr ? (
          <View style={{ gap: p(6) }}>
            <Eyebrow p={p} color={success}>New personal record</Eyebrow>
            <Text style={{ color: muted, fontSize: p(15), fontWeight: '600' }} numberOfLines={1}>{pr.lift} · {pr.metric}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'flex-end' }}>
              <Text style={{ color: white, fontSize: p(58), fontWeight: '700', letterSpacing: -p(58) * 0.04, fontVariant: ['tabular-nums'], lineHeight: p(58) }}>{pr.value}</Text>
              <Text style={{ color: white, fontSize: p(22), fontWeight: '700', marginLeft: p(5), marginBottom: p(6) }}>{pr.unit}</Text>
              <Text style={{ color: success, fontSize: p(18), fontWeight: '700', marginLeft: p(8), marginBottom: p(8), fontVariant: ['tabular-nums'] }}>{pr.delta}</Text>
            </View>
          </View>
        ) : (
          <View style={{ gap: p(4) }}>
            <Eyebrow p={p} color={muted}>Session logged</Eyebrow>
            <View style={{ flexDirection: 'row', alignItems: 'flex-end' }}>
              <Text style={{ color: white, fontSize: p(58), fontWeight: '700', letterSpacing: -p(58) * 0.04, fontVariant: ['tabular-nums'], lineHeight: p(58) }}>{formatVolume(data.volumeLb)}</Text>
              <Text style={{ color: white, fontSize: p(22), fontWeight: '700', marginLeft: p(5), marginBottom: p(6) }}>lb</Text>
            </View>
            <Eyebrow p={p} color={muted}>Total volume lifted</Eyebrow>
          </View>
        )}

        {/* Divider → the lifts */}
        <View style={{ height: p(1), backgroundColor: cardColors.glassHairline, marginVertical: p(16) }} />
        <Eyebrow p={p} color={muted} style={{ marginBottom: p(8) }}>The lifts</Eyebrow>
        {lifts.map((ex, i) => (
          <View key={`${ex.name}-${i}`} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: p(6) }}>
            <Text style={{ color: white, fontSize: p(14), fontWeight: '500', flex: 1, marginRight: p(10) }} numberOfLines={1}>{ex.name}</Text>
            <Text style={{ color: muted, fontSize: p(13), fontWeight: '600', fontVariant: ['tabular-nums'] }} numberOfLines={1}>{ex.detail}</Text>
          </View>
        ))}

        {/* Caption */}
        <Text style={{ color: muted, fontSize: p(13), fontWeight: '500', marginTop: p(12) }} numberOfLines={1}>
          {joinCaption(data.title, `${data.sets} sets`, formatDuration(data.durationMin))}
        </Text>
      </GlassPanel>
    </View>
  );
}
