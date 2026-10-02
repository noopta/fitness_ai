// The phone's stand-in for the Ask Anakin sidebar (design handoff §6.6): a
// new question, the questions that run every morning, and recent threads.

import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Trash2 } from 'lucide-react-native';
import { COPY } from '@axiom/personal-training-core';
import { Skeleton } from '../../components/ui/Skeleton';
import { colors, fontSize, fontWeight, radius, spacing } from '../../constants/theme';
import { Eyebrow, MAX_FONT_SCALE, Notice } from './components';
import { ActionButton, FeedbackText, IconButton, TintedSwitch } from './controls';
import { useAnakinThreads, useScheduledActions } from './hooks';
import { MOBILE_COPY } from './mobileCopy';
import { Sheet } from './Sheet';

export function AnakinThreadsSheet({
  visible, onClose, threadId, onNew, onOpenThread,
}: {
  visible: boolean;
  onClose: () => void;
  threadId: string | null;
  onNew: () => void;
  onOpenThread: (id: string) => void;
}) {
  const sidebar = useAnakinThreads();
  const { toggle, remove } = useScheduledActions();
  const scheduled = sidebar.data?.scheduled ?? [];
  const threads = sidebar.data?.threads ?? [];
  const failure = toggle.error ?? remove.error;

  return (
    <Sheet visible={visible} onClose={onClose} title={COPY.anakin.threads} fraction={0.85}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <ActionButton variant="secondary" fullWidth onPress={onNew}>{COPY.anakin.newQuestion}</ActionButton>

        {sidebar.isPending ? (
          <View style={styles.block} accessibilityState={{ busy: true }}>
            {[0, 1, 2].map((i) => <Skeleton key={i} height={44} />)}
          </View>
        ) : sidebar.isError ? (
          <Notice alert action={<ActionButton variant="secondary" onPress={() => sidebar.refetch()}>{COPY.roster.retry}</ActionButton>}>{MOBILE_COPY.anakin.threadsFailed}</Notice>
        ) : (
          <>
            <View style={styles.block}>
              <Eyebrow>{COPY.anakin.runsEveryMorning}</Eyebrow>
              {scheduled.length === 0 ? <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.caption}>{COPY.anakin.noScheduled}</Text> : scheduled.map((q) => (
                <View key={q.id} style={styles.scheduled}>
                  <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.scheduledText}>{q.text}</Text>
                  <View style={styles.scheduledControls}>
                    <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.count}>{q.lastCount === undefined ? '' : MOBILE_COPY.anakin.thisMorning(q.lastCount)}</Text>
                    <TintedSwitch
                      label={MOBILE_COPY.anakin.runEveryMorningFor(COPY.anakin.runEveryMorning, q.text)}
                      value={q.active}
                      onValueChange={(active) => toggle.mutate({ id: q.id, active })}
                    />
                    <IconButton icon={Trash2} label={MOBILE_COPY.anakin.runEveryMorningFor(COPY.anakin.remove, q.text)} onPress={() => remove.mutate(q.id)} />
                  </View>
                </View>
              ))}
              {failure ? <FeedbackText error>{(failure as Error).message || COPY.anakin.failed}</FeedbackText> : null}
            </View>

            <View style={styles.block}>
              <Eyebrow>{COPY.anakin.recent}</Eyebrow>
              {threads.length === 0 ? <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.caption}>{MOBILE_COPY.anakin.noThreads}</Text> : threads.map((t) => {
                const current = t.id === threadId;
                return (
                  <Pressable
                    key={t.id}
                    onPress={() => onOpenThread(t.id)}
                    accessibilityRole="button"
                    accessibilityLabel={t.title}
                    accessibilityState={{ selected: current }}
                    style={({ pressed }) => [styles.thread, current && styles.threadCurrent, pressed && styles.pressed]}
                  >
                    <Text maxFontSizeMultiplier={MAX_FONT_SCALE} numberOfLines={2} style={[styles.threadText, current && styles.threadTextCurrent]}>{t.title}</Text>
                  </Pressable>
                );
              })}
            </View>
          </>
        )}
      </ScrollView>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.82 },
  scroll: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.lg, gap: spacing.lg },
  block: { gap: spacing.sm },
  caption: { fontSize: 12, lineHeight: 17, color: colors.mutedForeground },
  scheduled: { padding: 12, gap: 4, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth * 2, borderColor: colors.border },
  scheduledText: { fontSize: fontSize.sm, lineHeight: 19, color: colors.foreground },
  scheduledControls: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  count: { flex: 1, fontSize: 12, color: colors.mutedForeground, fontVariant: ['tabular-nums'] },
  thread: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.sm },
  threadCurrent: { backgroundColor: colors.muted },
  threadText: { fontSize: fontSize.sm, color: colors.zinc600 },
  threadTextCurrent: { fontWeight: fontWeight.semibold, color: colors.foreground },
});
