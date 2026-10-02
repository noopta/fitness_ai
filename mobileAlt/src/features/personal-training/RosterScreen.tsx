// Client roster on the phone (design handoff §6.2): list rows of at least
// 64pt — avatar with status dot, name, reason line, sparkline — and a tap
// opens the client. An Ask Anakin answer can be applied as a filter through
// the `anakin` route param.

import React, { useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Search } from 'lucide-react-native';
import {
  COPY, FILTER_LABEL, ROSTER_FILTERS, STATUS_LABEL, countByStatus, filterClients, matchesQuery, reasonLine,
  type Client, type MeResponse, type RosterFilter,
} from '@axiom/personal-training-core';
import { Skeleton } from '../../components/ui/Skeleton';
import { colors, fontSize, fontWeight, radius, spacing } from '../../constants/theme';
import { Avatar, FilterChip, MAX_FONT_SCALE, Sparkline, clientPath } from './components';
import { ActionButton } from './controls';
import { useAnakinFilter, useRoster } from './hooks';
import { InviteSheet } from './InviteSheet';
import { Screen } from './Screen';

function ClientRow({ client, evidence, onPress }: { client: Client; evidence?: string; onPress: () => void }) {
  // Under an Ask Anakin filter the reason line is Anakin's evidence for this client.
  const reason = evidence ?? reasonLine(client);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={[client.name, STATUS_LABEL[client.status], reason].filter(Boolean).join('. ')}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <Avatar initials={client.initials} status={client.status} />
      <View style={styles.rowText}>
        {/* Two lines rather than truncation: client names must survive 1.3× type (§10). */}
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} numberOfLines={2} style={styles.name}>{client.name}</Text>
        {reason ? <Text maxFontSizeMultiplier={MAX_FONT_SCALE} numberOfLines={2} style={styles.reason}>{reason}</Text> : null}
      </View>
      <Sparkline series={client.engagement8w} trend={client.engagementTrend} />
    </Pressable>
  );
}

export function RosterScreen({ me }: { me: MeResponse }) {
  const router = useRouter();
  const roster = useRoster();
  const [filter, setFilter] = useState<RosterFilter>('all');
  const [q, setQ] = useState('');
  const [inviteOpen, setInviteOpen] = useState(false);

  // "Apply as roster filter" from Ask Anakin arrives as ?anakin=threadId:messageId.
  const params = useLocalSearchParams<{ anakin?: string | string[] }>();
  const anakinParam = Array.isArray(params.anakin) ? params.anakin[0] : params.anakin;
  const [filterThread, filterMessage] = (anakinParam ?? '').split(':');
  const anakin = useAnakinFilter(filterThread ?? '', filterMessage ?? '');
  const evidence = useMemo(() => (anakin.data ? new Map(anakin.data.rows.map((r) => [r.clientId, r.evidence])) : null), [anakin.data]);

  const everyone = roster.data?.clients ?? [];
  const all = useMemo(() => (evidence ? everyone.filter((c) => evidence.has(c.id)) : everyone), [everyone, evidence]);
  // Counts follow the search box but not the chip, so each chip keeps showing how many it would reveal.
  const counts = useMemo(() => countByStatus(all.filter((c) => matchesQuery(c, q))), [all, q]);
  const visible = useMemo(() => filterClients(all, filter, q), [all, filter, q]);

  const header = (
    <View style={styles.header}>
      <View style={styles.headerRow}>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.count}>
          {roster.data ? COPY.roster.countLine(all.length) : ' '}
        </Text>
        <ActionButton size="sm" onPress={() => setInviteOpen(true)}>{COPY.roster.invite}</ActionButton>
      </View>
      {filterThread && (anakin.data || anakin.isError) ? (
        <View style={styles.banner} accessibilityLiveRegion="polite">
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.bannerText}>
            {anakin.data ? COPY.anakin.filterBanner(anakin.data.question) : COPY.anakin.failed}
          </Text>
          <ActionButton variant="secondary" size="sm" onPress={() => router.setParams({ anakin: '' })}>{COPY.anakin.clearFilter}</ActionButton>
        </View>
      ) : null}
      <View style={styles.search}>
        <Search size={16} color={colors.mutedForeground} />
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder={COPY.roster.searchPlaceholder}
          placeholderTextColor={colors.mutedForeground}
          accessibilityLabel={COPY.roster.searchPlaceholder}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          maxFontSizeMultiplier={MAX_FONT_SCALE}
          style={styles.searchInput}
        />
      </View>
      {/* Horizontal scroll, never wrap (§5). */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} style={styles.chipScroll}>
        {ROSTER_FILTERS.map((f) => (
          <FilterChip key={f} active={filter === f} onPress={() => setFilter(f)} label={FILTER_LABEL[f]} count={counts[f]} />
        ))}
      </ScrollView>
    </View>
  );

  const empty = roster.isPending ? (
    <View style={styles.skeletons} accessibilityState={{ busy: true }}>
      {[0, 1, 2, 3].map((i) => <Skeleton key={i} height={64} />)}
    </View>
  ) : roster.isError ? (
    <View style={styles.notice} accessibilityRole="alert">
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.noticeBody}>{COPY.roster.loadFailed}</Text>
      <ActionButton variant="secondary" onPress={() => roster.refetch()}>{COPY.roster.retry}</ActionButton>
    </View>
  ) : everyone.length === 0 ? (
    <View style={styles.notice}>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.noticeTitle}>{COPY.roster.emptyTitle}</Text>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.noticeBody}>{COPY.roster.emptyBody}</Text>
    </View>
  ) : (
    <View style={styles.notice}>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.noticeBody}>{COPY.roster.noMatches}</Text>
    </View>
  );

  return (
    <Screen me={me} title={COPY.roster.title} active="clients">
      <FlatList
        data={visible}
        keyExtractor={(c) => c.id}
        renderItem={({ item }) => (
          <ClientRow client={item} evidence={evidence?.get(item.id)} onPress={() => router.navigate(clientPath(item.id) as any)} />
        )}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        ListHeaderComponent={header}
        ListEmptyComponent={empty}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={roster.isRefetching} onRefresh={() => roster.refetch()} tintColor={colors.mutedForeground} />}
      />
      <InviteSheet visible={inviteOpen} onClose={() => setInviteOpen(false)} practiceName={me.practice?.name ?? ''} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.82 },
  list: { paddingBottom: spacing.lg },
  header: { paddingTop: spacing.md, gap: spacing.sm + 4, marginBottom: spacing.sm },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.md },
  count: { fontSize: fontSize.base, color: colors.zinc600 },
  banner: {
    flexDirection: 'row', alignItems: 'center', gap: 12, marginHorizontal: spacing.md, paddingLeft: spacing.md, paddingRight: spacing.sm,
    paddingVertical: spacing.sm, borderRadius: radius.md, backgroundColor: colors.foreground,
  },
  bannerText: { flex: 1, fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.background },
  search: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginHorizontal: spacing.md, paddingHorizontal: 12,
    minHeight: 44, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth * 2, borderColor: colors.border,
  },
  searchInput: { flex: 1, fontSize: fontSize.base, color: colors.foreground, paddingVertical: 0 },
  chipScroll: { flexGrow: 0 },
  chips: { gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: 6 },
  row: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: spacing.md, paddingVertical: 10 },
  rowText: { flex: 1 },
  name: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.foreground },
  reason: { fontSize: 12, lineHeight: 17, color: colors.mutedForeground },
  separator: { height: StyleSheet.hairlineWidth * 2, backgroundColor: colors.border, marginLeft: spacing.md },
  skeletons: { paddingHorizontal: spacing.md, gap: spacing.sm },
  notice: { padding: spacing.xl, gap: spacing.sm, alignItems: 'center' },
  noticeTitle: { fontSize: fontSize.lg, fontWeight: fontWeight.semibold, color: colors.foreground },
  noticeBody: { fontSize: fontSize.base, color: colors.zinc600, textAlign: 'center' },
});
