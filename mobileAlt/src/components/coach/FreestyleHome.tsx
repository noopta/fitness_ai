// FreestyleHome — the Coach tab for someone training without a program
// (`freestyle` flag). Log as you go; Axiom reads the logs and proposes changes
// through the same confirm-first AdaptationCard the program dashboard uses.
//
// Data: GET /training/freestyle (contract 3) + /adaptation/pending. Every
// section degrades on its own — a failed fetch leaves "Log workout" working.
import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, RefreshControl, Alert, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import Svg, { Polyline, Circle } from 'react-native-svg';
import { colors, fontSize, fontWeight, spacing, radius } from '../../constants/theme';
import { adaptationApi, coachApi, trainingApi, type FreestyleHome as FreestyleData, type FreestyleLiftTrend } from '../../lib/api';
import { invalidateCache } from '../../lib/cache';
import { useAuth } from '../../context/AuthContext';
import { useUnits } from '../../context/UnitsContext';
import { WorkoutLogModal } from './WorkoutLogModal';
import { AdaptationCard, type AdaptationProposalData, type AdaptationCardState, type TargetEdit } from './AdaptationCard';
import { PhaseCard } from './PhaseCard';
import { UpgradeSheet } from '../UpgradeSheet';
import { maybeShowPostWorkoutPaywall } from '../../lib/paywallTriggers';
import { dayLabel } from './LogDateAndNotes';
import { KeyboardDoneBar } from '../ui/KeyboardDoneBar';

interface Props {
  /** "Build me a program" — the existing intake/setup flow. */
  onBuildProgram: () => void;
  /** A freestyle archive was restored — the parent reloads into the dashboard. */
  onRestored: () => void | Promise<void>;
}

const TREND_STYLE: Record<FreestyleLiftTrend['trend'], { text: string; soft: string; ink: string }> = {
  progressing: { text: 'progressing', soft: '#dcfce7', ink: '#15803d' },
  plateau: { text: 'plateau', soft: '#fef3c7', ink: '#b45309' },
  declining: { text: 'slipping', soft: '#fee2e2', ink: '#b91c1c' },
  insufficient: { text: 'few sessions', soft: colors.muted, ink: colors.mutedForeground },
};

function Sparkline({ values, width = 64, height = 22 }: { values: number[]; width?: number; height?: number }) {
  const pts = (values ?? []).filter((v) => Number.isFinite(v)).slice(-12);
  if (pts.length < 2) return <View style={{ width, height }} />;
  const max = Math.max(...pts), min = Math.min(...pts);
  const span = Math.max(max - min, 1e-6);
  const step = (width - 4) / (pts.length - 1);
  const xy = pts.map((v, i) => [2 + i * step, 2 + (height - 4) * (1 - (max === min ? 0.5 : (v - min) / span))] as const);
  const last = xy[xy.length - 1];
  return (
    <Svg width={width} height={height}>
      <Polyline points={xy.map(([x, y]) => `${x},${y}`).join(' ')} fill="none" stroke={colors.foreground} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      <Circle cx={last[0]} cy={last[1]} r={2.2} fill={colors.foreground} />
    </Svg>
  );
}

export function FreestyleHome({ onBuildProgram, onRestored }: Props) {
  const { user, getFeatures } = useAuth();
  const { unit, fromKg } = useUnits();
  const phaseOn = getFeatures().phaseInference;

  const [data, setData] = useState<FreestyleData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [logVisible, setLogVisible] = useState(false);
  const [saved, setSaved] = useState(false);
  const [paywallVisible, setPaywallVisible] = useState(false);
  const [canRestore, setCanRestore] = useState(false);
  const [restoring, setRestoring] = useState(false);

  const [proposals, setProposals] = useState<AdaptationProposalData[]>([]);
  const [proposalStates, setProposalStates] = useState<Record<string, AdaptationCardState>>({});

  const loadHome = useCallback(async () => {
    try {
      const r = await trainingApi.freestyle();
      if (r && typeof r === 'object' && Array.isArray((r as any).recentSessions)) setData(r);
    } catch { /* sections hide; Log workout still works */ }
  }, []);

  const loadProposals = useCallback(async () => {
    try {
      const res = await adaptationApi.pending();
      if (res?.enabled === false) { setProposals([]); return; }
      setProposals(res?.proposals ?? []);
    } catch { /* feature-gated or offline */ }
  }, []);

  const loadRestore = useCallback(async () => {
    try {
      const res: any = await coachApi.getCompletedPrograms();
      const list: any[] = Array.isArray(res?.programs) ? res.programs : [];
      setCanRestore(list.some((p) => p?.reason === 'freestyle'));
    } catch { setCanRestore(false); }
  }, []);

  const loadAll = useCallback(async () => {
    await Promise.all([loadHome(), loadProposals(), loadRestore()]);
    setLoading(false);
    setRefreshing(false);
  }, [loadHome, loadProposals, loadRestore]);

  useEffect(() => { void loadAll(); }, [loadAll]);

  const setProposalState = (id: string, st: AdaptationCardState) =>
    setProposalStates((prev) => ({ ...prev, [id]: st }));

  async function decideProposal(id: string, action: 'apply' | 'decline' | 'snooze', edits?: TargetEdit[]) {
    setProposalState(id, 'working');
    try {
      await adaptationApi.decide(id, action, edits ? { edits } : {});
      setProposalState(id, action === 'apply' ? 'applied' : action === 'snooze' ? 'snoozed' : 'declined');
      invalidateCache('coach:');
      if (action === 'apply') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        void loadHome();
      } else {
        setTimeout(() => setProposals((prev) => prev.filter((p) => p.id !== id)), 1800);
      }
    } catch {
      setProposalState(id, 'failed');
    }
  }

  async function undoProposal(id: string) {
    setProposalState(id, 'working');
    try {
      await adaptationApi.undo(id);
      setProposalState(id, 'undone');
      invalidateCache('coach:');
      void loadHome();
    } catch {
      setProposalState(id, 'applied');
    }
  }

  function handleSaved() {
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
    void maybeShowPostWorkoutPaywall({ tier: user?.tier }).then((show) => { if (show) setPaywallVisible(true); });
    void loadHome();
    void loadProposals();
  }

  function confirmRestore() {
    Alert.alert(
      'Restore your program?',
      'Your last program comes back where you left it. Everything you logged while freestyling stays in your history.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Restore', onPress: async () => {
            setRestoring(true);
            try {
              await coachApi.restoreProgram();
              invalidateCache('coach:');
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
              await Promise.resolve(onRestored());
            } catch (e: any) {
              if (e?.status === 404) setCanRestore(false);
              else Alert.alert("Couldn't restore", e?.message ?? 'Try again in a moment.');
            } finally {
              setRestoring(false);
            }
          },
        },
      ],
    );
  }

  const weekly = data?.weeklySessions ?? [];
  const weeklyMax = Math.max(1, ...weekly);
  const thisWeek = weekly.length ? weekly[weekly.length - 1] : 0;
  const top = proposals[0];

  return (
    <>
      <KeyboardDoneBar />
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void loadAll(); }} />}
      >
        {/* Hero — the one thing this screen is for */}
        <View style={styles.hero}>
          <View style={styles.heroLabelRow}>
            <View style={styles.heroDot} />
            <Text style={styles.heroLabel}>FREESTYLE</Text>
            {weekly.length ? <Text style={styles.heroMeta}>{thisWeek} session{thisWeek === 1 ? '' : 's'} this week</Text> : null}
          </View>
          <Text style={styles.heroTitle}>Train your way.</Text>
          <Text style={styles.heroSub}>Log as you go. Axiom reads your sessions and suggests what's next — you confirm every change.</Text>
          {weekly.length ? (
            <View style={styles.weekBars} accessibilityLabel={`Sessions per week, last ${weekly.length} weeks`}>
              {weekly.map((n, i) => (
                <View key={i} style={styles.weekBarCol}>
                  <View style={[styles.weekBar, { height: 4 + Math.round((n / weeklyMax) * 26), opacity: i === weekly.length - 1 ? 1 : 0.45 }]} />
                </View>
              ))}
            </View>
          ) : null}
          <TouchableOpacity
            style={styles.logBtn}
            activeOpacity={0.85}
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}); setLogVisible(true); }}
            accessibilityRole="button"
            accessibilityLabel="Log workout"
          >
            <Ionicons name="barbell-outline" size={18} color={colors.foreground} />
            <Text style={styles.logBtnText}>Log workout</Text>
          </TouchableOpacity>
        </View>

        {saved ? (
          <View style={styles.savedBanner}>
            <Ionicons name="checkmark-circle" size={14} color="#22c55e" />
            <Text style={styles.savedBannerText}>Workout saved!</Text>
          </View>
        ) : null}

        {canRestore ? (
          <TouchableOpacity style={styles.restoreRow} onPress={confirmRestore} disabled={restoring} activeOpacity={0.75} accessibilityRole="button">
            <Ionicons name="arrow-undo-outline" size={16} color={colors.foreground} />
            <Text style={styles.restoreText}>Restore my program</Text>
            {restoring ? <ActivityIndicator size="small" color={colors.foreground} /> : <Ionicons name="chevron-forward" size={16} color={colors.mutedForeground} />}
          </TouchableOpacity>
        ) : null}

        {/* Confirm-first proposals — one at a time, never a stack */}
        {top ? (
          <AdaptationCard
            proposal={top}
            state={proposalStates[top.id] ?? 'idle'}
            onApply={(edits) => decideProposal(top.id, 'apply', edits)}
            onSnooze={() => decideProposal(top.id, 'snooze')}
            onDecline={() => decideProposal(top.id, 'decline')}
            onUndo={() => undoProposal(top.id)}
          />
        ) : null}
        {proposals.length > 1 ? (
          <Text style={styles.moreNote}>
            {proposals.length - 1} more suggestion{proposals.length - 1 === 1 ? '' : 's'} waiting after this one.
          </Text>
        ) : null}

        {phaseOn ? <PhaseCard initial={data ? data.phase : undefined} onChanged={() => { void loadHome(); void loadProposals(); }} /> : null}

        {loading && !data ? (
          <View style={styles.loader}><ActivityIndicator color={colors.mutedForeground} /></View>
        ) : null}

        {/* Lift trends */}
        {data?.liftTrends?.length ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Your lifts</Text>
            {data.liftTrends.map((t, i) => {
              const st = TREND_STYLE[t.trend] ?? TREND_STYLE.insufficient;
              const lastTop = t.lastTop
                ? `${t.lastTop.weightKg != null ? `${fromKg(t.lastTop.weightKg)} ${unit} × ` : ''}${t.lastTop.reps}${t.lastTop.rpe != null ? ` @ ${t.lastTop.rpe}` : ''}`
                : null;
              const pct = Number.isFinite(t.pctPerWeek) && t.trend !== 'insufficient' && Math.abs(t.pctPerWeek) >= 0.1
                ? `${t.pctPerWeek > 0 ? '+' : ''}${(Math.round(t.pctPerWeek * 10) / 10).toFixed(1)}%/wk`
                : null;
              return (
                <View key={t.key} style={[styles.liftRow, i === data.liftTrends.length - 1 && { borderBottomWidth: 0 }]}>
                  <View style={{ flex: 1 }}>
                    <View style={styles.liftTop}>
                      <Text style={styles.liftName} numberOfLines={1}>{t.name}</Text>
                      <View style={[styles.pill, { backgroundColor: st.soft }]}>
                        <Text style={[styles.pillText, { color: st.ink }]}>{st.text}</Text>
                      </View>
                    </View>
                    <Text style={styles.liftMeta} numberOfLines={1}>
                      {[lastTop, pct, t.lastDate ? dayLabel(t.lastDate.slice(0, 10)) : null].filter(Boolean).join(' · ')}
                    </Text>
                  </View>
                  <Sparkline values={t.spark} />
                </View>
              );
            })}
          </View>
        ) : null}

        {/* Recent sessions */}
        {data ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Recent sessions</Text>
            {data.recentSessions.length === 0 ? (
              <Text style={styles.empty}>Nothing logged yet. Log your first session and Axiom starts learning how you train.</Text>
            ) : data.recentSessions.map((s, i) => (
              <View key={s.id} style={[styles.sessionRow, i === data.recentSessions.length - 1 && { borderBottomWidth: 0 }]}>
                <View style={styles.sessionDate}>
                  <Text style={styles.sessionDateText}>{dayLabel(s.date.slice(0, 10))}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.sessionTitle} numberOfLines={1}>{s.title || s.topLifts.slice(0, 2).join(' · ') || 'Workout'}</Text>
                  <Text style={styles.sessionMeta} numberOfLines={1}>
                    {s.exerciseCount} exercise{s.exerciseCount === 1 ? '' : 's'} · {s.setCount} set{s.setCount === 1 ? '' : 's'}
                    {s.title && s.topLifts.length ? ` · ${s.topLifts.slice(0, 2).join(', ')}` : ''}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        ) : null}

        {/* Secondary: the structured path is still one tap away */}
        <TouchableOpacity style={styles.buildRow} onPress={onBuildProgram} activeOpacity={0.75} accessibilityRole="button">
          <View style={styles.buildIcon}>
            <Ionicons name="calendar-outline" size={16} color={colors.foreground} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.buildTitle}>Build me a program</Text>
            <Text style={styles.buildSub}>Prefer structure? Anakin builds a plan around your goals and history.</Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={colors.mutedForeground} />
        </TouchableOpacity>
      </ScrollView>

      <WorkoutLogModal
        visible={logVisible}
        onClose={() => setLogVisible(false)}
        onSaved={handleSaved}
      />
      <UpgradeSheet
        visible={paywallVisible}
        onClose={() => setPaywallVisible(false)}
        onSuccess={() => setPaywallVisible(false)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: spacing.md, paddingBottom: 120 },
  hero: { backgroundColor: '#09090b', borderRadius: radius.lg, padding: spacing.md, marginBottom: spacing.md },
  heroLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  heroDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#22c55e' },
  heroLabel: { color: '#a1a1aa', fontSize: 11, fontWeight: fontWeight.bold, letterSpacing: 0.8 },
  heroMeta: { color: '#71717a', fontSize: 11, marginLeft: 'auto', fontVariant: ['tabular-nums'] },
  heroTitle: { color: '#fff', fontSize: fontSize.xxl, fontWeight: fontWeight.bold, marginTop: 10 },
  heroSub: { color: '#a1a1aa', fontSize: fontSize.sm, lineHeight: 19, marginTop: 4 },
  weekBars: { flexDirection: 'row', alignItems: 'flex-end', gap: 6, height: 32, marginTop: 14 },
  weekBarCol: { flex: 1, alignItems: 'center', justifyContent: 'flex-end' },
  weekBar: { width: '100%', maxWidth: 22, borderRadius: 3, backgroundColor: '#fff' },
  logBtn: {
    marginTop: 16, height: 50, borderRadius: radius.md, backgroundColor: '#fff',
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  logBtnText: { color: colors.foreground, fontSize: fontSize.base, fontWeight: fontWeight.bold },
  savedBanner: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: spacing.sm },
  savedBannerText: { fontSize: fontSize.sm, color: '#15803d', fontWeight: fontWeight.semibold },
  restoreRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 12, marginBottom: spacing.md,
  },
  restoreText: { flex: 1, fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.foreground },
  moreNote: { fontSize: 12, color: colors.mutedForeground, marginBottom: spacing.sm },
  loader: { paddingVertical: spacing.lg, alignItems: 'center' },
  section: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: 12, paddingTop: 12, paddingBottom: 4, marginBottom: spacing.md },
  sectionTitle: { fontSize: fontSize.base, fontWeight: fontWeight.bold, color: colors.foreground, marginBottom: 4 },
  liftRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  liftTop: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  liftName: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.foreground, flexShrink: 1 },
  liftMeta: { fontSize: 12, color: colors.mutedForeground, marginTop: 2, fontVariant: ['tabular-nums'] },
  pill: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 999 },
  pillText: { fontSize: 10, fontWeight: fontWeight.bold, letterSpacing: 0.3 },
  sessionRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  sessionDate: { minWidth: 72 },
  sessionDateText: { fontSize: 12, fontWeight: fontWeight.semibold, color: colors.mutedForeground },
  sessionTitle: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.foreground },
  sessionMeta: { fontSize: 12, color: colors.mutedForeground, marginTop: 1 },
  empty: { fontSize: fontSize.sm, color: colors.mutedForeground, lineHeight: 19, paddingVertical: 8 },
  buildRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md, padding: 12, backgroundColor: colors.muted,
  },
  buildIcon: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center' },
  buildTitle: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.foreground },
  buildSub: { fontSize: 12, color: colors.mutedForeground, marginTop: 2, lineHeight: 16 },
});
