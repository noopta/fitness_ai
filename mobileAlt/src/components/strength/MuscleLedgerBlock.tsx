import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { TrendPill } from './TrendPill';
import { ZoneDonut, ZONE_META } from './ZoneDonut';
import type { MuscleLedgerEntry } from '../../lib/athleteModel';

// Per-muscle ledger block rendered inside RadarAxisDrillSheet for level-2
// muscle taps. Design handoff §6 layout:
//   trend pill → user-relative position bar → 3-col stat grid
//   → zone donut + legend → per-muscle confidence bar.

function StatCell({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.statCell}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue} allowFontScaling={false}>{value}</Text>
    </View>
  );
}

export function MuscleLedgerBlock({ entry }: { entry: MuscleLedgerEntry }) {
  const slope = entry.trendSlopePerWeekKg;
  const slopeText = slope > 0 ? `+${slope.toFixed(1)}` : slope.toFixed(1);
  const lastText = entry.lastTrainedDaysAgo == null
    ? '—'
    : entry.lastTrainedDaysAgo === 0 ? 'Today'
    : `${entry.lastTrainedDaysAgo}d ago`;

  const zones = ZONE_META.filter((z) => (entry.zoneDistribution[z.key] ?? 0) > 0.005);

  return (
    <View style={styles.block}>
      {/* Trend pill */}
      <TrendPill trend={entry.trend} />

      {/* User-relative position bar — this muscle's strength vs the user's max */}
      <View style={styles.posSection}>
        <View style={styles.posHeader}>
          <Text style={styles.posLabel}>Relative strength</Text>
          <Text style={styles.posValue} allowFontScaling={false}>{entry.strengthScore}/100</Text>
        </View>
        <View style={styles.posTrack}>
          <View style={[styles.posFill, { width: `${Math.max(2, Math.min(100, entry.strengthScore))}%` }]} />
        </View>
      </View>

      {/* 3-column stat grid */}
      <View style={styles.statRow}>
        <StatCell label="WEEKLY SETS" value={String(entry.weeklyHardSets)} />
        <View style={styles.statDivider} />
        <StatCell label="e1RM / WK" value={`${slopeText} kg`} />
        <View style={styles.statDivider} />
        <StatCell label="LAST TRAINED" value={lastText} />
      </View>

      {/* Zone donut + legend */}
      {zones.length > 0 && (
        <View style={styles.zoneSection}>
          <ZoneDonut distribution={entry.zoneDistribution} size={76} />
          <View style={styles.zoneLegend}>
            <Text style={styles.zoneTitle}>Training mix</Text>
            {zones.map((z) => (
              <View key={z.key} style={styles.zoneRow}>
                <View style={[styles.zoneDot, { backgroundColor: z.color }]} />
                <Text style={styles.zoneLabel}>{z.label}</Text>
                <Text style={styles.zonePct} allowFontScaling={false}>
                  {Math.round((entry.zoneDistribution[z.key] ?? 0) * 100)}%
                </Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {/* Per-muscle confidence bar */}
      <View style={styles.confSection}>
        <View style={styles.confHeader}>
          <Text style={styles.confLabel}>Read confidence</Text>
          <Text style={styles.confValue} allowFontScaling={false}>
            {Math.round(entry.confidence * 100)}%
          </Text>
        </View>
        <View style={styles.confTrack}>
          <View style={[styles.confFill, { width: `${Math.max(2, Math.min(100, entry.confidence * 100))}%` }]} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  block: {
    marginTop: 14,
    padding: 14,
    backgroundColor: '#FAFAFA',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E4E4E7',
    gap: 14,
  },

  posSection: { gap: 6 },
  posHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  posLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 0.4, color: '#71717A' },
  posValue: { fontSize: 13, fontWeight: '800', fontFamily: 'Menlo', color: '#09090B' },
  posTrack: { height: 6, borderRadius: 3, backgroundColor: '#E4E4E7', overflow: 'hidden' },
  posFill: { height: '100%', borderRadius: 3, backgroundColor: '#09090B' },

  statRow: { flexDirection: 'row', alignItems: 'center' },
  statCell: { flex: 1, alignItems: 'center' },
  statDivider: { width: 1, height: 28, backgroundColor: '#E4E4E7' },
  statLabel: { fontSize: 8.5, fontWeight: '700', letterSpacing: 0.5, color: '#A1A1AA' },
  statValue: { fontSize: 14, fontWeight: '700', color: '#09090B', marginTop: 3 },

  zoneSection: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  zoneLegend: { flex: 1, gap: 4 },
  zoneTitle: { fontSize: 11, fontWeight: '700', letterSpacing: 0.4, color: '#71717A', marginBottom: 2 },
  zoneRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  zoneDot: { width: 8, height: 8, borderRadius: 4 },
  zoneLabel: { flex: 1, fontSize: 12, color: '#27272A' },
  zonePct: { fontSize: 12, fontWeight: '700', fontFamily: 'Menlo', color: '#09090B' },

  confSection: { gap: 6 },
  confHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  confLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 0.4, color: '#71717A' },
  confValue: { fontSize: 13, fontWeight: '800', fontFamily: 'Menlo', color: '#09090B' },
  confTrack: { height: 6, borderRadius: 3, backgroundColor: '#E4E4E7', overflow: 'hidden' },
  confFill: { height: '100%', borderRadius: 3, backgroundColor: '#6366F1' },
});
