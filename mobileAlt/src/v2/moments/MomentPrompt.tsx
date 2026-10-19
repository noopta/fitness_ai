// The congratulation and the share prompt (spec "Progress Moments"): what you
// did in your own numbers, why it counts, and the card you could post. One
// body, three homes — inline under a chat log, on the session Done screen,
// and in the sheet the shell raises after a log anywhere else.

import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { isOverlay, type ProgressMoment } from '@axiom/agent-ui-core';
import { v2, T } from '../theme';
import { Pressable } from '../primitives/Pressable';
import { TextAction } from '../primitives/TextAction';
import { Sheet } from '../primitives/Sheet';
import { haptics } from '../haptics';
import { ScenePreview } from './ScenePreview';
import { useShareAssets } from './useShareAssets';
import { onMoment, momentsApi, rememberMoment } from './store';

const THUMB = 84;

export function MomentPrompt({ moment, onShare, onDismiss, dismissLabel = 'Not now', compact, hideLabel }: {
  moment: ProgressMoment;
  onShare: () => void;
  onDismiss?: () => void;
  dismissLabel?: string;
  /** Chat: no Not-now (the card just stays), smaller title. */
  compact?: boolean;
  /** The card's meta line already says it. */
  hideLabel?: boolean;
}) {
  const assets = useShareAssets();
  const [why, setWhy] = useState(false);
  const first = moment.shareables[0];
  return (
    <View accessibilityRole="summary" accessibilityLabel={`${moment.label}. ${moment.title}`}>
      {hideLabel ? null : <Text style={st.eyebrow}>{moment.label.toUpperCase()}</Text>}
      <Text style={[st.title, compact && { fontSize: 20, lineHeight: 26 }, hideLabel && { marginTop: 0 }]}>{moment.title}</Text>
      <Text style={st.praise}>{moment.praise}</Text>
      {moment.why.length ? (
        <Pressable onPress={() => { haptics.select(); setWhy((w) => !w); }} hitSlop={8} accessibilityRole="button" accessibilityState={{ expanded: why }}>
          <Text style={st.whyToggle}>{why ? 'Hide the numbers' : 'Why it counts'} {why ? '⌄' : '›'}</Text>
        </Pressable>
      ) : null}
      {why ? (
        <View style={st.whyList}>
          {moment.why.map((w, i) => <Text key={i} style={st.whyLine}>{w}</Text>)}
        </View>
      ) : null}
      {moment.canShare && first ? (
        <View style={st.shareRow}>
          <Pressable onPress={() => { haptics.select(); onShare(); }} accessibilityRole="button" accessibilityLabel="Make a share card">
            {assets ? (
              <ScenePreview shareable={first} width={THUMB} faces={assets.faces} mark={assets.mark} withPhoto={isOverlay(first.kind)} />
            ) : <View style={st.thumbPlaceholder} />}
          </Pressable>
          <View style={st.shareText}>
            <Text style={st.shareLine}>{moment.shareables.length > 1 ? `${moment.shareables.length} cards ready for your story.` : 'A card ready for your story.'}</Text>
            <View style={st.actions}>
              <TextAction primary onPress={onShare}>{moment.sharedAt ? 'Share again' : 'Share'}</TextAction>
              {onDismiss && !compact ? <TextAction muted arrow={false} size={15} onPress={onDismiss}>{dismissLabel}</TextAction> : null}
            </View>
          </View>
        </View>
      ) : onDismiss && !compact ? (
        <View style={[st.actions, { marginTop: 18 }]}><TextAction primary arrow={false} onPress={onDismiss}>Done</TextAction></View>
      ) : null}
    </View>
  );
}

/** Opens the share studio for a moment. */
export function useOpenMoment() {
  const router = useRouter();
  return (m: ProgressMoment) => { rememberMoment(m); router.push({ pathname: '/(v2)/moment', params: { id: m.id } } as any); };
}

/**
 * Mounted once in the v2 shell: raises the prompt sheet when a log anywhere
 * (log page, Fuel, Body, a quick set) returns a moment. Waits a beat so the
 * screen that logged can close first.
 */
export function MomentPresenter() {
  const [m, setM] = useState<ProgressMoment | null>(null);
  const open = useOpenMoment();
  useEffect(() => onMoment((x) => { setTimeout(() => { haptics.success(); setM(x); }, 450); }), []);
  if (!m) return null;
  const close = (dismissed: boolean) => { if (dismissed) void momentsApi.dismiss(m.id); setM(null); };
  return (
    <Sheet visible onClose={() => close(true)}>
      <MomentPrompt moment={m} onShare={() => { const x = m; setM(null); setTimeout(() => open(x), 250); }} onDismiss={() => close(true)} />
    </Sheet>
  );
}

const st = StyleSheet.create({
  eyebrow: { fontFamily: v2.font.bold, fontSize: 11, lineHeight: 14, letterSpacing: 1.4, color: v2.color.crimson },
  title: { ...T.headlineSm, fontSize: 24, lineHeight: 30, marginTop: 8, color: v2.color.ink },
  praise: { fontFamily: v2.font.regular, fontSize: 15, lineHeight: 22, color: v2.color.ink, marginTop: 8 },
  whyToggle: { fontFamily: v2.font.semibold, fontSize: 13, lineHeight: 18, color: v2.color.muted, marginTop: 10 },
  whyList: { marginTop: 6, gap: 4 },
  whyLine: { fontFamily: v2.font.regular, fontSize: 13, lineHeight: 19, color: v2.color.muted, fontVariant: ['tabular-nums'] },
  shareRow: { flexDirection: 'row', alignItems: 'center', gap: 16, marginTop: 18 },
  thumbPlaceholder: { width: THUMB, height: Math.round((THUMB * 533) / 300), borderRadius: 6, backgroundColor: v2.color.surface },
  shareText: { flex: 1, minWidth: 0 },
  shareLine: { fontFamily: v2.font.regular, fontSize: 13, lineHeight: 18, color: v2.color.muted },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 24, marginTop: 8 },
});
