// Gut-health section for the Nutrition tab — handoff §7.3 (focus-nutrients
// card + weekly gut card) and §7.1 entry (dark invite card until the
// assessment is done). Self-contained: owns its data fetching and mounts the
// assessment / plan / weekly / order-scan modals.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { colors } from '../../../../constants/theme';
import { nutritionApi } from '../../../../lib/api';
import {
  Eyebrow, StatusDot, PillarBar, EST_NOTE, statusLabel, type BandStatus,
} from './GutPrimitives';
import { AssessmentFlow } from './AssessmentFlow';
import { PlanRevealScreen, type NutritionPlanPayload } from './PlanRevealScreen';
import { GutWeekScreen } from './GutWeekScreen';

interface DailyNutrient {
  key: string; label: string; unit: string; target: number;
  direction: 'meet' | 'limit'; actual: number; pct: number;
  status: BandStatus; focus: boolean;
}

export function GutSection({ refreshKey }: { refreshKey?: unknown }) {
  const [hasPlan, setHasPlan] = useState<boolean | null>(null);
  const [planPayload, setPlanPayload] = useState<NutritionPlanPayload | null>(null);
  const [daily, setDaily] = useState<DailyNutrient[] | null>(null);
  const [gutWeek, setGutWeek] = useState<any>(null);
  const [expanded, setExpanded] = useState(false);
  const [assessmentOpen, setAssessmentOpen] = useState(false);
  const [revealOpen, setRevealOpen] = useState<'reveal' | 'document' | null>(null);
  const [weekOpen, setWeekOpen] = useState(false);

  const load = useCallback(() => {
    nutritionApi.getNutritionPlan()
      .then((p: NutritionPlanPayload) => { setPlanPayload(p); setHasPlan(true); })
      .catch(() => setHasPlan(false));
    nutritionApi.getMicrosDaily()
      .then((d: { nutrients: DailyNutrient[] }) => setDaily(d.nutrients))
      .catch(() => {});
    nutritionApi.getGutWeek().then(setGutWeek).catch(() => {});
  }, []);

  useEffect(() => { load(); }, [load, refreshKey]);

  const focus = (daily ?? []).filter((n) => n.focus);
  const rest = (daily ?? []).filter((n) => !n.focus);

  return (
    <View style={{ gap: 12 }}>
      {/* Invite card — only until the assessment/plan exists */}
      {hasPlan === false && (
        <Pressable onPress={() => setAssessmentOpen(true)} style={styles.inviteCard}>
          <Eyebrow>New · Nutrition & gut health</Eyebrow>
          <Text style={styles.inviteTitle}>Let’s add nutrition to your plan</Text>
          <Text style={styles.inviteSub}>
            3 minutes → personal targets for the 18 nutrients behind energy, recovery, and gut health.
          </Text>
          <View style={styles.inviteButton}>
            <Text style={{ color: colors.foreground, fontWeight: '600', fontSize: 13 }}>Start the assessment</Text>
          </View>
        </Pressable>
      )}

      {/* Focus nutrients — 2-col grid, expander to all 18 (§7.3) */}
      {hasPlan && focus.length > 0 && (
        <View style={styles.card}>
          <View style={styles.rowBetween}>
            <Text style={styles.cardTitle}>Focus Nutrients</Text>
            <Pressable onPress={() => setRevealOpen('document')} hitSlop={8}>
              <Text style={{ fontSize: 11, color: colors.mutedForeground }}>View plan →</Text>
            </Pressable>
          </View>
          <View style={styles.focusGrid}>
            {focus.map((n) => (
              <View key={n.key} style={styles.focusCell}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <StatusDot status={n.status} />
                  <Text numberOfLines={1} style={{ fontSize: 12, fontWeight: '600', color: colors.foreground, flexShrink: 1 }}>
                    {n.label}
                  </Text>
                </View>
                <Text style={{ fontSize: 15, fontWeight: '700', fontVariant: ['tabular-nums'], color: colors.foreground }}>
                  {Math.min(999, n.pct)}%
                  <Text style={{ fontSize: 10, fontWeight: '400', color: colors.mutedForeground }}> of target</Text>
                </Text>
              </View>
            ))}
          </View>
          <Pressable onPress={() => setExpanded((e) => !e)} style={{ paddingTop: 10 }}>
            <Text style={{ fontSize: 12, fontWeight: '600', color: colors.mutedForeground }}>
              {expanded ? 'Show less ▴' : `All ${(daily ?? []).length} nutrients ▾`}
            </Text>
          </Pressable>
          {expanded && (
            <View style={{ gap: 8, paddingTop: 8 }}>
              {rest.map((n) => (
                <View key={n.key} style={styles.rowBetween}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <StatusDot status={n.status} />
                    <Text style={{ fontSize: 12, color: colors.foreground }}>{n.label}</Text>
                  </View>
                  <Text style={{ fontSize: 11, color: colors.mutedForeground }}>
                    {statusLabel(n.status, n.direction)} · {Math.min(999, n.pct)}%
                  </Text>
                </View>
              ))}
              <Text style={{ fontSize: 10, color: '#a1a1aa', paddingTop: 4 }}>{EST_NOTE}</Text>
            </View>
          )}
        </View>
      )}

      {/* Weekly gut card (§7.3) */}
      {gutWeek?.pillars && (() => {
        const noData = gutWeek.plantCount === 0 &&
          gutWeek.pillars.every((pl: any) => pl.key === 'avoid' || pl.score === 0);
        return (
          <Pressable onPress={() => setWeekOpen(true)} style={styles.card}>
            <View style={styles.rowBetween}>
              <Text style={styles.cardTitle}>Gut health · this week</Text>
              <Text style={{ fontSize: 13, fontWeight: '700', fontVariant: ['tabular-nums'], color: colors.foreground }}>
                {gutWeek.plantCount}
                <Text style={{ fontSize: 11, fontWeight: '400', color: colors.mutedForeground }}> / {gutWeek.plantTarget} plants</Text>
              </Text>
            </View>
            {noData ? (
              <Text style={{ fontSize: 12, lineHeight: 18, color: colors.mutedForeground, marginTop: 8 }}>
                Log your first meal of the week and this lights up — every distinct plant fills a slot.
              </Text>
            ) : (
              <View style={{ gap: 10, marginTop: 10 }}>
                {gutWeek.pillars.map((p: any) => (
                  <PillarBar key={p.key} label={p.label} score={p.score} status={p.status} detail={p.detail} />
                ))}
              </View>
            )}
            <Text style={{ fontSize: 11, color: colors.mutedForeground, marginTop: 10 }}>Tap for the full week →</Text>
          </Pressable>
        );
      })()}

      {/* Modals */}
      <AssessmentFlow
        visible={assessmentOpen}
        onClose={() => setAssessmentOpen(false)}
        onPlanReady={(payload) => {
          setAssessmentOpen(false);
          setPlanPayload(payload as NutritionPlanPayload);
          setHasPlan(true);
          setRevealOpen('reveal');
          load();
        }}
      />
      <PlanRevealScreen
        visible={revealOpen !== null}
        payload={planPayload}
        mode={revealOpen ?? 'document'}
        onContinue={() => setRevealOpen(null)}
        onClose={() => setRevealOpen(null)}
      />
      <GutWeekScreen visible={weekOpen} onClose={() => { setWeekOpen(false); load(); }} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border,
    borderRadius: 16, padding: 16,
  },
  cardTitle: { fontSize: 14, fontWeight: '600', color: colors.foreground },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  focusGrid: {
    flexDirection: 'row', flexWrap: 'wrap', marginTop: 12, rowGap: 12,
  },
  focusCell: { width: '50%', gap: 2, paddingRight: 8 },
  inviteCard: {
    backgroundColor: colors.foreground, borderRadius: 20, padding: 18, gap: 8,
  },
  inviteTitle: {
    color: colors.primaryForeground, fontSize: 18, fontWeight: '700', letterSpacing: -0.3,
  },
  inviteSub: { color: '#a1a1aa', fontSize: 13, lineHeight: 19 },
  inviteButton: {
    backgroundColor: colors.primaryForeground, borderRadius: 12,
    paddingVertical: 11, alignItems: 'center', marginTop: 6,
  },
});
