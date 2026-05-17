import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { MiniSparkline } from './MiniSparkline';
import type { Insight, InsightKind, RatioResult } from '../../lib/athleteModel';

// "Anakin's Read" insight card — kind-aware. A single entry point that
// switches its visualization on insight.kind while sharing the chrome
// (tag pill, priority dot, title, detail, CTA chip). Design handoff §6.
//
//   kind        tag         visualization
//   stagnation  warning     flat / declining sparkline (real e1RM history)
//   imbalance   destructive mini band track w/ marker (from the ratio)
//   neglect     zinc        low-volume bar
//   win         success     rising sparkline, green
//
// The per-kind visualizations that need data beyond the Insight object
// (imbalance → RatioResult) receive it via the optional `ratio` prop.

interface KindStyle {
  label: string;
  tagBg: string;
  tagFg: string;
  accent: string;   // sparkline / marker color
}

const KIND_STYLE: Record<InsightKind, KindStyle> = {
  stagnation: { label: 'STAGNATION', tagBg: '#FEF3C7', tagFg: '#B45309', accent: '#B45309' },
  imbalance:  { label: 'IMBALANCE',  tagBg: '#FEE2E2', tagFg: '#DC2626', accent: '#DC2626' },
  neglect:    { label: 'NEGLECT',    tagBg: '#F4F4F5', tagFg: '#52525B', accent: '#A1A1AA' },
  win:        { label: 'WIN',        tagBg: '#DCFCE7', tagFg: '#15803D', accent: '#15803D' },
};

interface Props {
  insight: Insight;
  /** The matching RatioResult — supplied for imbalance insights so the card
   *  can draw the band track. Optional. */
  ratio?: RatioResult | null;
  /** Tap handler — caller routes from insight.ctaHint. */
  onPress?: (insight: Insight) => void;
}

/** Mini band track for imbalance cards — the user's value vs the healthy band. */
function ImbalanceViz({ ratio }: { ratio: RatioResult }) {
  const W = 66;
  const [lo, hi] = ratio.band;
  const span = hi - lo || 1;
  const min = lo - span * 0.8;
  const max = hi + span * 0.8;
  const total = max - min || 1;
  const pct = (v: number) => Math.max(0, Math.min(1, (v - min) / total));
  const bandL = pct(lo);
  const bandR = pct(hi);
  const markerColor = ratio.status === 'in-band' ? '#09090B'
    : ratio.severity > 0.5 ? '#DC2626' : '#B45309';
  return (
    <View style={{ width: W, height: 24, justifyContent: 'center' }}>
      <View style={vizStyles.trackBase} />
      <View style={[vizStyles.trackBand, { left: bandL * W, width: (bandR - bandL) * W }]} />
      {ratio.value != null && (
        <View
          style={[
            vizStyles.marker,
            { left: pct(ratio.value) * W - 1.5, backgroundColor: markerColor },
          ]}
        />
      )}
    </View>
  );
}

/** Low-volume bar for neglect cards — a near-empty fill signaling "under-trained". */
function NeglectViz() {
  return (
    <View style={{ width: 66, height: 24, justifyContent: 'center' }}>
      <View style={vizStyles.trackBase} />
      <View style={[vizStyles.neglectFill]} />
    </View>
  );
}

function InsightViz({ insight, ratio }: { insight: Insight; ratio?: RatioResult | null }) {
  const ks = KIND_STYLE[insight.kind];
  switch (insight.kind) {
    case 'stagnation':
      return <MiniSparkline values={insight.spark ?? []} color={ks.accent} />;
    case 'win':
      // Win cards: rising line. Real spark if present, else an indicative ramp.
      return (
        <MiniSparkline
          values={insight.spark && insight.spark.length >= 2 ? insight.spark : [1, 1.4, 1.8, 2.6]}
          color={ks.accent}
        />
      );
    case 'imbalance':
      return ratio ? <ImbalanceViz ratio={ratio} /> : null;
    case 'neglect':
      return <NeglectViz />;
    default:
      return null;
  }
}

export function InsightCard({ insight, ratio, onPress }: Props) {
  const ks = KIND_STYLE[insight.kind];
  const isHigh = insight.priority === 'high';

  return (
    <Pressable
      onPress={() => onPress?.(insight)}
      style={({ pressed }) => [
        styles.card,
        isHigh && styles.cardHigh,
        pressed && { transform: [{ scale: 0.985 }], opacity: 0.96 },
      ]}
      accessibilityRole="button"
      accessibilityLabel={`${insight.priority} priority ${insight.kind}: ${insight.title}. ${insight.detail}`}
    >
      {/* Top row — tag pill (+ priority dot) and the kind visualization */}
      <View style={styles.topRow}>
        <View style={styles.tagWrap}>
          <View style={[styles.tag, { backgroundColor: ks.tagBg }]}>
            <Text style={[styles.tagText, { color: ks.tagFg }]}>{ks.label}</Text>
          </View>
          {isHigh && <View style={[styles.priorityDot, { backgroundColor: ks.accent }]} />}
        </View>
        <InsightViz insight={insight} ratio={ratio} />
      </View>

      <Text style={styles.title}>{insight.title}</Text>
      <Text style={styles.detail}>{insight.detail}</Text>

      {insight.ctaHint && (
        <View style={styles.ctaChip}>
          <Text style={styles.ctaText}>{insight.ctaHint}</Text>
          <Ionicons name="chevron-forward" size={12} color="#FFFFFF" />
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E4E4E7',
    borderRadius: 14,
    padding: 14,
  },
  cardHigh: {
    shadowColor: '#000',
    shadowOpacity: 0.07,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  tagWrap: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  tag: { paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6 },
  tagText: { fontSize: 9, fontWeight: '800', letterSpacing: 0.8 },
  priorityDot: { width: 6, height: 6, borderRadius: 3 },
  title: { fontSize: 14.5, fontWeight: '700', color: '#09090B', lineHeight: 19 },
  detail: { fontSize: 12.5, color: '#52525B', lineHeight: 18, marginTop: 4 },
  ctaChip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 3,
    marginTop: 12,
    backgroundColor: '#09090B',
    paddingLeft: 11,
    paddingRight: 8,
    paddingVertical: 7,
    borderRadius: 999,
  },
  ctaText: { color: '#FFFFFF', fontSize: 11.5, fontWeight: '700' },
});

const vizStyles = StyleSheet.create({
  trackBase: {
    position: 'absolute', left: 0, right: 0, height: 4,
    borderRadius: 2, backgroundColor: '#E4E4E7',
  },
  trackBand: {
    position: 'absolute', height: 4, borderRadius: 2,
    backgroundColor: '#BBF7D0',
  },
  marker: {
    position: 'absolute', width: 3, height: 14, borderRadius: 1.5,
    borderWidth: 1, borderColor: '#FFFFFF', top: 5,
  },
  neglectFill: {
    position: 'absolute', left: 0, width: '14%', height: 4,
    borderRadius: 2, backgroundColor: '#A1A1AA',
  },
});
