// Weekly gut view + plant-diversity counter — handoff §7.4. Five pillars
// with status bars, and the collection grid (30 slots; tap a plant to see
// what counted). Tone: celebratory, never nagging — gaps are opportunities.
import React, { useEffect, useState } from 'react';
import { Modal, View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { colors } from '../../../../constants/theme';
import { nutritionApi } from '../../../../lib/api';
import { todayStr } from '../../../../lib/localDate';
import { Eyebrow, PillarBar, EST_NOTE, type BandStatus } from './GutPrimitives';

interface GutWeekPayload {
  days: number;
  overall: number;
  plantCount: number;
  plantTarget: number;
  plants: string[];
  pillars: Array<{ key: string; label: string; score: number; status: BandStatus; detail: string }>;
}

export function GutWeekScreen({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const [data, setData] = useState<GutWeekPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tappedPlant, setTappedPlant] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setError(null);
    nutritionApi.getGutWeek(todayStr())
      .then(setData)
      .catch(() => setError('Couldn’t load your week — pull to retry.'));
  }, [visible]);

  if (!visible) return null;
  const remaining = data ? Math.max(0, data.plantTarget - data.plantCount) : 0;
  // Nothing logged yet this window: every earn-direction pillar is 0 (the
  // "avoid" pillar scores 100 on zero meals by design). Red "very low"
  // everywhere would read as failure before the user has even started —
  // show an invitation instead (handoff §10 empty states).
  const noData = !!data && data.plantCount === 0 &&
    data.pillars.every((pl) => pl.key === 'avoid' || pl.score === 0);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <ScrollView contentContainerStyle={{ padding: 20, paddingTop: 64, paddingBottom: 48, gap: 20 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <View style={{ gap: 6 }}>
              <Eyebrow>This week</Eyebrow>
              <Text style={{ fontSize: 24, fontWeight: '700', letterSpacing: -0.6, color: colors.foreground }}>
                Gut health
              </Text>
            </View>
            <Pressable onPress={onClose} hitSlop={12}>
              <Text style={{ fontSize: 15, color: colors.mutedForeground }}>Done</Text>
            </Pressable>
          </View>

          {error && (
            <View style={styles.card}><Text style={{ fontSize: 13, color: colors.mutedForeground }}>{error}</Text></View>
          )}

          {!data && !error && (
            <View style={[styles.card, { height: 220, backgroundColor: colors.muted, borderColor: colors.muted }]} />
          )}

          {data && (
            <>
              {/* Plant collection grid — the one playful mechanic */}
              <View style={styles.card}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <Text style={styles.cardTitle}>Plant collection</Text>
                  <Text style={{ fontSize: 17, fontWeight: '700', color: colors.foreground, fontVariant: ['tabular-nums'] }}>
                    {data.plantCount}
                    <Text style={{ fontSize: 12, fontWeight: '400', color: colors.mutedForeground }}> / {data.plantTarget}</Text>
                  </Text>
                </View>
                <Text style={{ fontSize: 12, color: colors.mutedForeground, marginTop: 2, lineHeight: 17 }}>
                  {data.plantCount === 0
                    ? 'Every distinct plant you eat this week fills a slot — herbs and spices count.'
                    : remaining > 0
                      ? `${remaining} to go. Different plants feed different gut microbes — variety is the whole game.`
                      : 'Full board. Your microbiome had a great week.'}
                </Text>
                <View style={styles.grid}>
                  {Array.from({ length: data.plantTarget }, (_, i) => {
                    const plant = data.plants[i];
                    return (
                      <Pressable
                        key={i}
                        onPress={() => plant && setTappedPlant(plant)}
                        style={[styles.slot, plant ? styles.slotFilled : null]}
                      >
                        {plant ? (
                          <Text numberOfLines={1} style={styles.slotText}>{plant}</Text>
                        ) : null}
                      </Pressable>
                    );
                  })}
                </View>
                {tappedPlant && (
                  <View style={styles.plantDetail}>
                    <Text style={{ fontSize: 12, color: colors.foreground }}>
                      <Text style={{ fontWeight: '700' }}>{tappedPlant}</Text> — counted once this week, no
                      matter how many times you ate it. New plants score, repeats don’t.
                    </Text>
                  </View>
                )}
              </View>

              {/* Five pillars */}
              <View style={styles.card}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <Text style={styles.cardTitle}>The five pillars</Text>
                  {!noData && <Text style={{ fontSize: 10, color: '#a1a1aa' }}>{EST_NOTE}</Text>}
                </View>
                {noData ? (
                  <View style={{ gap: 12 }}>
                    <Text style={{ fontSize: 13, lineHeight: 19, color: colors.mutedForeground }}>
                      Nothing logged yet this week. Log your first meal and the five pillars
                      light up — fiber, plant variety, fermented foods, whole foods, and rhythm.
                    </Text>
                    <View style={{ gap: 8 }}>
                      {data.pillars.map((p) => (
                        <View key={p.key} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.border }} />
                          <Text style={{ fontSize: 13, color: colors.mutedForeground }}>{p.label}</Text>
                        </View>
                      ))}
                    </View>
                  </View>
                ) : (
                  <>
                    <View style={{ gap: 14 }}>
                      {data.pillars.map((p) => (
                        <PillarBar key={p.key} label={p.label} score={p.score} status={p.status} detail={p.detail} />
                      ))}
                    </View>
                    {data.days < 7 && (
                      <Text style={{ fontSize: 11, color: colors.mutedForeground, marginTop: 12 }}>
                        Based on {data.days} {data.days === 1 ? 'day' : 'days'} of logs — the picture sharpens as the week fills in.
                      </Text>
                    )}
                  </>
                )}
              </View>
            </>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border,
    borderRadius: 16, padding: 16,
  },
  cardTitle: { fontSize: 14, fontWeight: '600', color: colors.foreground },
  grid: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 14,
  },
  slot: {
    width: '18.4%', height: 34, borderRadius: 8,
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.muted,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4,
  },
  slotFilled: { backgroundColor: colors.foreground, borderColor: colors.foreground },
  slotText: { fontSize: 9, fontWeight: '600', color: colors.primaryForeground },
  plantDetail: {
    marginTop: 10, backgroundColor: colors.muted, borderRadius: 10, padding: 10,
  },
});
