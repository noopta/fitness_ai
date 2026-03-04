import { View, Text, StyleSheet } from 'react-native';
import { PhaseScore } from '@/lib/api';
import { colors, fontSize, fontWeight, radius } from '@/constants/theme';

interface Props {
  phaseScores: PhaseScore[];
  primaryPhase: string;
  primaryPhaseConfidence: number;
  liftId?: string;
}

const LIFT_PHASES: Record<string, Array<{ id: string; label: string; description: string }>> = {
  flat_bench_press: [
    { id: 'setup', label: 'Setup', description: 'Bar position, arch, shoulder blade retraction' },
    { id: 'descent', label: 'Descent', description: 'Controlled lowering to the chest' },
    { id: 'bottom', label: 'Off Chest', description: 'Initial drive from chest' },
    { id: 'ascent', label: 'Mid Range', description: 'Drive from chest to midpoint' },
    { id: 'lockout', label: 'Lockout', description: 'Final extension — triceps finish' },
  ],
  incline_bench_press: [
    { id: 'setup', label: 'Setup', description: 'Incline position, shoulder retraction' },
    { id: 'descent', label: 'Descent', description: 'Controlled lowering to upper chest' },
    { id: 'bottom', label: 'Off Chest', description: 'Initial drive from upper chest' },
    { id: 'ascent', label: 'Mid Range', description: 'Drive through midpoint' },
    { id: 'lockout', label: 'Lockout', description: 'Triceps extension to finish' },
  ],
  deadlift: [
    { id: 'setup', label: 'Setup', description: 'Bar over mid-foot, lat tension' },
    { id: 'initial_pull', label: 'Off Floor', description: 'Breaking the bar from the ground' },
    { id: 'knee_level', label: 'Mid Pull', description: 'Bar passing the knees' },
    { id: 'lockout', label: 'Lockout', description: 'Hip extension to standing' },
  ],
  barbell_back_squat: [
    { id: 'setup', label: 'Setup', description: 'Bar placement, stance, bracing' },
    { id: 'descent', label: 'Descent', description: 'Controlled descent to depth' },
    { id: 'bottom', label: 'Out of Hole', description: 'Reversal from depth' },
    { id: 'ascent', label: 'Ascent', description: 'Drive to standing' },
  ],
  barbell_front_squat: [
    { id: 'setup', label: 'Setup', description: 'Front rack, upright torso' },
    { id: 'descent', label: 'Descent', description: 'Controlled descent maintaining torso' },
    { id: 'bottom', label: 'Out of Hole', description: 'Reversal from depth' },
    { id: 'ascent', label: 'Ascent', description: 'Drive to standing' },
  ],
};

const DEFAULT_PHASES = [
  { id: 'setup', label: 'Setup', description: 'Starting position' },
  { id: 'descent', label: 'Descent', description: 'Eccentric phase' },
  { id: 'bottom', label: 'Bottom', description: 'Bottom position and reversal' },
  { id: 'ascent', label: 'Ascent', description: 'Concentric phase' },
  { id: 'lockout', label: 'Lockout', description: 'Final lockout' },
];

function phaseBarColor(hasSignal: boolean, isPrimary: boolean): string {
  if (isPrimary) return colors.red500;
  if (hasSignal) return colors.orange500;
  return colors.muted;
}

export function PhaseBreakdown({ phaseScores, primaryPhase, primaryPhaseConfidence, liftId }: Props) {
  const liftKey = liftId ?? '';
  const allPhases = LIFT_PHASES[liftKey] ?? LIFT_PHASES[liftKey.replace('barbell_', '')] ?? DEFAULT_PHASES;

  const scoreMap: Record<string, number> = {};
  for (const ps of phaseScores ?? []) {
    scoreMap[ps.phase_id] = ps.points;
  }
  const maxPoints = Math.max(...Object.values(scoreMap), 1);

  const primaryLabel = allPhases.find(p => p.id === primaryPhase)?.label ?? primaryPhase;
  const confidencePct = Math.round(primaryPhaseConfidence * 100);
  const hasAnySignal = Object.keys(scoreMap).length > 0;

  return (
    <View style={styles.container}>
      <Text style={styles.description}>
        Each lift has distinct phases. Higher evidence weight = more data pointing to a weakness there.
      </Text>

      {hasAnySignal ? (
        <View style={styles.callout}>
          <View style={styles.calloutDot} />
          <View style={styles.calloutContent}>
            <Text style={styles.calloutTitle}>
              Suspected weak point: {primaryLabel} ({confidencePct}% confidence)
            </Text>
          </View>
        </View>
      ) : (
        <View style={styles.noSignal}>
          <Text style={styles.noSignalText}>
            No phase signal yet — answer more diagnostic questions.
          </Text>
        </View>
      )}

      {allPhases.map((phase) => {
        const points = scoreMap[phase.id] ?? 0;
        const hasSignal = points > 0;
        const isPrimary = phase.id === primaryPhase && hasSignal;
        const widthPct = hasSignal ? Math.round((points / maxPoints) * 100) : 0;

        return (
          <View key={phase.id} style={styles.phaseItem}>
            <View style={styles.phaseHeader}>
              <View style={styles.phaseLabelRow}>
                <Text style={[styles.phaseLabel, isPrimary && styles.phaseLabelPrimary]}>
                  {phase.label}
                </Text>
                {isPrimary && (
                  <View style={styles.primaryTag}>
                    <Text style={styles.primaryTagText}>Primary</Text>
                  </View>
                )}
              </View>
              <Text style={[
                styles.phasePoints,
                isPrimary ? { color: colors.red500 } : hasSignal ? { color: colors.orange500 } : {},
              ]}>
                {hasSignal ? `${points} pts` : 'No signal'}
              </Text>
            </View>

            <View style={styles.phaseTrack}>
              <View
                style={[
                  styles.phaseFill,
                  {
                    width: hasSignal ? `${widthPct}%` : '0%',
                    backgroundColor: phaseBarColor(hasSignal, isPrimary),
                    minWidth: hasSignal ? 4 : 0,
                  },
                ]}
              />
            </View>

            <Text style={styles.phaseDescription}>{phase.description}</Text>
          </View>
        );
      })}

      <Text style={styles.footnote}>
        Phases with "No signal" haven't fired any diagnostic rules yet.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 14 },
  description: { color: colors.mutedForeground, fontSize: fontSize.xs, lineHeight: 16 },
  callout: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    backgroundColor: colors.red100, borderWidth: 1, borderColor: colors.red500 + '30',
    borderRadius: radius.md, padding: 10,
  },
  calloutDot: {
    width: 8, height: 8, borderRadius: 4, backgroundColor: colors.red500, marginTop: 4,
  },
  calloutContent: { flex: 1 },
  calloutTitle: { color: colors.red500, fontSize: fontSize.xs, fontWeight: fontWeight.semibold },
  noSignal: {
    backgroundColor: colors.muted + '60', borderRadius: radius.md, padding: 10,
  },
  noSignalText: { color: colors.mutedForeground, fontSize: fontSize.xs },
  phaseItem: { gap: 4 },
  phaseHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  phaseLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  phaseLabel: { color: colors.foreground, fontSize: fontSize.xs, fontWeight: fontWeight.semibold },
  phaseLabelPrimary: { color: colors.red500 },
  primaryTag: {
    backgroundColor: colors.red100, paddingHorizontal: 6, paddingVertical: 2, borderRadius: radius.full,
  },
  primaryTagText: { color: colors.red500, fontSize: 10, fontWeight: fontWeight.semibold },
  phasePoints: { color: colors.mutedForeground, fontSize: 11, fontWeight: fontWeight.bold, fontVariant: ['tabular-nums'] },
  phaseTrack: { height: 6, borderRadius: 3, backgroundColor: colors.muted, overflow: 'hidden' },
  phaseFill: { height: '100%', borderRadius: 3 },
  phaseDescription: { color: colors.mutedForeground, fontSize: 11, lineHeight: 14 },
  footnote: {
    color: colors.mutedForeground, fontSize: 11, lineHeight: 16,
    borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 12,
  },
});
