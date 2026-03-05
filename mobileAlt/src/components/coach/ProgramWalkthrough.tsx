import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { colors, fontSize, fontWeight, spacing, radius } from '../../constants/theme';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { coachApi } from '../../lib/api';

interface ProgramWalkthroughProps {
  program: any;
  onSave: () => void;
  onBack: () => void;
}

export function ProgramWalkthrough({ program, onSave, onBack }: ProgramWalkthroughProps) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function handleSave() {
    setSaving(true);
    setError('');
    try {
      await coachApi.updateProgram(program);
      onSave();
    } catch (err: any) {
      setError(err?.message || 'Failed to save program. Please try again.');
      setSaving(false);
    }
  }

  const firstPhaseFirstDay = program?.phases?.[0]?.days?.[0];

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      {/* Program header */}
      <Card style={styles.card}>
        <CardHeader>
          <View style={styles.headerRow}>
            <View style={styles.headerLeft}>
              <CardTitle style={styles.programName}>
                {program?.name || 'Your Program'}
              </CardTitle>
              <Text style={styles.programDuration}>
                {program?.durationWeeks ? `${program.durationWeeks} weeks` : ''}
              </Text>
            </View>
            {program?.focus && (
              <Badge variant="default">{program.focus}</Badge>
            )}
          </View>
        </CardHeader>
        <CardContent>
          {program?.description ? (
            <Text style={styles.programDescription}>{program.description}</Text>
          ) : null}
          <View style={styles.statsRow}>
            {program?.daysPerWeek && (
              <View style={styles.statItem}>
                <Text style={styles.statValue}>{program.daysPerWeek}</Text>
                <Text style={styles.statLabel}>days/week</Text>
              </View>
            )}
            {program?.phases?.length > 0 && (
              <View style={styles.statItem}>
                <Text style={styles.statValue}>{program.phases.length}</Text>
                <Text style={styles.statLabel}>phases</Text>
              </View>
            )}
            {program?.durationWeeks && (
              <View style={styles.statItem}>
                <Text style={styles.statValue}>{program.durationWeeks}</Text>
                <Text style={styles.statLabel}>weeks total</Text>
              </View>
            )}
          </View>
        </CardContent>
      </Card>

      {/* Phase list */}
      {program?.phases && program.phases.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Program Phases</Text>
          {program.phases.map((phase: any, phaseIdx: number) => (
            <Card key={phaseIdx} style={styles.phaseCard}>
              <CardHeader>
                <View style={styles.phaseHeaderRow}>
                  <View style={styles.phaseNumBadge}>
                    <Text style={styles.phaseNumText}>{phaseIdx + 1}</Text>
                  </View>
                  <View style={styles.phaseInfo}>
                    <CardTitle style={styles.phaseName}>
                      {phase.name || `Phase ${phaseIdx + 1}`}
                    </CardTitle>
                    <Text style={styles.phaseMeta}>
                      {phase.weeks ? `${phase.weeks} weeks` : ''}
                      {phase.weeks && phase.daysPerWeek ? ' · ' : ''}
                      {phase.daysPerWeek ? `${phase.daysPerWeek} days/week` : ''}
                    </Text>
                  </View>
                </View>
              </CardHeader>
              {phase.description ? (
                <CardContent>
                  <Text style={styles.phaseDesc}>{phase.description}</Text>
                </CardContent>
              ) : null}
            </Card>
          ))}
        </View>
      )}

      {/* First day preview */}
      {firstPhaseFirstDay && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Week 1 Preview</Text>
          <Card style={styles.card}>
            <CardHeader>
              <CardTitle style={styles.dayTitle}>
                {firstPhaseFirstDay.name || 'Day 1'}
              </CardTitle>
            </CardHeader>
            <CardContent style={styles.exerciseListContent}>
              {firstPhaseFirstDay.exercises && firstPhaseFirstDay.exercises.length > 0 ? (
                firstPhaseFirstDay.exercises.map((ex: any, exIdx: number) => (
                  <View key={exIdx} style={styles.exerciseRow}>
                    <View style={styles.exerciseLeft}>
                      <Text style={styles.exerciseName}>{ex.name || ex.exercise || `Exercise ${exIdx + 1}`}</Text>
                      {ex.notes ? (
                        <Text style={styles.exerciseNotes}>{ex.notes}</Text>
                      ) : null}
                    </View>
                    <Text style={styles.exerciseSetsReps}>
                      {ex.sets && ex.reps
                        ? `${ex.sets} × ${ex.reps}`
                        : ex.sets
                        ? `${ex.sets} sets`
                        : ''}
                    </Text>
                  </View>
                ))
              ) : (
                <Text style={styles.noExercises}>No exercises listed</Text>
              )}
            </CardContent>
          </Card>
        </View>
      )}

      {!!error && (
        <Text style={styles.errorText}>{error}</Text>
      )}

      {/* Action buttons */}
      <View style={styles.navRow}>
        <Button variant="outline" onPress={onBack} disabled={saving} style={styles.navButton}>
          Back
        </Button>
        <Button onPress={handleSave} disabled={saving} style={styles.navButton}>
          {saving ? (
            <ActivityIndicator size="small" color={colors.primaryForeground} />
          ) : (
            'Save Program'
          )}
        </Button>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: spacing.md,
    gap: spacing.md,
    paddingBottom: spacing.xxl,
  },
  card: {},
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  headerLeft: {
    flex: 1,
  },
  programName: {
    fontSize: fontSize.xl,
    fontWeight: fontWeight.bold,
    color: colors.foreground,
  },
  programDuration: {
    fontSize: fontSize.sm,
    color: colors.mutedForeground,
    marginTop: 2,
  },
  programDescription: {
    fontSize: fontSize.sm,
    color: colors.mutedForeground,
    lineHeight: 20,
    marginBottom: spacing.sm,
  },
  statsRow: {
    flexDirection: 'row',
    gap: spacing.lg,
    marginTop: spacing.xs,
  },
  statItem: {
    alignItems: 'center',
  },
  statValue: {
    fontSize: fontSize.xl,
    fontWeight: fontWeight.bold,
    color: colors.primary,
  },
  statLabel: {
    fontSize: fontSize.xs,
    color: colors.mutedForeground,
    marginTop: 2,
  },
  section: {
    gap: spacing.sm,
  },
  sectionTitle: {
    fontSize: fontSize.base,
    fontWeight: fontWeight.semibold,
    color: colors.foreground,
  },
  phaseCard: {},
  phaseHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  phaseNumBadge: {
    width: 32,
    height: 32,
    borderRadius: radius.full,
    backgroundColor: `${colors.primary}22`,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  phaseNumText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.bold,
    color: colors.primary,
  },
  phaseInfo: {
    flex: 1,
  },
  phaseName: {
    fontSize: fontSize.base,
    fontWeight: fontWeight.semibold,
    color: colors.foreground,
  },
  phaseMeta: {
    fontSize: fontSize.xs,
    color: colors.mutedForeground,
    marginTop: 2,
  },
  phaseDesc: {
    fontSize: fontSize.sm,
    color: colors.mutedForeground,
    lineHeight: 18,
  },
  dayTitle: {
    fontSize: fontSize.base,
    fontWeight: fontWeight.semibold,
    color: colors.foreground,
  },
  exerciseListContent: {
    gap: spacing.sm,
    paddingTop: 0,
  },
  exerciseRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingVertical: spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  exerciseLeft: {
    flex: 1,
    paddingRight: spacing.sm,
  },
  exerciseName: {
    fontSize: fontSize.sm,
    color: colors.foreground,
    fontWeight: fontWeight.medium,
  },
  exerciseNotes: {
    fontSize: fontSize.xs,
    color: colors.mutedForeground,
    marginTop: 2,
  },
  exerciseSetsReps: {
    fontSize: fontSize.sm,
    color: colors.primary,
    fontWeight: fontWeight.semibold,
    flexShrink: 0,
  },
  noExercises: {
    fontSize: fontSize.sm,
    color: colors.mutedForeground,
    textAlign: 'center',
    paddingVertical: spacing.sm,
  },
  errorText: {
    fontSize: fontSize.sm,
    color: colors.destructive,
    textAlign: 'center',
  },
  navRow: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  navButton: {
    flex: 1,
  },
});
