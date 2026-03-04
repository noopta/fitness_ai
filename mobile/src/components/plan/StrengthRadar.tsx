import { View, Text, StyleSheet } from 'react-native';
import { DiagnosticSignalsSubset, IndexScore } from '@/lib/api';
import { colors, fontSize, fontWeight, radius } from '@/constants/theme';

interface Props {
  signals: DiagnosticSignalsSubset;
  liftId: string;
}

const LIFT_INDEX_MAP: Record<string, Array<keyof DiagnosticSignalsSubset['indices']>> = {
  flat_bench_press:    ['triceps_index', 'shoulder_index', 'back_tension_index'],
  incline_bench_press: ['triceps_index', 'shoulder_index', 'back_tension_index'],
  deadlift:            ['posterior_index', 'quad_index', 'back_tension_index'],
  barbell_back_squat:  ['quad_index', 'posterior_index', 'back_tension_index'],
  barbell_front_squat: ['quad_index', 'posterior_index', 'back_tension_index'],
  back_squat:          ['quad_index', 'posterior_index', 'back_tension_index'],
  front_squat:         ['quad_index', 'posterior_index', 'back_tension_index'],
};

const INDEX_LABELS: Record<string, string> = {
  quad_index: 'Quads',
  posterior_index: 'Posterior Chain',
  back_tension_index: 'Back / Lats',
  triceps_index: 'Triceps',
  shoulder_index: 'Shoulders',
};

function scoreLabel(value: number): { label: string; color: string } {
  if (value >= 90) return { label: 'Very Strong', color: colors.green500 };
  if (value >= 75) return { label: 'Strong', color: colors.green500 };
  if (value >= 60) return { label: 'Adequate', color: colors.amber500 };
  if (value >= 45) return { label: 'Weak', color: colors.orange500 };
  return { label: 'Deficient', color: colors.red500 };
}

function barBg(value: number): string {
  if (value >= 75) return colors.green500;
  if (value >= 60) return colors.amber500;
  if (value >= 45) return colors.orange500;
  return colors.red500;
}

export function StrengthRadar({ signals, liftId }: Props) {
  const relevantKeys = LIFT_INDEX_MAP[liftId] ??
    (Object.keys(INDEX_LABELS) as Array<keyof DiagnosticSignalsSubset['indices']>);

  const data = relevantKeys
    .map((key) => {
      const idx = signals.indices[key];
      if (!idx) return null;
      return { key, label: INDEX_LABELS[key] ?? key, value: Math.round(idx.value) };
    })
    .filter(Boolean) as Array<{ key: string; label: string; value: number }>;

  if (data.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>
          Add proxy lift data in the snapshot step to see muscle group indices.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.legend}>
        <Text style={styles.legendText}>Index scale: 100 = expected for your lift level</Text>
      </View>

      {data.map((d) => {
        const { label, color } = scoreLabel(d.value);
        return (
          <View key={d.key} style={styles.barSection}>
            <View style={styles.barHeader}>
              <View style={styles.barHeaderLeft}>
                <Text style={styles.barLabel}>{d.label}</Text>
                <Text style={[styles.barTag, { color }]}>{label}</Text>
              </View>
              <View style={styles.barHeaderRight}>
                <Text style={styles.barValue}>{d.value}</Text>
                <Text style={styles.barMax}>/ 100</Text>
              </View>
            </View>

            <View style={styles.barTrack}>
              <View
                style={[styles.barFill, { width: `${d.value}%`, backgroundColor: barBg(d.value) }]}
              />
              <View style={styles.benchmarkLine} />
            </View>
          </View>
        );
      })}

      <Text style={styles.footnote}>
        Indices compare your proxy lift performance to what's expected given your primary lift strength.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 16 },
  empty: { padding: 20, alignItems: 'center' },
  emptyText: { color: colors.mutedForeground, fontSize: fontSize.sm, textAlign: 'center' },
  legend: { marginBottom: 4 },
  legendText: { color: colors.mutedForeground, fontSize: 11 },
  barSection: { gap: 6 },
  barHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  barHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  barLabel: { color: colors.foreground, fontSize: fontSize.sm, fontWeight: fontWeight.semibold },
  barTag: { fontSize: fontSize.xs, fontWeight: fontWeight.medium },
  barHeaderRight: { flexDirection: 'row', alignItems: 'baseline', gap: 2 },
  barValue: { color: colors.foreground, fontSize: fontSize.sm, fontWeight: fontWeight.bold, fontVariant: ['tabular-nums'] },
  barMax: { color: colors.mutedForeground, fontSize: fontSize.xs },
  barTrack: {
    height: 10, borderRadius: 5, backgroundColor: colors.muted,
    overflow: 'visible', position: 'relative',
  },
  barFill: { height: '100%', borderRadius: 5 },
  benchmarkLine: {
    position: 'absolute', left: '70%', top: -3, bottom: -3,
    width: 1, backgroundColor: colors.foreground + '60',
  },
  footnote: {
    color: colors.mutedForeground, fontSize: 11, lineHeight: 16,
    borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 12, marginTop: 4,
  },
});
