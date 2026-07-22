// Weekly Trend (spec §5.4) — micronutrient-coverage bar chart across the
// window (most recent 1–2 days inked, earlier days in zinc tints), plus a
// per-nutrient "% of days on target" consistency list.
//
// Spec defines 7 day columns; a 7d/30d toggle extends that since the engine
// already computes any window. At 30 columns a fixed-width row would squash the
// bars to slivers, so the chart scrolls horizontally past 7 days and drops the
// per-bar numerals (the row stays readable, the numbers live in the tooltip-free
// caption instead).
//
// Unlogged days are NOT 0% — they're gaps. The API marks them `logged: false`
// and they render as a hollow track so a week of silence can't read as a week
// of bad eating.

import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, TouchableOpacity, ScrollView } from 'react-native';
import { nutritionProfileApi, type NpTrend } from '../../src/lib/api';
import { fontWeight } from '../../src/constants/theme';
import { NpScreen } from '../../src/components/coach/nutritionProfile/NpScreen';
import { NP } from '../../src/components/coach/nutritionProfile/npTokens';
import { todayStr } from '../../src/lib/localDate';

type Range = '7d' | '30d';
const CHART_H = 120;

export default function TrendScreen() {
  const [range, setRange] = useState<Range>('7d');
  const [data, setData] = useState<NpTrend | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback((r: Range) => {
    setLoading(true);
    let alive = true;
    nutritionProfileApi.getTrend(r, todayStr())
      .then(d => { if (alive) setData(d); })
      .catch(() => { if (alive) setData(null); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  useEffect(() => load(range), [range, load]);

  const wide = range === '30d';
  const loggedDays = data?.loggedDays ?? 0;

  return (
    <NpScreen kicker="TREND" title={wide ? '30-day trend' : '7-day trend'}>
      {/* Range toggle — same segmented treatment as the profile's Strength|Nutrition */}
      <View style={styles.segment}>
        {(['7d', '30d'] as Range[]).map(r => (
          <TouchableOpacity
            key={r}
            style={[styles.segItem, range === r && styles.segItemOn]}
            onPress={() => setRange(r)}
            accessibilityRole="button"
            accessibilityState={{ selected: range === r }}
            accessibilityLabel={r === '7d' ? 'Last 7 days' : 'Last 30 days'}
          >
            <Text style={[styles.segText, range === r && styles.segTextOn]}>
              {r === '7d' ? '7 days' : '30 days'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading ? (
        <ActivityIndicator color={NP.ink} />
      ) : !data || loggedDays === 0 ? (
        <Text style={styles.muted}>
          No meals logged in this window. Log food in Coach → Nutrition and your trend builds automatically.
        </Text>
      ) : (
        <>
          <Text style={styles.sectionLabel}>MICRONUTRIENT COVERAGE</Text>
          {wide ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chartScroll}>
              <Chart data={data} wide />
            </ScrollView>
          ) : (
            <View style={styles.chart}><Chart data={data} wide={false} /></View>
          )}
          <Text style={styles.footNote}>
            {loggedDays} of {data.series.length} days logged. Hollow columns are days with no food logged.
          </Text>

          <Text style={styles.sectionLabel}>CONSISTENCY BY NUTRIENT</Text>
          <View style={styles.list}>
            {data.consistency.map((c, i) => (
              <View key={c.key} style={[styles.row, i > 0 && styles.divider]}>
                <Text style={styles.rowLabel} numberOfLines={1}>{c.label}</Text>
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
          <Text style={styles.footNote}>% of your {loggedDays} logged day{loggedDays === 1 ? '' : 's'} that hit each target.</Text>
        </>
      )}
    </NpScreen>
  );
}

function Chart({ data, wide }: { data: NpTrend; wide: boolean }) {
  const lastIdx = data.series.length - 1;
  return (
    <View style={[styles.chartInner, wide && styles.chartInnerWide]}>
      {data.series.map((pt, i) => {
        const recent = i >= lastIdx - 1; // most recent 1–2 days inked (§5.4)
        const h = Math.max(3, Math.round((pt.coveragePct / 100) * CHART_H));
        const d = new Date(`${pt.date}T12:00:00Z`);
        // At 30 columns, label only every 5th day so the axis stays legible.
        const showLabel = !wide || i % 5 === 0 || i === lastIdx;
        return (
          <View key={pt.date} style={[styles.col, wide && styles.colWide]}>
            {!wide ? (
              <Text style={styles.colPct}>{pt.logged ? pt.coveragePct : '–'}</Text>
            ) : null}
            {pt.logged ? (
              <View style={[styles.bar, { height: h, backgroundColor: recent ? NP.ink : '#D4D4D8' }]} />
            ) : (
              // Gap, not zero — a hollow track reads as "nothing logged".
              <View style={[styles.barEmpty, { height: CHART_H }]} />
            )}
            <Text style={styles.colDay}>
              {showLabel ? (wide ? d.getUTCDate() : d.toLocaleDateString([], { weekday: 'narrow' })) : ''}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  muted: { fontSize: 13, color: NP.mutedInk, lineHeight: 19 },
  segment: { flexDirection: 'row', backgroundColor: NP.muted, borderRadius: 10, padding: 4, gap: 4 },
  segItem: { flex: 1, paddingVertical: 7, borderRadius: 8, alignItems: 'center' },
  segItemOn: { backgroundColor: NP.cardBg, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 2, shadowOffset: { width: 0, height: 1 } },
  segText: { fontSize: 13, fontWeight: fontWeight.semibold, color: NP.mutedInk },
  segTextOn: { color: NP.ink, fontWeight: fontWeight.bold },

  sectionLabel: { fontSize: 10, fontWeight: fontWeight.bold, letterSpacing: 1.2, color: NP.mutedInk },
  chart: { borderWidth: 1, borderColor: NP.border, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 10 },
  chartScroll: { borderWidth: 1, borderColor: NP.border, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 10 },
  chartInner: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 6, minHeight: CHART_H + 34 },
  chartInnerWide: { justifyContent: 'flex-start', gap: 5 },
  col: { flex: 1, alignItems: 'center', gap: 5, justifyContent: 'flex-end' },
  colWide: { flex: 0, width: 16 },
  colPct: { fontSize: 9, fontWeight: fontWeight.bold, color: NP.mutedInk, fontVariant: ['tabular-nums'] },
  bar: { width: '70%', minWidth: 10, borderRadius: 5 },
  barEmpty: { width: '70%', minWidth: 10, borderRadius: 5, borderWidth: 1, borderColor: NP.border, backgroundColor: 'transparent' },
  colDay: { fontSize: 10, color: NP.mutedInk, height: 13 },

  list: { borderWidth: 1, borderColor: NP.border, borderRadius: 16, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 11 },
  divider: { borderTopWidth: 1, borderTopColor: NP.border },
  rowLabel: { width: 92, fontSize: 12.5, color: NP.ink },
  rowTrack: { flex: 1, height: 6, borderRadius: 999, backgroundColor: NP.muted, overflow: 'hidden' },
  rowFill: { height: 6, borderRadius: 999 },
  rowPct: { width: 34, textAlign: 'right', fontSize: 11, fontWeight: fontWeight.bold, color: NP.ink, fontVariant: ['tabular-nums'] },
  footNote: { fontSize: 11, color: NP.mutedInk, marginTop: -6 },
});
