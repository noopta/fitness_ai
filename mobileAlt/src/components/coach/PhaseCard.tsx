// PhaseCard — "Your phase: Cutting · 82% sure" with the evidence behind it and
// a Change sheet (pick a phase, or "Let Axiom decide"). Contract 6. Rendered
// only when the `phaseInference` flag is on; the caller owns that check.
//
// A confirmed / user-set phase reads as fact ("You told us"), an inferred one
// carries its confidence — the card never claims more certainty than it has.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { trainingApi, type PhaseResult, type TrainingPhase } from '../../lib/api';
import { colors, fontWeight, radius, spacing } from '../../constants/theme';
import { BottomSheet } from './nutrition/sheets/BottomSheet';
import { phaseLabel, SELECTABLE_PHASES } from './phaseLabels';

interface Props {
  /** Pre-fetched phase (e.g. from /training/freestyle). Undefined = fetch here. */
  initial?: PhaseResult | null;
  onChanged?: () => void;
}

export function PhaseCard({ initial, onChanged }: Props) {
  const [phase, setPhase] = useState<PhaseResult | null>(initial ?? null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await trainingApi.phase();
      if (r && typeof r === 'object' && 'effective' in r) setPhase(r);
    } catch { /* optional surface — hide on failure */ }
  }, []);

  useEffect(() => {
    if (initial === undefined) void load();
    else setPhase(initial);
  }, [initial, load]);

  if (!phase) return null;

  const confirmed = phase.confirmed;
  const showInferred = !confirmed;
  const pct = Math.round((phase.confidence ?? 0) * 100);
  const headline = confirmed
    ? phaseLabel(confirmed.phase)
    : phase.effective === 'unknown' && phase.inferred !== 'unknown'
      ? `Maybe ${phaseLabel(phase.inferred).toLowerCase()}`
      : phaseLabel(phase.effective);
  const sub = confirmed
    ? confirmed.source === 'user_set' ? 'You set this' : 'You confirmed this'
    : phase.inferred === 'unknown' ? 'Log a few more sessions and weigh-ins' : `${pct}% sure`;

  async function choose(next: TrainingPhase | 'auto') {
    setSaving(next);
    setError(null);
    try {
      await trainingApi.setPhase(next);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setSheetOpen(false);
      await load();
      onChanged?.();
    } catch (e: any) {
      setError(e?.message ?? 'Could not save. Try again.');
    } finally {
      setSaving(null);
    }
  }

  return (
    <View style={styles.card}>
      <View style={styles.topRow}>
        <View style={styles.iconWrap}>
          <Ionicons name="compass-outline" size={16} color={colors.foreground} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.eyebrow}>YOUR PHASE</Text>
          <Text style={styles.headline} numberOfLines={1}>
            {headline}
            <Text style={styles.sub}> · {sub}</Text>
          </Text>
        </View>
        <TouchableOpacity
          onPress={() => { Haptics.selectionAsync().catch(() => {}); setSheetOpen(true); }}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Change your training phase"
        >
          <Text style={styles.change}>Change</Text>
        </TouchableOpacity>
      </View>

      {showInferred && phase.evidence?.length ? (
        <View style={styles.evidence}>
          {phase.evidence.slice(0, 4).map((e, i) => (
            <View key={i} style={styles.evRow}>
              <Text style={styles.evLabel} numberOfLines={1}>{e.label}</Text>
              <Text style={styles.evValue} numberOfLines={1}>{e.value}</Text>
            </View>
          ))}
        </View>
      ) : null}
      {phase.statedGoalMismatch ? (
        <Text style={styles.mismatch}>{phase.statedGoalMismatch}</Text>
      ) : null}

      <BottomSheet
        visible={sheetOpen}
        onClose={() => { if (!saving) setSheetOpen(false); }}
        title="What are you training for right now?"
        subtitle="Axiom tunes suggestions and calories to this."
        dismissOnBackdrop={!saving}
      >
        <TouchableOpacity
          style={[styles.option, !confirmed && styles.optionOn]}
          onPress={() => choose('auto')}
          disabled={!!saving}
          accessibilityRole="button"
        >
          <View style={{ flex: 1 }}>
            <Text style={styles.optionText}>Let Axiom decide</Text>
            <Text style={styles.optionSub}>
              {phase.inferred !== 'unknown' ? `Reads as ${phaseLabel(phase.inferred).toLowerCase()} (${pct}%)` : 'Reads your logs and weigh-ins'}
            </Text>
          </View>
          {saving === 'auto' ? <ActivityIndicator size="small" color={colors.foreground} /> : !confirmed ? <Ionicons name="checkmark" size={18} color={colors.foreground} /> : null}
        </TouchableOpacity>
        {SELECTABLE_PHASES.map((p) => {
          const on = confirmed?.phase === p;
          return (
            <TouchableOpacity
              key={p}
              style={[styles.option, on && styles.optionOn]}
              onPress={() => choose(p)}
              disabled={!!saving}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
            >
              <Text style={[styles.optionText, { flex: 1 }]}>{phaseLabel(p)}</Text>
              {saving === p ? <ActivityIndicator size="small" color={colors.foreground} /> : on ? <Ionicons name="checkmark" size={18} color={colors.foreground} /> : null}
            </TouchableOpacity>
          );
        })}
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </BottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    backgroundColor: colors.background, padding: 12, marginBottom: spacing.md,
  },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  iconWrap: { width: 30, height: 30, borderRadius: 15, backgroundColor: colors.muted, alignItems: 'center', justifyContent: 'center' },
  eyebrow: { fontSize: 10, fontWeight: fontWeight.bold, letterSpacing: 0.6, color: colors.mutedForeground },
  headline: { fontSize: 15, fontWeight: fontWeight.bold, color: colors.foreground, marginTop: 1 },
  sub: { fontSize: 13, fontWeight: fontWeight.normal, color: colors.mutedForeground },
  change: { fontSize: 13, fontWeight: fontWeight.semibold, color: colors.foreground, textDecorationLine: 'underline' },
  evidence: { marginTop: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, paddingTop: 6 },
  evRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2, gap: 12 },
  evLabel: { fontSize: 12, color: colors.mutedForeground, flexShrink: 1 },
  evValue: { fontSize: 12, fontWeight: fontWeight.semibold, color: colors.foreground, fontVariant: ['tabular-nums'], maxWidth: '60%' },
  mismatch: { fontSize: 12, color: colors.foreground, marginTop: 8, lineHeight: 17 },
  option: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 12,
    borderRadius: 10, borderWidth: 1, borderColor: colors.border, marginTop: 8, gap: 8,
  },
  optionOn: { borderColor: colors.foreground },
  optionText: { fontSize: 14, fontWeight: fontWeight.semibold, color: colors.foreground },
  optionSub: { fontSize: 12, color: colors.mutedForeground, marginTop: 2 },
  error: { color: colors.destructive, fontSize: 12, marginTop: 8 },
});
