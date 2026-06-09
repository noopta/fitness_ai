// WeightShareModal — a branded, screenshot-ready weight-progress card with a
// mini trend line. Exported to X / Instagram / etc. via the OS share sheet.

import React, { useRef } from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import Svg, { Polyline, Circle } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, fontSize, fontWeight } from '../../constants/theme';
import { captureAndShare } from './shareCapture';

interface Props {
  visible: boolean;
  onClose: () => void;
  rangeLabel: string;
  current: number | null;
  totalChange: number | null; // lb over the range (negative = lost)
  series: number[];
}

function MiniTrend({ values }: { values: number[] }) {
  const W = 296;
  const H = 90;
  const PAD = 8;
  const finite = values.filter((v) => Number.isFinite(v));
  if (finite.length < 2) return <View style={{ height: H }} />;
  const min = Math.min(...finite);
  const max = Math.max(...finite);
  const range = max - min || 1;
  const dx = (W - PAD * 2) / (finite.length - 1);
  const pts = finite
    .map((v, i) => `${(PAD + i * dx).toFixed(1)},${(PAD + (1 - (v - min) / range) * (H - PAD * 2)).toFixed(1)}`)
    .join(' ');
  const lastX = PAD + (finite.length - 1) * dx;
  const lastY = PAD + (1 - (finite[finite.length - 1] - min) / range) * (H - PAD * 2);
  return (
    <Svg width={W} height={H}>
      <Polyline points={pts} fill="none" stroke="#22c55e" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
      <Circle cx={lastX} cy={lastY} r={4} fill="#22c55e" />
    </Svg>
  );
}

export function WeightShareModal({ visible, onClose, rangeLabel, current, totalChange, series }: Props) {
  const cardRef = useRef<View>(null);
  const changeColor = totalChange == null ? '#a1a1aa' : totalChange <= 0 ? '#22c55e' : '#f59e0b';

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.container}>
          <View ref={cardRef} collapsable={false} style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.brand}>AXIOM</Text>
              <Text style={styles.range}>{rangeLabel}</Text>
            </View>

            <Text style={styles.eyebrow}>BODY WEIGHT</Text>
            <View style={styles.currentRow}>
              <Text style={styles.currentNum}>{current != null ? current.toFixed(1) : '—'}</Text>
              <Text style={styles.unit}>lb</Text>
            </View>
            {totalChange != null && (
              <Text style={[styles.change, { color: changeColor }]}>
                {totalChange > 0 ? '+' : ''}{totalChange.toFixed(1)} lb this {rangeLabel.toLowerCase()}
              </Text>
            )}

            <View style={styles.chartWrap}>
              <MiniTrend values={series} />
            </View>

            <Text style={styles.tagline}>Progress with Axiom 💪</Text>
          </View>

          <View style={styles.controls}>
            <TouchableOpacity style={styles.shareBtn} activeOpacity={0.85} onPress={() => captureAndShare(cardRef, { dialogTitle: 'Share your progress' })}>
              <Ionicons name="share-outline" size={18} color={colors.primaryForeground} />
              <Text style={styles.shareBtnText}>Share</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.closeBtn} activeOpacity={0.7} onPress={onClose}>
              <Text style={styles.closeBtnText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  container: { width: '100%', maxWidth: 360, gap: spacing.lg },
  card: { backgroundColor: '#0a0a0a', borderRadius: radius.xl, padding: spacing.xl, gap: spacing.xs },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm },
  brand: { color: '#fff', fontSize: fontSize.lg, fontWeight: fontWeight.bold, letterSpacing: 2 },
  range: { color: '#a1a1aa', fontSize: fontSize.xs, fontWeight: fontWeight.semibold },
  eyebrow: { color: '#a1a1aa', fontSize: fontSize.xs, fontWeight: fontWeight.bold, letterSpacing: 1.5 },
  currentRow: { flexDirection: 'row', alignItems: 'flex-end' },
  currentNum: { color: '#fff', fontSize: 48, fontWeight: fontWeight.bold },
  unit: { color: '#71717a', fontSize: fontSize.xl, marginLeft: 6, marginBottom: 8 },
  change: { fontSize: fontSize.base, fontWeight: fontWeight.semibold, marginBottom: spacing.md },
  chartWrap: { alignItems: 'center', marginTop: spacing.sm },
  tagline: { color: '#71717a', fontSize: fontSize.xs, textAlign: 'center', marginTop: spacing.lg },
  controls: { flexDirection: 'row', gap: spacing.sm },
  shareBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: colors.foreground, borderRadius: radius.lg, paddingVertical: 14 },
  shareBtnText: { color: colors.primaryForeground, fontSize: fontSize.base, fontWeight: fontWeight.semibold },
  closeBtn: { paddingHorizontal: spacing.lg, alignItems: 'center', justifyContent: 'center' },
  closeBtnText: { color: '#fff', fontSize: fontSize.base, fontWeight: fontWeight.semibold },
});
