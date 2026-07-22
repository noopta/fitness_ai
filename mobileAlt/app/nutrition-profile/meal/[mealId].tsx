// Meal Breakdown (spec §5.3) — total kcal + logged time, three macro tiles,
// then one card per ingredient with the nutrient chips it contributes.
// Ingredients whose per-nutrient data hasn't resolved read "resolving…" (§7).
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { nutritionProfileApi, type NpMealBreakdown } from '../../../src/lib/api';
import { fontWeight } from '../../../src/constants/theme';
import { NpScreen } from '../../../src/components/coach/nutritionProfile/NpScreen';
import { NP } from '../../../src/components/coach/nutritionProfile/npTokens';

export default function MealBreakdownScreen() {
  const { mealId } = useLocalSearchParams<{ mealId: string }>();
  const [data, setData] = useState<NpMealBreakdown | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    nutritionProfileApi.getMeal(String(mealId))
      .then(d => { if (alive) setData(d); })
      .catch(() => {})
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [mealId]);

  const time = data?.loggedAt
    ? new Date(data.loggedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : '';

  return (
    <NpScreen kicker="MEAL" title={data?.name ?? 'Meal breakdown'}>
      {loading ? (
        <ActivityIndicator color={NP.ink} />
      ) : !data ? (
        <Text style={styles.muted}>Couldn't load this meal.</Text>
      ) : (
        <>
          <View style={styles.headerCard}>
            <Text style={styles.kcal}>{data.kcal} <Text style={styles.kcalUnit}>kcal</Text></Text>
            {time ? <Text style={styles.time}>Logged {time}</Text> : null}
            <View style={styles.tiles}>
              <MacroTile label="PROTEIN" value={`${data.macros.proteinG}g`} />
              <MacroTile label="CARBS" value={`${data.macros.carbsG}g`} />
              <MacroTile label="FAT" value={`${data.macros.fatG}g`} />
            </View>
          </View>

          <Text style={styles.sectionLabel}>INGREDIENTS → WHAT THEY CARRY</Text>
          <View style={{ gap: 10 }}>
            {data.ingredients.map((ing, i) => (
              <View key={i} style={styles.ingCard}>
                <Text style={styles.ingName}>{ing.name}</Text>
                {ing.resolved ? (
                  <View style={styles.chipWrap}>
                    {ing.chips.map((c, j) => (
                      <View key={j} style={styles.chip}><Text style={styles.chipText}>{c}</Text></View>
                    ))}
                  </View>
                ) : (
                  <Text style={styles.resolving}>resolving…</Text>
                )}
              </View>
            ))}
          </View>
        </>
      )}
    </NpScreen>
  );
}

function MacroTile({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.tile}>
      <Text style={styles.tileValue}>{value}</Text>
      <Text style={styles.tileLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  muted: { fontSize: 13, color: NP.mutedInk },
  headerCard: { gap: 10, padding: 16, borderWidth: 1, borderColor: NP.border, borderRadius: 16 },
  kcal: { fontSize: 30, fontWeight: fontWeight.bold, color: NP.ink, fontVariant: ['tabular-nums'] },
  kcalUnit: { fontSize: 15, fontWeight: fontWeight.bold, color: NP.mutedInk },
  time: { fontSize: 12, color: NP.mutedInk },
  tiles: { flexDirection: 'row', gap: 8 },
  tile: { flex: 1, backgroundColor: NP.muted, borderRadius: 12, padding: 12, gap: 3 },
  tileValue: { fontSize: 16, fontWeight: fontWeight.bold, color: NP.ink, fontVariant: ['tabular-nums'] },
  tileLabel: { fontSize: 9, fontWeight: fontWeight.bold, letterSpacing: 0.5, color: NP.mutedInk },
  sectionLabel: { fontSize: 10, fontWeight: fontWeight.bold, letterSpacing: 1.2, color: NP.mutedInk },
  ingCard: { borderWidth: 1, borderColor: NP.border, borderRadius: 14, padding: 13, gap: 8 },
  ingName: { fontSize: 13.5, fontWeight: fontWeight.bold, color: NP.ink },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { backgroundColor: NP.muted, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4 },
  chipText: { fontSize: 10.5, fontWeight: fontWeight.semibold, color: NP.ink },
  resolving: { fontSize: 12, fontStyle: 'italic', color: NP.mutedInk },
});
