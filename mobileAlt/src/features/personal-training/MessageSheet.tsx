// Write to a client directly from the dossier (design handoff §6.3). The
// message goes through the same send → undo window → deliver path as every
// draft, and only when the trainer presses the button.

import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { COPY, queryKeys, type Draft } from '@axiom/personal-training-core';
import { colors, fontSize, radius, spacing } from '../../constants/theme';
import { MAX_FONT_SCALE } from './components';
import { ActionButton, FeedbackText, TextArea, sendHaptic } from './controls';
import { SentRow } from './DraftReply';
import { useCanUndo, useMessageClient, useUndoDraft } from './hooks';
import { MOBILE_COPY } from './mobileCopy';
import { Sheet } from './Sheet';

export function MessageSheet({ visible, onClose, clientId, name }: { visible: boolean; onClose: () => void; clientId: string; name: string }) {
  const qc = useQueryClient();
  const [text, setText] = useState('');
  const [sent, setSent] = useState<Draft | null>(null);
  const send = useMessageClient(clientId);
  const undo = useUndoDraft();
  const canUndo = useCanUndo(sent?.undoUntil);

  function close() {
    // A delivered message shows on the timeline; an unsent one stays in the box for next time.
    if (sent) {
      setText('');
      setSent(null);
      void qc.invalidateQueries({ queryKey: queryKeys.client(clientId) });
    }
    send.reset();
    undo.reset();
    onClose();
  }

  return (
    <Sheet visible={visible} onClose={close} title={COPY.dossier.messageTitle(name)} fraction={0.9}>
      <View style={styles.body}>
        {sent ? (
          <>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.sentBody}>{sent.text}</Text>
            <SentRow
              summary={MOBILE_COPY.dossier.messageSent}
              canUndo={sent.status === 'sending' && canUndo}
              busy={undo.isPending}
              // Undo hands the words back to the box rather than discarding them.
              onUndo={() => undo.mutate(sent.id, { onSuccess: () => setSent(null) })}
            />
            {undo.isError && <FeedbackText error>{(undo.error as Error).message || COPY.briefing.sendFailed}</FeedbackText>}
          </>
        ) : (
          <>
            <TextArea
              accessibilityLabel={COPY.dossier.messageTitle(name)}
              placeholder={COPY.dossier.messagePlaceholder}
              value={text}
              onChangeText={setText}
              maxLength={2000}
              style={styles.input}
            />
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.caption}>{COPY.briefing.nothingSends}</Text>
            <ActionButton
              fullWidth
              disabled={!text.trim() || send.isPending}
              loading={send.isPending}
              onPress={() => { sendHaptic(); send.mutate(text.trim(), { onSuccess: ({ draft }) => setSent(draft) }); }}
            >
              {COPY.dossier.messageSend}
            </ActionButton>
            {send.isError && <FeedbackText error>{(send.error as Error).message || COPY.briefing.sendFailed}</FeedbackText>}
          </>
        )}
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, gap: spacing.sm + 4 },
  input: { minHeight: 120, maxHeight: 200 },
  caption: { fontSize: 12, lineHeight: 17, color: colors.mutedForeground },
  sentBody: { padding: 12, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth * 2, borderColor: colors.border, fontSize: fontSize.base, lineHeight: 22, color: colors.zinc600 },
});
