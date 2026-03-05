import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  StyleSheet,
} from 'react-native';
import { colors, fontSize, fontWeight, spacing, radius } from '../../constants/theme';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/Card';
import { Badge } from '../ui/Badge';

interface ProgramTabProps {
  coachData: any;
}

export function ProgramTab({ coachData }: ProgramTabProps) {
  const [expandedPhase, setExpandedPhase] = useState<number | null>(0);

  let savedProgram: any = null;
  if (coachData?.savedProgram) {
    try {
      savedProgram =
        typeof coachData.savedProgram === 'string'
          ? JSON.parse(coachData.savedProgram)
          : coachData.savedProgram;
    } catch {
      savedProgram = null;
    }
  }

  if (!savedProgram) {
    return (
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <Card style={styles.emptyCard}>
          <CardContent style={styles.emptyContent}>
            <Text style={styles.emptyIcon}>📋</Text>
            <Text style={styles.emptyTitle}>No Program Yet</Text>
            <Text style={styles.emptyDesc}>
              No program yet. Set up your program in the Coach tab.
            </Text>
          </CardContent>
        </Card>
      </ScrollView>
    );
  }

  const phases: any[] = savedProgram.phases ?? [];
  const currentPhaseIdx = (coachData?.currentWeek ?? 0) > 0 && phases.length > 0
    ? Math.min(Math.floor(((coachData.currentWeek - 1) / (savedProgram.durationWeeks ?? 1)) * phases.length), phases.length - 1)
    : 0;

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
              <CardTitle>{savedProgram.name || 'My Program'}</CardTitle>
              <Text style={styles.headerSub}>
                {savedProgram.durationWeeks ? `${savedProgram.durationWeeks} weeks total` : ''}
              </Text>
            </View>
            {savedProgram.focus && (
              <Badge variant="default">{savedProgram.focus}</Badge>
            )}
          </View>
        </CardHeader>
        <CardContent style={styles.headerContent}>
          {phases.length > 0 && (
            <View style={styles.currentPhaseBadge}>
              <Text style={styles.currentPhaseText}>
                Current Phase: {phases[currentPhaseIdx]?.name ?? `Phase ${currentPhaseIdx + 1}`}
              </Text>
            </View>
          )}
        </CardContent>
      </Card>

      {/* Phase accordion */}
      {phases.map((phase: any, phaseIdx: number) => {
        const isExpanded = expandedPhase === phaseIdx;
        const days: any[] = phase.days ?? [];

        return (
          <Card key={phaseIdx} style={styles.phaseCard}>
            <Pressable
              onPress={() => setExpandedPhase(isExpanded ? null : phaseIdx)}
              style={styles.phaseHeader}
            >
              <View style={styles.phaseHeaderLeft}>
                <View style={[
                  styles.phaseNumBadge,
                  phaseIdx === currentPhaseIdx && styles.phaseNumBadgeActive,
                ]}>
                  <Text style={[
                    styles.phaseNumText,
                    phaseIdx === currentPhaseIdx && styles.phaseNumTextActive,
                  ]}>
                    {phaseIdx + 1}
                  </Text>
                </View>
                <View style={styles.phaseInfo}>
                  <Text style={styles.phaseName}>
                    {phase.name || `Phase ${phaseIdx + 1}`}
                  </Text>
                  <Text style={styles.phaseMeta}>
                    {phase.weeks ? `${phase.weeks} weeks` : ''}
                    {phase.weeks && phase.daysPerWeek ? ' · ' : ''}
                    {phase.daysPerWeek ? `${phase.daysPerWeek} days/week` : ''}
                  </Text>
                </View>
              </View>
              <Text style={styles.chevron}>{isExpanded ? '▲' : '▼'}</Text>
            </Pressable>

            {isExpanded && days.length > 0 && (
              <View style={styles.phaseContent}>
                {days.map((day: any, dayIdx: number) => (
                  <View key={dayIdx} style={styles.daySection}>
                    <View style={styles.dayHeader}>
                      <Text style={styles.dayName}>
                        {day.name || `Day ${dayIdx + 1}`}
                      </Text>
                      {day.focus && (
                        <Badge variant="secondary">{day.focus}</Badge>
                      )}
                    </View>

                    {day.exercises && day.exercises.length > 0 ? (
                      <View style={styles.exerciseList}>
                        {day.exercises.map((ex: any, exIdx: number) => (
                          <View key={exIdx} style={styles.exerciseRow}>
                            <View style={styles.exerciseLeft}>
                              <Text style={styles.exerciseName}>
                                {ex.name || ex.exercise || `Exercise ${exIdx + 1}`}
                              </Text>
                              {ex.notes ? (
                                <Text style={styles.exerciseNotes}>{ex.notes}</Text>
                              ) : null}
                            </View>
                            <View style={styles.exerciseRight}>
                              {ex.sets && ex.reps ? (
                                <Text style={styles.exerciseSets}>
                                  {ex.sets} × {ex.reps}
                                </Text>
                              ) : ex.sets ? (
                                <Text style={styles.exerciseSets}>{ex.sets} sets</Text>
                              ) : null}
                              {ex.rpe ? (
                                <Text style={styles.exerciseRpe}>RPE {ex.rpe}</Text>
                              ) : null}
                            </View>
                          </View>
                        ))}
                      </View>
                    ) : (
                      <Text style={styles.noExercises}>No exercises listed</Text>
                    )}

                    {dayIdx < days.length - 1 && (
                      <View style={styles.dayDivider} />
                    )}
                  </View>
                ))}
              </View>
            )}

            {isExpanded && days.length === 0 && (
              <View style={styles.phaseContent}>
                <Text style={styles.noExercises}>No days configured for this phase.</Text>
              </View>
            )}
          </Card>
        );
      })}
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
  headerSub: {
    fontSize: fontSize.sm,
    color: colors.mutedForeground,
    marginTop: 2,
  },
  headerContent: {
    paddingTop: 0,
  },
  currentPhaseBadge: {
    backgroundColor: colors.muted,
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    alignSelf: 'flex-start',
  },
  currentPhaseText: {
    fontSize: fontSize.sm,
    color: colors.primary,
    fontWeight: fontWeight.medium,
  },
  emptyCard: {},
  emptyContent: {
    alignItems: 'center',
    paddingVertical: spacing.xl,
    gap: spacing.sm,
  },
  emptyIcon: {
    fontSize: 40,
  },
  emptyTitle: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.semibold,
    color: colors.foreground,
  },
  emptyDesc: {
    fontSize: fontSize.sm,
    color: colors.mutedForeground,
    textAlign: 'center',
    lineHeight: 20,
  },
  phaseCard: {},
  phaseHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.md,
  },
  phaseHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flex: 1,
  },
  phaseNumBadge: {
    width: 32,
    height: 32,
    borderRadius: radius.full,
    backgroundColor: colors.muted,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  phaseNumBadgeActive: {
    backgroundColor: colors.muted,
  },
  phaseNumText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.bold,
    color: colors.mutedForeground,
  },
  phaseNumTextActive: {
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
  chevron: {
    fontSize: fontSize.xs,
    color: colors.mutedForeground,
    marginLeft: spacing.sm,
  },
  phaseContent: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    padding: spacing.md,
    gap: spacing.md,
  },
  daySection: {
    gap: spacing.sm,
  },
  dayHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  dayName: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    color: colors.foreground,
    flex: 1,
  },
  exerciseList: {
    gap: 4,
  },
  exerciseRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingVertical: 5,
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
  },
  exerciseNotes: {
    fontSize: fontSize.xs,
    color: colors.mutedForeground,
    marginTop: 2,
  },
  exerciseRight: {
    alignItems: 'flex-end',
  },
  exerciseSets: {
    fontSize: fontSize.sm,
    color: colors.primary,
    fontWeight: fontWeight.semibold,
  },
  exerciseRpe: {
    fontSize: fontSize.xs,
    color: colors.mutedForeground,
    marginTop: 2,
  },
  noExercises: {
    fontSize: fontSize.sm,
    color: colors.mutedForeground,
    textAlign: 'center',
    paddingVertical: spacing.sm,
  },
  dayDivider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: spacing.xs,
  },
});
