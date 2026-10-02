// One turn of an Ask Anakin conversation (design handoff §6.6): the answer
// with its client rows, note, actions and follow-ups; a clarifying question;
// or per-client drafts that still need the trainer to press Send.

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { COPY, seriesDomain, type AnakinEvent, type AnakinScope } from '@axiom/personal-training-core';
import { colors, fontSize, fontWeight, radius, spacing } from '../../constants/theme';
import { Avatar, MAX_FONT_SCALE, Sparkline } from './components';
import { ActionButton, FeedbackText } from './controls';
import { DraftReply } from './DraftReply';
import { useScheduledActions } from './hooks';
import { MOBILE_COPY } from './mobileCopy';

type AnswerEvent = Extract<AnakinEvent, { type: 'answer' }>;

export interface Turn {
  key: string;
  role: 'user' | 'assistant';
  text: string;
  event?: AnakinEvent;
  status?: string;
  pending?: boolean;
  /** The question this assistant turn answers; a clarify choice re-asks it. */
  question?: string;
  /** For a clarify turn: the option the trainer chose. */
  chosen?: string;
}

function AnswerView({
  event, scope, canFilter, onAsk, onOpenClient, onApplyFilter,
}: {
  event: AnswerEvent;
  scope: AnakinScope;
  canFilter: boolean;
  onAsk: (text: string) => void;
  onOpenClient: (clientId: string) => void;
  onApplyFilter: (messageId: string) => void;
}) {
  const { add } = useScheduledActions();
  // Small talk and single-client answers arrive with no rows and nothing to filter or schedule.
  const rows = event.rows ?? [];
  const followUps = event.followUps ?? [];
  const scheduleText = event.scheduleText;
  const showFilter = event.actionable && rows.length > 0 && canFilter;

  return (
    <View style={styles.stack}>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.answer}>{event.text}</Text>

      {rows.length > 0 && (
        <View style={styles.rows}>
          {rows.map((r, i) => (
            <Pressable
              key={r.clientId}
              onPress={() => onOpenClient(r.clientId)}
              accessibilityRole="button"
              accessibilityLabel={`${r.client.name}. ${r.evidence}`}
              style={({ pressed }) => [styles.row, i > 0 && styles.rowBorder, pressed && styles.pressed]}
            >
              <Avatar initials={r.client.initials} size={32} />
              <View style={styles.rowText}>
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} numberOfLines={2} style={styles.name}>{r.client.name}</Text>
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.evidence}>{r.evidence}</Text>
              </View>
              {r.series && r.series.length > 1 ? <Sparkline series={r.series} domain={seriesDomain(r.series)} label={`${r.client.name}: ${r.evidence}`} /> : null}
            </Pressable>
          ))}
        </View>
      )}

      {event.note ? <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.note}>{event.note}</Text> : null}

      {(showFilter || scheduleText) && (
        <View style={styles.actions}>
          {showFilter && <ActionButton variant="secondary" onPress={() => onApplyFilter(event.messageId)}>{COPY.anakin.applyFilter}</ActionButton>}
          {scheduleText ? (
            <ActionButton variant="secondary" disabled={add.isPending || add.isSuccess} onPress={() => add.mutate({ text: scheduleText, scope })}>
              {add.isSuccess ? COPY.anakin.scheduledDone : COPY.anakin.runEveryMorning}
            </ActionButton>
          ) : null}
        </View>
      )}
      {event.sources ? <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.caption}>{COPY.anakin.basedOn(event.sources)}</Text> : null}
      {add.isError && <FeedbackText error>{(add.error as Error).message || COPY.anakin.failed}</FeedbackText>}

      {followUps.length > 0 && (
        <View style={styles.chips}>
          {followUps.map((f) => (
            <Pressable key={f} onPress={() => onAsk(f)} accessibilityRole="button" style={({ pressed }) => [styles.chip, pressed && styles.pressed]}>
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.chipText}>{f}</Text>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

export function AssistantTurn({
  turn, scope, canFilter, onAsk, onClarify, onOpenClient, onApplyFilter,
}: {
  turn: Turn;
  scope: AnakinScope;
  canFilter: boolean;
  onAsk: (text: string) => void;
  onClarify: (turn: Turn, choice: string) => void;
  onOpenClient: (clientId: string) => void;
  onApplyFilter: (messageId: string) => void;
}) {
  const e = turn.event;
  return (
    <View style={styles.assistant}>
      <View style={styles.badge} accessible accessibilityRole="image" accessibilityLabel={MOBILE_COPY.anakin.avatar}>
        <Text allowFontScaling={false} style={styles.badgeText}>A</Text>
      </View>
      <View style={styles.assistantBody}>
        {turn.pending && !e && (
          <View style={styles.thinking}>
            <View style={styles.dot} />
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityLiveRegion="polite" style={styles.status}>{turn.status || COPY.anakin.thinking}</Text>
          </View>
        )}
        {e?.type === 'answer' && <AnswerView event={e} scope={scope} canFilter={canFilter} onAsk={onAsk} onOpenClient={onOpenClient} onApplyFilter={onApplyFilter} />}
        {e?.type === 'clarify' && (
          <View style={styles.stack}>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.answer}>{e.text}</Text>
            <View style={styles.chips} accessibilityRole="radiogroup" accessibilityLabel={e.text}>
              {e.options.map((o) => {
                const chosen = turn.chosen === o;
                return (
                  <Pressable
                    key={o}
                    disabled={!!turn.chosen}
                    onPress={() => onClarify(turn, o)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: chosen, checked: chosen, disabled: !!turn.chosen }}
                    style={({ pressed }) => [styles.option, chosen && styles.optionChosen, !!turn.chosen && !chosen && styles.optionDim, pressed && styles.pressed]}
                  >
                    <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.optionText, chosen && styles.optionTextChosen]}>{o}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        )}
        {e?.type === 'drafts' && (
          <View style={styles.stack}>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.answer}>{e.text}</Text>
            {e.drafts.map((d) => (
              <View key={d.id} style={styles.draftCard}>
                <View style={styles.draftWho}>
                  <Avatar initials={d.client.initials} size={28} />
                  <Text maxFontSizeMultiplier={MAX_FONT_SCALE} numberOfLines={2} style={[styles.name, styles.flex]}>{d.client.name}</Text>
                </View>
                <DraftReply draft={d} label={MOBILE_COPY.anakin.draftTo(d.client.name)} />
              </View>
            ))}
          </View>
        )}
        {e?.type === 'error' && <FeedbackText error>{e.message || COPY.anakin.failed}</FeedbackText>}
      </View>
    </View>
  );
}

export function UserTurn({ text }: { text: string }) {
  return (
    <View style={styles.user}>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.userText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  pressed: { opacity: 0.82 },
  stack: { gap: 12 },
  assistant: { flexDirection: 'row', gap: 12 },
  assistantBody: { flex: 1, paddingTop: 4 },
  badge: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.foreground },
  badgeText: { fontSize: 12, fontWeight: fontWeight.bold, color: colors.background },
  thinking: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 24 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.foreground },
  status: { flex: 1, fontSize: fontSize.base, color: colors.zinc600 },
  answer: { fontSize: fontSize.base, lineHeight: 24, color: colors.foreground },
  rows: { borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth * 2, borderColor: colors.border },
  row: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 12, paddingVertical: 10 },
  rowBorder: { borderTopWidth: StyleSheet.hairlineWidth * 2, borderTopColor: colors.border },
  rowText: { flex: 1 },
  name: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.foreground },
  evidence: { fontSize: 12, lineHeight: 17, color: colors.zinc600 },
  note: { paddingHorizontal: 12, paddingVertical: spacing.sm, borderRadius: radius.md, backgroundColor: colors.zinc50, fontSize: 12, lineHeight: 18, color: colors.zinc600 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm },
  caption: { fontSize: 12, lineHeight: 17, color: colors.mutedForeground },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 14, paddingVertical: 6, borderRadius: radius.full, borderWidth: StyleSheet.hairlineWidth * 2, borderColor: colors.border },
  chipText: { fontSize: 12, fontWeight: fontWeight.semibold, color: colors.zinc600 },
  option: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 14, paddingVertical: 6, borderRadius: radius.full, borderWidth: StyleSheet.hairlineWidth * 2, borderColor: colors.border },
  optionChosen: { backgroundColor: colors.foreground, borderColor: colors.foreground },
  optionDim: { opacity: 0.4 },
  optionText: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.foreground },
  optionTextChosen: { color: colors.background },
  draftCard: { padding: 12, gap: spacing.sm, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth * 2, borderColor: colors.border },
  draftWho: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  user: { alignSelf: 'flex-end', maxWidth: '85%', paddingHorizontal: spacing.md, paddingVertical: 10, borderRadius: radius.lg, backgroundColor: colors.muted },
  userText: { fontSize: fontSize.base, lineHeight: 23, color: colors.foreground },
});
