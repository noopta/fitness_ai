import React from 'react';
import { View, Text, ScrollView, StyleSheet, Dimensions } from 'react-native';
import { BottomSheet } from '../ui/BottomSheet';

const SCREEN_H = Dimensions.get('window').height;

interface Props {
  visible: boolean;
  onClose: () => void;
  /** 1..6 — current tier rung. 0 = pre-diagnostic. */
  currentTierIndex: number;
}

interface TierEntry {
  i: 1 | 2 | 3 | 4 | 5 | 6;
  name: string;
  band: string;
}

// Bands borrowed from the handoff's mock — Wilks-based. They're a documentation
// artefact; the actual tier comes from the backend's StrengthProfile.strengthTier.
const TIERS: TierEntry[] = [
  { i: 1, name: 'Novice',          band: '< 200 Wilks' },
  { i: 2, name: 'Beginner',        band: '200–260 Wilks' },
  { i: 3, name: 'Intermediate I',  band: '260–310 Wilks' },
  { i: 4, name: 'Intermediate II', band: '310–365 Wilks' },
  { i: 5, name: 'Advanced',        band: '365–430 Wilks' },
  { i: 6, name: 'Elite',           band: '> 430 Wilks' },
];

/**
 * Static educational sheet — opens when the tier hero card is tapped.
 * Spec: snap point 60% — we approximate with height: 72% (handoff's mock).
 */
export function TierExplainerSheet({ visible, onClose, currentTierIndex }: Props) {
  return (
    <BottomSheet visible={visible} onClose={onClose} height={SCREEN_H * 0.72} style={styles.sheet}>
      <View style={styles.handle} />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <Text style={styles.eyebrow}>The strength ladder</Text>
        <Text style={styles.title}>Where you stand</Text>
        <Text style={styles.lede}>
          Six tiers benchmarked against ~100k strength athletes. Your tier is set by your weighted
          Wilks across the four big lifts.
        </Text>

        <View style={{ marginTop: 18 }}>
          {TIERS.map((t, idx) => {
            const isCurrent = t.i === currentTierIndex;
            const isDone = t.i < currentTierIndex;
            return (
              <View
                key={t.i}
                style={[
                  styles.row,
                  idx < TIERS.length - 1 && styles.rowBorder,
                ]}
              >
                <View
                  style={[
                    styles.bullet,
                    isCurrent && styles.bulletCurrent,
                    isDone && styles.bulletDone,
                    !isDone && !isCurrent && styles.bulletEmpty,
                  ]}
                >
                  <Text
                    style={[
                      styles.bulletNum,
                      isCurrent && { color: '#FFFFFF' },
                      !isDone && !isCurrent && { color: '#71717A' },
                    ]}
                  >
                    {t.i}
                  </Text>
                </View>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text style={styles.tierName}>{t.name}</Text>
                    {isCurrent && (
                      <View style={styles.youPill}>
                        <Text style={styles.youPillText}>YOU</Text>
                      </View>
                    )}
                  </View>
                  <Text style={styles.band}>{t.band}</Text>
                </View>
                {isDone && <Text style={styles.checkmark}>✓</Text>}
              </View>
            );
          })}
        </View>
      </ScrollView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  sheet: { backgroundColor: '#FFFFFF' },
  handle: {
    width: 36, height: 4, borderRadius: 999, backgroundColor: '#D4D4D8',
    alignSelf: 'center', marginTop: 10, marginBottom: 16,
  },
  content: { paddingHorizontal: 20, paddingBottom: 24 },
  eyebrow: {
    fontSize: 11, fontWeight: '700', letterSpacing: 1.5,
    textTransform: 'uppercase', color: '#71717A',
  },
  title: { fontSize: 22, fontWeight: '700', letterSpacing: -0.4, marginTop: 4, color: '#09090B' },
  lede: { fontSize: 13, color: '#71717A', marginTop: 6, lineHeight: 19 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14 },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: '#E4E4E7' },
  bullet: {
    width: 32, height: 32, borderRadius: 999,
    alignItems: 'center', justifyContent: 'center',
  },
  bulletCurrent: { backgroundColor: '#09090B' },
  bulletDone: { backgroundColor: '#E4E4E7' },
  bulletEmpty: { borderWidth: 1, borderColor: '#D4D4D8', borderStyle: 'dashed' },
  bulletNum: { fontSize: 12, fontWeight: '700', fontFamily: 'Menlo', color: '#09090B' },
  tierName: { fontSize: 14, fontWeight: '700', color: '#09090B' },
  band: { fontSize: 11, color: '#71717A', fontFamily: 'Menlo', marginTop: 2 },
  youPill: {
    backgroundColor: '#09090B', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 999,
  },
  youPillText: { color: '#FFFFFF', fontSize: 9.5, fontWeight: '700', letterSpacing: 0.5 },
  checkmark: { color: '#15803D', fontSize: 14, fontWeight: '700' },
});
