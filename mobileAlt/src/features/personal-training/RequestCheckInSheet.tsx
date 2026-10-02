// "Request a check-in" (design handoff §6.4): pick clients, then send each a
// message with their check-in link. Nothing goes out until the button is
// pressed.

import React, { useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { Square, SquareCheck } from 'lucide-react-native';
import { COPY } from '@axiom/personal-training-core';
import { Skeleton } from '../../components/ui/Skeleton';
import { colors, fontSize, fontWeight, spacing } from '../../constants/theme';
import { Avatar, MAX_FONT_SCALE, Notice } from './components';
import { ActionButton, FeedbackText, sendHaptic } from './controls';
import { useCheckInActions, useRoster } from './hooks';
import { MOBILE_COPY } from './mobileCopy';
import { Sheet } from './Sheet';

export function RequestCheckInSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const roster = useRoster(visible);
  const { request } = useCheckInActions();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const clients = roster.data?.clients ?? [];

  const toggle = (id: string) => setPicked((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  function close() {
    setPicked(new Set());
    request.reset();
    onClose();
  }

  const empty = roster.isPending ? (
    <View style={styles.skeletons} accessibilityState={{ busy: true }}>
      {[0, 1, 2].map((i) => <Skeleton key={i} height={44} />)}
    </View>
  ) : roster.isError ? (
    <Notice alert action={<ActionButton variant="secondary" onPress={() => roster.refetch()}>{COPY.roster.retry}</ActionButton>}>{COPY.roster.loadFailed}</Notice>
  ) : (
    <Notice>{MOBILE_COPY.checkIns.noClients}</Notice>
  );

  return (
    <Sheet visible={visible} onClose={close} title={COPY.checkIns.requestTitle} fraction={0.8}>
      {request.isSuccess ? (
        <View style={styles.done}>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityLiveRegion="polite" style={styles.body}>{COPY.checkIns.requested(request.data.requested)}</Text>
          <ActionButton variant="secondary" fullWidth onPress={close}>{MOBILE_COPY.close}</ActionButton>
        </View>
      ) : (
        <>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.body, styles.intro]}>{COPY.checkIns.requestBody}</Text>
          <FlatList
            style={styles.list}
            data={clients}
            keyExtractor={(c) => c.id}
            renderItem={({ item }) => {
              const checked = picked.has(item.id);
              const Box = checked ? SquareCheck : Square;
              return (
                <Pressable
                  onPress={() => toggle(item.id)}
                  accessibilityRole="checkbox"
                  accessibilityLabel={item.name}
                  accessibilityState={{ checked }}
                  style={({ pressed }) => [styles.row, pressed && styles.pressed]}
                >
                  <Box size={22} color={checked ? colors.foreground : colors.zinc400} />
                  <Avatar initials={item.initials} size={28} />
                  <Text maxFontSizeMultiplier={MAX_FONT_SCALE} numberOfLines={2} style={styles.name}>{item.name}</Text>
                </Pressable>
              );
            }}
            ListEmptyComponent={empty}
          />
          <View style={styles.footer}>
            {request.isError && <FeedbackText error>{(request.error as Error).message || COPY.briefing.sendFailed}</FeedbackText>}
            <ActionButton fullWidth disabled={picked.size === 0 || request.isPending} loading={request.isPending} onPress={() => { sendHaptic(); request.mutate(Array.from(picked)); }}>
              {COPY.checkIns.requestSend(picked.size)}
            </ActionButton>
          </View>
        </>
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.82 },
  intro: { paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  body: { fontSize: fontSize.base, lineHeight: 22, color: colors.zinc600 },
  list: { flex: 1 },
  row: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: spacing.lg, paddingVertical: 6 },
  name: { flex: 1, fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.foreground },
  skeletons: { paddingHorizontal: spacing.lg, gap: spacing.sm },
  footer: { gap: spacing.sm, paddingHorizontal: spacing.lg, paddingTop: 12, paddingBottom: spacing.md, borderTopWidth: StyleSheet.hairlineWidth * 2, borderTopColor: colors.border },
  done: { gap: spacing.md, paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
});
