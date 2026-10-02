// The editable AI draft (design handoff §5). Nothing here sends on its own:
// the trainer presses Send, the server opens a short undo window, and only
// when that closes is the message delivered.

import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Check } from 'lucide-react-native';
import { COPY, type Draft } from '@axiom/personal-training-core';
import { colors, fontSize, fontWeight, radius, spacing } from '../../constants/theme';
import { MAX_FONT_SCALE } from './components';
import { ActionButton, FeedbackText, TextArea, sendHaptic } from './controls';
import { useCanUndo, useRedraft, useSendDraft, useUndoDraft } from './hooks';

/** The green confirmation row an action collapses to, with Undo while the server still honours it. */
export function SentRow({ summary, canUndo, onUndo, busy }: { summary: string; canUndo: boolean; onUndo: () => void; busy?: boolean }) {
  return (
    <View style={styles.sent}>
      <Check size={16} color={colors.successInk} />
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityLiveRegion="polite" style={styles.sentText}>{summary}</Text>
      {canUndo && (
        <ActionButton variant="ghost" size="sm" disabled={busy} onPress={onUndo} textStyle={styles.undoText}>{COPY.draft.undo}</ActionButton>
      )}
    </View>
  );
}

export function DraftReply({
  draft: initial, label, children, onChange,
}: {
  draft: Draft;
  label?: string;
  /** Extra actions beside Send and Shorter, e.g. "Mark read, no reply". */
  children?: React.ReactNode;
  onChange?: (draft: Draft) => void;
}) {
  const [draft, setDraft] = useState(initial);
  const [text, setText] = useState(initial.text);
  const send = useSendDraft();
  const undo = useUndoDraft();
  const shorter = useRedraft();
  const canUndo = useCanUndo(draft.undoUntil);

  // A refetch may bring a newer server state for the same draft (sent elsewhere, undone).
  useEffect(() => {
    setDraft(initial);
    if (initial.status === 'pending') setText(initial.text);
  }, [initial.id, initial.status, initial.undoUntil]); // eslint-disable-line react-hooks/exhaustive-deps

  const update = (next: Draft) => { setDraft(next); onChange?.(next); };

  if (draft.status === 'discarded') {
    return <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.caption}>{COPY.draft.discarded}</Text>;
  }

  if (draft.status !== 'pending') {
    return (
      <View style={styles.stack}>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.sentBody}>{draft.text}</Text>
        <SentRow
          summary={COPY.draft.sent}
          canUndo={draft.status === 'sending' && canUndo}
          busy={undo.isPending}
          onUndo={() => undo.mutate(draft.id, { onSuccess: ({ draft: d }) => update(d) })}
        />
        {undo.isError && <FeedbackText error>{(undo.error as Error).message || COPY.briefing.sendFailed}</FeedbackText>}
      </View>
    );
  }

  return (
    <View style={styles.stack}>
      <TextArea accessibilityLabel={label ?? COPY.draft.label} value={text} onChangeText={setText} />
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.caption}>{COPY.briefing.nothingSends}</Text>
      <View style={styles.actions}>
        <ActionButton
          disabled={!text.trim() || send.isPending}
          onPress={() => { sendHaptic(); send.mutate({ id: draft.id, text }, { onSuccess: ({ draft: d }) => update(d) }); }}
        >
          {COPY.draft.send}
        </ActionButton>
        <ActionButton
          variant="secondary"
          disabled={shorter.isPending || text.trim().length < 80}
          onPress={() => shorter.mutate({ id: draft.id, text }, { onSuccess: ({ draft: d }) => setText(d.text) })}
        >
          {COPY.draft.shorter}
        </ActionButton>
        {children}
      </View>
      {send.isError && <FeedbackText error>{(send.error as Error).message || COPY.briefing.sendFailed}</FeedbackText>}
      {shorter.isError && <FeedbackText error>{(shorter.error as Error).message}</FeedbackText>}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.sm },
  actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm },
  caption: { fontSize: 12, lineHeight: 17, color: colors.mutedForeground },
  sent: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingLeft: 12, paddingRight: 4, paddingVertical: 4, borderRadius: radius.md, backgroundColor: colors.successSoft },
  sentText: { flex: 1, fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.successInk },
  undoText: { color: colors.foreground },
  sentBody: { padding: 12, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth * 2, borderColor: colors.border, fontSize: fontSize.base, lineHeight: 22, color: colors.zinc600 },
});
