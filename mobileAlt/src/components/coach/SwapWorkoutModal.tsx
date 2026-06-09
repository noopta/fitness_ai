// SwapWorkoutModal — lets the user swap another day's workout into today, then
// shows the LLM-rebalanced week for confirmation before applying. Backed by
// POST /coach/swap-day (propose) and /coach/apply-week-plan (persist).

import React, { useState } from 'react';
import {
  Modal, View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { coachApi } from '../../lib/api';
import { colors, spacing, radius, fontSize, fontWeight } from '../../constants/theme';

interface WeekDay {
  date: string;
  dayLabel: string;
  dateNumber?: number;
  isToday?: boolean;
  isTrainingDay?: boolean;
  isLogged?: boolean;
  isSwapped?: boolean;
  locked?: boolean;
  session?: { day?: string; focus?: string } | null;
}

interface ProposedDay extends WeekDay {}

interface Props {
  visible: boolean;
  onClose: () => void;
  weekDays: WeekDay[];
  onApplied: () => void;
}

export function SwapWorkoutModal({ visible, onClose, weekDays, onApplied }: Props) {
  const [step, setStep] = useState<'pick' | 'review'>('pick');
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [proposedWeek, setProposedWeek] = useState<ProposedDay[]>([]);
  const [rationale, setRationale] = useState('');

  const todayDate = weekDays.find(d => d.isToday)?.date ?? '';
  // Candidate sources: any other training day this week with a session that
  // hasn't been logged yet.
  const candidates = weekDays.filter(
    d => !d.isToday && d.isTrainingDay && d.session && !d.isLogged,
  );

  function reset() {
    setStep('pick');
    setProposedWeek([]);
    setRationale('');
    setLoading(false);
    setApplying(false);
  }

  function handleClose() {
    reset();
    onClose();
  }

  async function pickSource(sourceDate: string) {
    if (!todayDate) {
      Alert.alert('Cannot swap', "Could not determine today's date.");
      return;
    }
    setLoading(true);
    try {
      const res = await coachApi.swapDay({ date: todayDate, sourceDate });
      setProposedWeek(res.proposedWeek ?? []);
      setRationale(res.rationale ?? '');
      setStep('review');
    } catch (err: any) {
      Alert.alert('Swap failed', err?.message || 'Could not plan the swap. Try again.');
    } finally {
      setLoading(false);
    }
  }

  async function applyPlan() {
    setApplying(true);
    try {
      await coachApi.applyWeekPlan({
        week: proposedWeek.map(d => ({ date: d.date, session: d.session ?? null, locked: d.locked })),
        reason: 'Workout swap',
      });
      handleClose();
      onApplied();
    } catch (err: any) {
      Alert.alert('Could not apply', err?.message || 'Please try again.');
      setApplying(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title}>
              {step === 'pick' ? 'Swap today’s workout' : 'Review your week'}
            </Text>
            <TouchableOpacity onPress={handleClose} hitSlop={10}>
              <Ionicons name="close" size={22} color={colors.foreground} />
            </TouchableOpacity>
          </View>

          {loading ? (
            <View style={styles.center}>
              <ActivityIndicator size="large" color={colors.foreground} />
              <Text style={styles.muted}>Re-planning your week…</Text>
            </View>
          ) : step === 'pick' ? (
            <ScrollView contentContainerStyle={styles.body}>
              <Text style={styles.muted}>
                Pick a workout from this week to do today instead. We’ll re-balance the
                rest of the week so you don’t double up on tired muscles.
              </Text>
              {candidates.length === 0 ? (
                <Text style={[styles.muted, { marginTop: spacing.lg }]}>
                  No other workouts available to swap in this week.
                </Text>
              ) : (
                candidates.map((d) => (
                  <TouchableOpacity key={d.date} style={styles.option} activeOpacity={0.8} onPress={() => pickSource(d.date)}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.optionTitle}>{d.session?.day || d.session?.focus || 'Workout'}</Text>
                      {d.session?.focus && d.session?.day ? (
                        <Text style={styles.optionSub}>{d.session.focus}</Text>
                      ) : null}
                    </View>
                    <Text style={styles.optionDay}>{d.dayLabel}</Text>
                    <Ionicons name="chevron-forward" size={16} color={colors.mutedForeground} />
                  </TouchableOpacity>
                ))
              )}
            </ScrollView>
          ) : (
            <ScrollView contentContainerStyle={styles.body}>
              {!!rationale && (
                <View style={styles.rationaleBox}>
                  <Ionicons name="sparkles-outline" size={14} color={colors.foreground} />
                  <Text style={styles.rationaleText}>{rationale}</Text>
                </View>
              )}
              {proposedWeek.map((d) => (
                <View
                  key={d.date}
                  style={[styles.weekRow, d.isToday && styles.weekRowToday, d.locked && styles.weekRowLocked]}
                >
                  <Text style={[styles.weekDayLabel, d.isToday && styles.weekDayLabelToday]}>{d.dayLabel}</Text>
                  <Text style={styles.weekSession} numberOfLines={1}>
                    {d.session ? (d.session.day || d.session.focus) : 'Rest'}
                  </Text>
                  {d.isToday && <View style={styles.badge}><Text style={styles.badgeText}>TODAY</Text></View>}
                  {d.isSwapped && !d.isToday && <View style={styles.badgeAlt}><Text style={styles.badgeAltText}>moved</Text></View>}
                  {d.isLogged && <Ionicons name="checkmark-circle" size={14} color="#22c55e" />}
                </View>
              ))}
              <TouchableOpacity style={styles.applyBtn} activeOpacity={0.85} onPress={applyPlan} disabled={applying}>
                {applying
                  ? <ActivityIndicator size="small" color={colors.primaryForeground} />
                  : <Text style={styles.applyBtnText}>Apply this week</Text>}
              </TouchableOpacity>
              <TouchableOpacity style={styles.backBtn} activeOpacity={0.7} onPress={() => setStep('pick')} disabled={applying}>
                <Text style={styles.backBtnText}>Choose a different day</Text>
              </TouchableOpacity>
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    maxHeight: '85%',
    paddingBottom: spacing.xl,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  title: { fontSize: fontSize.lg, fontWeight: fontWeight.bold, color: colors.foreground },
  body: { padding: spacing.lg, gap: spacing.sm },
  center: { padding: spacing.xxl, alignItems: 'center', gap: spacing.md },
  muted: { fontSize: fontSize.sm, color: colors.mutedForeground, lineHeight: 20 },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  optionTitle: { fontSize: fontSize.base, fontWeight: fontWeight.semibold, color: colors.foreground },
  optionSub: { fontSize: fontSize.xs, color: colors.mutedForeground, marginTop: 2 },
  optionDay: { fontSize: fontSize.xs, fontWeight: fontWeight.bold, color: colors.mutedForeground },
  rationaleBox: {
    flexDirection: 'row',
    gap: 8,
    backgroundColor: colors.muted,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  rationaleText: { flex: 1, fontSize: fontSize.sm, color: colors.foreground, lineHeight: 19 },
  weekRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: 10,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  weekRowToday: { borderColor: colors.foreground, backgroundColor: colors.muted },
  weekRowLocked: { opacity: 0.55 },
  weekDayLabel: { width: 42, fontSize: fontSize.xs, fontWeight: fontWeight.bold, color: colors.mutedForeground },
  weekDayLabelToday: { color: colors.foreground },
  weekSession: { flex: 1, fontSize: fontSize.sm, color: colors.foreground },
  badge: { backgroundColor: colors.foreground, borderRadius: 999, paddingHorizontal: 6, paddingVertical: 2 },
  badgeText: { color: colors.primaryForeground, fontSize: 9, fontWeight: fontWeight.bold },
  badgeAlt: { backgroundColor: '#FEF3C7', borderRadius: 999, paddingHorizontal: 6, paddingVertical: 2 },
  badgeAltText: { color: '#92400E', fontSize: 9, fontWeight: fontWeight.bold },
  applyBtn: {
    backgroundColor: colors.foreground,
    borderRadius: radius.md,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: spacing.lg,
  },
  applyBtnText: { color: colors.primaryForeground, fontSize: fontSize.base, fontWeight: fontWeight.semibold },
  backBtn: { alignItems: 'center', paddingVertical: spacing.md },
  backBtnText: { color: colors.mutedForeground, fontSize: fontSize.sm, fontWeight: fontWeight.semibold },
});
