import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  Pressable,
  TouchableOpacity,
  Modal,
  Dimensions,
  ActivityIndicator,
  Animated,
  Linking,
} from 'react-native';
import YoutubeIframe from 'react-native-youtube-iframe';
import { Ionicons } from '@expo/vector-icons';
import { colors, fontSize, fontWeight, spacing, radius } from '../../constants/theme';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/Card';
import { LoadingSpinner } from '../ui/LoadingSpinner';
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
  isLogged?: boolean;
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

// ─── Day Workout Sheet ────────────────────────────────────────────────────────

const SHEET_HEIGHT = Dimensions.get('window').height * 0.88;
const SHEET_VIDEO_HEIGHT = Dimensions.get('window').width * (9 / 16);

function DayWorkoutSheet({
  day,
  visible,
  onClose,
  onLogged,
  onLogWorkout,
}: {
  day: WeekDay;
  visible: boolean;
  onClose: () => void;
  onLogged: () => void;
  onLogWorkout: (exercises: Exercise[], date: string, title?: string) => void;
}) {
  const [loadingVideo, setLoadingVideo] = useState<string | null>(null);
  const [sheetVideo, setSheetVideo] = useState<{ videoId: string; title: string } | null>(null);
  const [sheetVideoError, setSheetVideoError] = useState(false);
  const translateY = useRef(new Animated.Value(SHEET_HEIGHT)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.timing(backdropOpacity, { toValue: 1, duration: 220, useNativeDriver: true }),
        Animated.spring(translateY, { toValue: 0, damping: 22, stiffness: 180, useNativeDriver: true }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(backdropOpacity, { toValue: 0, duration: 180, useNativeDriver: true }),
        Animated.timing(translateY, { toValue: SHEET_HEIGHT, duration: 200, useNativeDriver: true }),
      ]).start();
    }
  }, [visible]);

  const exercises = day.session?.exercises ?? [];
  const isRestDay = !day.isTrainingDay;

  return (
    <>
      <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
        <Animated.View style={[sheet.root, { opacity: backdropOpacity }]}>
          <Pressable style={StyleSheet.absoluteFillObject} onPress={onClose} />
          <Animated.View style={[sheet.container, { transform: [{ translateY }] }]}>
          <View style={sheet.handle} />
          <View style={sheet.header}>
            <View>
              <Text style={sheet.dayLabel}>
                {day.dayLabel} · {day.monthLabel} {day.dateNumber}
              </Text>
              <Text style={sheet.title}>
                {isRestDay ? 'Rest Day' : (day.session?.focus ?? day.session?.day ?? 'Training Day')}
              </Text>
            </View>
            <TouchableOpacity onPress={onClose} style={sheet.closeBtn}>
              <Ionicons name="close" size={20} color={colors.mutedForeground} />
            </TouchableOpacity>
          </View>

          <ScrollView
            style={sheet.body}
            contentContainerStyle={sheet.bodyContent}
            showsVerticalScrollIndicator={false}
          >
            {isRestDay ? (
              <View style={sheet.restBox}>
                <Ionicons name="moon-outline" size={32} color="#8b5cf6" />
                <Text style={sheet.restText}>Rest & Recovery Day</Text>
              </View>
            ) : exercises.length === 0 ? (
              <Text style={sheet.emptyText}>No exercises defined for this day.</Text>
            ) : (
              <>
                <Text style={sheet.sectionTitle}>EXERCISES</Text>
                {exercises.map((ex, i) => {
                  const exName = ex.exercise ?? ex.name ?? `Exercise ${i + 1}`;
                  const isLoadingThis = loadingVideo === exName;
                  return (
                    <TouchableOpacity
                      key={i}
                      activeOpacity={0.7}
                      style={[sheet.exRow, i < exercises.length - 1 && sheet.exRowBorder]}
                      onPress={() => !isLoadingThis && openExerciseVideo(exName, setLoadingVideo, (videoId, title) => setSheetVideo({ videoId, title }))}
                    >
                      <Text style={sheet.exName}>{exName}</Text>
                      <View style={sheet.exMeta}>
                        {ex.sets && ex.reps ? (
                          <Text style={sheet.exSets}>{ex.sets} × {ex.reps}</Text>
                        ) : null}
                        {ex.intensity ? (
                          <Text style={sheet.exIntensity}>{ex.intensity}</Text>
                        ) : null}
                        {isLoadingThis
                          ? <ActivityIndicator size="small" color={colors.mutedForeground} />
                          : <Ionicons name="play-circle-outline" size={16} color={colors.mutedForeground} />}
                      </View>
                    </TouchableOpacity>
                  );
                })}

                {/* Inline video player within the sheet */}
                {sheetVideo && (
                  <View style={sheet.videoWrap}>
                    <View style={sheet.videoHeader}>
                      <Text style={sheet.videoTitle} numberOfLines={1}>{sheetVideo.title}</Text>
                      <TouchableOpacity onPress={() => { setSheetVideoError(false); setSheetVideo(null); }} style={sheet.videoClose}>
                        <Ionicons name="close-circle" size={20} color={colors.mutedForeground} />
                      </TouchableOpacity>
                    </View>
                    {sheetVideoError ? (
                      <TouchableOpacity
                        style={{ width: '100%', height: SHEET_VIDEO_HEIGHT, backgroundColor: '#111', alignItems: 'center', justifyContent: 'center', gap: 10 }}
                        activeOpacity={0.8}
                        onPress={() => Linking.openURL(`https://www.youtube.com/watch?v=${sheetVideo!.videoId}`)}
                      >
                        <Ionicons name="logo-youtube" size={40} color="#FF0000" />
                        <Text style={{ color: '#fff', fontSize: 13, fontWeight: '600' }}>Open in YouTube</Text>
                        <Text style={{ color: '#888', fontSize: 11 }}>Video unavailable in-app</Text>
                      </TouchableOpacity>
                    ) : (
                      <YoutubeIframe
                        height={SHEET_VIDEO_HEIGHT}
                        videoId={sheetVideo!.videoId.startsWith('search:') ? '' : sheetVideo!.videoId}
                        play
                        onError={() => setSheetVideoError(true)}
                        webViewProps={{ allowsFullscreenVideo: true }}
                      />
                    )}
                  </View>
                )}
              </>
            )}
          </ScrollView>

          {!isRestDay && (
            <View style={sheet.footer}>
              <TouchableOpacity
                style={sheet.logBtn}
                onPress={() => {
                  onClose();
                  setTimeout(() => {
                    onLogWorkout(exercises, day.date, day.session?.focus ?? day.session?.day);
                  }, 350);
                }}
              >
                <Ionicons name="barbell-outline" size={16} color="#fff" />
                <Text style={sheet.logBtnText}>Log This Workout</Text>
              </TouchableOpacity>
            </View>
          )}
          </Animated.View>
        </Animated.View>
      </Modal>
    </>
  );
}

const sheet = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  container: {
    backgroundColor: colors.card,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    height: SHEET_HEIGHT,
    paddingBottom: 34,
  },
  handle: {
    width: 40, height: 4, borderRadius: radius.full,
    backgroundColor: colors.border,
    alignSelf: 'center',
    marginTop: spacing.sm,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  dayLabel: { fontSize: fontSize.xs, color: colors.mutedForeground, marginBottom: 2 },
  title: { fontSize: fontSize.lg, fontWeight: fontWeight.bold, color: colors.foreground },
  closeBtn: { padding: 4 },
  body: { flex: 1 },
  bodyContent: { padding: spacing.md, gap: spacing.sm },
  sectionTitle: {
    fontSize: 10, fontWeight: fontWeight.bold, color: colors.mutedForeground,
    letterSpacing: 0.8, marginBottom: 4,
  },
  exRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10 },
  exRowBorder: { borderBottomWidth: 1, borderBottomColor: colors.border },
  exName: { flex: 1, fontSize: fontSize.sm, color: colors.foreground, marginRight: spacing.sm },
  exMeta: { alignItems: 'flex-end', gap: 2 },
  exSets: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.primary },
  exIntensity: { fontSize: fontSize.xs, color: colors.mutedForeground },
  restBox: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xl },
  restText: { fontSize: fontSize.base, color: '#8b5cf6', fontWeight: fontWeight.medium },
  emptyText: { fontSize: fontSize.sm, color: colors.mutedForeground, textAlign: 'center', paddingVertical: spacing.lg },
  videoWrap: { marginTop: spacing.sm, borderRadius: radius.md, overflow: 'hidden', backgroundColor: '#000' },
  videoHeader: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.muted, paddingHorizontal: spacing.sm, paddingVertical: 8 },
  videoTitle: { flex: 1, fontSize: fontSize.xs, fontWeight: fontWeight.semibold, color: colors.foreground, marginRight: 8 },
  videoClose: { padding: 2 },
  footer: { padding: spacing.md, borderTopWidth: 1, borderTopColor: colors.border },
  logBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: spacing.xs, backgroundColor: colors.primary,
    borderRadius: radius.lg, paddingVertical: 14,
  },
  logBtnText: { fontSize: fontSize.base, fontWeight: fontWeight.semibold, color: '#fff' },
});

// ─── Component ────────────────────────────────────────────────────────────────

export function OverviewTab({ coachData, onGoToProgram, onRefresh }: OverviewTabProps) {
  const [todayData, setTodayData] = useState<TodayData | null>(null);
  const [scheduleData, setScheduleData] = useState<ScheduleData | null>(null);
  const [loading, setLoading] = useState(true);

  const [lifeHappenedVisible, setLifeHappenedVisible] = useState(false);
  const [logWorkoutVisible, setLogWorkoutVisible] = useState(false);
  const [workoutSaved, setWorkoutSaved] = useState(false);
  const [selectedDay, setSelectedDay] = useState<WeekDay | null>(null);
  const [pastLogVisible, setPastLogVisible] = useState(false);
  const [dayLogData, setDayLogData] = useState<{ exercises: Exercise[]; date: string; title?: string } | null>(null);
  const [loadingVideoEx, setLoadingVideoEx] = useState<string | null>(null);
  const [videoModal, setVideoModal] = useState<{ videoId: string; title: string } | null>(null);
  const [modalVideoError, setModalVideoError] = useState(false);

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

  function handleWorkoutSaved(loggedDate?: string) {
    setWorkoutSaved(true);
    setTimeout(() => setWorkoutSaved(false), 3000);
    if (loggedDate) {
      const dateKey = loggedDate.slice(0, 10);
      setScheduleData(prev => prev ? {
        ...prev,
        weekDays: prev.weekDays.map(d =>
          d.date.slice(0, 10) === dateKey ? { ...d, isLogged: true } : d
        ),
      } : prev);
    }
    loadData();
    onRefresh?.();
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

        {/* ── Today's Workout Card (dark) ──────────────────────────────────── */}
        {todayData?.isRestDay ? (
          <View style={dark.card}>
            {/* header */}
            <View style={dark.headerRow}>
              <View style={dark.labelRow}>
                <View style={dark.dotRest} />
                <Text style={dark.labelText}>TODAY</Text>
              </View>
              {(todayData.phaseName ?? scheduleData?.phaseName) && (
                <View style={dark.phasePill}>
                  <Text style={dark.phasePillText} numberOfLines={1} ellipsizeMode="tail">
                    {(todayData.phaseName ?? scheduleData?.phaseName)!.toUpperCase()}
                    {todayData.weekNumber ? ` · W${todayData.weekNumber}` : ''}
                  </Text>
                </View>
              )}
            </View>
            <Text style={dark.title}>Rest Day</Text>
            <Text style={dark.subtitle}>Recovery is where gains are made</Text>
            <View style={dark.tipsBox}>
              <Text style={dark.tipsLabel}>RECOVERY FOCUS</Text>
              {[
                'Aim for 8+ hours of sleep tonight',
                'Prioritize protein: 0.8–1g per lb of bodyweight',
                'Light walking or stretching is fine',
              ].map((tip, i) => (
                <View key={i} style={dark.tipRow}>
                  <Ionicons name="checkmark-outline" size={12} color="#71717a" style={{ marginTop: 1 }} />
                  <Text style={dark.tipText}>{tip}</Text>
                </View>
              ))}
            </View>
            {todayData.nextTrainingDay && (
              <Text style={dark.nextDay}>
                Next training: <Text style={{ color: '#fff', fontWeight: '600' }}>{todayData.nextTrainingDay}</Text>
              </Text>
            )}
          </View>
        ) : (
          <View style={dark.card}>
            {/* header row */}
            <View style={dark.headerRow}>
              <View style={dark.labelRow}>
                <View style={dark.dotActive} />
                <Text style={dark.labelText}>TODAY'S WORKOUT</Text>
              </View>
              {(todayData?.phaseName ?? scheduleData?.phaseName) && (
                <View style={dark.phasePill}>
                  <Text style={dark.phasePillText} numberOfLines={1} ellipsizeMode="tail">
                    {(todayData?.phaseName ?? scheduleData?.phaseName)!.toUpperCase()}
                    {todayData?.weekNumber ? ` · W${todayData.weekNumber}` : ''}
                  </Text>
                </View>
              )}
            </View>

            {/* title + focus */}
            <Text style={dark.title} numberOfLines={2} ellipsizeMode="tail">
              {todayData?.todaySession?.day || todayData?.todaySession?.focus || 'Training Day'}
            </Text>
            {todayData?.todaySession?.focus && todayData.todaySession.day && (
              <Text style={dark.subtitle}>{todayData.todaySession.focus}</Text>
            )}

            {/* exercise list */}
            <View style={dark.exList}>
              {todayExercises.length === 0 ? (
                <Text style={dark.emptyText}>No exercises listed for today.</Text>
              ) : (
                todayExercises.map((ex, i) => {
                  const exName = ex.exercise ?? ex.name ?? `Exercise ${i + 1}`;
                  const isLoadingThis = loadingVideoEx === exName;
                  return (
                    <TouchableOpacity
                      key={i}
                      activeOpacity={0.7}
                      style={[dark.exRow, i < todayExercises.length - 1 && dark.exRowBorder]}
                      onPress={() => openExerciseVideo(exName, setLoadingVideoEx, (videoId, title) => setVideoModal({ videoId, title }))}
                    >
                      <Text style={dark.exName}>{exName}</Text>
                      <View style={dark.exRight}>
                        {ex.sets && ex.reps ? (
                          <Text style={dark.exMeta}>{ex.sets}×{ex.reps}{ex.intensity ? ` · ${ex.intensity}` : ''}</Text>
                        ) : null}
                        {isLoadingThis
                          ? <ActivityIndicator size="small" color="#71717a" />
                          : <Ionicons name="play-circle-outline" size={16} color="#71717a" />}
                      </View>
                    </TouchableOpacity>
                  );
                })
              )}
            </View>
          </View>
        )}

        {/* ── Action buttons ───────────────────────────────────────────────── */}
        <TouchableOpacity
          style={[styles.actionBtn, styles.logBtn]}
          onPress={() => setLogWorkoutVisible(true)}
        >
          <Ionicons name="barbell-outline" size={16} color="#fff" />
          <Text style={styles.logBtnText}>Log Workout</Text>
        </TouchableOpacity>

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
                  <TouchableOpacity
                    key={i}
                    activeOpacity={0.7}
                    onPress={() => { setSelectedDay(day); setPastLogVisible(true); }}
                    style={[
                      styles.dayCell,
                      day.isToday && styles.dayCellToday,
                      day.isTrainingDay && !day.isToday && styles.dayCellTraining,
                      day.isLogged && !day.isToday && styles.dayCellLogged,
                    ]}
                  >
                    <Text style={[styles.dayLabel, day.isToday && styles.dayLabelToday]}>
                      {day.dayLabel}
                    </Text>
                    <Text style={[styles.dateNum, day.isToday && styles.dateNumToday]}>
                      {day.dateNumber}
                    </Text>
                    {day.isLogged ? (
                      <Ionicons
                        name="checkmark-circle"
                        size={14}
                        color={day.isToday ? '#fff' : '#22c55e'}
                      />
                    ) : day.isTrainingDay ? (
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
                        style={[styles.dayFocus, day.isToday && styles.dayFocusToday, day.isLogged && !day.isToday && styles.dayFocusLogged]}
                        numberOfLines={1}
                      >
                        {day.session.focus}
                      </Text>
                    ) : !day.isTrainingDay ? (
                      <Text style={[styles.dayFocus, { color: colors.mutedForeground }]}>Rest</Text>
                    ) : null}
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </CardContent>
          </Card>
        )}

        {/* ── Life Happened card ───────────────────────────────────────────── */}
        <View style={styles.lifeCard}>
          <View style={styles.lifeCardTop}>
            <View style={styles.lifeCardIcon}>
              <Ionicons name="heart-outline" size={20} color="#d97706" />
            </View>
            <View style={styles.lifeCardBody}>
              <Text style={styles.lifeCardTitle}>Life Happened?</Text>
              <Text style={styles.lifeCardDesc}>
                Missed a session, had a rough night out, feeling sick, or just overwhelmed? Tell Anakin — get a personalized recovery plan with adjusted training and nutrition advice.
              </Text>
            </View>
          </View>
          <TouchableOpacity style={styles.lifeCardBtn} onPress={() => setLifeHappenedVisible(true)}>
            <Text style={styles.lifeCardBtnText}>Tell Anakin</Text>
            <Ionicons name="chevron-forward" size={14} color="#d97706" />
          </TouchableOpacity>
        </View>

        {/* ── Program Progress ─────────────────────────────────────────────── */}
        {savedProgram && (
          <Card style={styles.card}>
            <CardHeader>
              <CardTitle>Program Progress</CardTitle>
            </CardHeader>
            <CardContent style={styles.cardContent}>

              {/* Current phase — clean row at the top */}
              {(todayData?.phaseName ?? scheduleData?.phaseName) && (() => {
                const phaseName = todayData?.phaseName ?? scheduleData?.phaseName!;
                const phase = savedProgram?.phases?.find((p: any) =>
                  p.phaseName?.toLowerCase() === phaseName.toLowerCase()
                );
                return (
                  <View style={styles.phaseHeaderRow}>
                    <View style={styles.phaseHeaderLeft}>
                      <Text style={styles.phaseHeaderLabel}>CURRENT PHASE</Text>
                      <Text style={styles.phaseHeaderName}>{phaseName}</Text>
                      {phase?.focus && <Text style={styles.phaseHeaderFocus}>{phase.focus}</Text>}
                    </View>
                    {phase?.durationWeeks && (
                      <View style={styles.phaseHeaderBadge}>
                        <Text style={styles.phaseHeaderBadgeText}>{phase.durationWeeks}w</Text>
                      </View>
                    )}
                  </View>
                );
              })()}

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

              {totalWeeks > 0 && (
                <View style={styles.progressSection}>
                  <View style={styles.progressLabelRow}>
                    <Text style={styles.progressLabel}>Overall Progress</Text>
                    <Text style={styles.progressPct}>{Math.round(progressPct)}%</Text>
                  </View>
                  <View style={styles.progressTrack}>
                    <View style={[styles.progressBar, { width: `${progressPct}%` as any }]} />
                  </View>
                  <Text style={styles.progressSub}>Week {currentWeek} of {totalWeeks}</Text>
                </View>
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

      {/* Day workout detail + log sheet */}
      {selectedDay && (
        <DayWorkoutSheet
          day={selectedDay}
          visible={pastLogVisible}
          onClose={() => {
            setPastLogVisible(false);
            setTimeout(() => setSelectedDay(null), 400);
          }}
          onLogged={() => {
            const loggedDate = selectedDay?.date;
            setPastLogVisible(false);
            setTimeout(() => setSelectedDay(null), 400);
            handleWorkoutSaved(loggedDate);
          }}
          onLogWorkout={(exercises, date, title) => setDayLogData({ exercises, date, title })}
        />
      )}

      {/* Day-specific log modal — rendered outside DayWorkoutSheet to avoid nested modals */}
      <WorkoutLogModal
        visible={!!dayLogData}
        onClose={() => setDayLogData(null)}
        onSaved={() => { const loggedDate = dayLogData?.date; setDayLogData(null); handleWorkoutSaved(loggedDate); }}
        todayExercises={dayLogData?.exercises}
        date={dayLogData?.date}
        workoutTitle={dayLogData?.title}
      />

      {/* ── Video modal ────────────────────────────────────────────────────── */}
      <Modal
        visible={!!videoModal}
        transparent
        animationType="slide"
        onRequestClose={() => { setModalVideoError(false); setVideoModal(null); }}
      >
        <View style={videoStyles.backdrop}>
          <Pressable style={StyleSheet.absoluteFillObject} onPress={() => { setModalVideoError(false); setVideoModal(null); }} />
          <View style={videoStyles.sheet}>
            <View style={videoStyles.handle} />
            <View style={videoStyles.header}>
              <Text style={videoStyles.title} numberOfLines={1}>{videoModal?.title ?? ''}</Text>
              <TouchableOpacity onPress={() => { setModalVideoError(false); setVideoModal(null); }} style={videoStyles.closeBtn}>
                <Ionicons name="close" size={20} color={colors.mutedForeground} />
              </TouchableOpacity>
            </View>
            {videoModal && (
              modalVideoError ? (
                <TouchableOpacity
                  style={[videoStyles.webview, { backgroundColor: '#111', alignItems: 'center', justifyContent: 'center', gap: 10 }]}
                  activeOpacity={0.8}
                  onPress={() => Linking.openURL(`https://www.youtube.com/watch?v=${videoModal.videoId}`)}
                >
                  <Ionicons name="logo-youtube" size={40} color="#FF0000" />
                  <Text style={{ color: '#fff', fontSize: 13, fontWeight: '600' }}>Open in YouTube</Text>
                  <Text style={{ color: '#888', fontSize: 11 }}>Video unavailable in-app</Text>
                </TouchableOpacity>
              ) : (
                <YoutubeIframe
                  height={VIDEO_HEIGHT}
                  videoId={videoModal.videoId.startsWith('search:') ? '' : videoModal.videoId}
                  play
                  onError={() => setModalVideoError(true)}
                  webViewProps={{ allowsFullscreenVideo: true }}
                />
              )
            )}
          </View>
        </View>
      </Modal>
    </>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────


async function openExerciseVideo(
  exerciseName: string,
  setLoadingEx: (n: string | null) => void,
  onResult: (videoId: string, title: string) => void,
) {
  setLoadingEx(exerciseName);
  try {
    const res = await coachApi.getExerciseVideo(exerciseName);
    if (res?.videoId) {
      onResult(res.videoId, exerciseName);
    } else {
      // Fallback: prefix with 'search:' so the player uses YouTube search page
      onResult(`search:${exerciseName} exercise tutorial`, exerciseName);
    }
  } catch {
    onResult(`search:${exerciseName} exercise tutorial`, exerciseName);
  } finally {
    setLoadingEx(null);
  }
}

function parseTips(tips: string): string[] {
  return tips
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0 && /^[•\-*]/.test(l))
    .map(l => l.replace(/^[•\-*]\s*/, '').trim())
    .filter(l => l.length > 0);
}

// ─── Dark card styles (Today's Workout) ──────────────────────────────────────

const dark = StyleSheet.create({
  card: {
    backgroundColor: '#18181b',
    borderRadius: 20,
    padding: 20,
    gap: 12,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  dotActive: {
    width: 7, height: 7, borderRadius: 4,
    backgroundColor: '#4ade80',
  },
  dotRest: {
    width: 7, height: 7, borderRadius: 4,
    backgroundColor: '#52525b',
  },
  labelText: {
    fontSize: 10, fontWeight: '700', color: '#71717a', letterSpacing: 1,
  },
  phasePill: {
    backgroundColor: '#27272a',
    borderRadius: 100,
    paddingHorizontal: 10, paddingVertical: 4,
    maxWidth: '60%',
    flexShrink: 1,
  },
  phasePillText: {
    fontSize: 10, fontWeight: '700', color: '#a1a1aa', letterSpacing: 0.5,
  },
  title: {
    fontSize: 24, fontWeight: '700', color: '#fff',
  },
  subtitle: {
    fontSize: 13, color: '#a1a1aa', marginTop: -8,
  },
  exList: {
    backgroundColor: '#27272a',
    borderRadius: 14,
    overflow: 'hidden',
  },
  exRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  exRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: '#3f3f46',
  },
  exName: {
    flex: 1,
    fontSize: 13, fontWeight: '500', color: '#fff',
    marginRight: 8,
  },
  exRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  exMeta: {
    fontSize: 11, color: '#71717a',
  },
  emptyText: {
    fontSize: 13, color: '#52525b', textAlign: 'center', padding: 16,
  },
  tipsBox: {
    backgroundColor: '#27272a',
    borderRadius: 12,
    padding: 12,
    gap: 8,
  },
  tipsLabel: {
    fontSize: 9, fontWeight: '700', color: '#52525b', letterSpacing: 1,
  },
  tipRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
  },
  tipText: {
    flex: 1,
    fontSize: 12, color: '#a1a1aa', lineHeight: 17,
  },
  nextDay: {
    fontSize: 12, color: '#71717a', textAlign: 'center',
  },
});

// ─── Video modal styles ───────────────────────────────────────────────────────

const VIDEO_HEIGHT = Dimensions.get('window').width * (9 / 16);

const videoStyles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingBottom: 34,
    overflow: 'hidden',
    minHeight: VIDEO_HEIGHT + 80,
  },
  handle: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: colors.border,
    alignSelf: 'center',
    marginTop: 10, marginBottom: 4,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  title: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    color: colors.foreground,
    marginRight: 8,
  },
  closeBtn: { padding: 4 },
  webview: {
    width: '100%',
    height: VIDEO_HEIGHT,
    backgroundColor: '#000',
  },
});

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
    borderColor: '#8b5cf625',
    backgroundColor: '#8b5cf608',
  },
  restDayContent: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingTop: spacing.lg,   // Override CardContent's paddingTop:0
    paddingBottom: spacing.lg,
  },
  restDayIcon: {
    width: 60, height: 60,
    borderRadius: 30,
    backgroundColor: '#8b5cf618',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
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
    gap: 4,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  workoutDayLabel: {
    fontSize: 10,
    fontWeight: fontWeight.bold,
    color: colors.primary,
    letterSpacing: 0.8,
  },
  workoutTitle: {
    fontSize: fontSize.xl,
    fontWeight: fontWeight.bold,
    color: colors.foreground,
  },
  workoutMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginTop: 4,
  },
  focusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: `${colors.primary}15`,
    borderRadius: radius.full,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: `${colors.primary}25`,
  },
  focusPillText: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
    color: colors.primary,
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
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    borderRadius: radius.lg,
    paddingVertical: 14,
  },
  logBtn: {
    backgroundColor: colors.primary,
  },
  logBtnText: {
    fontSize: fontSize.base,
    fontWeight: fontWeight.semibold,
    color: '#fff',
  },

  // Life Happened card
  lifeCard: {
    backgroundColor: 'rgba(245,158,11,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(245,158,11,0.35)',
    borderRadius: radius.xl,
    padding: spacing.md,
    gap: spacing.sm,
  },
  lifeCardTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  lifeCardIcon: {
    width: 40, height: 40,
    borderRadius: radius.full,
    backgroundColor: 'rgba(245,158,11,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  lifeCardBody: {
    flex: 1,
    gap: 4,
  },
  lifeCardTitle: {
    fontSize: fontSize.base,
    fontWeight: fontWeight.bold,
    color: colors.foreground,
  },
  lifeCardDesc: {
    fontSize: fontSize.sm,
    color: colors.mutedForeground,
    lineHeight: 20,
  },
  lifeCardBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 4,
    borderWidth: 1,
    borderColor: 'rgba(245,158,11,0.5)',
    borderRadius: radius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
  },
  lifeCardBtnText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    color: '#d97706',
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
    // Rest day default: muted grey
    alignItems: 'center',
    width: 52,
    paddingVertical: spacing.sm,
    paddingHorizontal: 4,
    borderRadius: radius.md,
    gap: 3,
    backgroundColor: colors.muted,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  dayCellToday: {
    // Today: primary color, regardless of training/rest
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  dayCellTraining: {
    // Future/past training day: green accent
    backgroundColor: '#22c55e12',
    borderColor: '#22c55e30',
  },
  dayCellTodayRest: {
    backgroundColor: '#8b5cf6',
    borderColor: '#8b5cf6',
  },
  dayCellLogged: {
    backgroundColor: '#22c55e10',
    borderColor: '#22c55e40',
  },
  dayFocusLogged: { color: '#22c55e' },
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
    backgroundColor: '#22c55e',
  },
  trainingDotToday: {
    backgroundColor: '#fff',
  },
  restIcon: { marginTop: 1 },
  dayFocus: {
    fontSize: 9,
    color: '#22c55e',
    fontWeight: fontWeight.medium,
    textAlign: 'center',
  },
  dayFocusToday: { color: '#ffffffcc' },
  phaseLabel: {
    fontSize: fontSize.xs,
    color: colors.mutedForeground,
    marginTop: 2,
  },

  // Phase header row
  phaseHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingBottom: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    marginBottom: spacing.sm,
  },
  phaseHeaderLeft: { flex: 1, gap: 2 },
  phaseHeaderLabel: {
    fontSize: 9, fontWeight: fontWeight.bold, color: colors.primary,
    letterSpacing: 0.8,
  },
  phaseHeaderName: {
    fontSize: fontSize.base, fontWeight: fontWeight.bold, color: colors.foreground,
  },
  phaseHeaderFocus: {
    fontSize: fontSize.xs, color: colors.mutedForeground,
  },
  phaseHeaderBadge: {
    backgroundColor: `${colors.primary}15`,
    borderRadius: radius.full,
    paddingHorizontal: 10, paddingVertical: 4,
    marginLeft: spacing.sm,
  },
  phaseHeaderBadgeText: {
    fontSize: fontSize.xs, fontWeight: fontWeight.bold, color: colors.primary,
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
