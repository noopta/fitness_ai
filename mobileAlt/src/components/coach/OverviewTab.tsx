import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  Pressable,
} from 'react-native';
import { colors, fontSize, fontWeight, spacing, radius } from '../../constants/theme';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/Card';
import { LoadingSpinner } from '../ui/LoadingSpinner';
import { coachApi } from '../../lib/api';

interface OverviewTabProps {
  coachData: any;
  onGoToProgram?: () => void;
}

interface TodayWorkout {
  title?: string;
  name?: string;
  day?: string;
  focus?: string;
  exercises?: Array<{
    name?: string;
    exercise?: string;
    sets?: number;
    reps?: number | string;
    intensity?: string;
    notes?: string;
  }>;
  warmup?: string[];
}

export function OverviewTab({ coachData, onGoToProgram }: OverviewTabProps) {
  const [todayWorkout, setTodayWorkout] = useState<TodayWorkout | null>(null);
  const [todayLoading, setTodayLoading] = useState(true);
  const [todayError, setTodayError] = useState('');

  useEffect(() => {
    async function loadToday() {
      try {
        const data = await coachApi.getToday();
        const session = data?.todaySession ?? data?.session ?? data;
        setTodayWorkout(session);
      } catch (err: any) {
        setTodayError('Could not load today\'s workout.');
      } finally {
        setTodayLoading(false);
      }
    }
    loadToday();
  }, []);

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

  const totalWeeks = savedProgram?.durationWeeks ?? 0;
  const currentWeek = coachData?.currentWeek ?? 1;
  const progressPct = totalWeeks > 0 ? Math.min((currentWeek / totalWeeks) * 100, 100) : 0;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      {/* Today's Workout */}
      <Card style={styles.card}>
        <CardHeader>
          <CardTitle>Today's Workout</CardTitle>
        </CardHeader>
        <CardContent style={styles.cardContent}>
          {todayLoading ? (
            <View style={styles.miniLoading}>
              <LoadingSpinner size="small" />
            </View>
          ) : todayError || !todayWorkout ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyText}>No workout scheduled today.</Text>
              {onGoToProgram && (
                <Pressable onPress={onGoToProgram}>
                  <Text style={styles.linkText}>Set up your program</Text>
                </Pressable>
              )}
            </View>
          ) : (
            <View style={styles.workoutContent}>
              <Text style={styles.workoutTitle}>
                {todayWorkout.title || todayWorkout.name || todayWorkout.day || 'Today\'s Session'}
              </Text>
              {todayWorkout.focus ? (
                <Text style={styles.workoutFocus}>{todayWorkout.focus}</Text>
              ) : null}
              {(todayWorkout.exercises ?? []).length > 0 ? (
                <View style={styles.exerciseList}>
                  {todayWorkout.exercises.map((ex: any, i: number) => (
                    <View key={i} style={styles.exerciseRow}>
                      <Text style={styles.exerciseName}>
                        {ex.name || ex.exercise || `Exercise ${i + 1}`}
                      </Text>
                      <Text style={styles.exerciseSets}>
                        {ex.sets && ex.reps
                          ? `${ex.sets} × ${ex.reps}`
                          : ex.sets
                          ? `${ex.sets} sets`
                          : ''}
                      </Text>
                    </View>
                  ))}
                </View>
              ) : (
                <Text style={styles.emptyText}>No exercises listed.</Text>
              )}
            </View>
          )}
        </CardContent>
      </Card>

      {/* Program Summary */}
      <Card style={styles.card}>
        <CardHeader>
          <CardTitle>Program Summary</CardTitle>
        </CardHeader>
        <CardContent style={styles.cardContent}>
          {!savedProgram ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyText}>No active program.</Text>
              {onGoToProgram && (
                <Pressable onPress={onGoToProgram}>
                  <Text style={styles.linkText}>Set up a program</Text>
                </Pressable>
              )}
            </View>
          ) : (
            <View style={styles.summaryContent}>
              {/* Stats row */}
              <View style={styles.statsRow}>
                <View style={styles.statItem}>
                  <Text style={styles.statValue}>{savedProgram.durationWeeks ?? '—'}</Text>
                  <Text style={styles.statLabel}>Total Weeks</Text>
                </View>
                <View style={styles.statDivider} />
                <View style={styles.statItem}>
                  <Text style={styles.statValue}>{currentWeek}</Text>
                  <Text style={styles.statLabel}>Current Week</Text>
                </View>
                <View style={styles.statDivider} />
                <View style={styles.statItem}>
                  <Text style={styles.statValue}>{savedProgram.daysPerWeek ?? '—'}</Text>
                  <Text style={styles.statLabel}>Days/Week</Text>
                </View>
              </View>

              {/* Progress bar */}
              {totalWeeks > 0 && (
                <View style={styles.progressSection}>
                  <View style={styles.progressLabelRow}>
                    <Text style={styles.progressLabel}>Program Progress</Text>
                    <Text style={styles.progressPct}>{Math.round(progressPct)}%</Text>
                  </View>
                  <View style={styles.progressTrack}>
                    <View
                      style={[styles.progressBar, { width: `${progressPct}%` }]}
                    />
                  </View>
                  <Text style={styles.progressSub}>
                    Week {currentWeek} of {totalWeeks}
                  </Text>
                </View>
              )}
            </View>
          )}
        </CardContent>
      </Card>
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
  cardContent: {
    paddingTop: 0,
  },
  miniLoading: {
    alignItems: 'center',
    paddingVertical: spacing.md,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: spacing.md,
    gap: spacing.sm,
  },
  emptyText: {
    fontSize: fontSize.sm,
    color: colors.mutedForeground,
    textAlign: 'center',
  },
  linkText: {
    fontSize: fontSize.sm,
    color: colors.primary,
    fontWeight: fontWeight.medium,
    textDecorationLine: 'underline',
  },
  workoutContent: {
    gap: spacing.sm,
  },
  workoutTitle: {
    fontSize: fontSize.base,
    fontWeight: fontWeight.semibold,
    color: colors.foreground,
  },
  exerciseList: {
    gap: 6,
  },
  exerciseRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 5,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  exerciseName: {
    fontSize: fontSize.sm,
    color: colors.foreground,
    flex: 1,
  },
  exerciseSets: {
    fontSize: fontSize.sm,
    color: colors.primary,
    fontWeight: fontWeight.semibold,
  },
  workoutFocus: {
    fontSize: fontSize.xs,
    color: colors.mutedForeground,
    marginBottom: 4,
  },
  summaryContent: {
    gap: spacing.md,
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
  },
  statItem: {
    alignItems: 'center',
    flex: 1,
  },
  statValue: {
    fontSize: fontSize.xxl,
    fontWeight: fontWeight.bold,
    color: colors.primary,
  },
  statLabel: {
    fontSize: fontSize.xs,
    color: colors.mutedForeground,
    marginTop: 2,
    textAlign: 'center',
  },
  statDivider: {
    width: 1,
    height: 36,
    backgroundColor: colors.border,
  },
  progressSection: {
    gap: spacing.xs,
  },
  progressLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  progressLabel: {
    fontSize: fontSize.sm,
    color: colors.foreground,
    fontWeight: fontWeight.medium,
  },
  progressPct: {
    fontSize: fontSize.sm,
    color: colors.primary,
    fontWeight: fontWeight.semibold,
  },
  progressTrack: {
    height: 8,
    borderRadius: radius.full,
    backgroundColor: colors.muted,
    overflow: 'hidden',
  },
  progressBar: {
    height: '100%',
    borderRadius: radius.full,
    backgroundColor: colors.primary,
  },
  progressSub: {
    fontSize: fontSize.xs,
    color: colors.mutedForeground,
    textAlign: 'center',
  },
});
