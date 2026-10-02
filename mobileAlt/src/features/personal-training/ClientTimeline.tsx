// Client timeline (design handoff §6.3, layout A): kind filter chips and a
// day-grouped feed, newest first, with cursor-based "Load earlier". The
// dossier header scrolls with the feed.

import React, { useMemo, useState } from 'react';
import { ScrollView, SectionList, StyleSheet, Text, View } from 'react-native';
import {
  Activity, ClipboardCheck, CreditCard, Dumbbell, Image as ImageIcon, MessageSquare, Scale, Sparkles, StickyNote,
  type LucideIcon,
} from 'lucide-react-native';
import {
  COPY, KIND_LABEL, TIMELINE_FILTER_KINDS, clockTime, groupByDay, mergePages,
  type TimelineEvent, type TimelineKind,
} from '@axiom/personal-training-core';
import { Skeleton } from '../../components/ui/Skeleton';
import { colors, fontSize, fontWeight, radius, spacing } from '../../constants/theme';
import { Eyebrow, FilterChip, MAX_FONT_SCALE, Notice, Pill } from './components';
import { ActionButton } from './controls';
import { useTimeline } from './hooks';

const KIND_ICON: Record<TimelineKind, LucideIcon> = {
  workout: Dumbbell, checkin: ClipboardCheck, message: MessageSquare, measurement: Scale,
  photos: ImageIcon, program: Activity, note: StickyNote, billing: CreditCard,
};

function EventRow({ event, last }: { event: TimelineEvent; last: boolean }) {
  const Icon = event.ai ? Sparkles : KIND_ICON[event.kind] ?? Activity;
  return (
    <View style={styles.event}>
      <View style={styles.rail}>
        <View style={[styles.tile, event.ai && styles.tileAi]}>
          <Icon size={16} color={event.ai ? colors.background : colors.foreground} />
        </View>
        {!last && <View style={styles.connector} />}
      </View>
      <View style={[styles.eventBody, !last && styles.eventGap]}>
        <View style={styles.eventTitleRow}>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.eventTitle}>{event.title}</Text>
          {event.flag ? <Pill tone={event.flag.tone}>{event.flag.label}</Pill> : null}
        </View>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.caption}>{clockTime(event.at)} · {KIND_LABEL[event.kind] ?? event.kind}</Text>
        {event.body ? <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.eventText}>{event.body}</Text> : null}
      </View>
    </View>
  );
}

export function ClientTimeline({ clientId, header }: { clientId: string; header: React.ReactElement }) {
  const [kind, setKind] = useState<TimelineKind | null>(null);
  const kinds = useMemo(() => (kind ? [kind] : []), [kind]);
  const timeline = useTimeline(clientId, kinds);
  const sections = useMemo(
    () => groupByDay(mergePages(timeline.data?.pages ?? [])).map((d) => ({ key: d.key, title: d.heading, data: d.events })),
    [timeline.data],
  );

  const listHeader = (
    <View>
      {header}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} style={styles.chipScroll}>
        <FilterChip active={kind === null} onPress={() => setKind(null)} label={COPY.timeline.allKinds} />
        {TIMELINE_FILTER_KINDS.map((k) => (
          <FilterChip key={k} active={kind === k} onPress={() => setKind(k)} label={KIND_LABEL[k]} />
        ))}
      </ScrollView>
    </View>
  );

  const empty = timeline.isPending ? (
    <View style={styles.skeletons} accessibilityState={{ busy: true }}>
      {[0, 1, 2].map((i) => <Skeleton key={i} height={56} />)}
    </View>
  ) : timeline.isError ? (
    <Notice alert action={<ActionButton variant="secondary" onPress={() => timeline.refetch()}>{COPY.roster.retry}</ActionButton>}>{COPY.timeline.loadFailed}</Notice>
  ) : (
    <Notice>{kind ? COPY.timeline.emptyFiltered : COPY.timeline.empty}</Notice>
  );

  return (
    <SectionList
      sections={sections}
      keyExtractor={(e) => e.id}
      stickySectionHeadersEnabled={false}
      renderSectionHeader={({ section }) => <Eyebrow style={styles.dayHeading}>{section.title}</Eyebrow>}
      renderItem={({ item, index, section }) => <EventRow event={item} last={index === section.data.length - 1} />}
      ListHeaderComponent={listHeader}
      ListEmptyComponent={empty}
      ListFooterComponent={timeline.hasNextPage ? (
        <View style={styles.footer}>
          <ActionButton variant="secondary" fullWidth loading={timeline.isFetchingNextPage} onPress={() => timeline.fetchNextPage()}>
            {COPY.timeline.loadEarlier}
          </ActionButton>
        </View>
      ) : null}
      contentContainerStyle={styles.list}
    />
  );
}

const styles = StyleSheet.create({
  list: { paddingBottom: spacing.lg },
  caption: { fontSize: 12, lineHeight: 17, color: colors.mutedForeground },
  chipScroll: { flexGrow: 0 },
  chips: { gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: 6 },
  dayHeading: { paddingHorizontal: spacing.md, paddingTop: spacing.lg - 4, paddingBottom: 12 },
  event: { flexDirection: 'row', gap: 12, paddingHorizontal: spacing.md },
  rail: { alignItems: 'center' },
  tile: { width: 32, height: 32, borderRadius: radius.sm, backgroundColor: colors.muted, alignItems: 'center', justifyContent: 'center' },
  tileAi: { backgroundColor: colors.foreground },
  connector: { flex: 1, width: 1, backgroundColor: colors.border },
  eventBody: { flex: 1 },
  eventGap: { paddingBottom: spacing.lg - 4 },
  eventTitleRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: spacing.sm, rowGap: 4 },
  eventTitle: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.foreground },
  eventText: { marginTop: 4, fontSize: fontSize.base, lineHeight: 23, color: colors.zinc600 },
  skeletons: { padding: spacing.md, gap: spacing.sm },
  footer: { paddingHorizontal: spacing.md, paddingTop: spacing.lg },
});
