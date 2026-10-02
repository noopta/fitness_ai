// The client report (design handoff §6.5): the PR log and bodyweight, then
// the report exactly as the client will get it, with the trainer's own note.
// It is delivered only when the trainer presses "Approve and send".

import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { COPY, type Report } from '@axiom/personal-training-core';
import { Skeleton } from '../../components/ui/Skeleton';
import { colors, fontSize, fontWeight, radius, spacing } from '../../constants/theme';
import { Eyebrow, MAX_FONT_SCALE, Notice, Pill } from './components';
import { ActionButton, FeedbackText, PickerField, TextArea, sendHaptic } from './controls';
import { SentRow } from './DraftReply';
import { useCanUndo, useReport, useReportActions, useRoster } from './hooks';
import { MOBILE_COPY, MONTH_NAMES } from './mobileCopy';
import { OptionSheet } from './Sheet';

const monthOf = (offset: number) => {
  const d = new Date();
  const m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + offset, 1));
  return { value: `${m.getUTCFullYear()}-${String(m.getUTCMonth() + 1).padStart(2, '0')}`, label: `${MONTH_NAMES[m.getUTCMonth()]} ${m.getUTCFullYear()}` };
};

function ReportPreview({ report, clientId, month }: { report: Report; clientId: string; month: string }) {
  const { patch, send, undo } = useReportActions(clientId, month);
  const [note, setNote] = useState(report.coachNote);
  const canUndo = useCanUndo(report.undoUntil);
  useEffect(() => setNote(report.coachNote), [report.id, report.coachNote]);
  const sent = report.status === 'sent';
  const first = report.trainerName.split(' ')[0];
  const failure = send.error ?? patch.error ?? undo.error;

  async function approve() {
    sendHaptic();
    try {
      if (note !== report.coachNote) await patch.mutateAsync({ id: report.id, patch: { coachNote: note } });
    } catch {
      return; // the note did not save; the failure is shown and nothing is sent
    }
    send.mutate(report.id);
  }

  return (
    <View style={styles.block}>
      <View style={styles.previewHead}>
        <Eyebrow>{COPY.progress.preview}</Eyebrow>
        <Pill tone={sent ? 'green' : 'zinc'}>{sent ? COPY.progress.statusSent : COPY.progress.statusDraft}</Pill>
      </View>
      <View style={styles.preview}>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.caption}>{`${report.practiceName} · ${report.trainerName}`}</Text>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={styles.title}>{report.title}</Text>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.body}>{report.narrative}</Text>
        <View style={styles.stats}>
          {report.stats.headline.map((h) => (
            <View key={h.label} style={styles.stat} accessible accessibilityLabel={`${h.label}: ${h.value}`}>
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.statValue}>{h.value}</Text>
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.caption}>{h.label}</Text>
            </View>
          ))}
        </View>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.label}>{COPY.progress.note(first)}</Text>
        {sent
          ? <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.body}>{report.coachNote || MOBILE_COPY.noValue}</Text>
          : <TextArea accessibilityLabel={COPY.progress.note(first)} value={note} maxLength={1500} placeholder={COPY.progress.notePlaceholder} onChangeText={setNote} />}
        {report.nextLine ? <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.nextLine}>{report.nextLine}</Text> : null}
      </View>

      {sent ? (
        <SentRow summary={MOBILE_COPY.progress.sentTo(COPY.progress.statusSent, report.client.name)} canUndo={canUndo} busy={undo.isPending} onUndo={() => undo.mutate(report.id)} />
      ) : (
        <>
          <View style={styles.actions}>
            <ActionButton disabled={send.isPending || patch.isPending} onPress={() => { void approve(); }}>{COPY.progress.approveSend}</ActionButton>
            <ActionButton variant="secondary" disabled={note === report.coachNote || patch.isPending} onPress={() => patch.mutate({ id: report.id, patch: { coachNote: note } })}>
              {COPY.progress.saveNote}
            </ActionButton>
          </View>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.caption}>{COPY.briefing.nothingSends}</Text>
        </>
      )}
      {failure ? <FeedbackText error>{(failure as Error).message || COPY.briefing.sendFailed}</FeedbackText> : null}
    </View>
  );
}

export function ProgressReport() {
  const roster = useRoster();
  const months = useMemo(() => [monthOf(-1), monthOf(0)], []);
  const [clientId, setClientId] = useState('');
  const [month, setMonth] = useState(months[0].value);
  const [picker, setPicker] = useState<'client' | 'month' | null>(null);
  const report = useReport(clientId, month);
  const clients = roster.data?.clients ?? [];
  const r = report.data?.report;

  return (
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.scroll}>
      <View style={styles.pickers}>
        <PickerField
          style={styles.flex}
          label={COPY.progress.reportClient}
          value={clients.find((c) => c.id === clientId)?.name ?? COPY.progress.reportClient}
          onPress={() => setPicker('client')}
        />
        <PickerField style={styles.flex} label={COPY.progress.reportMonth} value={months.find((m) => m.value === month)?.label ?? ''} onPress={() => setPicker('month')} />
      </View>
      {roster.isError && (
        <Notice alert action={<ActionButton variant="secondary" onPress={() => roster.refetch()}>{COPY.roster.retry}</ActionButton>}>{COPY.roster.loadFailed}</Notice>
      )}

      {!clientId ? (roster.isError ? null : <Notice>{COPY.progress.pickClient}</Notice>)
        : report.isPending ? <View accessibilityState={{ busy: true }}><Skeleton height={280} /></View>
        : report.isError || !r ? <Notice alert action={<ActionButton variant="secondary" onPress={() => report.refetch()}>{COPY.roster.retry}</ActionButton>}>{COPY.progress.loadFailed}</Notice>
        : (
          <>
            <View style={styles.block}>
              <Eyebrow>{COPY.progress.prLog}</Eyebrow>
              {r.stats.prs.length === 0 ? <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.empty}>{COPY.progress.noPrs}</Text> : (
                <View style={styles.listCard}>
                  {r.stats.prs.map((p, i) => (
                    <View key={`${p.lift}-${i}`} style={[styles.listRow, i > 0 && styles.rowBorder]}>
                      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.listName}>{p.lift}</Text>
                      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.listNumber}>{`${p.value} · ${p.date}`}</Text>
                    </View>
                  ))}
                </View>
              )}
            </View>

            <View style={styles.block}>
              <Eyebrow>{COPY.progress.measurements}</Eyebrow>
              {r.stats.measurements.length === 0 ? <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.empty}>{COPY.progress.noMeasurements}</Text> : (
                <>
                  {r.stats.bodyweight && (
                    <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.bodyweight}>
                      {`${r.stats.bodyweight.start} → ${r.stats.bodyweight.end} (${r.stats.bodyweight.change})`}
                    </Text>
                  )}
                  <View style={styles.listCard}>
                    {r.stats.measurements.map((m, i) => (
                      <View key={`${m.date}-${i}`} style={[styles.listRow, i > 0 && styles.rowBorder]}>
                        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.listNumber}>{m.date}</Text>
                        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.listValue}>{m.value}</Text>
                      </View>
                    ))}
                  </View>
                </>
              )}
            </View>

            <ReportPreview report={r} clientId={clientId} month={month} />
          </>
        )}

      <OptionSheet
        visible={picker === 'client'}
        onClose={() => setPicker(null)}
        title={COPY.progress.reportClient}
        options={clients.map((c) => ({ value: c.id, label: c.name }))}
        value={clientId || null}
        onSelect={setClientId}
      />
      <OptionSheet visible={picker === 'month'} onClose={() => setPicker(null)} title={COPY.progress.reportMonth} options={months} value={month} onSelect={setMonth} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scroll: { padding: spacing.md, paddingBottom: spacing.xl, gap: spacing.lg - 4 },
  pickers: { flexDirection: 'row', gap: spacing.sm },
  block: { gap: spacing.sm },
  empty: { fontSize: fontSize.base, color: colors.mutedForeground },
  caption: { fontSize: 12, lineHeight: 17, color: colors.mutedForeground },
  listCard: { borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth * 2, borderColor: colors.border },
  listRow: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingHorizontal: 12, paddingVertical: spacing.sm },
  rowBorder: { borderTopWidth: StyleSheet.hairlineWidth * 2, borderTopColor: colors.border },
  listName: { flex: 1, fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.foreground },
  listNumber: { fontSize: fontSize.sm, color: colors.zinc600, fontVariant: ['tabular-nums'] },
  listValue: { fontSize: fontSize.sm, color: colors.foreground, fontVariant: ['tabular-nums'] },
  bodyweight: { fontSize: fontSize.base, color: colors.foreground, fontVariant: ['tabular-nums'] },
  previewHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  preview: { padding: spacing.md, gap: spacing.sm, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth * 2, borderColor: colors.border },
  title: { fontSize: 22, lineHeight: 27, fontWeight: fontWeight.bold, letterSpacing: -0.4, color: colors.foreground },
  body: { fontSize: fontSize.base, lineHeight: 23, color: colors.zinc600 },
  stats: { flexDirection: 'row', gap: spacing.sm, marginVertical: 4 },
  stat: { flex: 1, padding: 10, gap: 4, borderRadius: radius.md, backgroundColor: colors.zinc50 },
  statValue: { fontSize: fontSize.xl, fontWeight: fontWeight.bold, letterSpacing: -0.4, color: colors.foreground, fontVariant: ['tabular-nums'] },
  label: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.foreground },
  nextLine: { fontSize: fontSize.base, lineHeight: 22, fontWeight: fontWeight.semibold, color: colors.foreground },
  actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm },
});
