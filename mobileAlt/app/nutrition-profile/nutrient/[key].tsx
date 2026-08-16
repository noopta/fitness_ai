// Nutrient Detail (spec §5.2) — the flagship. Header card (tag chip + status +
// big current value of target + coverage bar), the mechanism → outcome stepped
// chain (node dot + connector), a personalized "why it matters for you"
// paragraph, best food sources, and a concrete recommendation.
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { nutritionProfileApi, type NpNutrientDetail, type NpRange } from '../../../src/lib/api';
import { fontWeight } from '../../../src/constants/theme';
import { NpScreen } from '../../../src/components/coach/nutritionProfile/NpScreen';
import { StatusPill, CoverageBar } from '../../../src/components/coach/nutritionProfile/StatusPill';
import { NP } from '../../../src/components/coach/nutritionProfile/npTokens';
import { rangeWindowLabel } from '../../../src/components/coach/nutritionProfile/rangeCopy';
import { todayStr } from '../../../src/lib/localDate';

function asRange(raw: unknown): NpRange {
  return raw === '7d' || raw === '30d' ? raw : 'today';
}

export default function NutrientDetailScreen() {
  const { key, range: rangeParam } = useLocalSearchParams<{ key: string; range?: string }>();
  const range = asRange(rangeParam);
  const [data, setData] = useState<NpNutrientDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    nutritionProfileApi.getNutrient(String(key), todayStr(), range)
      .then(d => { if (alive) setData(d); })
      .catch(() => {})
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [key, range]);

  return (
    <NpScreen kicker={`NUTRIENT · ${rangeWindowLabel(range)}`} title={data?.label ?? 'Nutrient'}>
      {loading ? (
        <ActivityIndicator color={NP.ink} />
      ) : !data ? (
        <Text style={styles.muted}>Couldn't load this nutrient.</Text>
      ) : (
        <>
          <View style={styles.headerCard}>
            <View style={styles.headRow}>
              {data.tag ? <View style={styles.tagChip}><Text style={styles.tagText}>{data.tag}</Text></View> : <View />}
              <StatusPill status={data.status} />
            </View>
            <Text style={styles.bigValue}>
              {data.current}<Text style={styles.bigUnit}> {data.unit}</Text>
              <Text style={styles.ofTarget}>  of {data.target} {data.unit} target</Text>
            </Text>
            <Text style={styles.pctLine}>{data.pct}% of target</Text>
            <CoverageBar pct={data.pct} status={data.status} />
            {/* Under a window the figure above is a per-day mean over logged
                days, and the target is a daily one — say so, or it reads as a
                window total measured against a single day's target. */}
            {range !== 'today' ? (
              <Text style={styles.perDayNote}>
                Daily average across {data.loggedDays ?? 0} logged day
                {(data.loggedDays ?? 0) === 1 ? '' : 's'} of {data.windowDays ?? 0}.
                {data.ceiling && (data.daysOverCeiling?.[data.key] ?? 0) > 0
                  ? ` Over target on ${data.daysOverCeiling?.[data.key]} of them.`
                  : ''}
              </Text>
            ) : null}
          </View>

          {data.chain.length > 0 ? (
            <>
              <Text style={styles.sectionLabel}>MECHANISM → OUTCOME</Text>
              <View>
                {data.chain.map((step, i) => (
                  <View key={i} style={styles.step}>
                    <View style={styles.stepGutter}>
                      <View style={styles.stepDot} />
                      {i < data.chain.length - 1 ? <View style={styles.stepLine} /> : null}
                    </View>
                    <View style={styles.stepBody}>
                      <Text style={styles.stepTitle}>{step.title}</Text>
                      <Text style={styles.stepText}>{step.body}</Text>
                    </View>
                  </View>
                ))}
              </View>
            </>
          ) : null}

          <Text style={styles.sectionLabel}>WHY IT MATTERS FOR YOU</Text>
          <Text style={styles.why}>{data.why}</Text>

          {data.sources.length > 0 ? (
            <>
              <Text style={styles.sectionLabel}>BEST FOOD SOURCES</Text>
              <View style={styles.list}>
                {data.sources.map((s, i) => (
                  <View key={i} style={[styles.sourceRow, i > 0 && styles.divider]}>
                    <Text style={styles.sourceFood}>{s.food}</Text>
                    <Text style={styles.sourceAmt}>{s.amount}</Text>
                  </View>
                ))}
              </View>
            </>
          ) : null}

          <View style={styles.recCard}>
            <Text style={styles.recText}>{data.recommendation}</Text>
          </View>

          {data.watchFor ? (
            <View style={styles.watch}>
              <Ionicons name="alert-circle-outline" size={15} color="#B45309" />
              <Text style={styles.watchText}>{data.watchFor}</Text>
            </View>
          ) : null}
        </>
      )}
    </NpScreen>
  );
}

const styles = StyleSheet.create({
  muted: { fontSize: 13, color: NP.mutedInk },
  headerCard: { gap: 8, padding: 16, borderWidth: 1, borderColor: NP.border, borderRadius: 16 },
  headRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  tagChip: { backgroundColor: NP.muted, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3 },
  tagText: { fontSize: 10, fontWeight: fontWeight.semibold, color: NP.ink },
  bigValue: { fontSize: 30, fontWeight: fontWeight.bold, color: NP.ink, fontVariant: ['tabular-nums'] },
  bigUnit: { fontSize: 16, fontWeight: fontWeight.bold, color: NP.mutedInk },
  ofTarget: { fontSize: 12, fontWeight: fontWeight.medium, color: NP.mutedInk },
  pctLine: { fontSize: 12, fontWeight: fontWeight.semibold, color: NP.ink },
  perDayNote: { fontSize: 11, color: NP.mutedInk, lineHeight: 16 },
  sectionLabel: { fontSize: 10, fontWeight: fontWeight.bold, letterSpacing: 1.2, color: NP.mutedInk },

  step: { flexDirection: 'row', gap: 12 },
  stepGutter: { alignItems: 'center', width: 12 },
  stepDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: NP.ink, marginTop: 3 },
  stepLine: { flex: 1, width: 2, backgroundColor: NP.border, marginTop: 2 },
  stepBody: { flex: 1, paddingBottom: 16 },
  stepTitle: { fontSize: 13.5, fontWeight: fontWeight.bold, color: NP.ink },
  stepText: { fontSize: 12.5, color: NP.mutedInk, lineHeight: 18, marginTop: 2 },

  why: { fontSize: 13.5, color: NP.ink, lineHeight: 20 },
  list: { borderWidth: 1, borderColor: NP.border, borderRadius: 16, overflow: 'hidden' },
  sourceRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 11 },
  divider: { borderTopWidth: 1, borderTopColor: NP.border },
  sourceFood: { fontSize: 13, color: NP.ink },
  sourceAmt: { fontSize: 12, fontWeight: fontWeight.bold, color: '#15803D', fontVariant: ['tabular-nums'] },
  recCard: { backgroundColor: NP.ink, borderRadius: 16, padding: 16 },
  recText: { fontSize: 13.5, color: '#FFFFFF', lineHeight: 20, fontWeight: fontWeight.medium },
  watch: { flexDirection: 'row', gap: 8, backgroundColor: '#FEF3C7', borderRadius: 12, padding: 12 },
  watchText: { flex: 1, fontSize: 12, color: '#B45309', lineHeight: 17 },
});
