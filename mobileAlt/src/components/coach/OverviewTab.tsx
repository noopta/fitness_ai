import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  Pressable,
  TouchableOpacity,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, fontSize, fontWeight, spacing, radius } from '../../constants/theme';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/Card';
import { LoadingSpinner } from '../ui/LoadingSpinner';
import { Badge } from '../ui/Badge';
import { coachApi } from '../../lib/api';
import { LifeHappenedModal } from './LifeHappenedModal';
import { WorkoutLogModal } from './WorkoutLogModal';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Exercise {
  exercise?: string;
  name?: string;
  sets?: number;
  reps?: number | string;
  intensity?: string;
  notes?: string;
}

interface TodayData {
  todaySession: {
    day: string;
    focus: string;
    warmup?: string[];
    exercises: Exercise[];
    cooldown?: string[];
  } | null;
  isRestDay: boolean;
  weekNumber: number;
  phaseName: string | null;
  tips: string | null;
  nextTrainingDay: string | null;
  programGoal: string | null;
}

interface WeekDay {
  date: string;
  dayLabel: string;
  dateNumber: number;
  monthLabel: string;
  isToday: boolean;
  isTrainingDay: boolean;
  session: {
    day: string;
    focus: string;
    exercises: Exercise[];
  } | null;
}

interface ScheduleData {
  weekDays: WeekDay[];
  weekNumber: number | null;
  phaseName: string | null;
}

interface OverviewTabProps {
  coachData: any;
  onGoToProgram?: () => void;
  onRefresh?: () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function OverviewTab({ coachData, onGoToProgram, onRefresh }: OverviewTabProps) {
  const [todayData, setTodayData] = useState<TodayData | null>(null);
  const [scheduleData, setScheduleData] = useState<ScheduleData | null>(null);
  const [loading, setLoading] = useState(true);

  const [lifeHappenedVisible, setLifeHappenedVisible] = useState(false);
  const [logWorkoutVisible, setLogWorkoutVisible] = useState(false);
  const [workoutSaved, setWorkoutSaved] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [todayRes, schedRes] = await Promise.all([
        coachApi.getToday().catch(() => null),
        coachApi.getSchedule().catch(() => null),
      ]);

      if (todayRes) {
        // Normalize: backend may return data directly or under todaySession key
        const isRestDay = todayRes.isRestDay ?? false;
        const session = todayRes.todaySession ?? (isRestDay ? null : todayRes.session ?? todayRes);
        setTodayData({
          todaySession: session,
          isRestDay,
          weekNumber: todayRes.weekNumber ?? 1,
          phaseName: todayRes.phaseName ?? null,
          tips: todayRes.tips ?? null,
          nextTrainingDay: todayRes.nextTrainingDay ?? null,
          programGoal: todayRes.programGoal ?? null,
        });
      }

      if (schedRes) {
        setScheduleData({
          weekDays: schedRes.weekDays ?? [],
          weekNumber: schedRes.weekNumber ?? null,
          phaseName: schedRes.phaseName ?? null,
        });
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Parse saved program
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
  const currentWeek = coachData?.currentWeek ?? todayData?.weekNumber ?? 1;
  const progressPct = totalWeeks > 0 ? Math.min((currentWeek / totalWeeks) * 100, 100) : 0;
  const programGoal =
    todayData?.programGoal ??
    savedProgram?.goal ??
    savedProgram?.primaryGoal ??
    coachData?.coachGoal ??
    null;

  const todayExercises = todayData?.todaySession?.exercises ?? [];

  function handleLifeHappenedApplied() {
    setLifeHappenedVisible(false);
    loadData();
    onRefresh?.();
  }

  function handleWorkoutSaved() {
    setWorkoutSaved(true);
    setTimeout(() => setWorkoutSaved(false), 3000);
  }

  if (loading) {
    return (
      <View style={styles.centerLoader}>
        <LoadingSpinner size="small" />
      </View>
    );
  }

  return (
    <>
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Goal banner ──────────────────────────────────────────────────── */}
        {programGoal && (
          <View style={styles.goalBanner}>
            <Ionicons name="trophy-outline" size={14} color={colors.primary} />
            <Text style={styles.goalText}>Goal: {programGoal}</Text>
          </View>
        )}

        {/* ── Today's Workout Card ─────────────────────────────────────────── */}
        {todayData?.isRestDay ? (
          <Card style={[styles.card, styles.restDayCard]}>
            <CardContent style={styles.restDayContent}>
              <View style={styles.restDayIcon}>
                <Ionicons name="moon-outline" size={28} color="#8b5cf6" />
              </View>
              <Text style={styles.restDayTitle}>Rest Day</Text>
              <Text style={styles.restDaySubtitle}>Recovery & adaptation — today you grow</Text>
              {todayData.nextTrainingDay && (
                <View style={styles.nextDayRow}>
                  <Ionicons name="calendar-outline" size={13} color={colors.mutedForeground} />
                  <Text style={styles.nextDayText}>Next training: {todayData.nextTrainingDay}</Text>
                </View>
              )}
              {todayData.tips && parseTips(todayData.tips).length > 0 && (
                <View style={styles.tipsBox}>
                  <Text style={styles.tipsLabel}>RECOVERY TIPS</Text>
                  {parseTips(todayData.tips).slice(0, 3).map((tip, i) => (
                    <View key={i} style={styles.tipRow}>
                      <View style={styles.tipDot} />
                      <Text style={styles.tipText}>{tip}</Text>
                    </View>
                  ))}
                </View>
              )}
            </CardContent>
          </Card>
        ) : (
          <Card style={[styles.card, styles.workoutCard]}>
            <CardHeader style={styles.workoutCardHeader}>
              <View style={styles.workoutHeaderTop}>
                <View>
                  <Text style={styles.workoutDayLabel}>TODAY'S WORKOUT</Text>
                  <CardTitle style={styles.workoutTitle}>
                    {todayData?.todaySession?.day ||
                      todayData?.todaySession?.focus ||
                      'Training Day'}
                  </CardTitle>
                </View>
                {todayData?.todaySession?.focus && todayData.todaySession.day && (
                  <Badge variant="default">{todayData.todaySession.focus}</Badge>
                )}
              </View>
              {todayData?.weekNumber != null && (
                <Text style={styles.weekLabel}>
                  Week {todayData.weekNumber}
                  {todayData.phaseName ? ` · ${todayData.phaseName}` : ''}
                </Text>
              )}
            </CardHeader>

            <CardContent style={styles.exerciseListContent}>
              {todayExercises.length === 0 ? (
                <Text style={styles.emptyText}>No exercises listed for today.</Text>
              ) : (
                todayExercises.map((ex, i) => (
                  <View
                    key={i}
                    style={[styles.exerciseRow, i < todayExercises.length - 1 && styles.exerciseRowBorder]}
                  >
                    <Text style={styles.exerciseName}>
                      {ex.exercise ?? ex.name ?? `Exercise ${i + 1}`}
                    </Text>
                    <View style={styles.exerciseMeta}>
                      {ex.sets && ex.reps ? (
                        <Text style={styles.exerciseSets}>{ex.sets} × {ex.reps}</Text>
                      ) : null}
                      {ex.intensity ? (
                        <Text style={styles.exerciseIntensity}>{ex.intensity}</Text>
                      ) : null}
                    </View>
                  </View>
                ))
              )}
            </CardContent>
          </Card>
        )}

        {/* ── Action buttons ───────────────────────────────────────────────── */}
        <View style={styles.actionRow}>
          <TouchableOpacity
            style={[styles.actionBtn, styles.logBtn]}
            onPress={() => setLogWorkoutVisible(true)}
          >
            <Ionicons name="barbell-outline" size={16} color="#fff" />
            <Text style={styles.logBtnText}>Log Workout</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionBtn, styles.lifeBtn]}
            onPress={() => setLifeHappenedVisible(true)}
          >
            <Ionicons name="heart-outline" size={16} color={colors.foreground} />
            <Text style={styles.lifeBtnText}>Life Happened</Text>
          </TouchableOpacity>
        </View>

        {workoutSaved && (
          <View style={styles.savedBanner}>
            <Ionicons name="checkmark-circle" size={14} color="#22c55e" />
            <Text style={styles.savedBannerText}>Workout saved!</Text>
          </View>
        )}

        {/* ── Weekly Schedule Strip ────────────────────────────────────────── */}
        {(scheduleData?.weekDays ?? []).length > 0 && (
          <Card style={styles.card}>
            <CardHeader>
              <CardTitle>This Week</CardTitle>
              {scheduleData?.phaseName && (
                <Text style={styles.phaseLabel}>{scheduleData.phaseName}</Text>
              )}
            </CardHeader>
            <CardContent style={styles.scheduleContent}>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.scheduleScroll}
              >
                {scheduleData!.weekDays.map((day, i) => (
                  <View
                    key={i}
                    style={[
                      styles.dayCell,
                      day.isToday && styles.dayCellToday,
                      day.isTrainingDay && !day.isToday && styles.dayCellTraining,
                    ]}
                  >
                    <Text style={[styles.dayLabel, day.isToday && styles.dayLabelToday]}>
                      {day.dayLabel}
                    </Text>
                    <Text style={[styles.dateNum, day.isToday && styles.dateNumToday]}>
                      {day.dateNumber}
                    </Text>
                    {day.isTrainingDay ? (
                      <View style={[styles.trainingDot, day.isToday && styles.trainingDotToday]} />
                    ) : (
                      <Ionicons
                        name="moon-outline"
                        size={10}
                        color={day.isToday ? '#fff' : colors.mutedForeground}
                        style={styles.restIcon}
                      />
                    )}
                    {day.session?.focus ? (
                      <Text
                        style={[styles.dayFocus, day.isToday && styles.dayFocusToday]}
                        numberOfLines={1}
                      >
                        {day.session.focus}
                      </Text>
                    ) : !day.isTrainingDay ? (
                      <Text style={[styles.dayFocus, { color: colors.mutedForeground }]}>Rest</Text>
                    ) : null}
                  </View>
                ))}
              </ScrollView>
            </CardContent>
          </Card>
        )}

        {/* ── Program Progress ─────────────────────────────────────────────── */}
        {savedProgram && (
          <Card style={styles.card}>
            <CardHeader>
              <CardTitle>Program Progress</CardTitle>
            </CardHeader>
            <CardContent style={styles.cardContent}>
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

              {totalWeeks > 0 && (
                <View style={styles.progressSection}>
                  <View style={styles.progressLabelRow}>
                    <Text style={styles.progressLabel}>Progress</Text>
                    <Text style={styles.progressPct}>{Math.round(progressPct)}%</Text>
                  </View>
                  <View style={styles.progressTrack}>
                    <View style={[styles.progressBar, { width: `${progressPct}%` as any }]} />
                  </View>
                  <Text style={styles.progressSub}>Week {currentWeek} of {totalWeeks}</Text>
                </View>
              )}

              {!savedProgram && onGoToProgram && (
                <Pressable onPress={onGoToProgram}>
                  <Text style={styles.linkText}>Set up a program</Text>
                </Pressable>
              )}
            </CardContent>
          </Card>
        )}

        {!savedProgram && (
          <Card style={styles.card}>
            <CardContent style={styles.emptyProgramContent}>
              <Ionicons name="calendar-outline" size={32} color={colors.mutedForeground} />
              <Text style={styles.emptyText}>No active program.</Text>
              {onGoToProgram && (
                <Pressable onPress={onGoToProgram}>
                  <Text style={styles.linkText}>Set up your program →</Text>
                </Pressable>
              )}
            </CardContent>
          </Card>
        )}
      </ScrollView>

      {/* Modals */}
      <LifeHappenedModal
        visible={lifeHappenedVisible}
        onClose={() => setLifeHappenedVisible(false)}
        onApplied={handleLifeHappenedApplied}
      />
      <WorkoutLogModal
        visible={logWorkoutVisible}
        onClose={() => setLogWorkoutVisible(false)}
        onSaved={handleWorkoutSaved}
        todayExercises={todayExercises}
        workoutTitle={
          todayData?.todaySession?.day || todayData?.todaySession?.focus || undefined
        }
      />
    </>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseTips(tips: string): string[] {
  return tips
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0 && /^[•\-*]/.test(l))
    .map(l => l.replace(/^[•\-*]\s*/, '').trim())
    .filter(l => l.length > 0);
}

// ─── Styles ───────────────────────────────────────────────────────────────────

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
  centerLoader: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Goal banner
  goalBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: `${colors.primary}12`,
    borderRadius: radius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
    alignSelf: 'flex-start',
  },
  goalText: {
    fontSize: fontSize.xs,
    color: colors.primary,
    fontWeight: fontWeight.semibold,
  },

  // Cards
  card: {},
  cardContent: { paddingTop: 0 },

  // Rest day
  restDayCard: {
    borderColor: '#8b5cf620',
    backgroundColor: '#8b5cf608',
  },
  restDayContent: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
  },
  restDayIcon: {
    width: 56, height: 56,
    borderRadius: 28,
    backgroundColor: '#8b5cf615',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  restDayTitle: {
    fontSize: fontSize.xl,
    fontWeight: fontWeight.bold,
    color: '#8b5cf6',
  },
  restDaySubtitle: {
    fontSize: fontSize.sm,
    color: colors.mutedForeground,
    textAlign: 'center',
  },
  nextDayRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: 4,
  },
  nextDayText: {
    fontSize: fontSize.xs,
    color: colors.mutedForeground,
  },
  tipsBox: {
    width: '100%',
    backgroundColor: colors.muted,
    borderRadius: radius.md,
    padding: spacing.sm,
    gap: 6,
    marginTop: 4,
  },
  tipsLabel: {
    fontSize: 10,
    fontWeight: fontWeight.bold,
    color: colors.mutedForeground,
    letterSpacing: 0.8,
    marginBottom: 2,
  },
  tipRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.xs,
  },
  tipDot: {
    width: 5, height: 5,
    borderRadius: 3,
    backgroundColor: '#8b5cf6',
    marginTop: 5,
    flexShrink: 0,
  },
  tipText: {
    flex: 1,
    fontSize: fontSize.xs,
    color: colors.foreground,
    lineHeight: 17,
  },

  // Workout card
  workoutCard: {
    borderColor: `${colors.primary}30`,
    backgroundColor: `${colors.primary}06`,
  },
  workoutCardHeader: {
    gap: spacing.xs,
    paddingBottom: spacing.sm,
  },
  workoutHeaderTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  workoutDayLabel: {
    fontSize: 10,
    fontWeight: fontWeight.bold,
    color: colors.primary,
    letterSpacing: 0.8,
    marginBottom: 2,
  },
  workoutTitle: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.bold,
    color: colors.foreground,
  },
  weekLabel: {
    fontSize: fontSize.xs,
    color: colors.mutedForeground,
  },
  exerciseListContent: {
    paddingTop: 0,
    gap: 0,
  },
  exerciseRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
  },
  exerciseRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  exerciseName: {
    flex: 1,
    fontSize: fontSize.sm,
    color: colors.foreground,
    marginRight: spacing.sm,
  },
  exerciseMeta: {
    alignItems: 'flex-end',
    gap: 2,
  },
  exerciseSets: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    color: colors.primary,
  },
  exerciseIntensity: {
    fontSize: fontSize.xs,
    color: colors.mutedForeground,
  },

  // Action buttons
  actionRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    borderRadius: radius.lg,
    paddingVertical: 12,
  },
  logBtn: {
    backgroundColor: colors.primary,
  },
  logBtnText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    color: '#fff',
  },
  lifeBtn: {
    backgroundColor: colors.muted,
    borderWidth: 1,
    borderColor: colors.border,
  },
  lifeBtnText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
    color: colors.foreground,
  },
  savedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    backgroundColor: '#22c55e15',
    borderRadius: radius.full,
    paddingVertical: 7,
    paddingHorizontal: spacing.md,
  },
  savedBannerText: {
    fontSize: fontSize.sm,
    color: '#22c55e',
    fontWeight: fontWeight.medium,
  },

  // Weekly schedule
  scheduleContent: { paddingTop: 0 },
  scheduleScroll: { gap: spacing.xs, paddingVertical: 4 },
  dayCell: {
    alignItems: 'center',
    width: 50,
    paddingVertical: spacing.sm,
    paddingHorizontal: 4,
    borderRadius: radius.md,
    gap: 3,
    backgroundColor: colors.muted,
  },
  dayCellToday: {
    backgroundColor: colors.primary,
  },
  dayCellTraining: {
    backgroundColor: `${colors.primary}15`,
    borderWidth: 1,
    borderColor: `${colors.primary}30`,
  },
  dayLabel: {
    fontSize: 10,
    fontWeight: fontWeight.semibold,
    color: colors.mutedForeground,
    textTransform: 'uppercase',
  },
  dayLabelToday: { color: '#fff' },
  dateNum: {
    fontSize: fontSize.base,
    fontWeight: fontWeight.bold,
    color: colors.foreground,
  },
  dateNumToday: { color: '#fff' },
  trainingDot: {
    width: 6, height: 6,
    borderRadius: 3,
    backgroundColor: colors.primary,
  },
  trainingDotToday: {
    backgroundColor: '#fff',
  },
  restIcon: { marginTop: 1 },
  dayFocus: {
    fontSize: 9,
    color: colors.primary,
    fontWeight: fontWeight.medium,
    textAlign: 'center',
  },
  dayFocusToday: { color: '#ffffffcc' },
  phaseLabel: {
    fontSize: fontSize.xs,
    color: colors.mutedForeground,
    marginTop: 2,
  },

  // Program progress
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    marginBottom: spacing.md,
  },
  statItem: { alignItems: 'center', flex: 1 },
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
  statDivider: { width: 1, height: 36, backgroundColor: colors.border },
  progressSection: { gap: spacing.xs },
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

  // Empty state
  emptyProgramContent: {
    alignItems: 'center',
    paddingVertical: spacing.xl,
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
  },
});
