// NutritionShareModal — a branded, screenshot-ready summary of the user's day
// (calories + macros) they can export to X, Instagram, etc. Rendered on screen
// so the user previews exactly what they'll share, then captured to PNG.

import React, { useRef } from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, fontSize, fontWeight } from '../../constants/theme';
import { captureAndShare } from './shareCapture';

export interface MacroSummary {
  label: string;
  used: number;
  target: number | null;
  color: string;
}

interface Props {
  visible: boolean;
  onClose: () => void;
  dateLabel: string;
  calories: { used: number; target: number | null };
  macros: MacroSummary[];
}

function Bar({ used, target, color }: { used: number; target: number | null; color: string }) {
  const pct = target && target > 0 ? Math.min(used / target, 1) : 0;
  return (
    <View style={styles.barTrack}>
      <View style={[styles.barFill, { width: `${Math.round(pct * 100)}%`, backgroundColor: color }]} />
    </View>
  );
}

export function NutritionShareModal({ visible, onClose, dateLabel, calories, macros }: Props) {
  const cardRef = useRef<View>(null);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.container}>
          {/* The captured card */}
          <View ref={cardRef} collapsable={false} style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.brand}>AXIOM</Text>
              <Text style={styles.date}>{dateLabel}</Text>
            </View>

            <Text style={styles.calValue}>
              {Math.round(calories.used)}
              {calories.target ? <Text style={styles.calTarget}> / {Math.round(calories.target)}</Text> : null}
            </Text>
            <Text style={styles.calLabel}>CALORIES</Text>

            <View style={styles.macros}>
              {macros.map((m) => (
                <View key={m.label} style={styles.macroRow}>
                  <View style={styles.macroTop}>
                    <Text style={styles.macroLabel}>{m.label}</Text>
                    <Text style={styles.macroVal}>
                      {Math.round(m.used)}{m.target ? `/${Math.round(m.target)}` : ''}g
                    </Text>
                  </View>
                  <Bar used={m.used} target={m.target} color={m.color} />
                </View>
              ))}
            </View>

            <Text style={styles.tagline}>Tracked with Axiom 💪</Text>
          </View>

          {/* Controls (not part of the capture) */}
          <View style={styles.controls}>
            <TouchableOpacity style={styles.shareBtn} activeOpacity={0.85} onPress={() => captureAndShare(cardRef, { dialogTitle: 'Share your nutrition' })}>
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
  card: {
    backgroundColor: '#0a0a0a',
    borderRadius: radius.xl,
    padding: spacing.xl,
    gap: spacing.sm,
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm },
  brand: { color: '#fff', fontSize: fontSize.lg, fontWeight: fontWeight.bold, letterSpacing: 2 },
  date: { color: '#a1a1aa', fontSize: fontSize.xs, fontWeight: fontWeight.semibold },
  calValue: { color: '#fff', fontSize: 48, fontWeight: fontWeight.bold },
  calTarget: { color: '#71717a', fontSize: fontSize.xl, fontWeight: fontWeight.semibold },
  calLabel: { color: '#a1a1aa', fontSize: fontSize.xs, fontWeight: fontWeight.bold, letterSpacing: 1.5, marginBottom: spacing.md },
  macros: { gap: spacing.md },
  macroRow: { gap: 6 },
  macroTop: { flexDirection: 'row', justifyContent: 'space-between' },
  macroLabel: { color: '#e4e4e7', fontSize: fontSize.sm, fontWeight: fontWeight.semibold },
  macroVal: { color: '#a1a1aa', fontSize: fontSize.sm },
  barTrack: { height: 8, borderRadius: 4, backgroundColor: '#27272a', overflow: 'hidden' },
  barFill: { height: 8, borderRadius: 4 },
  tagline: { color: '#71717a', fontSize: fontSize.xs, textAlign: 'center', marginTop: spacing.lg },
  controls: { flexDirection: 'row', gap: spacing.sm },
  shareBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: colors.foreground, borderRadius: radius.lg, paddingVertical: 14,
  },
  shareBtnText: { color: colors.primaryForeground, fontSize: fontSize.base, fontWeight: fontWeight.semibold },
  closeBtn: { paddingHorizontal: spacing.lg, alignItems: 'center', justifyContent: 'center' },
  closeBtnText: { color: '#fff', fontSize: fontSize.base, fontWeight: fontWeight.semibold },
});
