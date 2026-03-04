import { View, Text, StyleSheet } from 'react-native';
import { HypothesisSignal } from '@/lib/api';
import { colors, fontSize, fontWeight, radius } from '@/constants/theme';

interface Props {
  hypotheses: HypothesisSignal[];
}

const CATEGORY_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  muscle:      { bg: colors.red100, text: colors.red500, label: 'Muscle' },
  mechanical:  { bg: colors.orange500 + '15', text: colors.orange500, label: 'Mechanical' },
  stability:   { bg: colors.amber500 + '15', text: colors.amber500, label: 'Stability' },
  mobility:    { bg: colors.primary + '15', text: colors.primary, label: 'Mobility' },
  technique:   { bg: colors.purple500 + '15', text: colors.purple500, label: 'Technique' },
  programming: { bg: colors.slate400 + '15', text: colors.slate400, label: 'Programming' },
};

function barColor(score: number): string {
  if (score >= 75) return colors.red500;
  if (score >= 50) return colors.orange500;
  if (score >= 30) return colors.amber500;
  return colors.slate400;
}

export function HypothesisRankings({ hypotheses }: Props) {
  if (!hypotheses || hypotheses.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>No hypothesis data available.</Text>
      </View>
    );
  }

  const sorted = [...hypotheses].sort((a, b) => b.score - a.score);
  const max = Math.max(...sorted.map(h => h.score), 1);

  return (
    <View style={styles.container}>
      {sorted.map((h, idx) => {
        const style = CATEGORY_STYLES[h.category] ?? CATEGORY_STYLES.technique;
        const widthPct = Math.round((h.score / max) * 100);

        return (
          <View key={h.key} style={styles.item}>
            <View style={styles.itemHeader}>
              <View style={styles.itemLeft}>
                <View style={styles.rankCircle}>
                  <Text style={styles.rankNum}>{idx + 1}</Text>
                </View>
                <Text style={styles.itemLabel} numberOfLines={1}>{h.label}</Text>
              </View>
              <View style={styles.itemRight}>
                <View style={[styles.categoryBadge, { backgroundColor: style.bg }]}>
                  <Text style={[styles.categoryText, { color: style.text }]}>{style.label}</Text>
                </View>
                <Text style={styles.scoreText}>{h.score}</Text>
              </View>
            </View>

            <View style={styles.barTrack}>
              <View
                style={[styles.barFill, { width: `${widthPct}%`, backgroundColor: barColor(h.score) }]}
              />
            </View>

            {h.evidence[0] && (
              <Text style={styles.evidenceText}>{h.evidence[0]}</Text>
            )}
          </View>
        );
      })}

      <Text style={styles.footnote}>
        Scores (0-100) reflect how strongly each factor is implicated.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 12 },
  empty: { padding: 20, alignItems: 'center' },
  emptyText: { color: colors.mutedForeground, fontSize: fontSize.sm },
  item: { gap: 4 },
  itemHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  itemLeft: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
  rankCircle: {
    width: 20, height: 20, borderRadius: 10, backgroundColor: colors.muted,
    alignItems: 'center', justifyContent: 'center',
  },
  rankNum: { color: colors.mutedForeground, fontSize: 10, fontWeight: fontWeight.bold },
  itemLabel: { color: colors.foreground, fontSize: fontSize.xs, fontWeight: fontWeight.medium, flex: 1 },
  itemRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  categoryBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.full },
  categoryText: { fontSize: 10, fontWeight: fontWeight.semibold },
  scoreText: {
    color: colors.foreground, fontSize: fontSize.xs, fontWeight: fontWeight.bold,
    width: 28, textAlign: 'right', fontVariant: ['tabular-nums'],
  },
  barTrack: { height: 5, borderRadius: 3, backgroundColor: colors.muted, overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 3 },
  evidenceText: { color: colors.mutedForeground, fontSize: 11, lineHeight: 14, paddingLeft: 28 },
  footnote: { color: colors.mutedForeground, fontSize: fontSize.xs, marginTop: 4 },
});
