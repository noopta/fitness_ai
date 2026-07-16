// Weekly Trend (spec §5.4) — a micronutrient-coverage bar chart across the last
// 7 days (most recent 1–2 days inked, earlier days in zinc tints), plus a
// per-nutrient "% of days on target" consistency list.
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { nutritionProfileApi, type NpTrend } from '../../src/lib/api';
import { fontWeight } from '../../src/constants/theme';
import { NpScreen } from '../../src/components/coach/nutritionProfile/NpScreen';
import { NP } from '../../src/components/coach/nutritionProfile/npTokens';

export default function TrendScreen() {
  const [data, setData] = useState<NpTrend | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    nutritionProfileApi.getTrend('7d')
      .then(d => { if (alive) setData(d); })
      .catch(() => {})
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  const maxPct = 100;
  const lastIdx = (data?.series.length ?? 0) - 1;

  return (
    <NpScreen kicker="TREND" title="7-day trend">
      {loading ? (
        <ActivityIndicator color={NP.ink} />
      ) : !data || data.series.length === 0 ? (
        <Text style={styles.muted}>Not enough logged days yet. Keep logging to build your trend.</Text>
      ) : (
        <>
          <Text style={styles.sectionLabel}>MICRONUTRIENT COVERAGE</Text>
          <View style={styles.chart}>
            {data.series.map((pt, i) => {
              const recent = i >= lastIdx - 1; // most recent 1–2 days inked
              const h = Math.max(4, Math.round((pt.coveragePct / maxPct) * 120));
              const d = new Date(pt.date + 'T00:00:00');
              return (
                <View key={pt.date} style={styles.col}>
                  <Text style={styles.colPct}>{pt.coveragePct}</Text>
                  <View style={[styles.bar, { height: h, backgroundColor: recent ? NP.ink : '#D4D4D8' }]} />
                  <Text style={styles.colDay}>{d.toLocaleDateString([], { weekday: 'narrow' })}</Text>
                </View>
              );
            })}
          </View>

          <Text style={styles.sectionLabel}>CONSISTENCY BY NUTRIENT</Text>
          <View style={styles.list}>
            {data.consistency.map((c, i) => (
              <View key={c.key} style={[styles.row, i > 0 && styles.divider]}>
                <Text style={styles.rowLabel}>{c.label}</Text>
                <View style={styles.rowTrack}>
                  <View style={[styles.rowFill, {
                    width: `${c.pctDaysOnTarget}%`,
                    backgroundColor: c.pctDaysOnTarget >= 70 ? '#22C55E' : c.pctDaysOnTarget >= 40 ? '#F59E0B' : '#EF4444',
                  }]} />
                </View>
                <Text style={styles.rowPct}>{c.pctDaysOnTarget}%</Text>
              </View>
            ))}
          </View>
          <Text style={styles.footNote}>% of logged days you hit each nutrient's target.</Text>
        </>
      )}
    </NpScreen>
  );
}

const styles = StyleSheet.create({
  muted: { fontSize: 13, color: NP.mutedInk },
  sectionLabel: { fontSize: 10, fontWeight: fontWeight.bold, letterSpacing: 1.2, color: NP.mutedInk },
  chart: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 6, paddingVertical: 8, minHeight: 160, borderWidth: 1, borderColor: NP.border, borderRadius: 16, paddingHorizontal: 12 },
  col: { flex: 1, alignItems: 'center', gap: 5, justifyContent: 'flex-end' },
  colPct: { fontSize: 9, fontWeight: fontWeight.bold, color: NP.mutedInk, fontVariant: ['tabular-nums'] },
  bar: { width: '70%', borderRadius: 5 },
  colDay: { fontSize: 10, color: NP.mutedInk },
  list: { borderWidth: 1, borderColor: NP.border, borderRadius: 16, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 11 },
  divider: { borderTopWidth: 1, borderTopColor: NP.border },
  rowLabel: { width: 92, fontSize: 12.5, color: NP.ink },
  rowTrack: { flex: 1, height: 6, borderRadius: 999, backgroundColor: NP.muted, overflow: 'hidden' },
  rowFill: { height: 6, borderRadius: 999 },
  rowPct: { width: 34, textAlign: 'right', fontSize: 11, fontWeight: fontWeight.bold, color: NP.ink, fontVariant: ['tabular-nums'] },
  footNote: { fontSize: 11, color: NP.mutedInk, marginTop: -6 },
});
