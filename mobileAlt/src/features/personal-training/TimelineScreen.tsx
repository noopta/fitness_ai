// Client timeline on the phone (design handoff §6.3, layout A): header with
// injuries, kind filter chips and a day-grouped feed, newest first, with
// cursor-based "Load earlier".

import React, { useMemo, useState } from 'react';
import { ScrollView, SectionList, StyleSheet, Text, View } from 'react-native';
import {
  Activity, ClipboardCheck, CreditCard, Dumbbell, Image as ImageIcon, MessageSquare, Scale, Sparkles, StickyNote,
  type LucideIcon,
} from 'lucide-react-native';
import {
  COPY, KIND_LABEL, PersonalTrainingApiError, TIMELINE_FILTER_KINDS, clockTime, groupByDay, mergePages, shortDate,
  type Client, type MeResponse, type TimelineEvent, type TimelineKind,
} from '@axiom/personal-training-core';
import { Button } from '../../components/ui/Button';
import { Skeleton } from '../../components/ui/Skeleton';
import { colors, fontSize, fontWeight, radius, spacing } from '../../constants/theme';
import { Avatar, Eyebrow, FilterChip, MAX_FONT_SCALE, Pill, StatusPill } from './components';
import { useClient, useTimeline } from './hooks';
import { Screen } from './Screen';

const KIND_ICON: Record<TimelineKind, LucideIcon> = {
  workout: Dumbbell, checkin: ClipboardCheck, message: MessageSquare, measurement: Scale,
  photos: ImageIcon, program: Activity, note: StickyNote, billing: CreditCard,
};

function ClientHeader({ client }: { client: Client }) {
  const line = [
    client.program?.goal,
    client.program ? `${client.program.blockLabel} · week ${client.program.week} of ${client.program.weeks}` : COPY.roster.noProgram,
    COPY.timeline.tenure(shortDate(new Date(client.joinedAt))),
  ].filter(Boolean).join(' · ');

  return (
    <View style={styles.clientHeader}>
      <View style={styles.clientTop}>
        <Avatar initials={client.initials} size={56} />
        <View style={styles.clientText}>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={styles.clientName}>{client.name}</Text>
          <StatusPill status={client.status} />
          {client.statusReason ? <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.reason}>{client.statusReason}</Text> : null}
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.caption}>{line}</Text>
        </View>
      </View>
      <View style={styles.injuries} accessibilityLabel="Injuries">
        {client.contraindications.length === 0
          ? <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.caption}>{COPY.timeline.noContraindications}</Text>
          : client.contraindications.map((c) => (
            <View key={c.label} style={[styles.injury, c.active ? styles.injuryActive : styles.injuryCleared]}>
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.injuryText, { color: c.active ? colors.destructiveInk : colors.zinc600 }]}>
                {c.label}{c.active ? '' : ` · ${COPY.timeline.cleared}`}
              </Text>
            </View>
          ))}
      </View>
    </View>
  );
}

function EventRow({ event, last }: { event: TimelineEvent; last: boolean }) {
  const Icon = event.ai ? Sparkles : KIND_ICON[event.kind];
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
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.caption}>{clockTime(event.at)} · {KIND_LABEL[event.kind]}</Text>
        {event.body ? <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.eventText}>{event.body}</Text> : null}
      </View>
    </View>
  );
}

export function TimelineScreen({ me, clientId }: { me: MeResponse; clientId: string }) {
  const client = useClient(clientId);
  const [kind, setKind] = useState<TimelineKind | null>(null);
  const kinds = useMemo(() => (kind ? [kind] : []), [kind]);
  const timeline = useTimeline(clientId, kinds);
  const sections = useMemo(
    () => groupByDay(mergePages(timeline.data?.pages ?? [])).map((d) => ({ key: d.key, title: d.heading, data: d.events })),
    [timeline.data],
  );

  const notFound = client.error instanceof PersonalTrainingApiError && client.error.status === 404;
  if (client.isError) {
    return (
      <Screen me={me} title={COPY.roster.title} back>
        <View style={styles.notice} accessibilityRole="alert">
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.noticeText}>{notFound ? COPY.timeline.notFound : COPY.timeline.loadFailed}</Text>
          {!notFound && <Button variant="secondary" onPress={() => client.refetch()}>{COPY.roster.retry}</Button>}
        </View>
      </Screen>
    );
  }

  const header = (
    <View>
      {client.data ? <ClientHeader client={client.data.client} /> : (
        <View style={styles.clientHeader} accessibilityState={{ busy: true }}><Skeleton width={220} height={56} /></View>
      )}
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
    <View style={styles.notice} accessibilityRole="alert">
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.noticeText}>{COPY.timeline.loadFailed}</Text>
      <Button variant="secondary" onPress={() => timeline.refetch()}>{COPY.roster.retry}</Button>
    </View>
  ) : (
    <View style={styles.notice}>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.noticeText}>{kind ? COPY.timeline.emptyFiltered : COPY.timeline.empty}</Text>
    </View>
  );

  return (
    <Screen me={me} title={client.data?.client.name ?? COPY.roster.title} back>
      <SectionList
        sections={sections}
        keyExtractor={(e) => e.id}
        stickySectionHeadersEnabled={false}
        renderSectionHeader={({ section }) => <Eyebrow style={styles.dayHeading}>{section.title}</Eyebrow>}
        renderItem={({ item, index, section }) => <EventRow event={item} last={index === section.data.length - 1} />}
        ListHeaderComponent={header}
        ListEmptyComponent={empty}
        ListFooterComponent={timeline.hasNextPage ? (
          <View style={styles.footer}>
            <Button variant="secondary" fullWidth loading={timeline.isFetchingNextPage} onPress={() => timeline.fetchNextPage()}>
              {COPY.timeline.loadEarlier}
            </Button>
          </View>
        ) : null}
        contentContainerStyle={styles.list}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { paddingBottom: spacing.lg },
  clientHeader: { padding: spacing.md, gap: spacing.sm + 4 },
  clientTop: { flexDirection: 'row', gap: spacing.md },
  clientText: { flex: 1, gap: 4 },
  clientName: { fontSize: 22, fontWeight: fontWeight.bold, letterSpacing: -0.4, color: colors.foreground },
  reason: { fontSize: fontSize.base, color: colors.zinc600 },
  caption: { fontSize: 12, lineHeight: 17, color: colors.mutedForeground },
  injuries: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  injury: { paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.sm },
  injuryActive: { backgroundColor: colors.destructiveSoft },
  injuryCleared: { backgroundColor: colors.muted },
  injuryText: { fontSize: fontSize.xs, fontWeight: fontWeight.semibold },
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
  notice: { padding: spacing.xl, gap: spacing.md, alignItems: 'center' },
  noticeText: { fontSize: fontSize.base, color: colors.zinc600, textAlign: 'center' },
  footer: { paddingHorizontal: spacing.md, paddingTop: spacing.lg },
});
