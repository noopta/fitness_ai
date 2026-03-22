import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  TouchableOpacity,
  Modal,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { Ionicons } from '@expo/vector-icons';
import { colors, fontSize, fontWeight, spacing, radius } from '../../constants/theme';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { coachApi } from '../../lib/api';

interface ProgramTabProps {
  coachData: any;
}

export function ProgramTab({ coachData }: ProgramTabProps) {
  const [expandedPhase, setExpandedPhase] = useState<number | null>(0);
  const [loadingVideo, setLoadingVideo] = useState<string | null>(null);
  const [videoModal, setVideoModal] = useState<{ videoId: string; title: string } | null>(null);

  async function openVideo(exerciseName: string) {
    setLoadingVideo(exerciseName);
    try {
      const res = await coachApi.getExerciseVideo(exerciseName);
      if (res?.videoId) setVideoModal({ videoId: res.videoId, title: exerciseName });
    } catch { /* silent */ } finally {
      setLoadingVideo(null);
    }
  }

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
    <>
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
                Current Phase: {phases[currentPhaseIdx]?.name || phases[currentPhaseIdx]?.phaseName || `Phase ${currentPhaseIdx + 1}`}
              </Text>
            </View>
          )}
        </CardContent>
      </Card>

      {/* Phase accordion */}
      {phases.map((phase: any, phaseIdx: number) => {
        const isExpanded = expandedPhase === phaseIdx;
        const days: any[] = phase.days ?? phase.trainingDays ?? [];

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
                    {phase.name || phase.phaseName || `Phase ${phaseIdx + 1}`}
                  </Text>
                  <Text style={styles.phaseMeta}>
                    {(phase.weeks || phase.durationWeeks) ? `${phase.weeks || phase.durationWeeks} weeks` : phase.weeksLabel || ''}
                    {(phase.weeks || phase.durationWeeks || phase.weeksLabel) && phase.daysPerWeek ? ' · ' : ''}
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
                        {day.name || day.day || `Day ${dayIdx + 1}`}
                      </Text>
                      {day.focus && (
                        <Badge variant="secondary">{day.focus}</Badge>
                      )}
                    </View>

                    {day.exercises && day.exercises.length > 0 ? (
                      <View style={styles.exerciseList}>
                        {day.exercises.map((ex: any, exIdx: number) => {
                          const exName = ex.name || ex.exercise || `Exercise ${exIdx + 1}`;
                          const isLoading = loadingVideo === exName;
                          return (
                            <TouchableOpacity
                              key={exIdx}
                              activeOpacity={0.7}
                              style={styles.exerciseRow}
                              onPress={() => openVideo(exName)}
                            >
                              <View style={styles.exerciseLeft}>
                                <Text style={styles.exerciseName}>{exName}</Text>
                                {ex.notes ? (
                                  <Text style={styles.exerciseNotes}>{ex.notes}</Text>
                                ) : null}
                              </View>
                              <View style={styles.exerciseRight}>
                                {ex.sets && ex.reps ? (
                                  <Text style={styles.exerciseSets}>{ex.sets} × {ex.reps}</Text>
                                ) : ex.sets ? (
                                  <Text style={styles.exerciseSets}>{ex.sets} sets</Text>
                                ) : null}
                                {(ex.rpe || ex.intensity) ? (
                                  <Text style={styles.exerciseRpe}>{ex.rpe ? `RPE ${ex.rpe}` : ex.intensity}</Text>
                                ) : null}
                                {isLoading
                                  ? <ActivityIndicator size="small" color={colors.mutedForeground} />
                                  : <Ionicons name="play-circle-outline" size={16} color={colors.mutedForeground} />}
                              </View>
                            </TouchableOpacity>
                          );
                        })}
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

    {/* ── Video modal ── */}
    <Modal
      visible={!!videoModal}
      transparent
      animationType="none"
      onRequestClose={() => setVideoModal(null)}
    >
      <View style={styles.videoBackdrop}>
        <TouchableOpacity style={StyleSheet.absoluteFillObject as any} onPress={() => setVideoModal(null)} activeOpacity={1} />
        <View style={styles.videoSheet}>
          <View style={styles.videoHandle} />
          <View style={styles.videoHeader}>
            <Text style={styles.videoTitle} numberOfLines={1}>{videoModal?.title ?? ''}</Text>
            <TouchableOpacity onPress={() => setVideoModal(null)} style={styles.videoClose}>
              <Ionicons name="close" size={20} color={colors.mutedForeground} />
            </TouchableOpacity>
          </View>
          {videoModal && (
            <WebView
              style={styles.webview}
              source={{ uri: `https://www.youtube.com/embed/${videoModal.videoId}?autoplay=1&playsinline=1` }}
              allowsFullscreenVideo
              mediaPlaybackRequiresUserAction={false}
              javaScriptEnabled
            />
          )}
        </View>
      </View>
    </Modal>
  </>
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
    backgroundColor: `${colors.primary}18`,
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
    backgroundColor: `${colors.primary}22`,
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

  // Video modal
  videoBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'flex-end',
  },
  videoSheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingBottom: 34,
  },
  videoHandle: {
    width: 40, height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    alignSelf: 'center',
    marginTop: 10,
    marginBottom: 8,
  },
  videoHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
  },
  videoTitle: {
    flex: 1,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    color: colors.foreground,
  },
  videoClose: { padding: 4 },
  webview: { height: 220 },
});
