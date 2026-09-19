// 3.5 · Glass stat chip — B3 · 1:1 · with photo.
// Full-bleed square photo with a scrim; brand + eyebrow overlaid top. A glass
// chip pinned to the bottom shows the total volume + an optional PR pill, then
// three mini-stats. This is the compact feed-post format — no exercise list.

import React from 'react';
import { View, Text } from 'react-native';
import { ShareableWorkout, CropTransform, ShareTheme } from '../types';
import { palette } from '../tokens';
import { BrandLockup, Eyebrow, VerticalScrim, GlassPanel, PRPill } from '../parts';
import { PhotoWindow } from '../PhotoWindow';
import { formatVolume, formatDuration, formatDateEyebrow } from '../format';

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
  captureMode?: boolean;
}

function MiniStat({ p, value, label, ink, muted }: {
  p: (n: number) => number; value: string; label: string; ink: string; muted: string;
}) {
  return (
    <View style={{ gap: p(2) }}>
      <Text style={{ color: ink, fontSize: p(18), fontWeight: '700', fontVariant: ['tabular-nums'] }} numberOfLines={1}>{value}</Text>
      <Eyebrow p={p} color={muted}>{label}</Eyebrow>
    </View>
  );
}

export function GlassChipCard({ p, width, height, data, theme, uri, crop, interactive, onCropChange, captureMode }: Props) {
  const inset = p(26);
  const pad = p(22);
  const c = palette(theme);
  const white = c.glassInk;
  const muted = c.glassMuted;
  const { pr } = data;

  // Third mini-stat highlights the PR when present, else the lift count.
  const third = pr
    ? { value: `${pr.value} ${pr.unit}`, label: pr.lift }
    : { value: String(data.exercises.length), label: 'Lifts' };

  return (
    <View style={{ width, height, backgroundColor: '#000', overflow: 'hidden' }}>
      <PhotoWindow uri={uri} crop={crop} width={width} height={height} interactive={interactive} onCropChange={onCropChange}>
        <VerticalScrim
          id={`b3Scrim-${Math.round(width)}-${theme}`}
          width={width}
          height={height}
          stops={[
            { offset: 0, color: c.scrim, opacity: 0.3 },
            { offset: 0.45, color: c.scrim, opacity: 0 },
            { offset: 1, color: c.scrim, opacity: 0.85 },
          ]}
        />
        <View style={{ position: 'absolute', top: p(24), left: inset, right: inset, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <BrandLockup p={p} mark={c.markFg} tileBg={c.markBg} wordmark={c.glassInk} />
          <Eyebrow p={p} color={muted}>Session logged</Eyebrow>
        </View>
      </PhotoWindow>

      <GlassPanel
        flat={captureMode}
        fill={c.glassFillStrong}
        blur={16}
        radius={p(20)}
        borderWidth={p(1)}
        borderColor={c.glassHairline}
        style={{ position: 'absolute', left: inset, right: inset, bottom: inset, padding: pad }}
      >
        {/* Top row — volume + caption left, PR pill right */}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'flex-end' }}>
              <Text style={{ color: white, fontSize: p(40), fontWeight: '700', letterSpacing: -p(40) * 0.04, fontVariant: ['tabular-nums'], lineHeight: p(40) }}>{formatVolume(data.volumeLb)}</Text>
              <Text style={{ color: white, fontSize: p(18), fontWeight: '700', marginLeft: p(4), marginBottom: p(4) }}>{data.volumeUnit ?? 'lb'}</Text>
            </View>
            <Text style={{ color: muted, fontSize: p(12), fontWeight: '500', marginTop: p(4) }} numberOfLines={1}>
              {data.title} · {formatDateEyebrow(data.loggedAt)}
            </Text>
          </View>
          {pr ? <PRPill p={p} bg={c.pillBg} fg={c.pillFg} /> : null}
        </View>

        <View style={{ height: p(1), backgroundColor: c.glassHairline, marginVertical: p(14) }} />

        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <MiniStat p={p} value={String(data.sets)} label="Sets" ink={white} muted={muted} />
          <MiniStat p={p} value={formatDuration(data.durationMin)} label="Time" ink={white} muted={muted} />
          <MiniStat p={p} value={third.value} label={third.label} ink={white} muted={muted} />
        </View>
      </GlassPanel>
    </View>
  );
}
