// Check-in configuration (design handoff §6.4): the default schedule and
// per-client overrides, the cadence, the ordered question list and what
// happens when a check-in is missed.

import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ArrowDown, ArrowUp, Trash2 } from 'lucide-react-native';
import {
  COPY, WEEKDAY_NAMES, hourLabel,
  type CheckInQuestion, type CheckInSchedule, type QuestionType,
} from '@axiom/personal-training-core';
import { Skeleton } from '../../components/ui/Skeleton';
import { colors, fontSize, fontWeight, radius, spacing } from '../../constants/theme';
import { Eyebrow, MAX_FONT_SCALE, Notice } from './components';
import { ActionButton, FeedbackText, IconButton, PickerField, SwitchRow, TextArea } from './controls';
import { useRoster, useScheduleActions, useSchedules } from './hooks';
import { MOBILE_COPY } from './mobileCopy';
import { OptionSheet, type Option } from './Sheet';

type Editable = Omit<CheckInSchedule, 'id' | 'clientName'>;
const editable = (s: CheckInSchedule): Editable => ({
  clientId: s.clientId, frequency: s.frequency, dayOfWeek: s.dayOfWeek, hour: s.hour, questions: s.questions,
  nudgeAfterHours: s.nudgeAfterHours, flagAfterHours: s.flagAfterHours, pauseAfterMisses: s.pauseAfterMisses, active: s.active,
});

const FREQUENCIES: Option<Editable['frequency']>[] = [
  { value: 'weekly', label: COPY.checkIns.frequency.weekly },
  { value: 'biweekly', label: COPY.checkIns.frequency.biweekly },
];
const DAYS: Option<number>[] = WEEKDAY_NAMES.map((label, value) => ({ value, label }));
const HOURS: Option<number>[] = Array.from({ length: 24 }, (_, value) => ({ value, label: hourLabel(value) }));
const TYPES: Option<QuestionType>[] = (['text', 'scale', 'number'] as QuestionType[]).map((value) => ({ value, label: COPY.checkIns.questionTypes[value] }));

type Picker = { kind: 'frequency' } | { kind: 'day' } | { kind: 'hour' } | { kind: 'type'; index: number } | null;
type NumberKey = 'nudgeAfterHours' | 'flagAfterHours' | 'pauseAfterMisses';

function ScheduleForm({ schedule, name, onRemove }: { schedule: CheckInSchedule; name: string; onRemove?: () => void }) {
  const [form, setForm] = useState<Editable>(editable(schedule));
  const [picker, setPicker] = useState<Picker>(null);
  const { save } = useScheduleActions();

  const set = <K extends keyof Editable>(key: K, value: Editable[K]) => { save.reset(); setForm((f) => ({ ...f, [key]: value })); };
  const setQuestion = (i: number, patch: Partial<CheckInQuestion>) => set('questions', form.questions.map((q, j) => (j === i ? { ...q, ...patch } : q)));
  const move = (i: number, by: number) => {
    const next = [...form.questions];
    const [q] = next.splice(i, 1);
    next.splice(i + by, 0, q);
    set('questions', next);
  };

  const numberField = (key: NumberKey, label: string) => (
    <View style={styles.numberField}>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.numberLabel}>{label}</Text>
      <TextArea
        multiline={false}
        accessibilityLabel={label}
        keyboardType="number-pad"
        maxLength={3}
        value={form[key] > 0 ? String(form[key]) : ''}
        onChangeText={(t) => set(key, Number(t.replace(/[^0-9]/g, '')) || 0)}
        style={styles.numberInput}
      />
    </View>
  );

  const numbersValid = form.nudgeAfterHours >= 1 && form.flagAfterHours >= 1 && form.pauseAfterMisses >= 1;
  const closePicker = () => setPicker(null);

  return (
    <View style={styles.form}>
      <View style={styles.activeCard}>
        <SwitchRow
          label={`${name} · ${form.active ? COPY.checkIns.scheduleOn : COPY.checkIns.scheduleOff}`}
          hint={COPY.checkIns.activeHint}
          value={form.active}
          onValueChange={(v) => set('active', v)}
        />
      </View>

      <View style={styles.block}>
        <Eyebrow>{COPY.checkIns.cadence}</Eyebrow>
        <PickerField label={COPY.checkIns.cadence} value={COPY.checkIns.frequency[form.frequency]} onPress={() => setPicker({ kind: 'frequency' })} />
        <View style={styles.pair}>
          <PickerField style={styles.flex} label={COPY.checkIns.day} value={WEEKDAY_NAMES[form.dayOfWeek] ?? ''} onPress={() => setPicker({ kind: 'day' })} />
          <PickerField style={styles.flex} label={COPY.checkIns.time} value={hourLabel(form.hour)} onPress={() => setPicker({ kind: 'hour' })} />
        </View>
      </View>

      <View style={styles.block}>
        <Eyebrow>{COPY.checkIns.questions}</Eyebrow>
        {form.questions.map((q, i) => (
          <View key={q.id} style={styles.question}>
            <View style={styles.questionTop}>
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.questionNumber}>{i + 1}</Text>
              <TextArea
                accessibilityLabel={MOBILE_COPY.checkIns.question(i + 1)}
                value={q.text}
                maxLength={200}
                onChangeText={(text) => setQuestion(i, { text })}
                style={styles.questionInput}
              />
            </View>
            <View style={styles.questionControls}>
              <PickerField style={styles.flex} label={MOBILE_COPY.checkIns.questionType(i + 1)} value={COPY.checkIns.questionTypes[q.type]} onPress={() => setPicker({ kind: 'type', index: i })} />
              {/* Reordering by buttons rather than drag: it works with a screen reader. */}
              <IconButton icon={ArrowUp} label={MOBILE_COPY.checkIns.questionAction(COPY.checkIns.moveUp, i + 1)} disabled={i === 0} onPress={() => move(i, -1)} />
              <IconButton icon={ArrowDown} label={MOBILE_COPY.checkIns.questionAction(COPY.checkIns.moveDown, i + 1)} disabled={i === form.questions.length - 1} onPress={() => move(i, 1)} />
              <IconButton icon={Trash2} label={MOBILE_COPY.checkIns.questionAction(COPY.checkIns.remove, i + 1)} disabled={form.questions.length === 1} onPress={() => set('questions', form.questions.filter((_, j) => j !== i))} />
            </View>
          </View>
        ))}
        <ActionButton
          variant="secondary"
          disabled={form.questions.length >= 12}
          onPress={() => set('questions', [...form.questions, { id: `q-${Date.now().toString(36)}`, text: '', type: 'text' }])}
        >
          {COPY.checkIns.addQuestion}
        </ActionButton>
      </View>

      <View style={styles.block}>
        <Eyebrow>{COPY.checkIns.missedRules}</Eyebrow>
        {numberField('nudgeAfterHours', COPY.checkIns.nudgeAfter)}
        {numberField('flagAfterHours', COPY.checkIns.flagAfter)}
        {numberField('pauseAfterMisses', COPY.checkIns.pauseAfter)}
      </View>

      <View style={styles.actions}>
        <ActionButton disabled={save.isPending || !numbersValid} loading={save.isPending} onPress={() => save.mutate(form)}>{COPY.checkIns.save}</ActionButton>
        {onRemove && <ActionButton variant="ghost" onPress={onRemove}>{COPY.checkIns.removeOverride}</ActionButton>}
      </View>
      {save.isSuccess && <FeedbackText>{COPY.checkIns.saved}</FeedbackText>}
      {save.isError && <FeedbackText error>{(save.error as Error).message || COPY.checkIns.loadFailed}</FeedbackText>}
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.caption}>{COPY.checkIns.footer}</Text>

      <OptionSheet visible={picker?.kind === 'frequency'} onClose={closePicker} title={COPY.checkIns.cadence} options={FREQUENCIES} value={form.frequency} onSelect={(v) => set('frequency', v)} />
      <OptionSheet visible={picker?.kind === 'day'} onClose={closePicker} title={COPY.checkIns.day} options={DAYS} value={form.dayOfWeek} onSelect={(v) => set('dayOfWeek', v)} />
      <OptionSheet visible={picker?.kind === 'hour'} onClose={closePicker} title={COPY.checkIns.time} options={HOURS} value={form.hour} onSelect={(v) => set('hour', v)} />
      <OptionSheet
        visible={picker?.kind === 'type'}
        onClose={closePicker}
        title={picker?.kind === 'type' ? MOBILE_COPY.checkIns.questionType(picker.index + 1) : COPY.checkIns.questions}
        options={TYPES}
        value={picker?.kind === 'type' ? form.questions[picker.index]?.type ?? null : null}
        onSelect={(type) => { if (picker?.kind === 'type') setQuestion(picker.index, { type }); }}
      />
    </View>
  );
}

export function CheckInConfigure() {
  const schedules = useSchedules();
  const roster = useRoster();
  const { remove } = useScheduleActions();
  const [selected, setSelected] = useState<string | null>(null);
  // An override being created, before its first save.
  const [draftFor, setDraftFor] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const list = schedules.data?.schedules ?? [];
  const fallback = list[0];
  const clients = roster.data?.clients ?? [];
  const available = useMemo(() => clients.filter((c) => !list.some((s) => s.clientId === c.id)), [clients, list]);

  if (schedules.isPending) {
    return <View style={styles.loading} accessibilityState={{ busy: true }}><Skeleton height={64} /><Skeleton height={240} /></View>;
  }
  if (schedules.isError || !fallback) {
    return <Notice alert action={<ActionButton variant="secondary" onPress={() => schedules.refetch()}>{COPY.roster.retry}</ActionButton>}>{COPY.checkIns.loadFailed}</Notice>;
  }

  const draftClient = clients.find((c) => c.id === draftFor);
  const current: CheckInSchedule = draftClient
    ? { ...fallback, id: null, clientId: draftClient.id, clientName: draftClient.name }
    : list.find((s) => (s.clientId ?? 'default') === (selected ?? 'default')) ?? fallback;

  return (
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.scroll}>
      <View style={styles.scheduleList}>
        {[...list, ...(draftClient ? [current] : [])].map((s, i) => {
          const key = s.clientId ?? 'default';
          const active = (current.clientId ?? 'default') === key;
          const label = s.clientId ? s.clientName ?? '' : COPY.checkIns.scheduleDefault;
          const state = s.active ? COPY.checkIns.scheduleOn : COPY.checkIns.scheduleOff;
          return (
            <Pressable
              key={key}
              onPress={() => { setSelected(s.clientId); setDraftFor(s.id === null && s.clientId ? s.clientId : null); }}
              accessibilityRole="button"
              accessibilityLabel={`${label}, ${state}`}
              accessibilityState={{ selected: active }}
              style={({ pressed }) => [styles.scheduleRow, i > 0 && styles.rowBorder, active && styles.scheduleRowActive, pressed && styles.pressed]}
            >
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} numberOfLines={2} style={styles.scheduleName}>{label}</Text>
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.caption}>{state}</Text>
            </Pressable>
          );
        })}
      </View>
      {available.length > 0 && (
        <ActionButton variant="secondary" onPress={() => setAdding(true)}>{COPY.checkIns.addOverride}</ActionButton>
      )}
      {remove.isError && <FeedbackText error>{(remove.error as Error).message || COPY.checkIns.loadFailed}</FeedbackText>}

      <ScheduleForm
        key={`${current.clientId ?? 'default'}:${current.id ?? 'new'}`}
        schedule={current}
        name={current.clientId ? current.clientName ?? '' : COPY.checkIns.scheduleDefault}
        onRemove={current.clientId ? () => { if (current.id) remove.mutate(current.clientId!); setDraftFor(null); setSelected(null); } : undefined}
      />

      <OptionSheet
        visible={adding}
        onClose={() => setAdding(false)}
        title={COPY.checkIns.addOverride}
        options={available.map((c) => ({ value: c.id, label: c.name }))}
        value={null}
        onSelect={(id) => { setDraftFor(id); setSelected(id); }}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  pressed: { opacity: 0.82 },
  loading: { padding: spacing.md, gap: 12 },
  scroll: { padding: spacing.md, paddingBottom: spacing.xl, gap: 12 },
  scheduleList: { borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth * 2, borderColor: colors.border, overflow: 'hidden' },
  scheduleRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, paddingHorizontal: 12, paddingVertical: spacing.sm },
  scheduleRowActive: { backgroundColor: colors.zinc50 },
  rowBorder: { borderTopWidth: StyleSheet.hairlineWidth * 2, borderTopColor: colors.border },
  scheduleName: { flex: 1, fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.foreground },
  caption: { fontSize: 12, lineHeight: 17, color: colors.mutedForeground },
  form: { gap: spacing.lg - 4, marginTop: spacing.sm },
  activeCard: { paddingHorizontal: 12, paddingVertical: 4, borderRadius: radius.md, backgroundColor: colors.zinc50 },
  block: { gap: spacing.sm },
  pair: { flexDirection: 'row', gap: spacing.sm },
  question: { padding: spacing.sm, gap: spacing.sm, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth * 2, borderColor: colors.border },
  questionTop: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  questionNumber: { width: 20, paddingTop: 12, textAlign: 'center', fontSize: 12, fontWeight: fontWeight.bold, color: colors.mutedForeground, fontVariant: ['tabular-nums'] },
  questionInput: { flex: 1, minHeight: 44 },
  questionControls: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  numberField: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  numberLabel: { flex: 1, fontSize: fontSize.sm, color: colors.foreground },
  numberInput: { width: 88, textAlign: 'right', fontVariant: ['tabular-nums'] },
  actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm },
});
