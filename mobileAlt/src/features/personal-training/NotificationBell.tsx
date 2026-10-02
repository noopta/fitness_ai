// The header bell (design handoff §6.7): what needs the trainer now, how much
// is being held for the briefing, and how much was recorded quietly. The red
// dot appears only for unread immediate items.

import React, { useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Bell } from 'lucide-react-native';
import { COPY, relativeDay, type NotificationItem } from '@axiom/personal-training-core';
import { Skeleton } from '../../components/ui/Skeleton';
import { colors, fontSize, fontWeight, spacing } from '../../constants/theme';
import { Eyebrow, MAX_FONT_SCALE, Notice, TAB_PATH, clientPath } from './components';
import { ActionButton } from './controls';
import { useMarkNotificationsRead, useNotifications } from './hooks';
import { MOBILE_COPY } from './mobileCopy';
import { Sheet } from './Sheet';

function Item({ item, onPress }: { item: NotificationItem; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={[item.read ? null : MOBILE_COPY.unread, item.title, item.body, relativeDay(item.at)].filter(Boolean).join('. ')}
      style={({ pressed }) => [styles.item, pressed && styles.pressed]}
    >
      <View style={[styles.itemDot, !item.read && styles.itemDotUnread]} />
      <View style={styles.itemText}>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.itemTitle}>{item.title}</Text>
        {item.body ? <Text maxFontSizeMultiplier={MAX_FONT_SCALE} numberOfLines={2} style={styles.itemBody}>{item.body}</Text> : null}
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.caption}>{item.read ? relativeDay(item.at) : `${MOBILE_COPY.unread} · ${relativeDay(item.at)}`}</Text>
      </View>
    </Pressable>
  );
}

export function NotificationBell() {
  const router = useRouter();
  const feed = useNotifications();
  const markRead = useMarkNotificationsRead();
  const [open, setOpen] = useState(false);
  const unread = feed.data?.unread ?? 0;

  function openItem(item: NotificationItem) {
    if (!item.read) markRead.mutate([item.id]);
    setOpen(false);
    router.navigate((item.clientId ? clientPath(item.clientId) : TAB_PATH.briefing) as any);
  }

  const empty = feed.isPending ? (
    <View style={styles.skeletons} accessibilityState={{ busy: true }}>
      {[0, 1, 2].map((i) => <Skeleton key={i} height={56} />)}
    </View>
  ) : feed.isError ? (
    <Notice alert action={<ActionButton variant="secondary" onPress={() => feed.refetch()}>{COPY.roster.retry}</ActionButton>}>
      {COPY.notifications.loadFailed}
    </Notice>
  ) : (
    <Notice>{COPY.notifications.nothing}</Notice>
  );

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        hitSlop={4}
        accessibilityRole="button"
        accessibilityLabel={unread > 0 ? MOBILE_COPY.bellUnread(COPY.notifications.bell, unread) : COPY.notifications.bell}
        style={styles.bell}
      >
        <Bell size={22} color={colors.foreground} />
        {unread > 0 && <View style={styles.bellDot} />}
      </Pressable>

      <Sheet visible={open} onClose={() => setOpen(false)} title={COPY.notifications.title} fraction={0.8}>
        <View style={styles.listHead}>
          <Eyebrow>{COPY.notifications.needsYou}</Eyebrow>
          {unread > 0 && (
            <ActionButton variant="ghost" size="sm" disabled={markRead.isPending} onPress={() => markRead.mutate(undefined)}>
              {COPY.notifications.markAllRead}
            </ActionButton>
          )}
        </View>
        <FlatList
          style={styles.list}
          data={feed.data?.immediate ?? []}
          keyExtractor={(n) => n.id}
          renderItem={({ item }) => <Item item={item} onPress={() => openItem(item)} />}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          ListEmptyComponent={empty}
        />
        <View style={styles.footer}>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.summary}>{COPY.notifications.held(feed.data?.heldForBriefing ?? 0)}</Text>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.summary}>{COPY.notifications.quiet(feed.data?.recordedQuietly ?? 0)}</Text>
          <ActionButton
            variant="secondary"
            fullWidth
            onPress={() => { setOpen(false); router.navigate('/personal-training/settings/notifications' as any); }}
          >
            {COPY.notifications.settings}
          </ActionButton>
        </View>
      </Sheet>
    </>
  );
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.82 },
  bell: { minWidth: 40, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  bellDot: { position: 'absolute', top: 10, right: 7, width: 9, height: 9, borderRadius: 5, backgroundColor: colors.destructive, borderWidth: 1.5, borderColor: colors.background },
  listHead: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.lg },
  list: { flex: 1 },
  item: { minHeight: 56, flexDirection: 'row', gap: 12, paddingHorizontal: spacing.lg, paddingVertical: 12 },
  itemDot: { width: 6, height: 6, borderRadius: 3, marginTop: 6 },
  itemDotUnread: { backgroundColor: colors.destructive },
  itemText: { flex: 1, gap: 2 },
  itemTitle: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.foreground },
  itemBody: { fontSize: 12, lineHeight: 17, color: colors.zinc600 },
  caption: { fontSize: 12, lineHeight: 17, color: colors.mutedForeground },
  separator: { height: StyleSheet.hairlineWidth * 2, backgroundColor: colors.border, marginLeft: spacing.lg },
  skeletons: { padding: spacing.lg, gap: spacing.sm },
  footer: { gap: 4, paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.md, borderTopWidth: StyleSheet.hairlineWidth * 2, borderTopColor: colors.border },
  summary: { fontSize: 12, lineHeight: 17, color: colors.zinc600 },
});
