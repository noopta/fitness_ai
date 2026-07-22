// Compact micronutrient + gut-win preview for the Review stage of the
// logging sheets (Describe / Snap / Voice) — handoff §7.5: the confirm
// screen shows what was detected beyond macros, banded-honest (est. ±30%),
// BEFORE the user commits the log.
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors } from '../../../../constants/theme';

// Headline set shown on the confirm card, in display order. The full 18
// live in the Nutrition tab; the confirm card stays glanceable.
const HEADLINE: Array<{ key: string; label: string; unit: string }> = [
  { key: 'fiberG',       label: 'Fiber',     unit: 'g' },
  { key: 'ironMg',       label: 'Iron',      unit: 'mg' },
  { key: 'magnesiumMg',  label: 'Magnesium', unit: 'mg' },
  { key: 'potassiumMg',  label: 'Potassium', unit: 'mg' },
  { key: 'calciumMg',    label: 'Calcium',   unit: 'mg' },
  { key: 'vitaminB12Mcg', label: 'B12',      unit: 'mcg' },
  { key: 'vitaminCMg',   label: 'Vit C',     unit: 'mg' },
  { key: 'omega3G',      label: 'Omega-3',   unit: 'g' },
];

export function MicroPreview({ raw }: { raw: any }) {
  const meal = raw?.meal ?? raw ?? {};
  const nutrients = meal?.nutrients ?? {};
  const plants: string[] = Array.isArray(meal?.plants) ? meal.plants : [];
  const fermented: string[] = Array.isArray(meal?.fermentedFoods) ? meal.fermentedFoods : [];
  const ultraProcessed = meal?.ultraProcessed === true;

  const rows = HEADLINE
    .map((h) => ({ ...h, value: Number(nutrients?.[h.key]) }))
    .filter((h) => Number.isFinite(h.value) && h.value > 0)
    .slice(0, 6);

  const hasChips = plants.length > 0 || fermented.length > 0 || ultraProcessed;
  if (rows.length === 0 && !hasChips) return null;

  return (
    <View style={styles.wrap}>
      {rows.length > 0 && (
        <>
          <View style={styles.headerRow}>
            <Text style={styles.title}>Also detected</Text>
            <Text style={styles.est}>est. ±30%</Text>
          </View>
          <View style={styles.microRow}>
            {rows.map((r) => (
              <View key={r.key} style={styles.microCell}>
                <Text style={styles.microValue}>
                  {r.value >= 10 ? Math.round(r.value) : Math.round(r.value * 10) / 10}
                  <Text style={styles.microUnit}>{r.unit}</Text>
                </Text>
                <Text style={styles.microLabel}>{r.label}</Text>
              </View>
            ))}
          </View>
        </>
      )}
      {hasChips && (
        <View style={styles.chipRow}>
          {plants.length > 0 && (
            <View style={[styles.chip, styles.chipGood]}>
              <Text style={styles.chipGoodText}>
                +{plants.length} {plants.length === 1 ? 'plant' : 'plants'}
              </Text>
            </View>
          )}
          {fermented.length > 0 && (
            <View style={[styles.chip, styles.chipGood]}>
              <Text style={styles.chipGoodText}>fermented ✓</Text>
            </View>
          )}
          {ultraProcessed && (
            <View style={[styles.chip, styles.chipWarn]}>
              <Text style={styles.chipWarnText}>ultra-processed</Text>
            </View>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginTop: 12,
    backgroundColor: colors.muted,
    borderRadius: 12,
    padding: 12,
    gap: 10,
  },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { fontSize: 11, fontWeight: '700', color: colors.mutedForeground, textTransform: 'uppercase', letterSpacing: 0.8 },
  est: { fontSize: 10, color: '#a1a1aa' },
  microRow: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 10 },
  microCell: { width: '33.3%', gap: 1 },
  microValue: { fontSize: 14, fontWeight: '700', color: colors.foreground, fontVariant: ['tabular-nums'] },
  microUnit: { fontSize: 10, fontWeight: '400', color: colors.mutedForeground },
  microLabel: { fontSize: 10, color: colors.mutedForeground },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { borderRadius: 999, paddingVertical: 4, paddingHorizontal: 10 },
  chipGood: { backgroundColor: colors.successSoft },
  chipGoodText: { fontSize: 11, fontWeight: '600', color: colors.successInk },
  chipWarn: { backgroundColor: colors.warningSoft },
  chipWarnText: { fontSize: 11, fontWeight: '600', color: colors.warningInk },
});
