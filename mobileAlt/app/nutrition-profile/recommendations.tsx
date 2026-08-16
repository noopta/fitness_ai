// Recommendations (spec §5.5) — ranked whole foods to close the selected
// window's gaps. Each card: food name + a green gain ("+440 mg choline"), a
// mechanism sentence, a category tag chip, and an "Add" pill that deep-links
// into the Coach log with the food prefilled (no server write — logging stays
// in Coach).
//
// `range` must match the profile screen's: the top-move card links straight
// here, and it's ranked off the same coverage vector, so a mismatch would make
// the card the user tapped absent from the list it opens.
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { nutritionProfileApi, type NpRecommendation, type NpRange } from '../../src/lib/api';
import { Analytics } from '../../src/lib/analytics';
import { fontWeight } from '../../src/constants/theme';
import { NpScreen } from '../../src/components/coach/nutritionProfile/NpScreen';
import { NP } from '../../src/components/coach/nutritionProfile/npTokens';
import { rangeSpokenLabel, rangeWindowLabel } from '../../src/components/coach/nutritionProfile/rangeCopy';
import { setNutritionPrefill } from '../../src/lib/nutritionPrefill';
import { todayStr } from '../../src/lib/localDate';

function asRange(raw: unknown): NpRange {
  return raw === '7d' || raw === '30d' ? raw : 'today';
}

export default function RecommendationsScreen() {
  const router = useRouter();
  const { range: rangeParam } = useLocalSearchParams<{ range?: string }>();
  const range = asRange(rangeParam);
  const [recs, setRecs] = useState<NpRecommendation[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    nutritionProfileApi.getRecommendations(todayStr(), range)
      .then(r => { if (alive) setRecs(r.recommendations); })
      .catch(() => { if (alive) setRecs([]); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [range]);

  const onAdd = (r: NpRecommendation) => {
    setNutritionPrefill(r.prefill.name);
    Analytics.nutritionRecommendationAdded({ food: r.name, nutrient: r.gain });
    // Deep-link into the Coach log; the nutrition surface opens Describe
    // prefilled with this food.
    router.push('/(tabs)/coach');
  };

  return (
    <NpScreen kicker={`RECOMMENDATIONS · ${rangeWindowLabel(range)}`} title="What to eat next">
      {loading ? (
        <ActivityIndicator color={NP.ink} />
      ) : !recs || recs.length === 0 ? (
        <Text style={styles.muted}>
          {range === 'today'
            ? "You've hit today's targets. Nothing to close right now."
            : `You've hit your daily targets across ${rangeSpokenLabel(range)}. Nothing to close right now.`}
        </Text>
      ) : (
        <>
          <Text style={styles.intro}>
            {range === 'today'
              ? "Ranked to close today's biggest gaps. Add queues it into your Coach log."
              : `Ranked to close your biggest average daily gaps over ${rangeSpokenLabel(range)}. Add queues it into your Coach log.`}
          </Text>
          {recs.map((r, i) => (
            <View key={i} style={styles.card}>
              <View style={styles.topRow}>
                <Text style={styles.name}>{r.name}</Text>
                <View style={styles.tag}><Text style={styles.tagText}>{r.category}</Text></View>
              </View>
              <Text style={styles.gain}>{r.gain} · {r.serving}</Text>
              <Text style={styles.mech}>{r.mechanism}</Text>
              <TouchableOpacity
                style={styles.addBtn}
                onPress={() => onAdd(r)}
                accessibilityRole="button"
                accessibilityLabel={`Add ${r.name} to your Coach log`}
              >
                <Ionicons name="add" size={15} color="#FFFFFF" />
                <Text style={styles.addText}>Add</Text>
              </TouchableOpacity>
            </View>
          ))}
        </>
      )}
    </NpScreen>
  );
}

const styles = StyleSheet.create({
  muted: { fontSize: 13, color: NP.mutedInk },
  intro: { fontSize: 12.5, color: NP.mutedInk, lineHeight: 18 },
  card: { borderWidth: 1, borderColor: NP.border, borderRadius: 16, padding: 15, gap: 7 },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  name: { flex: 1, fontSize: 15, fontWeight: fontWeight.bold, color: NP.ink },
  tag: { backgroundColor: NP.muted, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3 },
  tagText: { fontSize: 10, fontWeight: fontWeight.semibold, color: NP.mutedInk },
  gain: { fontSize: 12.5, fontWeight: fontWeight.bold, color: '#15803D' },
  mech: { fontSize: 12, color: NP.mutedInk, lineHeight: 17 },
  addBtn: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: NP.ink, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 7, marginTop: 3 },
  addText: { color: '#FFFFFF', fontSize: 12.5, fontWeight: fontWeight.bold },
});
