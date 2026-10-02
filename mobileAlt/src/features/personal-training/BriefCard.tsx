// One briefing item (design handoff §5, §6.1): who, what happened, what Axiom
// suggests and why. Any action collapses the card to a single row with Undo.
// Nothing sends until the trainer presses the primary button.

import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ShieldCheck, X } from 'lucide-react-native';
import { COPY, clockTime, shortDate, type BriefingItem, type ResolveAction } from '@axiom/personal-training-core';
import { colors, fontSize, fontWeight, radius, spacing } from '../../constants/theme';
import { Avatar, Eyebrow, EvidenceList, MAX_FONT_SCALE, Pill } from './components';
import { ActionButton, Disclosure, FeedbackText, IconButton, TextArea, sendHaptic } from './controls';
import { SentRow } from './DraftReply';
import { useCanUndo, useResolveItem, useUndoItem } from './hooks';
import { MOBILE_COPY } from './mobileCopy';

export function BriefCard({
  item, stale, sample, onOpenClient,
}: {
  item: BriefingItem;
  stale?: boolean;
  /** A non-interactive preview for the new-trainer state. */
  sample?: boolean;
  onOpenClient?: (clientId: string) => void;
}) {
  const [text, setText] = useState(item.draft.text);
  const [editing, setEditing] = useState(false);
  const [why, setWhy] = useState(false);
  const resolve = useResolveItem();
  const undo = useUndoItem();
  const canUndo = useCanUndo(item.resolution?.undoUntil);

  function act(action: ResolveAction) {
    if (sample || resolve.isPending) return;
    if (action === 'messaged') sendHaptic();
    resolve.mutate({ id: item.id, action, ...(action === 'messaged' ? { editedText: text } : {}) });
  }

  // Act → collapse: one row with what happened and an Undo.
  if (item.resolution) {
    return (
      <View style={styles.resolved}>
        <SentRow summary={item.resolution.summary} canUndo={canUndo} busy={undo.isPending} onUndo={() => undo.mutate(item.id)} />
        {undo.isError && <FeedbackText error>{(undo.error as Error).message || COPY.briefing.sendFailed}</FeedbackText>}
      </View>
    );
  }

  const openClient = () => onOpenClient?.(item.clientId);

  return (
    <View style={styles.card}>
      <View style={styles.top}>
        <Pressable
          onPress={openClient}
          disabled={sample}
          accessibilityRole="button"
          accessibilityLabel={MOBILE_COPY.briefing.openClient(item.client.name)}
          style={({ pressed }) => [styles.who, pressed && styles.pressed]}
        >
          <Avatar initials={item.client.initials} size={44} />
          <View style={styles.whoText}>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} numberOfLines={2} style={styles.name}>{item.client.name}</Text>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} numberOfLines={2} style={styles.caption}>{item.client.meta}</Text>
          </View>
        </Pressable>
        {!sample && (
          <IconButton icon={X} label={MOBILE_COPY.briefing.dismissClient(COPY.briefing.dismiss, item.client.name)} onPress={() => act('dismissed')} disabled={resolve.isPending} />
        )}
      </View>

      <Pill tone={item.severity === 'attention' ? 'red' : 'amber'}>{item.severity === 'attention' ? COPY.briefing.attention : COPY.briefing.look}</Pill>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={styles.headline}>{item.headline}</Text>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.detail}>{item.detail}</Text>
      {stale && (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.staleNote}>
          {COPY.briefing.basedOn(`${shortDate(new Date(item.dataThrough))}, ${clockTime(item.dataThrough)}`)}
        </Text>
      )}

      <View style={styles.suggestion}>
        <View style={styles.suggestionHead}>
          <Eyebrow>{COPY.briefing.suggests}</Eyebrow>
          {item.guardrail && (
            <View style={styles.guardrail}>
              <ShieldCheck size={14} color={colors.zinc600} />
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.guardrailText}>{item.guardrail.label}</Text>
            </View>
          )}
        </View>
        {editing
          ? <TextArea accessibilityLabel={COPY.draft.label} value={text} onChangeText={setText} autoFocus />
          : <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.draft}>{text}</Text>}
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.caption}>{COPY.briefing.nothingSends}</Text>
      </View>

      <View style={styles.actions}>
        <ActionButton disabled={sample || resolve.isPending || !text.trim()} onPress={() => act('messaged')}>{item.primaryLabel}</ActionButton>
        <ActionButton variant="secondary" disabled={sample} onPress={() => setEditing((v) => !v)}>
          {editing ? MOBILE_COPY.briefing.doneEditing : item.secondaryLabel}
        </ActionButton>
        {!sample && (
          <ActionButton variant="ghost" disabled={resolve.isPending} onPress={() => act('reviewed')}>{COPY.briefing.markHandled}</ActionButton>
        )}
      </View>
      {resolve.isError && <FeedbackText error>{(resolve.error as Error).message || COPY.briefing.sendFailed}</FeedbackText>}

      {!sample && (
        <Disclosure label={COPY.briefing.why} open={why} onToggle={() => setWhy((v) => !v)}>
          <View style={styles.why}>
            <Eyebrow>{COPY.briefing.whyHeading}</Eyebrow>
            <EvidenceList reasons={item.evidence.reasons} sources={item.evidence.sources} />
          </View>
        </Disclosure>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.82 },
  resolved: { gap: 4 },
  card: { padding: spacing.md, gap: spacing.sm, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth * 2, borderColor: colors.border, backgroundColor: colors.background },
  top: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  who: { flex: 1, minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 12 },
  whoText: { flex: 1 },
  name: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.foreground },
  caption: { fontSize: 12, lineHeight: 17, color: colors.mutedForeground },
  headline: { fontSize: fontSize.lg, lineHeight: 23, fontWeight: fontWeight.semibold, letterSpacing: -0.2, color: colors.foreground },
  detail: { fontSize: fontSize.base, lineHeight: 23, color: colors.zinc600 },
  staleNote: { fontSize: 12, lineHeight: 17, color: colors.warningInk },
  suggestion: { marginTop: 4, padding: 12, gap: spacing.sm, borderRadius: radius.md, backgroundColor: colors.zinc50 },
  suggestionHead: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  guardrail: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  guardrailText: { fontSize: fontSize.xs, fontWeight: fontWeight.semibold, color: colors.zinc600 },
  draft: { fontSize: fontSize.base, lineHeight: 23, color: colors.foreground },
  actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm, marginTop: 4 },
  why: { gap: spacing.sm, paddingTop: spacing.sm, paddingBottom: 4, borderTopWidth: StyleSheet.hairlineWidth * 2, borderTopColor: colors.border },
});
