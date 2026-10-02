// Dossier program tab (design handoff §6.3): the client's program as they
// have it — goal, phases, days and exercises — and the changes Axiom has
// proposed to them. Read-only: the client edits their program in their app.

import React, { useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { COPY, relativeDay, shortDate, type ClientProgramView } from '@axiom/personal-training-core';
import { Skeleton } from '../../components/ui/Skeleton';
import { colors, fontSize, fontWeight, radius, spacing } from '../../constants/theme';
import { Eyebrow, MAX_FONT_SCALE, Notice, Pill } from './components';
import { ActionButton, Disclosure } from './controls';
import { useProgram } from './hooks';
import { MOBILE_COPY } from './mobileCopy';

type Phase = ClientProgramView['phases'][number];

function PhaseCard({ phase }: { phase: Phase }) {
  const [open, setOpen] = useState(phase.current);
  return (
    <View style={styles.card}>
      {/* The current phase is marked in words, not by colour. */}
      {phase.current && <Pill tone="zinc">{COPY.dossier.currentPhase}</Pill>}
      <Disclosure strong label={`${phase.name} · ${phase.weeksLabel}`} open={open} onToggle={() => setOpen((v) => !v)}>
        <View style={styles.days}>
          {phase.rationale ? <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.detail}>{phase.rationale}</Text> : null}
          {phase.days.map((d, i) => (
            <View key={`${d.day}-${i}`} style={styles.day}>
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.dayTitle}>{[d.day, d.focus].filter(Boolean).join(' · ')}</Text>
              {d.exercises.map((x, j) => (
                <View key={`${x.name}-${j}`} style={styles.exercise}>
                  <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.exerciseName}>{x.name}</Text>
                  <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.scheme}>{[x.scheme, x.target].filter(Boolean).join(' · ')}</Text>
                </View>
              ))}
            </View>
          ))}
        </View>
      </Disclosure>
    </View>
  );
}

function Body({ program }: { program: ClientProgramView }) {
  return (
    <View style={styles.body}>
      <View style={styles.block}>
        {program.goal ? (
          <>
            <Eyebrow>{COPY.dossier.programGoal}</Eyebrow>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.goal}>{program.goal}</Text>
          </>
        ) : null}
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.captionNumber}>
          {[
            COPY.dossier.programWeek(program.currentWeek, program.totalWeeks),
            COPY.dossier.programDays(program.daysPerWeek),
            program.startedAt ? MOBILE_COPY.dossier.started(shortDate(new Date(program.startedAt))) : null,
          ].filter(Boolean).join(' · ')}
        </Text>
      </View>

      <View style={styles.block}>
        {program.phases.map((p, i) => <PhaseCard key={`${p.name}-${i}`} phase={p} />)}
      </View>

      {program.pending.length > 0 && (
        <View style={styles.block}>
          <Eyebrow>{COPY.dossier.pendingChanges}</Eyebrow>
          <View style={styles.listCard}>
            {program.pending.map((c, i) => (
              <View key={c.id} style={[styles.pending, i > 0 && styles.rowBorder]}>
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.dayTitle}>{c.title}</Text>
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.detail}>{c.reasoning}</Text>
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.caption}>{relativeDay(c.proposedAt)}</Text>
              </View>
            ))}
          </View>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.caption}>{COPY.dossier.pendingHelp}</Text>
        </View>
      )}

      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.readOnly}>{COPY.dossier.programReadOnly}</Text>
    </View>
  );
}

export function ClientProgram({ clientId, header }: { clientId: string; header: React.ReactElement }) {
  const program = useProgram(clientId);
  return (
    <ScrollView
      contentContainerStyle={styles.scroll}
      refreshControl={<RefreshControl refreshing={program.isRefetching} onRefresh={() => program.refetch()} tintColor={colors.mutedForeground} />}
    >
      {header}
      {program.isPending ? (
        <View style={styles.body} accessibilityState={{ busy: true }}><Skeleton height={72} /><Skeleton height={120} /><Skeleton height={120} /></View>
      ) : program.isError ? (
        <Notice alert action={<ActionButton variant="secondary" onPress={() => program.refetch()}>{COPY.roster.retry}</ActionButton>}>{COPY.dossier.loadFailed}</Notice>
      ) : program.data.program ? (
        <Body program={program.data.program} />
      ) : (
        <Notice>{COPY.dossier.noProgram}</Notice>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingBottom: spacing.xl },
  body: { padding: spacing.md, gap: spacing.lg - 4 },
  block: { gap: spacing.sm },
  goal: { fontSize: fontSize.lg, lineHeight: 23, fontWeight: fontWeight.semibold, letterSpacing: -0.2, color: colors.foreground },
  caption: { fontSize: 12, lineHeight: 17, color: colors.mutedForeground },
  captionNumber: { fontSize: 12, lineHeight: 17, color: colors.mutedForeground, fontVariant: ['tabular-nums'] },
  card: { paddingHorizontal: spacing.md, paddingVertical: 12, gap: 4, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth * 2, borderColor: colors.border },
  detail: { fontSize: fontSize.base, lineHeight: 22, color: colors.zinc600 },
  days: { gap: spacing.md, paddingTop: 4, paddingBottom: spacing.sm },
  day: { gap: 6 },
  dayTitle: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.foreground },
  exercise: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 },
  exerciseName: { flex: 1, fontSize: fontSize.base, lineHeight: 21, color: colors.foreground },
  scheme: { flexShrink: 1, textAlign: 'right', fontSize: fontSize.sm, lineHeight: 21, color: colors.zinc600, fontVariant: ['tabular-nums'] },
  listCard: { borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth * 2, borderColor: colors.border },
  rowBorder: { borderTopWidth: StyleSheet.hairlineWidth * 2, borderTopColor: colors.border },
  pending: { padding: 12, gap: 4 },
  readOnly: { padding: 12, borderRadius: radius.md, backgroundColor: colors.zinc50, fontSize: 12, lineHeight: 18, color: colors.zinc600 },
});
