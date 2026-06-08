// StickyHeader — date eyebrow + kcal hero + 4-ring macro row.
// Pins under the Coach tab strip. Spec: handoff §02, §06 (KcalHero, MacroRingRow).

import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, fontWeight } from '../../../constants/theme';
import { MacroRing, type MacroState, type MacroKey } from './MacroRing';

type StatusPill = 'on_track' | 'behind' | 'over';

interface Props {
  /** Per-day kcal state. */
  kcal: { used: number; target: number | null; workoutBurn: number };
  /** Four macros in this exact order: protein, carbs, fat, fiber. */
  macros: MacroState[];
  /** Selected macro key (drives row highlight). */
  selectedMacro: MacroKey | null;
  onSelectMacro: (key: MacroKey) => void;
  /** "TODAY · MAY 22" / "MAY 22, 2026". */
  dateLabel: string;
  /** Override status pill — when omitted we derive from kcal + clock. */
  status?: StatusPill;
  /** When provided, renders a share icon that exports today's nutrition card. */
  onShare?: () => void;
}

/**
 * Compute the status pill from kcal + workout burn + clock. The thresholds
 * mirror the spec (§07): ON TRACK by default, BEHIND after 6pm with <60% used,
 * OVER when used > target × 1.05.
 */
function deriveStatus(used: number, target: number | null, hour: number): StatusPill {
  if (!target) return 'on_track';
  if (used > target * 1.05) return 'over';
  if (hour >= 18 && used < target * 0.6) return 'behind';
  return 'on_track';
}

function StatusBadge({ status }: { status: StatusPill }) {
  const cfg = {
    on_track: { label: 'ON TRACK', bg: '#dcfce7', fg: '#166534' },
    behind:   { label: 'BEHIND',   bg: '#fef3c7', fg: '#92400e' },
    over:     { label: 'OVER',     bg: '#fee2e2', fg: '#991b1b' },
  }[status];
  return (
    <View style={[styles.pill, { backgroundColor: cfg.bg }]}>
      <Text style={[styles.pillText, { color: cfg.fg }]}>{cfg.label}</Text>
    </View>
  );
}

export function StickyHeader({
  kcal, macros, selectedMacro, onSelectMacro, dateLabel, status, onShare,
}: Props) {
  const targetWithBurn = kcal.target ? kcal.target + kcal.workoutBurn : null;
  const remaining = targetWithBurn != null ? targetWithBurn - kcal.used : null;
  const hour = new Date().getHours();
  const computedStatus: StatusPill = status ?? deriveStatus(kcal.used, kcal.target, hour);

  return (
    <View style={styles.root}>
      {/* Row 1 — date / hero / status pill / macro rings (spec puts rings on
          a 2nd row, but the device width comfortably fits everything inline
          on iPhone 12+). We render rings inline on the right; on narrower
          screens they wrap below via flexWrap. */}
      <View style={styles.topRow}>
        <View
          style={styles.heroBlock}
          accessibilityRole="summary"
          accessibilityLabel={
            targetWithBurn != null
              ? `${Math.round(kcal.used)} of ${Math.round(targetWithBurn)} calories logged today, ${
                  remaining != null && remaining >= 0
                    ? `${Math.round(remaining)} calories remaining`
                    : `${Math.round(Math.abs(remaining ?? 0))} calories over target`
                }${kcal.workoutBurn > 0 ? `, including ${Math.round(kcal.workoutBurn)} from your workout` : ''}.`
              : `${Math.round(kcal.used)} calories logged today, no target set.`
          }
        >
          <View style={styles.eyebrowRow}>
            <Text style={styles.eyebrow}>{dateLabel}</Text>
            {onShare && (
              <Pressable onPress={onShare} hitSlop={10} accessibilityRole="button" accessibilityLabel="Share today's nutrition">
                <Ionicons name="share-outline" size={15} color={colors.mutedForeground} />
              </Pressable>
            )}
          </View>
          <View style={styles.numRow}>
            <Text style={styles.numeral} allowFontScaling={false}>
              {Math.round(kcal.used)}
            </Text>
            <Text style={styles.numeralSuffix} numberOfLines={1}>
              {targetWithBurn != null
                ? ` / ${Math.round(targetWithBurn)} · ${
                    remaining != null && remaining >= 0
                      ? `${Math.round(remaining)} left`
                      : `${Math.round(Math.abs(remaining ?? 0))} over`
                  }`
                : ''}
            </Text>
          </View>
        </View>

        <View style={styles.rightCluster}>
          {macros.map((m) => (
            <View key={m.key} style={{ marginLeft: 4 }}>
              <MacroRing
                macro={m}
                size={38}
                stroke={3.2}
                selected={selectedMacro === m.key}
                onPress={() => onSelectMacro(m.key)}
              />
            </View>
          ))}
        </View>
      </View>

      {/* Status pill — only shown when not ON TRACK so it isn't visual noise
          on a normal day. */}
      {computedStatus !== 'on_track' && (
        <View style={styles.statusRow}>
          <Pressable hitSlop={6} accessibilityRole="button" accessibilityLabel={`Status: ${computedStatus}`}>
            <StatusBadge status={computedStatus} />
          </Pressable>
        </View>
      )}
    </View>
  );
}
const styles = StyleSheet.create({
  root: {
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.background,
  },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  heroBlock: { flex: 1, paddingRight: 8 },
  eyebrowRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  eyebrow: {
    fontSize: 10,
    fontWeight: fontWeight.bold,
    color: colors.mutedForeground,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  numRow: { flexDirection: 'row', alignItems: 'flex-end', marginTop: 2 },
  numeral: {
    fontSize: 28,
    fontWeight: '800',
    color: colors.foreground,
    letterSpacing: -1.1,
    fontVariant: ['tabular-nums'],
    lineHeight: 30,
  },
  numeralSuffix: {
    fontSize: 12,
    color: colors.mutedForeground,
    marginLeft: 4,
    marginBottom: 4,
  },
  rightCluster: { flexDirection: 'row', alignItems: 'center' },
  statusRow: { flexDirection: 'row', marginTop: 8 },
  pill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  pillText: { fontSize: 9.5, fontWeight: fontWeight.bold, letterSpacing: 0.8 },
});
