// 3.2 · Receipt — A4 · 9:16 · no photo.
// A muted page with a centered logo → "Axiom" → "Session receipt" eyebrow, then
// a white receipt card: monospaced content with dashed 1px dividers, a totals
// block, and (when present) a bold PR line. No theme toggle.

import React from 'react';
import { View, Text } from 'react-native';
import Svg, { Path, Line } from 'react-native-svg';
import { ShareableWorkout } from '../types';
import { cardColors, monoFont } from '../tokens';
import { Eyebrow } from '../parts';
import { formatReceiptDate, formatVolume, formatDuration } from '../format';

interface Props {
  p: (n: number) => number;
  width: number;
  height: number;
  data: ShareableWorkout;
}

function Dash({ w, p }: { w: number; p: (n: number) => number }) {
  return (
    <Svg width={w} height={p(1)} style={{ marginVertical: p(10) }}>
      <Line x1={0} y1={p(0.5)} x2={w} y2={p(0.5)} stroke="#d4d4d8" strokeWidth={p(1)} strokeDasharray={`${p(4)} ${p(3)}`} />
    </Svg>
  );
}

export function ReceiptCard({ p, width, height, data }: Props) {
  const pagePad = p(28);
  const cardPad = p(22);
  const cardW = width - pagePad * 2;
  const contentW = cardW - cardPad * 2;
  const tile = p(44);
  const mono = { fontFamily: monoFont } as const;

  const Row = ({ label, value, bold }: { label: string; value: string; bold?: boolean }) => (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: p(3) }}>
      <Text style={[mono, { color: cardColors.ink, fontSize: p(12), fontWeight: bold ? '700' : '400' }]} numberOfLines={1}>{label}</Text>
      <Text style={[mono, { color: cardColors.ink, fontSize: p(12), fontWeight: bold ? '700' : '400' }]} numberOfLines={1}>{value}</Text>
    </View>
  );

  return (
    <View style={{ width, height, backgroundColor: cardColors.muted, padding: pagePad, alignItems: 'center' }}>
      {/* Masthead */}
      <View style={{ alignItems: 'center', gap: p(8), marginBottom: p(20) }}>
        <View style={{ width: tile, height: tile, borderRadius: tile * 0.26, backgroundColor: cardColors.ink, alignItems: 'center', justifyContent: 'center' }}>
          <Svg width={tile * 0.5} height={tile * 0.5} viewBox="0 0 24 24" fill="none">
            <Path d="M12 2L2 22H7L12 12L17 22H22L12 2Z" fill="#ffffff" />
          </Svg>
        </View>
        <Text style={{ color: cardColors.ink, fontSize: p(20), fontWeight: '700' }}>Axiom</Text>
        <Eyebrow p={p} color={cardColors.mutedText}>Session receipt</Eyebrow>
      </View>

      {/* Receipt card */}
      <View style={{ width: cardW, backgroundColor: '#ffffff', borderRadius: p(14), borderWidth: p(1), borderColor: cardColors.border, padding: cardPad, shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: p(18), shadowOffset: { width: 0, height: p(6) }, elevation: 4 }}>
        <Text style={{ color: cardColors.ink, fontSize: p(17), fontWeight: '700', textAlign: 'center' }} numberOfLines={1}>{data.title}</Text>
        <Text style={[mono, { color: cardColors.mutedText, fontSize: p(11), textAlign: 'center', marginTop: p(4) }]} numberOfLines={1}>
          {formatReceiptDate(data.loggedAt)}
        </Text>

        <Dash w={contentW} p={p} />

        {data.exercises.map((ex, i) => (
          <Row key={`${ex.name}-${i}`} label={ex.name} value={ex.detail} />
        ))}

        <Dash w={contentW} p={p} />

        <Row label="TOTAL VOLUME" value={`${formatVolume(data.volumeLb)} LB`} />
        <Row label="SETS" value={String(data.sets)} />
        <Row label="DURATION" value={formatDuration(data.durationMin).toUpperCase()} />

        {data.pr ? (
          <>
            <Dash w={contentW} p={p} />
            <Row
              label="★ NEW PR"
              value={`${data.pr.lift.toUpperCase()} ${data.pr.value} ${data.pr.unit.toUpperCase()}`}
              bold
            />
          </>
        ) : null}
      </View>

      {/* Footer handle */}
      <View style={{ flex: 1, justifyContent: 'flex-end', paddingTop: p(16) }}>
        <Eyebrow p={p} color={cardColors.mutedText}>axiom · train by numbers</Eyebrow>
      </View>
    </View>
  );
}
