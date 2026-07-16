// Effect Detail (spec §5.1) — how today's food is acting on one body system.
// Status pill + summary, contributing-nutrient driver rows (tracked ones tap
// through to Nutrient Detail), mechanism sentences, and a single amber "watch
// for" caution.
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { nutritionProfileApi, type NpEffectDetail } from '../../../src/lib/api';
import { fontWeight } from '../../../src/constants/theme';
import { NpScreen } from '../../../src/components/coach/nutritionProfile/NpScreen';
import { StatusPill, CoverageBar } from '../../../src/components/coach/nutritionProfile/StatusPill';
import { NP } from '../../../src/components/coach/nutritionProfile/npTokens';

export default function EffectDetailScreen() {
  const { systemId } = useLocalSearchParams<{ systemId: string }>();
  const router = useRouter();
  const [data, setData] = useState<NpEffectDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    nutritionProfileApi.getEffect(String(systemId))
      .then(d => { if (alive) setData(d); })
      .catch(() => {})
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [systemId]);

  return (
    <NpScreen kicker="BODY SYSTEM" title={data?.name ?? 'Effect'}>
      {loading ? (
        <ActivityIndicator color={NP.ink} />
      ) : !data ? (
        <Text style={styles.muted}>Couldn't load this system.</Text>
      ) : (
        <>
          <View style={styles.headerCard}>
            <StatusPill status={data.status} />
            <Text style={styles.summary}>{data.summary}</Text>
          </View>

          <Text style={styles.sectionLabel}>CONTRIBUTING NUTRIENTS</Text>
          <View style={styles.list}>
            {data.drivers.map((d, i) => {
              const row = (
                <>
                  <View style={styles.driverTop}>
                    <Text style={styles.driverName}>{d.label}</Text>
                    <Text style={styles.driverPct}>{d.pct}%</Text>
                    {d.tracked ? <Ionicons name="chevron-forward" size={14} color={NP.mutedInk} /> : null}
                  </View>
                  <CoverageBar pct={d.pct} status={d.status} />
                  <Text style={styles.driverAmt}>{d.amount} / {d.target} {d.unit}</Text>
                </>
              );
              return d.tracked ? (
                <TouchableOpacity
                  key={d.key}
                  style={[styles.driverRow, i > 0 && styles.divider]}
                  onPress={() => router.push(`/nutrition-profile/nutrient/${d.key}` as never)}
                  activeOpacity={0.82}
                  accessibilityRole="button"
                  accessibilityLabel={`${d.label}, ${d.pct}% of target, opens nutrient detail`}
                >{row}</TouchableOpacity>
              ) : (
                <View key={d.key} style={[styles.driverRow, i > 0 && styles.divider]}>{row}</View>
              );
            })}
          </View>

          {data.mechanisms.length > 0 ? (
            <>
              <Text style={styles.sectionLabel}>HOW YOUR FOOD IS ACTING HERE</Text>
              <View style={{ gap: 10 }}>
                {data.mechanisms.map((m, i) => (
                  <View key={i} style={styles.mechRow}>
                    <View style={styles.mechRule} />
                    <Text style={styles.mechText}>{m}</Text>
                  </View>
                ))}
              </View>
            </>
          ) : null}

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
  headerCard: { gap: 10, padding: 15, borderWidth: 1, borderColor: NP.border, borderRadius: 16 },
  summary: { fontSize: 13.5, color: NP.ink, lineHeight: 19 },
  sectionLabel: { fontSize: 10, fontWeight: fontWeight.bold, letterSpacing: 1.2, color: NP.mutedInk },
  list: { borderWidth: 1, borderColor: NP.border, borderRadius: 16, overflow: 'hidden' },
  driverRow: { paddingHorizontal: 14, paddingVertical: 12, gap: 6 },
  divider: { borderTopWidth: 1, borderTopColor: NP.border },
  driverTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  driverName: { flex: 1, fontSize: 13, fontWeight: fontWeight.semibold, color: NP.ink },
  driverPct: { fontSize: 12, fontWeight: fontWeight.bold, color: NP.ink, fontVariant: ['tabular-nums'] },
  driverAmt: { fontSize: 11, color: NP.mutedInk },
  mechRow: { flexDirection: 'row', gap: 10 },
  mechRule: { width: 2, borderRadius: 2, backgroundColor: NP.ink },
  mechText: { flex: 1, fontSize: 12.5, color: NP.mutedInk, lineHeight: 18 },
  watch: { flexDirection: 'row', gap: 8, backgroundColor: '#FEF3C7', borderRadius: 12, padding: 12 },
  watchText: { flex: 1, fontSize: 12, color: '#B45309', lineHeight: 17 },
});
